/**
 * POST /api/tournaments/register
 *
 * Public — generic registration for any tournament format that uses the
 * tournament_entries table (RR, Single Elim, FMLC, FFIC, both singles + doubles).
 *
 * Mirrors /api/quads/register but writes to tournament_entries instead.
 *
 * Body:
 *   {
 *     slug, player_name, player_email, player_phone,
 *     parent_name, parent_email, parent_phone,
 *     date_of_birth, gender, ntrp,
 *     // Doubles only:
 *     partner_name, partner_email, partner_phone, partner_ntrp
 *   }
 *
 * Returns: { url?, entry_id, free? }
 */

import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { stripe, platformFeeForCents } from '@/lib/stripe';
import { computeQuadComposite } from '@/lib/quads';
import { sendQuadsConfirmEmail, sendQuadsWaitlistEmail } from '@/lib/quadEmails';

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
  const t = v.trim();
  return t.length === 0 ? null : t.slice(0, max);
}

function clampNumber(v: unknown, min: number, max: number): number | null {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  if (!Number.isFinite(n)) return null;
  if (n < min || n > max) return null;
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

function ageOnDate(dob: Date, on: Date): number {
  let age = on.getFullYear() - dob.getFullYear();
  const m = on.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && on.getDate() < dob.getDate())) age--;
  return age;
}

const VALID_FORMATS = new Set([
  'rr-singles',
  'rr-doubles',
  'single-elim-singles',
  'single-elim-doubles',
  'fmlc-singles',
  'fmlc-doubles',
  'ffic-singles',
  'ffic-doubles',
]);

