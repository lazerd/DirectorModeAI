/**
 * CalendarMode — server glue.
 *
 * The engine in this folder is pure. This file is the one place that talks to
 * the database on its behalf: resolving the club and plan, loading constraints
 * and court load, and assembling the ScoreContext the scorer needs.
 *
 * Keeping it separate means the engine stays testable without a database, and
 * every route builds its context the same way — so a date recommended by the
 * `recommend` route and the same date chosen by the AI year builder were
 * scored against identical inputs.
 */

import { NextResponse } from 'next/server';
import { requireStaffForClub } from '@/lib/courtsheet/routeAuth';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { hasFeature } from '@/lib/billing';
import { zipToLatLng } from '@/lib/geo';
import { catalogEntry } from './catalog';
import { regionFor } from './climate';
import { toISO } from './dates';
import type {
  CalendarConstraint, CourtLoad, ISODate, PlanItem, PlanGoals, ScoreContext,
} from './types';

export interface CalendarContext {
  user: { id: string; email: string };
  club: { id: string; slug: string; name: string; timezone: string };
  db: ReturnType<typeof getSupabaseAdmin>;
  isPro: boolean;
}

export type CalendarAuth = CalendarContext | { error: NextResponse };

export function isAuthError(v: CalendarAuth): v is { error: NextResponse } {
  return (v as { error?: unknown }).error !== undefined;
}

/**
 * Resolve the caller's club for CalendarMode.
 *
 * `requirePro` gates the paid surface. Reading a plan you already own is free
 * so a lapsed subscriber never loses sight of the calendar they built — only
 * building, importing, and exporting are gated.
 */
export async function requireCalendarContext(
  opts: { requirePro?: boolean } = {},
): Promise<CalendarAuth> {
  const ctx = await requireStaffForClub({ requireWrite: false });
  if ('error' in ctx) return { error: ctx.error };

  const isPro = await hasFeature(ctx.user.id, 'calendar_mode');
  if (opts.requirePro && !isPro) {
    return {
      error: NextResponse.json(
        {
          error: 'Pro required',
          detail: 'CalendarMode planning is a Pro feature. Browsing event ideas is free.',
          upgrade_url: '/pricing',
        },
        { status: 402 },
      ),
    };
  }

  return {
    user: ctx.user,
    club: {
      id: ctx.club.id,
      slug: ctx.club.slug,
      name: ctx.club.name,
      timezone: (ctx.club as { timezone?: string }).timezone || 'America/Los_Angeles',
    },
    db: ctx.db,
    isPro,
  };
}

// ============================================================
// Row → engine shape
// ============================================================

export interface CalendarItemRow {
  id: string;
  plan_id: string;
  title: string;
  catalog_key: string | null;
  description: string | null;
  department: string;
  audience: string[] | null;
  format_hint: string | null;
  status: string;
  target_date: string | null;
  target_end_date: string | null;
  start_time: string | null;
  duration_minutes: number | null;
  anchor_rule: string | null;
  courts_needed: number | null;
  staff_needed: number | null;
  expected_attendance: number | null;
  entry_fee_cents: number | null;
  expected_revenue_cents: number | null;
  expected_cost_cents: number | null;
  run_of_show: Record<string, unknown> | null;
  marketing: Record<string, unknown> | null;
  score: number | null;
  score_breakdown: Record<string, unknown> | null;
  event_id: string | null;
  hold_series_id: string | null;
  notes: string | null;
}

export const ITEM_COLUMNS =
  'id, plan_id, title, catalog_key, description, department, audience, format_hint, status, ' +
  'target_date, target_end_date, start_time, duration_minutes, anchor_rule, courts_needed, ' +
  'staff_needed, expected_attendance, entry_fee_cents, expected_revenue_cents, ' +
  'expected_cost_cents, run_of_show, marketing, score, score_breakdown, event_id, ' +
  'hold_series_id, notes';

/**
 * Columns safe to expose on the public member-facing calendar.
 * Deliberately excludes cost, revenue, staffing and internal notes — the
 * published plan is what the club is doing, not what it costs them.
 */
export const PUBLIC_ITEM_COLUMNS =
  'id, title, description, department, audience, target_date, target_end_date, ' +
  'start_time, duration_minutes, entry_fee_cents, catalog_key, event_id';

/**
 * Lift a DB row into the engine's PlanItem. Effort, outdoor-ness and ideal
 * months live on the catalog rather than the row, so a catalog improvement
 * benefits calendars that were built before it — items with no catalog key
 * (custom or AI-invented) fall back to neutral defaults.
 */
export function toPlanItem(row: CalendarItemRow): PlanItem {
  const cat = catalogEntry(row.catalog_key);
  return {
    id: row.id,
    title: row.title,
    catalog_key: row.catalog_key,
    department: (row.department as PlanItem['department']) ?? 'tennis',
    audience: (row.audience as PlanItem['audience']) ?? [],
    anchor_rule: row.anchor_rule,
    target_date: row.target_date,
    target_end_date: row.target_end_date,
    duration_minutes: row.duration_minutes,
    courts_needed: row.courts_needed,
    staff_needed: row.staff_needed,
    expected_attendance: row.expected_attendance,
    expected_revenue_cents: row.expected_revenue_cents,
    effort: cat?.effort ?? 'medium',
    outdoor: cat?.outdoor ?? true,
    idealMonths: cat?.idealMonths ?? [],
    status: (row.status as PlanItem['status']) ?? 'idea',
    // Carried through so promote.ts can honour a director's override.
    ...(row.format_hint ? { format_hint: row.format_hint } : {}),
  } as PlanItem;
}

// ============================================================
// ScoreContext assembly
// ============================================================

