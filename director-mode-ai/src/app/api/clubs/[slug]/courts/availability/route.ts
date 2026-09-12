/**
 * GET /api/clubs/[slug]/courts/availability?date=YYYY-MM-DD&minutes=60
 *
 * Public. What is free, at what price, for a signed-out visitor at the public
 * rate or a signed-in member at theirs.
 *
 * The audience is resolved from the SESSION, never from the request body — at a
 * club where members play free, a self-declared "I'm a member" field is a
 * free-courts field.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  availableSlots,
  bookableDates,
  windowsForDay,
  withinAdvanceWindow,
} from '@/lib/courts/availability';
import { bookingEnabled, bookingRules, durationOptions } from '@/lib/courts/pricing';
import {
  clubDayOfWeek,
  clubNow,
  getBookingClub,
  getBusyBlocks,
  getCourts,
  getRateCards,
  memberAudience,
} from '@/lib/courts/server';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const club = await getBookingClub(slug);
  if (!club || !club.is_public) {
    return NextResponse.json({ error: 'Club not found.' }, { status: 404 });
  }

  const rateCards = await getRateCards(club.id);
  if (!bookingEnabled(rateCards)) {
    // The club has not set any rates, so it is not taking online bookings.
    // A clear "off" beats an empty grid that looks broken.
    return NextResponse.json({
      enabled: false,
      reason: 'This club is not taking court bookings online yet.',
      club: { name: club.name, phone: club.phone, timezone: club.timezone },
    });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const audience = await memberAudience(club.id, user?.id ?? null);
  const rules = bookingRules(rateCards, audience);

  const now = clubNow(club.timezone);
  const url = new URL(req.url);
  const date = (url.searchParams.get('date') || now.ymd).slice(0, 10);
  const requested = parseInt(url.searchParams.get('minutes') || '', 10);
  const durations = durationOptions(rules);
  const minutes = durations.includes(requested) ? requested : durations[0];

  const window = withinAdvanceWindow(now.ymd, date, rules.advanceDays);
  if (!window.ok) {
    return NextResponse.json({
      enabled: true,
      audience,
      date,
      minutes,
      durations,
      dates: bookableDates(now.ymd, rules.advanceDays),
      slots: [],
      note:
        window.reason === 'past'
          ? 'That day has passed.'
          : audience === 'member'
            ? `Members can book up to ${rules.advanceDays} days ahead — the last bookable day is ${window.lastBookable}.`
            : `The public can book up to ${rules.advanceDays} days ahead — the last bookable day is ${window.lastBookable}. Members book further out.`,
    });
  }

  const dayOfWeek = clubDayOfWeek(date, club.timezone);
  const [courts, busy] = await Promise.all([
    getCourts(club.id),
    getBusyBlocks(club.id, date, club.timezone),
  ]);

  const result = availableSlots({
    courts,
    busy,
    openWindows: windowsForDay(club.operating_hours, dayOfWeek),
    rateCards,
    audience,
    dayOfWeek,
    minutes,
    nowMinute: date === now.ymd ? now.minute : null,
  });

  return NextResponse.json({
    enabled: true,
    audience,
    date,
    minutes,
    durations,
    dates: bookableDates(now.ymd, rules.advanceDays),
    advanceDays: rules.advanceDays,
    // Courts are returned per slot; the page shows a count, not a picker, and
    // the booking route assigns one. A visitor does not care which court.
    slots: result.slots.map((s) => ({
      time: s.time,
      cents: s.cents,
      courtsFree: s.courts.length,
      segments: s.segments,
    })),
    note: result.note,
    club: { name: club.name, phone: club.phone, timezone: club.timezone },
  });
}
