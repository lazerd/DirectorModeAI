/**
 * POST /api/leagues/[id]/add-entry
 *
 * Director-only endpoint to manually add an entry to a league. Mirrors the
 * public /api/leagues/register logic but:
 *   - Requires the caller be the director of the league
 *   - Can mark the entry as paid immediately
 *   - Can skip the partner confirmation email for doubles (the director is
 *     vouching for both players, so we flip entry_status straight to active)
 *   - Optionally creates a vault player entry so the person is remembered
 *     for future leagues (not done by default in v1)
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { computeCompositeRating, computeDoublesComposite } from '@/lib/leagueRatings';
import { generateToken, isDoubles, type CategoryKey } from '@/lib/leagueUtils';

function clampText(v: unknown, max = 120): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length === 0 ? null : t.slice(0, max);
}

function clampNumber(v: unknown, min: number, max: number): number | null {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
}

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
    const utr = raw && raw !== 0 ? parseFloat(String(raw)) : null;
    const utrId = p.profileId ? String(p.profileId) : p.id ? String(p.id) : null;
    return { utr, utrId };
  } catch {
    return { utr: null, utrId: null };
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: leagueId } = await params;

    // Auth: must be the league director
    const userClient = await createClient();
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const admin = getSupabaseAdmin();

    const { data: league } = await admin
      .from('leagues')
      .select('id, director_id, status')
      .eq('id', leagueId)
      .maybeSingle();
    if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 });
    if ((league as any).director_id !== user.id) {
      return NextResponse.json({ error: 'Not the league director' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const categoryKey = clampText(body.categoryKey, 32) as CategoryKey | null;
    const captainName = clampText(body.captainName);
    const captainEmail = clampText(body.captainEmail);
    const captainPhone = clampText(body.captainPhone, 32);
    const captainNtrp = clampNumber(body.captainNtrp, 2.0, 7.0);
    const captainWtn = clampNumber(body.captainWtn, 1, 40);
    const markPaid = body.markPaid !== false;   // default true for admin entries

    if (!categoryKey) return NextResponse.json({ error: 'Missing category' }, { status: 400 });
    if (!captainName) return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    if (!captainEmail || !captainEmail.includes('@')) {
      return NextResponse.json({ error: 'Valid email is required' }, { status: 400 });
    }
    if (captainNtrp == null) {
      return NextResponse.json({ error: 'NTRP rating is required' }, { status: 400 });
    }

    // Resolve the category
    const { data: category } = await admin
      .from('league_categories')
      .select('id, is_enabled')
      .eq('league_id', leagueId)
      .eq('category_key', categoryKey)
      .maybeSingle();
    if (!category || !(category as any).is_enabled) {
      return NextResponse.json({ error: 'Category not available' }, { status: 400 });
    }

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
      if (!partnerName || partnerNtrp == null) {
        return NextResponse.json(
          { error: 'Partner name and NTRP are required for doubles' },
          { status: 400 }
        );
      }
    }

    // UTR lookups
    const [captainUtrLookup, partnerUtrLookup] = await Promise.all([
      lookupUtr(captainName),
      doubles && partnerName ? lookupUtr(partnerName) : Promise.resolve({ utr: null, utrId: null }),
    ]);

    // Composite
    const captainInputs = { ntrp: captainNtrp, utr: captainUtrLookup.utr, wtn: captainWtn };
    const rating = doubles && partnerNtrp != null
      ? computeDoublesComposite(captainInputs, {
          ntrp: partnerNtrp,
          utr: partnerUtrLookup.utr,
          wtn: partnerWtn,
        })
      : computeCompositeRating(captainInputs);

    // Tokens (still needed so the player can get match emails later)
    const captainToken = generateToken();
    const partnerToken = doubles ? generateToken() : null;

    const entryRow = {
      league_id: leagueId,
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
      // Admin-entered doubles skip the partner confirmation flow — the
      // director is vouching for both players, so entry goes straight to active.
      partner_confirmed_at: doubles ? new Date().toISOString() : null,
      composite_score: rating.composite,
      rating_source: rating.source,
      rating_confidence: rating.confidence,
      payment_status: markPaid ? 'paid' : 'pending',
      entry_status: 'active',
    };

    const { data: newEntry, error: insertErr } = await admin
      .from('league_entries')
      .insert(entryRow)
      .select('id, composite_score')
      .single();
    if (insertErr || !newEntry) {
      return NextResponse.json(
        { error: `Insert failed: ${insertErr?.message || 'unknown'}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      entryId: (newEntry as any).id,
      composite: (newEntry as any).composite_score,
    });
  } catch (err: any) {
    console.error('Add entry error:', err);
    return NextResponse.json({ error: err?.message || 'Internal error' }, { status: 500 });
  }
}