/**
 * Build the full scoring context for a plan: its constraints, everything
 * already placed, the club's climate region, and court load from CourtSheet.
 *
 * `excludeItemId` drops one item from `placed` so an event is never scored
 * against itself — without it, moving an event would show a cadence penalty
 * caused by the very event being moved.
 */
export async function buildScoreContext(params: {
  db: ReturnType<typeof getSupabaseAdmin>;
  clubId: string;
  planId: string;
  year: number;
  goals?: PlanGoals;
  seasonWindows?: Array<{ label: string; start: string; end: string }>;
  excludeItemId?: string;
  /** Pass the caller's "today" — the engine never reads a clock itself. */
  today?: ISODate;
  /** Skip the court-load query when the caller doesn't need it. */
  includeCourtLoad?: boolean;
}): Promise<ScoreContext> {
  const { db, clubId, planId, year } = params;

  const [{ data: constraintRows }, { data: itemRows }, { data: clubRow }] = await Promise.all([
    db
      .from('calendar_constraints')
      .select('id, source, title, starts_on, ends_on, impact, audience_tags')
      .eq('club_id', clubId)
      .or(`plan_id.is.null,plan_id.eq.${planId}`)
      .lte('starts_on', toISO(year, 12, 31))
      .gte('ends_on', toISO(year, 1, 1)),
    db
      .from('calendar_items')
      .select(ITEM_COLUMNS)
      .eq('plan_id', planId)
      .not('target_date', 'is', null)
      .neq('status', 'dropped'),
    db.from('cc_clubs').select('state, zip').eq('id', clubId).maybeSingle(),
  ]);

  const constraints: CalendarConstraint[] = (constraintRows ?? []).map((c: any) => ({
    id: c.id,
    source: c.source,
    title: c.title,
    starts_on: c.starts_on,
    ends_on: c.ends_on,
    impact: c.impact,
    audience_tags: c.audience_tags ?? [],
  }));

  const placed = (itemRows ?? [])
    .map((r: any) => toPlanItem(r as CalendarItemRow))
    .filter((i) => i.id !== params.excludeItemId);

  const loc = zipToLatLng((clubRow as any)?.zip);
  const climateRegion = regionFor((clubRow as any)?.state, loc);

  const courtLoad = params.includeCourtLoad
    ? await loadCourtAvailability(db, clubId, year)
    : undefined;

  return {
    year,
    climateRegion,
    constraints,
    placed,
    courtLoad,
    goals: params.goals,
    seasonWindows: params.seasonWindows,
    notBefore: params.today,
  };
}

/**
 * Court load per date for a year, from CourtSheet.
 *
 * Counts distinct courts holding a non-cancelled reservation on each date.
 * Deliberately coarse: at planning distance "are the courts spoken for that
 * day" is the real question, and modelling hour-by-hour availability eleven
 * months out would be false precision.
 *
 * Holds this calendar created are excluded — an event should not be blocked by
 * its own provisional booking when the director drags it back and forth.
 */
export async function loadCourtAvailability(
  db: ReturnType<typeof getSupabaseAdmin>,
  clubId: string,
  year: number,
): Promise<Record<ISODate, CourtLoad>> {
  const [{ count: totalCourts }, { data: rows }] = await Promise.all([
    db
      .from('courts')
      .select('id', { count: 'exact', head: true })
      .eq('club_id', clubId)
      .eq('status', 'active'),
    db
      .from('reservations')
      .select('court_id, starts_at')
      .eq('club_id', clubId)
      .neq('status', 'cancelled')
      .neq('source', 'calendar')
      .gte('starts_at', `${toISO(year, 1, 1)}T00:00:00Z`)
      .lte('starts_at', `${toISO(year, 12, 31)}T23:59:59Z`)
      .limit(20000),
  ]);

  const total = totalCourts ?? 0;
  if (total === 0) return {};

  const byDate = new Map<ISODate, Set<string>>();
  for (const r of (rows ?? []) as Array<{ court_id: string; starts_at: string }>) {
    const date = r.starts_at.slice(0, 10);
    const set = byDate.get(date);
    if (set) set.add(r.court_id);
    else byDate.set(date, new Set([r.court_id]));
  }

  const out: Record<ISODate, CourtLoad> = {};
  for (const [date, courts] of byDate) out[date] = { total, busy: courts.size };
  return out;
}

/** Fetch a plan the caller's club owns, or null. */
export async function loadPlan(
  db: ReturnType<typeof getSupabaseAdmin>,
  clubId: string,
  planId: string,
) {
  const { data } = await db
    .from('calendar_plans')
    .select('id, club_id, owner_id, year, name, status, season_windows, goals, notes')
    .eq('id', planId)
    .eq('club_id', clubId)
    .maybeSingle();
  return data;
}

/**
 * The club's plan for a year, created on first use.
 * A director who opens CalendarMode should land on a working calendar, not an
 * empty-state form asking them to name something first.
 */
export async function ensurePlan(
  db: ReturnType<typeof getSupabaseAdmin>,
  clubId: string,
  ownerId: string,
  year: number,
  clubName: string,
) {
  const { data: existing } = await db
    .from('calendar_plans')
    .select('id, club_id, owner_id, year, name, status, season_windows, goals, notes')
    .eq('club_id', clubId)
    .eq('year', year)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (existing) return existing;

  const { data: created } = await db
    .from('calendar_plans')
    .insert({
      club_id: clubId,
      owner_id: ownerId,
      year,
      name: `${clubName} ${year}`,
      status: 'draft',
      goals: { events_per_month: 2, min_days_between: 10 },
    })
    .select('id, club_id, owner_id, year, name, status, season_windows, goals, notes')
    .single();

  return created;
}
