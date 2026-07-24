import { NextResponse } from 'next/server';
import { utcToLocalDate } from '@/lib/courtsheet/timezones';
import {
  requireCalendarContext, isAuthError, loadPlan, buildScoreContext, toPlanItem,
  ITEM_COLUMNS, type CalendarItemRow,
} from '@/lib/calendar/server';
import { recommendDates, scoreSlot } from '@/lib/calendar/score';
import { generateSlots } from '@/lib/calendar/slots';
import { catalogEntry } from '@/lib/calendar/catalog';
import type { PlanItem } from '@/lib/calendar/types';

// POST /api/calendar/recommend — rank candidate dates for one event.
//
// Pure engine, no AI: instant, free, and deterministic, which is what lets the
// year grid re-score on every drag without thinking about cost or latency.
//
// Body: { planId, itemId } to rank an existing event, or
//       { planId, catalogKey } to preview dates before adding one.
//       Optional { date } scores that single date instead of ranking.
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const ctx = await requireCalendarContext({ requirePro: true });
  if (isAuthError(ctx)) return ctx.error;

  const body = await req.json().catch(() => null);
  const planId = String(body?.planId || '');
  if (!planId) return NextResponse.json({ error: 'Missing planId.' }, { status: 400 });

  const plan = await loadPlan(ctx.db, ctx.club.id, planId);
  if (!plan) return NextResponse.json({ error: 'Plan not found.' }, { status: 404 });

  // Resolve the event being placed — either a real row or a catalog preview.
  let item: PlanItem | null = null;

  if (body?.itemId) {
    const { data } = await ctx.db
      .from('calendar_items')
      .select(ITEM_COLUMNS)
      .eq('id', String(body.itemId))
      .eq('club_id', ctx.club.id)
      .maybeSingle();
    if (!data) return NextResponse.json({ error: 'Event not found.' }, { status: 404 });
    item = toPlanItem(data as unknown as CalendarItemRow);
  } else if (body?.catalogKey) {
    const c = catalogEntry(String(body.catalogKey));
    if (!c) return NextResponse.json({ error: 'Unknown event idea.' }, { status: 400 });
    item = {
      id: '__preview__',
      title: c.title,
      catalog_key: c.key,
      department: c.department,
      audience: c.audience,
      anchor_rule: c.anchor,
      target_date: null,
      target_end_date: null,
      duration_minutes: c.durationMinutes,
      courts_needed: c.courtsNeeded,
      staff_needed: c.staffNeeded,
      expected_attendance: c.typicalAttendance,
      expected_revenue_cents: c.typicalFeeCents * c.typicalAttendance,
      effort: c.effort,
      outdoor: c.outdoor,
      idealMonths: c.idealMonths,
      status: 'idea',
    };
  } else {
    return NextResponse.json({ error: 'Pass an itemId or a catalogKey.' }, { status: 400 });
  }

  const today = utcToLocalDate(new Date(), ctx.club.timezone);
  const scoreCtx = await buildScoreContext({
    db: ctx.db,
    clubId: ctx.club.id,
    planId,
    year: plan.year,
    goals: (plan.goals ?? {}) as any,
    seasonWindows: (plan.season_windows ?? []) as any,
    excludeItemId: item.id,
    // Only constrain to "not in the past" when planning the current year.
    today: String(plan.year) === today.slice(0, 4) ? today : undefined,
    includeCourtLoad: true,
  });

  const slots = generateSlots(plan.year, {
    daysOfWeek: Array.isArray(body?.daysOfWeek) ? body.daysOfWeek : undefined,
    // Restricting to a month is how the list view's drag gesture works: the
    // director says "somewhere in March" and the engine picks the weekend.
    months: Array.isArray(body?.months)
      ? body.months.map(Number).filter((m: number) => m >= 1 && m <= 12)
      : undefined,
  });

  // Single-date mode: what does THIS date look like? Used by the drag handler.
  if (typeof body?.date === 'string') {
    const slot = slots.find((s) => s.date === body.date)
      ?? generateSlots(plan.year, { daysOfWeek: [0, 1, 2, 3, 4, 5, 6] }).find((s) => s.date === body.date);
    if (!slot) return NextResponse.json({ error: 'That date is not in the plan year.' }, { status: 400 });
    return NextResponse.json({ scored: scoreSlot(item, slot, scoreCtx) });
  }

  const limit = Math.min(20, Math.max(1, Number(body?.limit) || 6));
  const recommendations = recommendDates(item, slots, scoreCtx, limit);

  return NextResponse.json({
    item: { id: item.id, title: item.title },
    recommendations,
    // Surfaced so the UI can say "scored against 14 conflicts and 9 events".
    context: {
      constraints: scoreCtx.constraints.length,
      placed: scoreCtx.placed.length,
      climateRegion: scoreCtx.climateRegion,
    },
  });
}
