import { NextResponse } from 'next/server';
import { utcToLocalDate } from '@/lib/courtsheet/timezones';
import {
  requireCalendarContext, isAuthError, ensurePlan, loadPlan, toPlanItem, ITEM_COLUMNS,
  type CalendarItemRow,
} from '@/lib/calendar/server';
import { summarizePlan } from '@/lib/calendar/plan';

// GET  /api/calendar/plan?year=2027 — the club's plan for a year, with items.
// PATCH /api/calendar/plan          — update name/status/goals/season windows.
//
// GET creates the plan on first visit so a director lands on a working
// calendar rather than an empty-state form asking them to name something.
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const ctx = await requireCalendarContext();
  if (isAuthError(ctx)) return ctx.error;

  const url = new URL(req.url);
  const today = utcToLocalDate(new Date(), ctx.club.timezone);
  const year = Number(url.searchParams.get('year')) || Number(today.slice(0, 4));

  if (year < 2000 || year > 2100) {
    return NextResponse.json({ error: 'That year is out of range.' }, { status: 400 });
  }

  const plan = await ensurePlan(ctx.db, ctx.club.id, ctx.user.id, year, ctx.club.name);
  if (!plan) return NextResponse.json({ error: 'Could not open a plan for that year.' }, { status: 500 });

  const { data: rows } = await ctx.db
    .from('calendar_items')
    .select(ITEM_COLUMNS)
    .eq('plan_id', plan.id)
    .order('target_date', { ascending: true, nullsFirst: false });

  const items = (rows ?? []) as unknown as CalendarItemRow[];

  const { data: constraints } = await ctx.db
    .from('calendar_constraints')
    .select('id, source, title, starts_on, ends_on, impact, audience_tags, import_id')
    .eq('club_id', ctx.club.id)
    .or(`plan_id.is.null,plan_id.eq.${plan.id}`)
    .lte('starts_on', `${year}-12-31`)
    .gte('ends_on', `${year}-01-01`)
    .order('starts_on', { ascending: true });

  const { data: imports } = await ctx.db
    .from('calendar_imports')
    .select('id, kind, filename, label, item_count, summary, created_at')
    .eq('club_id', ctx.club.id)
    .order('created_at', { ascending: false })
    .limit(20);

  return NextResponse.json({
    plan,
    club: ctx.club,
    isPro: ctx.isPro,
    today,
    items,
    constraints: constraints ?? [],
    imports: imports ?? [],
    summary: summarizePlan(items.map(toPlanItem)),
  });
}

export async function PATCH(req: Request) {
  const ctx = await requireCalendarContext({ requirePro: true });
  if (isAuthError(ctx)) return ctx.error;

  const body = await req.json().catch(() => null);
  const planId = String(body?.planId || '');
  if (!planId) return NextResponse.json({ error: 'Missing planId.' }, { status: 400 });

  const plan = await loadPlan(ctx.db, ctx.club.id, planId);
  if (!plan) return NextResponse.json({ error: 'Plan not found.' }, { status: 404 });

  const patch: Record<string, unknown> = {};
  if (typeof body.name === 'string' && body.name.trim()) patch.name = body.name.trim().slice(0, 200);
  if (typeof body.notes === 'string') patch.notes = body.notes.slice(0, 5000);
  if (['draft', 'approved', 'published', 'archived'].includes(body.status)) patch.status = body.status;
  if (body.goals && typeof body.goals === 'object') patch.goals = sanitizeGoals(body.goals);
  if (Array.isArray(body.season_windows)) patch.season_windows = sanitizeWindows(body.season_windows);

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 });
  }

  // Publishing is exclusive per club-year (enforced by a partial unique index),
  // so stand down any previously published plan first rather than letting the
  // insert fail with a constraint error the director can't act on.
  if (patch.status === 'published') {
    await ctx.db
      .from('calendar_plans')
      .update({ status: 'approved' })
      .eq('club_id', ctx.club.id)
      .eq('year', plan.year)
      .eq('status', 'published')
      .neq('id', planId);
  }

  const { data, error } = await ctx.db
    .from('calendar_plans')
    .update(patch)
    .eq('id', planId)
    .eq('club_id', ctx.club.id)
    .select('id, year, name, status, season_windows, goals, notes')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ plan: data });
}

function sanitizeGoals(g: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const num = (v: unknown, min: number, max: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : null;
  };
  const perMonth = num(g.events_per_month, 0, 30);
  if (perMonth !== null) out.events_per_month = perMonth;
  const minDays = num(g.min_days_between, 0, 90);
  if (minDays !== null) out.min_days_between = minDays;
  const revenue = num(g.revenue_target_cents, 0, 1_000_000_000);
  if (revenue !== null) out.revenue_target_cents = revenue;
  if (g.department_mix && typeof g.department_mix === 'object') out.department_mix = g.department_mix;
  return out;
}

function sanitizeWindows(w: unknown[]): Array<{ label: string; start: string; end: string }> {
  const mmdd = /^\d{2}-\d{2}$/;
  return w
    .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
    .map((x) => ({
      label: String(x.label ?? 'Season').slice(0, 60),
      start: String(x.start ?? ''),
      end: String(x.end ?? ''),
    }))
    .filter((x) => mmdd.test(x.start) && mmdd.test(x.end))
    .slice(0, 6);
}
