import { NextResponse } from 'next/server';
import {
  requireCalendarContext, isAuthError, toPlanItem, ITEM_COLUMNS, type CalendarItemRow,
} from '@/lib/calendar/server';
import { buildEventPayload } from '@/lib/calendar/promote';
import { generateEventCode } from '@/lib/eventCodeGenerator';
import { slugify } from '@/lib/leagueUtils';

// POST /api/calendar/promote — turn a planned item into a real event.
//
// The deliberate moment a plan becomes a thing that runs. Creates the `events`
// row, links it back on calendar_items.event_id, and marks the item promoted.
// Idempotent: promoting twice returns the existing event rather than making a
// duplicate, because the button is easy to double-click and the failure mode is
// two half-configured tournaments.
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

  // Already promoted — hand back what exists.
  if (itemRow.event_id) {
    const { data: existing } = await ctx.db
      .from('events')
      .select('id, slug, name, match_format')
      .eq('id', itemRow.event_id)
      .maybeSingle();
    if (existing) {
      return NextResponse.json({
        event: existing,
        alreadyPromoted: true,
        url: eventUrl(existing as any),
      });
    }
  }

  const item = toPlanItem(itemRow);
  const built = buildEventPayload({
    item,
    userId: ctx.user.id,
    clubId: ctx.club.id,
    eventCode: generateEventCode(),
    slug: await uniqueSlug(ctx.db, `${slugify(item.title)}-${item.target_date?.slice(0, 4) ?? ''}`),
    defaultStartTime: itemRow.start_time?.slice(0, 5) || '09:00',
  });

  if (!built.ok || !built.event) {
    return NextResponse.json({ error: built.error ?? 'Could not build the event.' }, { status: 400 });
  }

  const { data: created, error } = await ctx.db
    .from('events')
    .insert(built.event)
    .select('id, slug, name, match_format')
    .single();

  if (error || !created) {
    return NextResponse.json({ error: error?.message ?? 'Could not create the event.' }, { status: 400 });
  }

  await ctx.db
    .from('calendar_items')
    .update({ event_id: (created as any).id, status: 'promoted' })
    .eq('id', itemId)
    .eq('club_id', ctx.club.id);

  // Re-point the tentative hold at the real event so the sheet stops calling it
  // provisional now that it is a booked event.
  await ctx.db
    .from('reservations')
    .update({ type: 'event', status: 'confirmed', source_id: (created as any).id })
    .eq('club_id', ctx.club.id)
    .eq('source', 'calendar')
    .eq('source_id', itemId)
    .neq('status', 'cancelled');

  return NextResponse.json({
    event: created,
    mode: built.mode,
    url: eventUrl(created as any),
  });
}

function eventUrl(e: { id: string }): string {
  // Both mixers and tournaments are administered from the same event page.
  return `/mixer/events/${e.id}`;
}

async function uniqueSlug(db: any, base: string): Promise<string> {
  const clean = (base || 'event').replace(/-+$/, '').slice(0, 80) || 'event';
  let candidate = clean;
  for (let n = 2; n < 40; n++) {
    const { data } = await db.from('events').select('id').eq('slug', candidate).maybeSingle();
    if (!data) return candidate;
    candidate = `${clean}-${n}`;
  }
  return `${clean}-${Math.floor(Math.random() * 10000)}`;
}
