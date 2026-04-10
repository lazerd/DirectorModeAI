/**
 * Public league entry submission endpoint.
 *
 * Accepts an entry from an unauthenticated visitor on the public signup page
 * and writes to league_entries using the service role client (bypasses RLS).
 *
 * Side effects:
 *   - For doubles, a unique partner confirmation token is generated and a
 *     confirmation email is sent to the partner via Resend.
 *   - Composite rating is computed from UTR (auto-lookup by name) + NTRP +
 *     optional WTN.
 */

import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { computeCompositeRating, computeDoublesComposite } from '@/lib/leagueRatings';
import { generateToken, isDoubles, CATEGORY_LABELS, type CategoryKey } from '@/lib/leagueUtils';

const resend = new Resend(process.env.RESEND_API_KEY);

// Same rate-limit pattern as the recommend routes.
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 20;
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    rateBuckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (bucket.count >= RATE_LIMIT_MAX) return false;
  bucket.count += 1;
  return true;
}

function clampText(v: unknown, max = 120): string | null {
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  return trimmed.length === 0 ? null : trimmed.slice(0, max);
}

function clampNumber(v: unknown, min: number, max: number): number | null {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  if (!Number.isFinite(n)) return null;
  if (n < min || n > max) return null;
  return n;
}

/** Fetch UTR singles/doubles by player name via the public UTR search API. */
async function lookupUtr(name: string): Promise<{ utr: number | null; utrId: string | null }> {
  try {
    const url = `https://api.utrsports.net/v2/search/players?query=${encodeURIComponent(name)}&top=3`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return { utr: null, utrId: null };
    const data = await res.json();
    const hits = data?.hits || [];
    if (hits.length === 0) return { utr: null, utrId: null };
    const p = hits[0].source || hits[0];
    const raw = p.singlesUtr ?? p.thpiSinglesRating ?? p.singlesRating ?? null;
    // 0.0 means Unrated in UTR — treat as no rating
    const utr = raw && raw !== 0 ? parseFloat(String(raw)) : null;
    const utrId = p.profileId ? String(p.profileId) : (p.id ? String(p.id) : null);
    return { utr, utrId };
  } catch {
    return { utr: null, utrId: null };
  }
}

