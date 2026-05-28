/**
 * CourtSheet AI — plan computation.
 *
 * The dry run. Given a BookingIntent (create) or a Mutation (cancel /
 * move / modify), produces a Plan describing exactly what would happen
 * if applied. Never writes.
 *
 * The Plan carries a signed plan_id that applyPlan() verifies before
 * executing. plan_id signing keeps a stale or stolen preview from being
 * re-applied later.
 */

import { createHmac, randomUUID } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  BookingIntent,
  Mutation,
  Plan,
  Court,
  Reservation,
  ReservationInstance,
  Conflict,
} from './types';
import { expandSeries } from './recurrence';
import { detectConflicts } from './conflicts';
import { resolveSelector, filterFutureOnly } from './selectors';
import { utcToLocalDate, utcToLocalTime } from './timezones';

const MAX_INSTANCES_PER_PLAN_DEFAULT = 500;

export interface PlannerContext {
  db: SupabaseClient<any, 'public', any>;
  club: {
    id: string;
    timezone: string;
    operating_hours: import('./types').OperatingHours;
  };
  courts: Court[];
  /** Max instance count before the plan refuses without explicit allow. */
  maxInstances?: number;
}

export class PlanTooLargeError extends Error {
  constructor(public readonly instanceCount: number, public readonly cap: number) {
    super(
      `Plan would create ${instanceCount} reservations, which exceeds the cap of ${cap}. ` +
        `Pass { allowLarge: true } to override.`
    );
    this.name = 'PlanTooLargeError';
  }
}

export interface PlanOptions {
  /** Override the per-plan instance cap. */
  allowLarge?: boolean;
}

/**
 * Build a plan from a BookingIntent (new reservations / series).
 */
export async function planBooking(
  intent: BookingIntent,
  ctx: PlannerContext,
  opts: PlanOptions = {}
): Promise<Plan> {
  const cap = ctx.maxInstances ?? MAX_INSTANCES_PER_PLAN_DEFAULT;

  const { instances, warnings } = expandSeries(intent, {
    timezone: ctx.club.timezone,
    courts: ctx.courts,
    operating_hours: ctx.club.operating_hours,
  });

  if (!opts.allowLarge && instances.length > cap) {
    throw new PlanTooLargeError(instances.length, cap);
  }

  const existing = await fetchExistingInWindow(
    ctx.db,
    ctx.club.id,
    instances
  );

  const overlapConflicts = detectConflicts({
    candidates: instances,
    existing,
    courts: ctx.courts,
  });

  const warningConflicts: Conflict[] = warnings
    .filter((w) => w.kind === 'outside_operating_hours')
    .map((w) => buildWarningConflict(w as Extract<typeof w, { kind: 'outside_operating_hours' }>, intent, ctx));

  const conflicts = [...overlapConflicts, ...warningConflicts];

  return {
    plan_id: signPlanId(randomUUID(), ctx.club.id),
    club_id: ctx.club.id,
    toCreate: instances,
    toModify: [],
    toCancel: [],
    conflicts,
    summary: summarize(intent, instances, ctx.club.timezone),
    intent,
  };
}

/**
 * Build a plan from a Mutation (cancel / move / modify).
 */
