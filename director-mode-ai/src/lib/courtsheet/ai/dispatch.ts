/**
 * CourtSheet AI — tool dispatch.
 *
 * Given an Anthropic tool_use block, runs the matching engine method and
 * returns the result. This is the seam between the LLM's structured
 * intent and the deterministic engine.
 *
 * All write-producing tools return a Plan (preview only — never writes).
 * The client confirms via /api/courtsheet/ai/confirm.
 */

import { CourtSheetEngine } from '../engine';
import type {
  BookingIntent,
  Mutation,
  Plan,
  Selector,
  ReservationType,
  DayOfWeek,
} from '../types';
import { availability } from '../availability';
import { utcToLocalDate, utcToLocalTime } from '../timezones';

export type ToolName =
  | 'get_context'
  | 'query_availability'
  | 'book'
  | 'move'
  | 'cancel'
  | 'modify'
  | 'block_courts';

export interface DispatchContext {
  engine: CourtSheetEngine;
  /** "Today" in the club's local time. */
  todayISO: string;
}

export type DispatchResult =
  | { kind: 'context'; context: ClubContext }
  | { kind: 'slots'; slots: AvailabilitySlot[] }
  | { kind: 'plan'; plan: Plan; intent_summary: string }
  | { kind: 'error'; message: string };

export interface ClubContext {
  club_name: string;
  timezone: string;
  today: string;
  /** Per-DOW operating window summary in HH:MM. */
  operating_hours: Record<string, Array<{ open: string; close: string }> | null>;
  courts: Array<{
    number: number;
    name: string | null;
    sports: string[];
    surface: string | null;
    indoor: boolean;
    status: string;
  }>;
  upcoming: Array<{
    title: string;
    type: string;
    court: string;
    date: string;
    time_start: string;
    time_end: string;
  }>;
}

interface AvailabilitySlot {
  court: string;
  date: string;
  start: string;
  end: string;
  duration_minutes: number;
}

export async function dispatch(
  name: ToolName,
  input: any,
  ctx: DispatchContext
): Promise<DispatchResult> {
  switch (name) {
    case 'get_context':
      return { kind: 'context', context: await buildContext(ctx, input) };
    case 'query_availability':
      return dispatchQueryAvailability(input, ctx);
    case 'book':
      return dispatchBook(input, ctx);
    case 'move':
      return dispatchMove(input, ctx);
    case 'cancel':
      return dispatchCancel(input, ctx);
    case 'modify':
      return dispatchModify(input, ctx);
    case 'block_courts':
      return dispatchBlockCourts(input, ctx);
    default:
      return { kind: 'error', message: `Unknown tool: ${name}` };
  }
}

async function buildContext(
  ctx: DispatchContext,
  input: { date_range_hint?: { start: string; end: string } }
): Promise<ClubContext> {
  const club = ctx.engine.getClub();
  const courts = ctx.engine.getCourts();

  // Upcoming bookings window: the hint if given, else today + 14 days.
  const windowStart = input?.date_range_hint?.start ?? ctx.todayISO;
  const windowEnd = input?.date_range_hint?.end ?? addDays(ctx.todayISO, 14);

  const slots = await ctx.engine.availability({
    date_range: { start: windowStart, end: windowEnd },
  });
  // Inverse of availability isn't directly exposed; for the summary we
  // query reservations through the engine's hosted DB-aware method.
  // Simpler: fetch reservations in the window via the engine's internal
  // method shape. For now, return courts + an empty upcoming and let the
  // model rely on availability() for "what's open".
  const _ = slots;

  // Read reservations directly through admin client for upcoming summary.
  const db = (ctx.engine as any).db as ReturnType<
    typeof import('@/lib/supabase/admin').getSupabaseAdmin
  >;
  const startUtc = new Date(`${windowStart}T00:00:00Z`).toISOString();
  const endUtc = new Date(`${windowEnd}T23:59:59Z`).toISOString();
  const { data: upcomingRows } = await db
    .from('reservations')
    .select('id, court_id, starts_at, ends_at, title, type, status')
    .eq('club_id', club.id)
    .neq('status', 'cancelled')
    .gte('starts_at', startUtc)
    .lt('starts_at', endUtc)
    .order('starts_at', { ascending: true })
    .limit(40);
  const upcoming = ((upcomingRows ?? []) as any[]).map((r) => {
    const c = courts.find((cc) => cc.id === r.court_id);
    return {
      title: r.title as string,
      type: r.type as string,
      court: c?.name ?? `Court ${c?.number ?? '?'}`,
      date: utcToLocalDate(r.starts_at, club.timezone),
      time_start: utcToLocalTime(r.starts_at, club.timezone),
      time_end: utcToLocalTime(r.ends_at, club.timezone),
    };
  });

  return {
    club_name: club.name,
    timezone: club.timezone,
    today: ctx.todayISO,
    operating_hours: (club.operating_hours ?? {}) as ClubContext['operating_hours'],
    courts: courts.map((c) => ({
      number: c.number,
      name: c.name,
      sports: c.sports,
      surface: c.surface,
      indoor: c.indoor,
      status: c.status,
    })),
    upcoming,
  };
}