export async function POST(request: Request) {
  try {
    // Rate-limit per IP to prevent abuse.
    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
      request.headers.get('x-real-ip') ||
      'unknown';
    if (!checkRateLimit(ip)) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const body = await request.json().catch(() => ({}));

    const leagueSlug = clampText(body.leagueSlug, 64);
    const categoryKey = clampText(body.categoryKey, 32) as CategoryKey | null;
    if (!leagueSlug || !categoryKey) {
      return NextResponse.json({ error: 'Missing league or category.' }, { status: 400 });
    }

    const captainName = clampText(body.captainName);
    const captainEmail = clampText(body.captainEmail);
    const captainPhone = clampText(body.captainPhone, 32);
    const captainNtrp = clampNumber(body.captainNtrp, 2.0, 7.0);
    const captainWtn = clampNumber(body.captainWtn, 1, 40);

    if (!captainName) return NextResponse.json({ error: 'Name is required.' }, { status: 400 });
    if (!captainEmail || !captainEmail.includes('@')) {
      return NextResponse.json({ error: 'Valid email is required.' }, { status: 400 });
    }
    if (captainNtrp == null) {
      return NextResponse.json({ error: 'NTRP rating is required.' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    // 1. Resolve the league + category
    const { data: league, error: leagueErr } = await supabase
      .from('leagues')
      .select('id, name, slug, status, registration_opens_at, registration_closes_at')
      .eq('slug', leagueSlug)
      .maybeSingle();

    if (leagueErr || !league) {
      return NextResponse.json({ error: 'League not found.' }, { status: 404 });
    }
    if ((league as any).status !== 'open') {
      return NextResponse.json({ error: 'Registration for this league is not currently open.' }, { status: 400 });
    }

    const now = new Date();
    const opensAt = (league as any).registration_opens_at ? new Date((league as any).registration_opens_at as string) : null;
    const closesAt = (league as any).registration_closes_at ? new Date((league as any).registration_closes_at as string) : null;
    if (opensAt && now < opensAt) {
      return NextResponse.json({ error: 'Registration has not opened yet.' }, { status: 400 });
    }
    if (closesAt && now > closesAt) {
      return NextResponse.json({ error: 'Registration has closed.' }, { status: 400 });
    }

    const { data: category, error: catErr } = await supabase
      .from('league_categories')
      .select('id, category_key, entry_fee_cents, is_enabled')
      .eq('league_id', (league as any).id)
      .eq('category_key', categoryKey)
      .maybeSingle();

    if (catErr || !category) {
      return NextResponse.json({ error: 'Category not available.' }, { status: 400 });
    }
    if (!(category as any).is_enabled) {
      return NextResponse.json({ error: 'This category is not running.' }, { status: 400 });
    }

    // 2. Validate doubles partner fields if required
    const doubles = isDoubles(categoryKey);
    let partnerName: string | null = null;
    let partnerEmail: string | null = null;
    let partnerPhone: string | null = null;
    let partnerNtrp: number | null = null;
    let partnerWtn: number | null = null;

    if (doubles) {
      partnerName = clampText(body.partnerName);
      partnerEmail = clampText(body.partnerEmail);
      partnerPhone = clampText(body.partnerPhone, 32);
      partnerNtrp = clampNumber(body.partnerNtrp, 2.0, 7.0);
      partnerWtn = clampNumber(body.partnerWtn, 1, 40);
      if (!partnerName || !partnerEmail || !partnerEmail.includes('@') || partnerNtrp == null) {
        return NextResponse.json(
          { error: 'Partner name, email, and NTRP are required for doubles.' },
          { status: 400 }
        );
      }
    }

    // 3. Auto-lookup UTRs in parallel (don't block on failure)
    const [captainUtrLookup, partnerUtrLookup] = await Promise.all([
      lookupUtr(captainName),
      doubles && partnerName ? lookupUtr(partnerName) : Promise.resolve({ utr: null, utrId: null }),
    ]);

    // 4. Compute composite
    const captainInputs = {
      ntrp: captainNtrp,
      utr: captainUtrLookup.utr,
      wtn: captainWtn,
    };
    const rating = doubles && partnerNtrp != null
      ? computeDoublesComposite(captainInputs, {
          ntrp: partnerNtrp,
          utr: partnerUtrLookup.utr,
          wtn: partnerWtn,
        })
      : computeCompositeRating(captainInputs);

    // 5. Tokens
    const captainToken = generateToken();
    const partnerToken = doubles ? generateToken() : null;

    // 6. Insert the entry
    const entryRow = {
      league_id: (league as any).id,
      category_id: (category as any).id,
      captain_name: captainName,
      captain_email: captainEmail.toLowerCase(),
      captain_phone: captainPhone,
      captain_ntrp: captainNtrp,
      captain_utr: captainUtrLookup.utr,
      captain_utr_id: captainUtrLookup.utrId,
      captain_wtn: captainWtn,
      captain_token: captainToken,
      partner_name: partnerName,
      partner_email: partnerEmail?.toLowerCase() ?? null,
      partner_phone: partnerPhone,
      partner_ntrp: partnerNtrp,
      partner_utr: partnerUtrLookup.utr,
      partner_utr_id: partnerUtrLookup.utrId,
      partner_wtn: partnerWtn,
      partner_token: partnerToken,
      composite_score: rating.composite,
      rating_source: rating.source,
      rating_confidence: rating.confidence,
      payment_status: 'pending',
      entry_status: doubles ? 'pending_confirm' : 'active',
    };

    const { data: newEntry, error: insertErr } = await supabase
      .from('league_entries')
      .insert(entryRow)
      .select('id')
      .single();

    if (insertErr || !newEntry) {
      console.error('Entry insert failed:', insertErr);
      return NextResponse.json(
        { error: `Failed to submit entry: ${insertErr?.message || 'unknown'}` },
        { status: 500 }
      );
    }

    // 7. Send partner confirmation email (doubles only, fire-and-forget)
    if (doubles && partnerEmail && partnerToken) {
      const origin = new URL(request.url).origin;
      const confirmUrl = `${origin}/leagues/confirm-partner/${partnerToken}`;
      const categoryLabel = CATEGORY_LABELS[categoryKey];
      const leagueName = (league as any).name;

      try {
        await resend.emails.send({
          from: process.env.RESEND_FROM_EMAIL || 'CoachMode Leagues <noreply@mail.coachmode.ai>',
          to: partnerEmail,
          subject: `${captainName} signed you up as their doubles partner — ${leagueName}`,
          html: `
            <div style="font-family: -apple-system, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
              <h2 style="color: #ea580c; margin-top: 0;">Confirm your doubles partnership</h2>
              <p><strong>${captainName}</strong> just registered you as their partner for:</p>
              <div style="background: #fff7ed; border-left: 4px solid #ea580c; padding: 14px 18px; border-radius: 6px; margin: 16px 0;">
                <div style="font-weight: 600; font-size: 16px;">${leagueName}</div>
                <div style="color: #6b7280; font-size: 14px; margin-top: 4px;">${categoryLabel}</div>
              </div>
              <p>Click the button below to confirm you're playing. If you didn't expect this email or don't want to play, just ignore it.</p>
              <p style="margin: 24px 0;">
                <a href="${confirmUrl}" style="display: inline-block; background: #ea580c; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 500;">Confirm partnership</a>
              </p>
              <p style="color: #6b7280; font-size: 12px; margin-top: 32px;">
                This confirmation link is unique to you and expires when registration closes.
              </p>
            </div>
          `,
        });
      } catch (emailErr) {
        console.error('Partner confirmation email failed:', emailErr);
        // Don't block the entry on email failure.
      }
    }

    return NextResponse.json({
      success: true,
      entryId: (newEntry as any).id,
      composite: rating.composite,
      doubles,
      partnerConfirmationRequired: doubles,
    });
  } catch (err: any) {
    console.error('League register error:', err);
    return NextResponse.json({ error: err?.message || 'Internal error' }, { status: 500 });
  }
}
