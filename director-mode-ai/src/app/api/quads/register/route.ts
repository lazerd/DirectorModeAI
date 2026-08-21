/**
 * POST /api/quads/register
 *
 * Public endpoint — no auth required. A parent/player submits an entry from
 * the public signup page. We:
 *   1. Validate the slug + that registration is open
 *   2. Look up UTR by player name (best-effort, soft fail)
 *   3. Insert a quad_entries row in `pending_payment`
 *   4. Branch on the event's entry_flow:
 *      - 'request_then_invite' — no payment at signup; the entry waits in
 *        'requested' for the director to send a payment invite.
 *      - 'pay_now' — confirm immediately (free event) or start checkout.
 *        Payment rails in priority order: Square-hosted payment link, a
 *        static external_payment_url, then legacy Stripe Connect.
 *
 * Body:
 *   {
 *     slug: string,
 *     player_name, player_email, player_phone, parent_name, parent_email,
 *     parent_phone, date_of_birth (YYYY-MM-DD), gender, ntrp
 *   }
 *
 * Returns: { url?: string, entry_id: string, free?: boolean }
 */

import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { stripe, platformFeeForCents } from '@/lib/stripe';
import { squareConfigured, createEntryPaymentLink } from '@/lib/square';
import { computeQuadComposite } from '@/lib/quads';
import {
  sendQuadsConfirmEmail,
  sendQuadsWaitlistEmail,
  sendQuadRequestReceivedEmail,
} from '@/lib/quadEmails';
import { claimCoupon, releaseCoupon, normalizeCode } from '@/lib/quadCoupons';
import {
  parseDivisions,
  divisionLabel,
  ageOnDate as ageOnDateDiv,
  isEligibleForDivision,
  PLAYERS_PER_QUAD,
} from '@/lib/quadDivisions';

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

    const admin = getSupabaseAdmin();

    const { data: ev, error: evErr } = await admin
      .from('events')
      .select(
        'id, name, slug, series_slug, public_status, public_registration, registration_opens_at, registration_closes_at, max_players, age_max, gender_restriction, entry_fee_cents, stripe_account_id, external_payment_url, event_date, user_id, divisions, entry_flow, total_quads'
      )
      .eq('slug', slug)
      .maybeSingle();
    if (evErr) return NextResponse.json({ error: evErr.message }, { status: 500 });
    if (!ev) return NextResponse.json({ error: 'Tournament not found.' }, { status: 404 });

    const e: any = ev;

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

    // Eligibility: gender
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

    // Eligibility: age
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

    // Division eligibility (multi-division events only)
    const divisions = parseDivisions(e.divisions);
    const requestedDivision = clampText(body.division, 40);
    let division: string | null = null;
    if (divisions.length > 0) {
      const match = divisions.find((d) => d.id === requestedDivision);
      if (!match) {
        return NextResponse.json(
          { error: 'Please choose a division.' },
          { status: 400 }
        );
      }
      if (!date_of_birth) {
        return NextResponse.json(
          { error: "Date of birth is required so we can check the player's division." },
          { status: 400 }
        );
      }
      const dob = new Date(date_of_birth + 'T00:00:00Z');
      const eventDay = e.event_date ? new Date(e.event_date + 'T00:00:00Z') : new Date();
      if (Number.isNaN(dob.getTime())) {
        return NextResponse.json({ error: 'That date of birth is not valid.' }, { status: 400 });
      }
      const age = ageOnDateDiv(dob, eventDay);
      if (!isEligibleForDivision(age, match)) {
        return NextResponse.json(
          {
            error: `${player_name} turns ${age} by the event date, which doesn't fit ${match.label}. Players may play up an age group but not down.`,
          },
          { status: 400 }
        );
      }
      division = match.id;
    }

    // Comp / discount code. Claimed BEFORE the insert so two people racing a
    // single-use code can't both get it; released again if the insert fails.
    const submittedCode = normalizeCode(body.coupon_code);
    let couponCode: string | null = null;
    let couponId: string | null = null;
    let discountPercent: number | null = null;
    if (submittedCode) {
      const claim = await claimCoupon(admin, {
        code: submittedCode,
        eventId: e.id,
        seriesSlug: e.series_slug ?? null,
      });
      if (!claim.valid) {
        return NextResponse.json({ error: claim.reason }, { status: 400 });
      }
      couponCode = claim.code;
      couponId = claim.id;
      discountPercent = claim.discountPercent;
    }

    // UTR auto-lookup (best effort)
    const { utr, utrId } = await lookupUtr(player_name);
    const composite = computeQuadComposite({ utr, ntrp });

    // Insert pending entry
    const { data: entry, error: insErr } = await admin
      .from('quad_entries')
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
        division,
        coupon_code: couponCode,
        discount_percent: discountPercent,
        position: e.entry_flow === 'request_then_invite' ? 'requested' : 'pending_payment',
        payment_status: 'pending',
      })
      .select('id')
      .single();
    if (insErr || !entry) {
      if (couponId) await releaseCoupon(admin, couponId);
      return NextResponse.json(
        { error: insErr?.message || 'Could not create entry' },
        { status: 500 }
      );
    }

    const origin = new URL(request.url).origin;

    // Request-then-invite: nobody pays at signup. The entry sits in
    // 'requested' until the director sees which divisions filled and sends
    // payment invites. See /api/quads/events/[id]/invite.
    if (e.entry_flow === 'request_then_invite') {
      const { count: aheadInDivision } = await admin
        .from('quad_entries')
        .select('*', { count: 'exact', head: true })
        .eq('event_id', e.id)
        .eq('division', division)
        .in('position', ['requested', 'pending_payment', 'in_flight'])
        .neq('id', (entry as any).id);
      const positionInLine = (aheadInDivision ?? 0) + 1;

      try {
        const recipient = parent_email || player_email;
        if (recipient) {
          await sendQuadRequestReceivedEmail({
            to: recipient,
            playerName: player_name,
            tournamentName: e.name,
            divisionLabel: divisionLabel(divisions, division),
            dateLabel: e.event_date ?? 'date TBD',
            feeLabel:
              discountPercent === 100
                ? 'free (comp code applied)'
                : `$${((e.entry_fee_cents ?? 0) / 100).toFixed(0)}`,
            positionInLine,
            publicUrl: `${origin}/quads/${slug}`,
          });
        }
      } catch (err) {
        console.error('quad request-received email failed:', err);
      }

      return NextResponse.json({
        entry_id: (entry as any).id,
        requested: true,
        division,
        position_in_line: positionInLine,
        in_first_four: positionInLine <= PLAYERS_PER_QUAD,
        coupon_code: couponCode,
        discount_percent: discountPercent,
      });
    }

    // A full comp leaves nothing to charge, so it takes the free path.
    const fee = discountPercent === 100 ? 0 : e.entry_fee_cents ?? 0;
    if (fee <= 0) {
      // Decide flight vs waitlist now.
      let position: 'in_flight' | 'waitlist' = 'in_flight';
      if (e.max_players && e.max_players > 0) {
        const { count } = await admin
          .from('quad_entries')
          .select('*', { count: 'exact', head: true })
          .eq('event_id', e.id)
          .in('position', ['in_flight'])
          .neq('id', (entry as any).id);
        if ((count ?? 0) >= e.max_players) position = 'waitlist';
      }
      await admin
        .from('quad_entries')
        .update({ position, payment_status: 'waived' })
        .eq('id', (entry as any).id);

      try {
        const recipient = player_email || parent_email;
        if (recipient) {
          const args = {
            to: recipient,
            playerName: player_name,
            tournamentName: e.name,
            publicUrl: `${origin}/quads/${slug}`,
          };
          if (position === 'in_flight') {
            await sendQuadsConfirmEmail({ ...args, tournamentDate: e.event_date ?? null });
          } else {
            await sendQuadsWaitlistEmail(args);
          }
        }
      } catch (err) {
        console.error('quad free-tournament email failed:', err);
      }

      return NextResponse.json({ entry_id: (entry as any).id, free: true, position });
    }

    // Helper: seat a paid-but-not-yet-collected entry into a flight (or the
    // waitlist if the field is already full).
    const seatEntry = async (): Promise<'in_flight' | 'waitlist'> => {
      let position: 'in_flight' | 'waitlist' = 'in_flight';
      if (e.max_players && e.max_players > 0) {
        const { count } = await admin
          .from('quad_entries')
          .select('*', { count: 'exact', head: true })
          .eq('event_id', e.id)
          .in('position', ['in_flight'])
          .neq('id', (entry as any).id);
        if ((count ?? 0) >= e.max_players) position = 'waitlist';
      }
      await admin
        .from('quad_entries')
        .update({ position })
        .eq('id', (entry as any).id);
      return position;
    };

    // Square-hosted checkout — the current payment rail (Stripe is unavailable).
    // The order's reference_id is this entry's id, so the Square webhook marks
    // the exact entry paid and seats it, even if the parent closes the tab.
    if (squareConfigured()) {
      try {
        const { url, orderId, paymentLinkId } = await createEntryPaymentLink({
          entryId: (entry as any).id,
          amountCents: fee,
          name: `Entry: ${e.name}`,
          buyerEmail: player_email || parent_email || null,
          redirectUrl: `${origin}/quads/${slug}/registered?entry=${(entry as any).id}`,
        });
        await admin
          .from('quad_entries')
          .update({ square_order_id: orderId, square_payment_link_id: paymentLinkId })
          .eq('id', (entry as any).id);
        return NextResponse.json({ url, entry_id: (entry as any).id });
      } catch (err: any) {
        return NextResponse.json(
          { error: `Could not start checkout: ${err?.message || 'Square error'}` },
          { status: 500 }
        );
      }
    }

    // Static external payment link (Square dashboard / PayPal) — the entry is
    // seated now and reconciled by hand.
    if (e.external_payment_url) {
      const position = await seatEntry();
      return NextResponse.json({
        entry_id: (entry as any).id,
        external_payment: true,
        external_payment_url: e.external_payment_url,
        position,
      });
    }

    // Legacy Stripe Connect path.
    if (!e.stripe_account_id) {
      return NextResponse.json(
        {
          error:
            "This tournament requires payment but the director hasn't connected Stripe yet. Please contact the tournament director.",
        },
        { status: 400 }
      );
    }

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
                description: `Quads tournament entry — ${player_name}`,
              },
            },
          },
        ],
        // Platform fee — Stripe routes this from the connected account
        // to our platform account automatically. Director sees net.
        ...(applicationFee > 0 && {
          payment_intent_data: { application_fee_amount: applicationFee },
        }),
        customer_email: player_email || parent_email || undefined,
        success_url: `${origin}/quads/${slug}/registered?entry=${(entry as any).id}`,
        cancel_url: `${origin}/quads/${slug}?cancelled=1`,
        metadata: {
          quad_entry_id: (entry as any).id,
          slug,
        },
      },
      { stripeAccount: e.stripe_account_id }
    );

    await admin
      .from('quad_entries')
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
