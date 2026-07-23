import { NextResponse } from 'next/server';
import { requireCalendarContext, isAuthError, ITEM_COLUMNS } from '@/lib/calendar/server';
import { itemOverrides as overrides } from '@/lib/calendar/itemFields';

// PATCH  /api/calendar/items/[id] — edit or reschedule one event.
// DELETE /api/calendar/items/[id] — remove it from the plan.
//
// Both scope the write by club_id as well as id: RLS already enforces this,
// but the service-role client used by these routes bypasses RLS, so the
// tenant check has to be explicit here.
export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const ctx = await requireCalendarContext({ requirePro: true });
  if (isAuthError(ctx)) return ctx.error;

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });

  const patch = overrides(body);
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 });
  }

  // Moving an event invalidates the stored explanation — a stale "great
  // spacing" note under a date the director just dragged somewhere crowded is
  // worse than no note. The client re-runs /recommend to refresh it.
  if ('target_date' in patch) {
    patch.score = null;
    patch.score_breakdown = {};
  }

  const { data, error } = await ctx.db
    .from('calendar_items')
    .update(patch)
    .eq('id', params.id)
    .eq('club_id', ctx.club.id)
    .select(ITEM_COLUMNS)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  if (!data) return NextResponse.json({ error: 'Event not found.' }, { status: 404 });

  return NextResponse.json({ item: data });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const ctx = await requireCalendarContext({ requirePro: true });
  if (isAuthError(ctx)) return ctx.error;

  // Release any tentative court hold this item was holding, so deleting a
  // planned event actually frees the courts rather than leaving orphan blocks
  // on the sheet with nothing to click through to.
  await ctx.db
    .from('reservations')
    .update({ status: 'cancelled' })
    .eq('club_id', ctx.club.id)
    .eq('source', 'calendar')
    .eq('source_id', params.id);

  const { error } = await ctx.db
    .from('calendar_items')
    .delete()
    .eq('id', params.id)
    .eq('club_id', ctx.club.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