export async function planMutation(mut: Mutation, ctx: PlannerContext): Promise<Plan> {
  let resolved = await resolveSelector(mut.selector, {
    db: ctx.db,
    timezone: ctx.club.timezone,
  });

  // Court-label match deferred from resolveSelector (it doesn't have courts).
  if (mut.selector.courts && mut.selector.courts.length > 0) {
    const wantedIds = mut.selector.courts
      .map((ref) => ctx.courts.find((c) => c.number === ref || c.name === ref)?.id)
      .filter((x): x is string => Boolean(x));
    resolved = resolved.filter((r) => wantedIds.includes(r.court_id));
  }

  if (mut.kind === 'cancel') {
    const scoped = scopeRows(resolved, mut.scope, ctx.club.timezone);
    return {
      plan_id: signPlanId(randomUUID(), ctx.club.id),
      club_id: ctx.club.id,
      toCreate: [],
      toModify: [],
      toCancel: scoped.map((r) => ({ reservation_id: r.id })),
      conflicts: [],
      summary: summarizeCancel(scoped, ctx.club.timezone),
    };
  }

  if (mut.kind === 'modify') {
    const scoped = scopeRows(resolved, 'instance', ctx.club.timezone);
    return {
      plan_id: signPlanId(randomUUID(), ctx.club.id),
      club_id: ctx.club.id,
      toCreate: [],
      toModify: scoped.map((r) => ({
        reservation_id: r.id,
        changes: mut.changes as Partial<Reservation>,
      })),
      toCancel: [],
      conflicts: [],
      summary: {
        instance_count: scoped.length,
        court_count: new Set(scoped.map((r) => r.court_id)).size,
        day_count: new Set(scoped.map((r) => utcToLocalDate(r.starts_at, ctx.club.timezone))).size,
        spans: `${scoped.length} reservation${scoped.length === 1 ? '' : 's'} modified`,
      },
    };
  }

  // move
  const target = mut.target;
  const scoped = scopeRows(resolved, 'instance', ctx.club.timezone);
  const newInstances: ReservationInstance[] = [];
  const toCancel: Array<{ reservation_id: string }> = [];
  for (const r of scoped) {
    // Resolve target court if provided; default to existing court.
    const targetCourtId = target.courts && target.courts.length > 0
      ? ctx.courts.find((c) => c.number === target.courts![0] || c.name === target.courts![0])?.id ?? r.court_id
      : r.court_id;

    const localDate = target.date ?? utcToLocalDate(r.starts_at, ctx.club.timezone);
    const localStart = target.time_start ?? utcToLocalTime(r.starts_at, ctx.club.timezone);
    const localEnd = target.time_end ?? utcToLocalTime(r.ends_at, ctx.club.timezone);

    const { localToUtc } = require('./timezones') as typeof import('./timezones');
    newInstances.push({
      court_id: targetCourtId,
      starts_at: localToUtc(localDate, localStart, ctx.club.timezone).toISOString(),
      ends_at: localToUtc(localDate, localEnd, ctx.club.timezone).toISOString(),
      type: r.type,
      title: r.title,
      meta: r.meta as Record<string, unknown>,
      color: r.color,
      signups_open: r.signups_open,
      signups_capacity: r.signups_capacity,
      signups_pitch: r.signups_pitch,
    });
    toCancel.push({ reservation_id: r.id });
  }

  // Check conflicts in the target window, excluding the rows we're moving away from.
  const existing = await fetchExistingInWindow(ctx.db, ctx.club.id, newInstances);
  const movingIds = new Set(toCancel.map((c) => c.reservation_id));
  const conflicts = detectConflicts({
    candidates: newInstances,
    existing: existing.filter((e) => !movingIds.has(e.id)),
    courts: ctx.courts,
  });

  return {
    plan_id: signPlanId(randomUUID(), ctx.club.id),
    club_id: ctx.club.id,
    toCreate: newInstances,
    toModify: [],
    toCancel,
    conflicts,
    summary: {
      instance_count: newInstances.length,
      court_count: new Set(newInstances.map((c) => c.court_id)).size,
      day_count: new Set(newInstances.map((c) => utcToLocalDate(c.starts_at, ctx.club.timezone))).size,
      spans: `Moved ${newInstances.length} reservation${newInstances.length === 1 ? '' : 's'}`,
    },
  };
}

// ---- internals ----

async function fetchExistingInWindow(
  db: SupabaseClient<any, 'public', any>,
  club_id: string,
  candidates: ReservationInstance[]
): Promise<Reservation[]> {
  if (candidates.length === 0) return [];

  let minStart = candidates[0].starts_at;
  let maxEnd = candidates[0].ends_at;
  for (const c of candidates) {
    if (c.starts_at < minStart) minStart = c.starts_at;
    if (c.ends_at > maxEnd) maxEnd = c.ends_at;
  }

  const { data } = await db
    .from('reservations')
    .select('*')
    .eq('club_id', club_id)
    .neq('status', 'cancelled')
    .lt('starts_at', maxEnd)
    .gt('ends_at', minStart);

  return (data ?? []) as Reservation[];
}