export async function POST(request: Request) {
  try {
    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
      request.headers.get('x-real-ip') ||
      'unknown';
    if (!checkRateLimit(ip)) {
      return NextResponse.json(
        { error: 'Too many requests. Please try again in a minute.' },
        { status: 429 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const slug = clampText(body.slug, 80);
    const player_name = clampText(body.player_name, 80);
    if (!slug || !player_name) {
      return NextResponse.json({ error: 'Slug and player name are required.' }, { status: 400 });
    }

    const player_email = clampText(body.player_email, 120);
    const player_phone = clampText(body.player_phone, 30);
    const parent_name = clampText(body.parent_name, 80);
    const parent_email = clampText(body.parent_email, 120);
    const parent_phone = clampText(body.parent_phone, 30);
    const date_of_birth = clampText(body.date_of_birth, 10);
    const genderRaw = clampText(body.gender, 20)?.toLowerCase();
    const gender =
      genderRaw === 'male' || genderRaw === 'female' || genderRaw === 'nonbinary'
        ? genderRaw
        : null;
    const ntrp = clampNumber(body.ntrp, 1, 7);
    const partner_name = clampText(body.partner_name, 80);
    const partner_email = clampText(body.partner_email, 120);
    const partner_phone = clampText(body.partner_phone, 30);
    const partner_ntrp = clampNumber(body.partner_ntrp, 1, 7);

    const admin = getSupabaseAdmin();

    const { data: ev, error: evErr } = await admin
      .from('events')
      .select(
        'id, name, slug, public_status, public_registration, registration_opens_at, registration_closes_at, max_players, age_max, gender_restriction, entry_fee_cents, stripe_account_id, event_date, match_format, user_id'
      )
      .eq('slug', slug)
      .maybeSingle();
    if (evErr) return NextResponse.json({ error: evErr.message }, { status: 500 });
    if (!ev) return NextResponse.json({ error: 'Tournament not found.' }, { status: 404 });

    const e: any = ev;

    if (!VALID_FORMATS.has(e.match_format)) {
      return NextResponse.json(
        { error: 'This tournament uses a format that does not accept signups via this endpoint.' },
        { status: 400 }
      );
    }
    const isDoubles = e.match_format.endsWith('-doubles');

    if (!e.public_registration || e.public_status !== 'open') {
      return NextResponse.json(
        { error: 'Registration is not open for this tournament.' },
        { status: 400 }
      );
    }

    const now = Date.now();
    if (e.registration_opens_at && Date.parse(e.registration_opens_at) > now) {
      return NextResponse.json({ error: 'Registration has not opened yet.' }, { status: 400 });
    }
    if (e.registration_closes_at && Date.parse(e.registration_closes_at) < now) {
      return NextResponse.json({ error: 'Registration has closed.' }, { status: 400 });
    }

    if (e.gender_restriction === 'boys' && gender !== 'male') {
      return NextResponse.json(
        { error: 'This tournament is restricted to boys.' },
        { status: 400 }
      );
    }
    if (e.gender_restriction === 'girls' && gender !== 'female') {
      return NextResponse.json(
        { error: 'This tournament is restricted to girls.' },
        { status: 400 }
      );
    }

    if (e.age_max && date_of_birth) {
      const dob = new Date(date_of_birth + 'T00:00:00Z');
      const eventDay = e.event_date ? new Date(e.event_date + 'T00:00:00Z') : new Date();
      if (!Number.isNaN(dob.getTime())) {
        const age = ageOnDate(dob, eventDay);
        if (age > e.age_max) {
          return NextResponse.json(
            { error: `Player is older than the ${e.age_max}-and-under age cap.` },
            { status: 400 }
          );
        }
      }
    }

    if (isDoubles && !partner_name) {
      return NextResponse.json(
        { error: 'Doubles tournament — partner name is required.' },
        { status: 400 }
      );
    }

    const { utr, utrId } = await lookupUtr(player_name);
    const composite = computeQuadComposite({ utr, ntrp });

    const { data: entry, error: insErr } = await admin
      .from('tournament_entries')
      .insert({
        event_id: e.id,
        player_name,
        player_email,
        player_phone,
        parent_name,
        parent_email,
        parent_phone,
        date_of_birth: date_of_birth || null,
        gender,
        ntrp,
        utr,
        utr_id: utrId,
        composite_rating: composite || null,
        partner_name: isDoubles ? partner_name : null,
        partner_email: isDoubles ? partner_email : null,
        partner_phone: isDoubles ? partner_phone : null,
        partner_ntrp: isDoubles ? partner_ntrp : null,
        position: 'pending_payment',
        payment_status: 'pending',
      })
      .select('id')
      .single();
    if (insErr || !entry) {
      return NextResponse.json(
        { error: insErr?.message || 'Could not create entry' },
        { status: 500 }
      );
    }

    const fee = e.entry_fee_cents ?? 0;
    if (fee <= 0) {
      let position: 'in_draw' | 'waitlist' = 'in_draw';
      if (e.max_players && e.max_players > 0) {
        const { count } = await admin
          .from('tournament_entries')
          .select('*', { count: 'exact', head: true })
          .eq('event_id', e.id)
          .in('position', ['in_draw'])
          .neq('id', (entry as any).id);
        if ((count ?? 0) >= e.max_players) position = 'waitlist';
      }
      await admin
        .from('tournament_entries')
        .update({ position, payment_status: 'waived' })
        .eq('id', (entry as any).id);

      try {
        const recipient = player_email || parent_email;
        if (recipient) {
          const origin = new URL(request.url).origin;
          const args = {
            to: recipient,
            playerName: player_name,
            tournamentName: e.name,
            publicUrl: `${origin}/tournaments/${slug}`,
          };
          if (position === 'in_draw') {
            await sendQuadsConfirmEmail({ ...args, tournamentDate: e.event_date ?? null });
          } else {
            await sendQuadsWaitlistEmail(args);
          }
        }
      } catch (err) {
        console.error('tournament free email failed:', err);
      }

      return NextResponse.json({ entry_id: (entry as any).id, free: true, position });
    }

    if (!e.stripe_account_id) {
      return NextResponse.json(
        {
          error:
            "This tournament requires payment but the director hasn't connected Stripe yet. Please contact the tournament director.",
        },
        { status: 400 }
      );
    }

    const origin = new URL(request.url).origin;
    const applicationFee = platformFeeForCents(fee);
    const session = await stripe.checkout.sessions.create(
      {
        mode: 'payment',
        payment_method_types: ['card'],
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: 'usd',
              unit_amount: fee,
              product_data: {
                name: `Entry: ${e.name}`,
                description: `Tournament entry — ${player_name}${isDoubles && partner_name ? ` + ${partner_name}` : ''}`,
              },
            },
          },
        ],
        ...(applicationFee > 0 && {
          payment_intent_data: { application_fee_amount: applicationFee },
        }),
        customer_email: player_email || parent_email || undefined,
        success_url: `${origin}/tournaments/${slug}/registered?entry=${(entry as any).id}`,
        cancel_url: `${origin}/tournaments/${slug}?cancelled=1`,
        metadata: {
          tournament_entry_id: (entry as any).id,
          slug,
        },
      },
      { stripeAccount: e.stripe_account_id }
    );

    await admin
      .from('tournament_entries')
      .update({ stripe_session_id: session.id })
      .eq('id', (entry as any).id);

    return NextResponse.json({ url: session.url, entry_id: (entry as any).id });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Server error' },
      { status: 500 }
    );
  }
}
