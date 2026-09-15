/**
 * GET /api/clubs/[slug]/courts/sheet?date=YYYY-MM-DD
 *
 * Public. The whole court sheet for one day — every court, booked or open, and
 * the price an open half hour would cost the person asking.
 *
 * Audience comes from the SESSION (see availability/route.ts for why). Booked
 * cells carry no title, type or name: this is readable by anyone.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { windowsForDay, withinAdvanceWindow } from '@/lib/courts/availability';
import { bookingEnabled, bookingRules } from '@/lib/courts/pricing';
import { sheetGrid } from '@/lib/courts/sheet';
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

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const now = clubNow(club.timezone);
  const url = new URL(req.url);
  const requested = (url.searchParams.get('date') || '').slice(0, 10);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(requested) ? requested : now.ymd;
  const dayOfWeek = clubDayOfWeek(date, club.timezone);

  const [rateCards, audience, courts, busy] = await Promise.all([
    getRateCards(club.id),
    memberAudience(club.id, user?.id ?? null),
    getCourts(club.id),
    getBusyBlocks(club.id, date, club.timezone),
  ]);

  const grid = sheetGrid({
    courts,
    busy,
    openWindows: windowsForDay(club.operating_hours, dayOfWeek),
    rateCards,
    audience,
    dayOfWeek,
    nowMinute: date === now.ymd ? now.minute : null,
  });

  const enabled = bookingEnabled(rateCards);
  const rules = bookingRules(rateCards, audience);
  const window = withinAdvanceWindow(now.ymd, date, rules.advanceDays);

  return NextResponse.json({
    date,
    today: now.ymd,
    audience,
    signedIn: !!user,
    /** Whether tapping an open cell can lead to a booking on this date. */
    bookable: enabled && window.ok,
    bookingEnabled: enabled,
    bookingNote: !enabled
      ? null
      : window.ok
        ? null
        : window.reason === 'past'
          ? null
          : audience === 'member'
            ? `Members book up to ${rules.advanceDays} days ahead.`
            : `The public books up to ${rules.advanceDays} days ahead — members book further out.`,
    /** Lets a visitor see "members play free" without being a member. */
    memberFree: rateCards.some((c) => c.active !== false && c.applies_to === 'member' && c.price_cents === 0),
    ...grid,
  });
}