function scopeRows(
  rows: Reservation[],
  scope: import('./types').MutationScope,
  timezone: string
): Reservation[] {
  switch (scope) {
    case 'instance':
      return rows;
    case 'future':
      return filterFutureOnly(rows, timezone);
    case 'series': {
      // All rows that share a series_id with any of the resolved rows.
      const seriesIds = new Set(rows.map((r) => r.series_id).filter(Boolean) as string[]);
      return rows.filter((r) => r.series_id && seriesIds.has(r.series_id));
    }
    case 'range':
      return rows;
  }
}

function summarize(
  intent: BookingIntent,
  instances: ReservationInstance[],
  timezone: string
): Plan['summary'] {
  const courts = new Set(instances.map((i) => i.court_id));
  const days = new Set(instances.map((i) => utcToLocalDate(i.starts_at, timezone)));
  const dowLabel = (intent.days_of_week && intent.days_of_week.length > 0)
    ? `${dowList(intent.days_of_week)}, `
    : '';
  const span = `${dowLabel}${intent.date_range.start} – ${intent.date_range.end}, ${intent.time_range.start}–${intent.time_range.end}`;
  return {
    instance_count: instances.length,
    court_count: courts.size,
    day_count: days.size,
    spans: span,
  };
}

function summarizeCancel(rows: Reservation[], timezone: string): Plan['summary'] {
  return {
    instance_count: rows.length,
    court_count: new Set(rows.map((r) => r.court_id)).size,
    day_count: new Set(rows.map((r) => utcToLocalDate(r.starts_at, timezone))).size,
    spans: `Cancel ${rows.length} reservation${rows.length === 1 ? '' : 's'}`,
  };
}

const DOW_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function dowList(dows: number[]): string {
  const sorted = [...dows].sort((a, b) => a - b);
  // Weekday compaction: 1..5 → "Mon–Fri"
  if (sorted.length === 5 && sorted[0] === 1 && sorted[4] === 5) return 'Mon–Fri';
  if (sorted.length === 7) return 'every day';
  return sorted.map((d) => DOW_NAMES[d]).join(', ');
}

function buildWarningConflict(
  w: { kind: 'outside_operating_hours'; date: string },
  intent: BookingIntent,
  ctx: PlannerContext
): Conflict {
  return {
    candidate: {
      court_id: '',
      court_label: '(any)',
      starts_at: w.date,
      ends_at: w.date,
      title: intent.title,
    },
    against: { kind: 'same-batch', court_id: '', starts_at: w.date, ends_at: w.date },
    warning: 'outside_operating_hours',
  };
}

// ---- plan_id signing ----

const PLAN_ID_SECRET_ENV = 'COURTSHEET_PLAN_SECRET';

/**
 * Returns `${uuid}.${hmac}`. applyPlan() splits + verifies before any DB
 * write. Falls back to SUPABASE_SERVICE_ROLE_KEY if the dedicated secret
 * isn't set (matches the existing UNSUBSCRIBE_SECRET fallback pattern).
 */
export function signPlanId(uuid: string, club_id: string): string {
  const secret = process.env[PLAN_ID_SECRET_ENV] ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  const hmac = createHmac('sha256', secret).update(`${uuid}:${club_id}`).digest('hex').slice(0, 32);
  return `${uuid}.${hmac}`;
}

export function verifyPlanId(signed: string, club_id: string): string | null {
  const [uuid, hmac] = signed.split('.');
  if (!uuid || !hmac) return null;
  const expected = signPlanId(uuid, club_id).split('.')[1];
  return constantTimeEqual(hmac, expected) ? uuid : null;
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
