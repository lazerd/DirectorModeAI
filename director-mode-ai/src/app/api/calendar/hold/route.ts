import { NextResponse } from 'next/server';
import { localToUtc } from '@/lib/courtsheet/timezones';
import {
  requireCalendarContext, isAuthError, toPlanItem, ITEM_COLUMNS, type CalendarItemRow,
} from '@/lib/calendar/server';
import { buildHolds } from '@/lib/calendar/promote';

// POST   /api/calendar/hold  { itemId }  — claim courts for a scheduled item
// DELETE /api/calendar/hold?itemId=…     — release them
//
// The point of the hold: a year plan that says "Member-Guest, ten courts,
// September 12th" while CourtSheet happily sells those courts to a member is
// worse than no plan at all. The hold is written as type 'hold' / status
// 'tentative' so it reads as provisional, but it still participates in the
// EXCLUDE-USING-gist constraint from courtsheet_005 and genuinely reserves.
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const ctx = await requireCalendarContext({ requirePro: true });
  if (isAuthError(ctx)) return ctx.error;

  const body = await req.json().catch(() => null);
  const itemId = String(body?.itemId || '');
  if (!itemId) return NextResponse.json({ error: 'Missing itemId.' }, { status: 400 });

  const { data: row } = await ctx.db
    .from('calendar_items')
    .select(ITEM_COLUMNS)
    .eq('id', itemId)
    .eq('club_id', ctx.club.id)
    .maybeSingle();

  if (!row) return NextResponse.json({ error: 'Event not found.' }, { status: 404 });

  const itemRow = row as unknown as CalendarItemRow;
  const item = toPlanItem(itemRow);
  if (!item.target_date) {
    return NextResponse.json({ error: 'Schedule the event before holding courts.' }, { status: 400 });
  }

  const need = item.courts_needed ?? 0;
  if (need <= 0) {
    return NextResponse.json({ error: 'This event does not need courts.' }, { status: 400 });
  }

  // Always release first so re-holding after a date change never leaves the old
  // date's courts locked.
  await releaseHolds(ctx.db, ctx.club.id, itemId);

  const { data: courts } = await ctx.db
    .from('courts')
    .select('id, number, name')
    .eq('club_id', ctx.club.id)
    .eq('status', 'active')
    .order('display_order', { ascending: true })
    .limit(need);

  const courtIds = ((courts ?? []) as any[]).map((c) => c.id);
  if (courtIds.length === 0) {
    return NextResponse.json(
      { error: 'This club has no courts set up in CourtSheet yet.', held: 0 },
      { status: 400 },
    );
  }

  const startTime = itemRow.start_time?.slice(0, 5) || '09:00';
  const holds = buildHolds({
    item,
    clubId: ctx.club.id,
    courtIds,
    createdBy: ctx.user.id,
    startTime,
    utcOffset: offsetFor(item.target_date, startTime, ctx.club.timezone),
  });

  // Insert one at a time: the no-double-booking constraint rejects the whole
  // statement on a single clash, and a partial hold with an honest report of
  // what was already taken is far more useful than an all-or-nothing failure.
  let held = 0;
  const conflicts: string[] = [];
  for (const h of holds) {
    const { error } = await ctx.db.from('reservations').insert(h);
    if (error) conflicts.push(error.message);
    else held++;
  }

  return NextResponse.json({
    held,
    requested: holds.length,
    courtsAvailable: courtIds.length,
    courtsNeeded: need,
    conflicts: conflicts.length,
    partial: held > 0 && held < holds.length,
  });
}

export async function DELETE(req: Request) {
  const ctx = await requireCalendarContext({ requirePro: true });
  if (isAuthError(ctx)) return ctx.error;

  const itemId = new URL(req.url).searchParams.get('itemId');
  if (!itemId) return NextResponse.json({ error: 'Missing itemId.' }, { status: 400 });

  const released = await releaseHolds(ctx.db, ctx.club.id, itemId);
  return NextResponse.json({ ok: true, released });
}

async function releaseHolds(db: any, clubId: string, itemId: string): Promise<number> {
  // Cancel rather than delete: the EXCLUDE constraint ignores cancelled rows,
  // so the courts free up while the history of the hold survives.
  const { data } = await db
    .from('reservations')
    .update({ status: 'cancelled' })
    .eq('club_id', clubId)
    .eq('source', 'calendar')
    .eq('source_id', itemId)
    .neq('status', 'cancelled')
    .select('id');
  return (data ?? []).length;
}

/**
 * The club's UTC offset on a given date, as '±HH:MM'.
 *
 * Derived by asking localToUtc what instant a wall-clock time maps to, so DST
 * is handled by the timezone database rather than guessed — a September hold
 * and a January hold at the same club get different offsets, correctly.
 */
function offsetFor(date: string, time: string, timezone: string): string {
  const utc = localToUtc(date, time, timezone).getTime();
  const naive = Date.parse(`${date}T${time}:00Z`);
  const minutes = Math.round((naive - utc) / 60000);
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}