async function dispatchQueryAvailability(
  input: any,
  ctx: DispatchContext
): Promise<DispatchResult> {
  if (!input?.date_range?.start || !input?.date_range?.end) {
    return { kind: 'error', message: 'date_range is required' };
  }
  const slots = await ctx.engine.availability({
    date_range: input.date_range,
    courts: input.courts,
    days_of_week: input.days_of_week,
    time_range: input.time_range,
    sport: input.sport,
    min_minutes: input.min_minutes ?? 30,
  });
  return {
    kind: 'slots',
    slots: slots.slice(0, 40).map((s) => ({
      court: s.court_label,
      date: s.date,
      start: s.start,
      end: s.end,
      duration_minutes: s.duration_minutes,
    })),
  };
}

async function dispatchBook(input: any, ctx: DispatchContext): Promise<DispatchResult> {
  if (!input?.courts || !input?.date_range || !input?.time_range || !input?.type || !input?.title) {
    return { kind: 'error', message: 'Missing required fields' };
  }
  const intent: BookingIntent = {
    club_id: ctx.engine.getClub().id,
    courts: input.courts,
    date_range: input.date_range,
    days_of_week: input.days_of_week as DayOfWeek[] | undefined,
    time_range: input.time_range,
    exclusions: input.exclusions,
    type: input.type as ReservationType,
    title: input.title,
    signups: input.signups,
    meta: input.meta,
    color: input.color,
  };
  const plan = await ctx.engine.computeBookingPlan(intent, { allowLarge: false });
  return {
    kind: 'plan',
    plan,
    intent_summary: summarizeBookingIntent(intent, plan.summary.instance_count),
  };
}

async function dispatchMove(input: any, ctx: DispatchContext): Promise<DispatchResult> {
  if (!input?.selector || !input?.target) {
    return { kind: 'error', message: 'selector and target are required' };
  }
  const mut: Mutation = {
    kind: 'move',
    selector: { club_id: ctx.engine.getClub().id, ...input.selector } as Selector,
    target: input.target,
  };
  const plan = await ctx.engine.computeMutationPlan(mut);
  return { kind: 'plan', plan, intent_summary: `Move ${plan.summary.instance_count} reservation(s)` };
}

async function dispatchCancel(input: any, ctx: DispatchContext): Promise<DispatchResult> {
  if (!input?.selector || !input?.scope) {
    return { kind: 'error', message: 'selector and scope are required' };
  }
  const mut: Mutation = {
    kind: 'cancel',
    selector: { club_id: ctx.engine.getClub().id, ...input.selector } as Selector,
    scope: input.scope,
  };
  const plan = await ctx.engine.computeMutationPlan(mut);
  return {
    kind: 'plan',
    plan,
    intent_summary: `Cancel ${plan.summary.instance_count} reservation(s)`,
  };
}

async function dispatchModify(input: any, ctx: DispatchContext): Promise<DispatchResult> {
  if (!input?.selector || !input?.changes) {
    return { kind: 'error', message: 'selector and changes are required' };
  }
  const mut: Mutation = {
    kind: 'modify',
    selector: { club_id: ctx.engine.getClub().id, ...input.selector } as Selector,
    changes: input.changes,
  };
  const plan = await ctx.engine.computeMutationPlan(mut);
  return {
    kind: 'plan',
    plan,
    intent_summary: `Modify ${plan.summary.instance_count} reservation(s)`,
  };
}

async function dispatchBlockCourts(input: any, ctx: DispatchContext): Promise<DispatchResult> {
  if (!input?.courts || !input?.date_range || !input?.reason) {
    return { kind: 'error', message: 'courts, date_range, and reason are required' };
  }
  const kind = (input.kind as 'maintenance' | 'blackout' | undefined) ?? 'maintenance';
  const intent: BookingIntent = {
    club_id: ctx.engine.getClub().id,
    courts: input.courts,
    date_range: input.date_range,
    time_range: input.time_range ?? { start: '00:00', end: '23:59' },
    type: kind,
    title: input.reason,
    meta: { reason: input.reason },
  };
  const plan = await ctx.engine.computeBookingPlan(intent, { allowLarge: true });
  return {
    kind: 'plan',
    plan,
    intent_summary: `Block ${plan.summary.instance_count} court-day(s) for ${input.reason}`,
  };
}

function summarizeBookingIntent(intent: BookingIntent, count: number): string {
  const courts = intent.courts.length;
  return `Create ${count} reservation${count === 1 ? '' : 's'} across ${courts} court${courts === 1 ? '' : 's'} — ${intent.title}`;
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
