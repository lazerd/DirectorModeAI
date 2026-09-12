/**
 * POST /api/clubs/[slug]/courts/book
 *
 * Public. Takes a court.
 *
 * Everything is re-derived and re-checked here — the price, the audience, the
 * advance window, whether the court is actually free. The browser is told what
 * a slot costs so it can show it, and then told again by the server when it
 * books; nothing the client sends about money or membership is trusted.
 *
 * The last line of defence is the database. `no_double_booking` is an EXCLUDE
 * constraint on reservations, so two people racing for the last court at 9am
 * cannot both win however carefully or carelessly this route is written — one
 * INSERT succeeds and the other gets 23P01, which is turned into "someone just
 * took it" and a re-offer rather than a 500.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import {
  availableSlots,
  windowsForDay,
  withinAdvanceWindow,
} from '@/lib/courts/availability';
import { bookingEnabled, bookingRules, durationOptions, priceBooking, toHHMM, toMinutes } from '@/lib/courts/pricing';
import {
  clubDayOfWeek,
  clubNow,
  getBookingClub,
  getBusyBlocks,
  getCourts,
  getRateCards,
  memberAudience,
  toInstant,
} from '@/lib/courts/server';
import { sendCourtBookingEmail } from '@/lib/courts/emails';
import { resolveTheme } from '@/lib/clubSite/theme';

export const dynamic = 'force-dynamic';

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 12;
const buckets = new Map<string, { count: number; resetAt: number }>();

function rateLimited(key: string): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  if (b.count >= RATE_LIMIT_MAX) return true;
  b.count += 1;
  return false;
}

const clamp = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length === 0 ? null : t.slice(0, max);
};

const looksLikeEmail = (s: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const ip =
      req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
      req.headers.get('x-real-ip') ||
      'unknown';
    if (rateLimited(ip)) {
      return NextResponse.json(
        { error: 'Too many booking attempts. Try again in a minute.' },
        { status: 429 },
      );
    }

    const { slug } = await params;
    const club = await getBookingClub(slug);
    if (!club || !club.is_public) {
      return NextResponse.json({ error: 'Club not found.' }, { status: 404 });
    }

    const rateCards = await getRateCards(club.id);
    if (!bookingEnabled(rateCards)) {
      return NextResponse.json(
        { error: 'This club is not taking court bookings online.' },
        { status: 409 },
      );
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const date = clamp(body.date, 10);
    const time = clamp(body.time, 5);
    const minutesRaw = Number(body.minutes);
    const name = clamp(body.name, 120);
    const emailRaw = clamp(body.email, 200);

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: 'Pick a date.' }, { status: 400 });
    }
    if (!time || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
      return NextResponse.json({ error: 'Pick a time.' }, { status: 400 });
    }
    if (!name) return NextResponse.json({ error: 'We need your name.' }, { status: 400 });
    if (!emailRaw || !looksLikeEmail(emailRaw)) {
      return NextResponse.json({ error: 'We need a valid email address.' }, { status: 400 });
    }
    const email = emailRaw.toLowerCase();

    // -------------------------------------------------- audience and rules
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const audience = await memberAudience(club.id, user?.id ?? null);
    const rules = bookingRules(rateCards, audience);

    const durations = durationOptions(rules);
    if (!durations.includes(minutesRaw)) {
      return NextResponse.json(
        { error: `Bookings are ${durations.join(', ')} minutes.` },
        { status: 400 },
      );
    }
    const minutes = minutesRaw;

    const now = clubNow(club.timezone);
    const windowCheck = withinAdvanceWindow(now.ymd, date, rules.advanceDays);
    if (!windowCheck.ok) {
      return NextResponse.json(
        {
          error:
            windowCheck.reason === 'past'
              ? 'That day has passed.'
              : `You can book up to ${rules.advanceDays} days ahead — the last bookable day is ${windowCheck.lastBookable}.`,
        },
        { status: 409 },
      );
    }
    // A slot that has already started is not bookable, whatever the client says.
    if (date === now.ymd && toMinutes(time) <= now.minute) {
      return NextResponse.json({ error: 'That time has already started.' }, { status: 409 });
    }

    // ------------------------------------------------------------- the price
    const dayOfWeek = clubDayOfWeek(date, club.timezone);
    const price = priceBooking(rateCards, {
      audience,
      dayOfWeek,
      startTime: time,
      minutes,
    });
    if (!price.ok) {
      return NextResponse.json(
        {
          error: `The club has no rate set between ${price.uncoveredFrom} and ${price.uncoveredTo}, so that time cannot be booked.`,
        },
        { status: 409 },
      );
    }

    // --------------------------------------------------- is it actually free
    const [courts, busy] = await Promise.all([
      getCourts(club.id),
      getBusyBlocks(club.id, date, club.timezone),
    ]);
    const availability = availableSlots({
      courts,
      busy,
      openWindows: windowsForDay(club.operating_hours, dayOfWeek),
      rateCards,
      audience,
      dayOfWeek,
      minutes,
      nowMinute: date === now.ymd ? now.minute : null,
    });
    const slot = availability.slots.find((s) => s.time === time);
    if (!slot || slot.courts.length === 0) {
      return NextResponse.json(
        { error: 'That slot has just gone. Pick another time.' },
        { status: 409 },
      );
    }

    // ------------------------------------------------------------ write it
    const db = getSupabaseAdmin();
    const startsAt = toInstant(date, time, club.timezone);
    const endsAt = new Date(startsAt.getTime() + minutes * 60_000);

    /*
     * Try each free court in turn.
     *
     * The availability read above is a snapshot; between it and the INSERT
     * someone else can take the court. The EXCLUDE constraint catches that
     * (23P01), so a clash is not an error — it is a reason to try the next
     * court. Only when every free court has gone is the slot really gone.
     */
    let reservationId: string | null = null;
    let courtId: string | null = null;
    let lastError: string | null = null;

    for (const candidate of slot.courts) {
      const { data, error } = await db
        .from('reservations')
        .insert({
          club_id: club.id,
          court_id: candidate.id,
          starts_at: startsAt.toISOString(),
          ends_at: endsAt.toISOString(),
          type: 'member',
          source: 'courtconnect',
          title: `Court booking — ${name}`,
          status: 'confirmed',
          // reservations.created_by is NOT NULL against auth.users, and a
          // public booker has no account. The club is the party that made the
          // booking; who it is FOR lives on court_bookings.
          created_by: user?.id ?? club.owner_id,
          meta: { booked_by: name, booker_email: email, audience },
        })
        .select('id')
        .maybeSingle();

      if (data) {
        reservationId = (data as { id: string }).id;
        courtId = candidate.id;
        break;
      }
      // 23P01 is the exclusion violation — someone got there first.
      const code = (error as { code?: string } | null)?.code;
      lastError = error?.message ?? null;
      if (code !== '23P01') break;
    }

    if (!reservationId || !courtId) {
      return NextResponse.json(
        {
          error: lastError
            ? 'That slot has just gone. Pick another time.'
            : 'Could not hold that court.',
        },
        { status: 409 },
      );
    }

    const { data: booking, error: bookingErr } = await db
      .from('court_bookings')
      .insert({
        club_id: club.id,
        reservation_id: reservationId,
        court_id: courtId,
        booker_name: name,
        booker_email: email,
        booker_phone: clamp(body.phone, 40),
        booker_user_id: user?.id ?? null,
        rate_applied: audience,
        minutes,
        amount_cents: price.cents,
        price_breakdown: price.segments,
        payment_status: price.cents > 0 ? 'pending' : 'waived',
        notes: clamp(body.notes, 500),
      })
      .select('id, cancel_token, amount_cents')
      .maybeSingle();

    if (bookingErr || !booking) {
      // The court is held but we cannot record who holds it. Release it rather
      // than leaving a reservation nobody can trace or cancel.
      await db.from('reservations').delete().eq('id', reservationId);
      return NextResponse.json(
        { error: bookingErr?.message || 'Could not record the booking.' },
        { status: 500 },
      );
    }

    const saved = booking as { id: string; cancel_token: string; amount_cents: number };

    // --------------------------------------------------------------- email
    const courtName = slot.courts.find((c) => c.id === courtId)?.name ?? 'Court';
    const { data: siteRow } = await db
      .from('club_site')
      .select('color_primary, color_secondary, color_ink, color_cream, color_surface, font_choice')
      .eq('club_id', club.id)
      .maybeSingle();

    let emailed = false;
    let warning: string | null = null;
    try {
      const result = await sendCourtBookingEmail({
        ownerId: club.owner_id,
        clubName: club.name,
        clubSlug: club.slug,
        clubEmail: club.email,
        clubPhone: club.phone,
        accent: resolveTheme(siteRow as Record<string, unknown> | null).primary,
        timeZone: club.timezone,
        booking: {
          id: saved.id,
          cancelToken: saved.cancel_token,
          name,
          email,
          date,
          time,
          minutes,
          courtName,
          amountCents: saved.amount_cents,
          segments: price.segments,
          audience,
        },
      });
      emailed = !!result?.sent;
    } catch {
      // The court is booked either way. Saying the booking failed would make
      // them book a second one.
      warning = 'Booked, but the confirmation email could not be sent.';
    }

    return NextResponse.json({
      ok: true,
      booking_id: saved.id,
      cancel_token: saved.cancel_token,
      court: courtName,
      date,
      time,
      end_time: toHHMM(toMinutes(time) + minutes),
      minutes,
      amount_cents: saved.amount_cents,
      rate_applied: audience,
      emailed,
      ...(warning ? { warning } : {}),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Something went wrong.' },
      { status: 500 },
    );
  }
}
