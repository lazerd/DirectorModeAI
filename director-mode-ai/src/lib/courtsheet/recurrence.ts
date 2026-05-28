/**
 * CourtSheet AI — recurrence expansion.
 *
 * Pure function: BookingIntent → ReservationInstance[]. Enumerates every
 * (court × date) the intent implies, in the club's timezone, respecting
 * operating hours and court status. No I/O.
 *
 * The backend owns expansion (NOT the model) — the spec is explicit:
 * "We do not trust the model to enumerate 264 dates."
 */

import type {
  BookingIntent,
  ReservationInstance,
  Court,
  DayOfWeek,
  OperatingHours,
} from './types';
import {
  enumerateDates,
  localDayOfWeek,
  localToUtc,
  normalizeTime,
  timeToMinutes,
} from './timezones';

export interface ExpandContext {
  timezone: string;
  /** All active courts for the club, with status/labels for resolution. */
  courts: Court[];
  /** Per-DOW operating windows (or empty {} for 24/7). */
  operating_hours: OperatingHours;
}

export interface ExpandedResult {
  instances: ReservationInstance[];
  /** Non-fatal issues the planner surfaces in Plan.conflicts as warnings. */
  warnings: Array<
    | { kind: 'unknown_court'; label: string | number }
    | { kind: 'court_maintenance'; court_id: string; label: string }
    | { kind: 'court_hidden'; court_id: string; label: string }
    | { kind: 'outside_operating_hours'; date: string }
    | { kind: 'date_excluded'; date: string }
  >;
}

/**
 * Expand a BookingIntent into one ReservationInstance per (court × date).
 *
 * The order of operations matters:
 *   1) Resolve court labels → court_ids using the club's courts.
 *      Unknown labels become warnings, not silent skips.
 *   2) Enumerate dates in [date_range.start, date_range.end] inclusive.
 *   3) Filter by days_of_week (DOW computed in CLUB-LOCAL time).
 *   4) Drop exclusions.
 *   5) Clip out-of-operating-hours days (warn, don't drop unless fully outside).
 *   6) Convert each (date, time_range) to UTC per-instance.
 */
export function expandSeries(intent: BookingIntent, ctx: ExpandContext): ExpandedResult {
  const warnings: ExpandedResult['warnings'] = [];

  // 1) Court resolution.
  const resolved: Array<{ court: Court; label: string }> = [];
  for (const ref of intent.courts) {
    const court = resolveCourt(ref, ctx.courts);
    if (!court) {
      warnings.push({ kind: 'unknown_court', label: ref });
      continue;
    }
    if (court.status === 'maintenance') {
      warnings.push({ kind: 'court_maintenance', court_id: court.id, label: String(ref) });
      // Still emit instances — planner will surface as soft conflict the
      // user can override with explicit confirm.
    }
    if (court.status === 'hidden') {
      warnings.push({ kind: 'court_hidden', court_id: court.id, label: String(ref) });
      continue; // hidden courts never get instances
    }
    resolved.push({ court, label: String(ref) });
  }

  // 2-4) Date filtering.
  const allDates = enumerateDates(intent.date_range.start, intent.date_range.end);
  const allowedDOW = new Set<DayOfWeek>(
    intent.days_of_week && intent.days_of_week.length > 0
      ? intent.days_of_week
      : ([0, 1, 2, 3, 4, 5, 6] as DayOfWeek[])
  );
  const exclusionSet = new Set(intent.exclusions ?? []);

  const validDates: string[] = [];
  for (const date of allDates) {
    if (exclusionSet.has(date)) {
      warnings.push({ kind: 'date_excluded', date });
      continue;
    }
    const dow = localDayOfWeek(date, ctx.timezone);
    if (!allowedDOW.has(dow)) continue;
    validDates.push(date);
  }

  // 5) Operating-hours check (warning only — adapters can decide to honor).
  const startMin = timeToMinutes(intent.time_range.start);
  const endMin = timeToMinutes(intent.time_range.end);
  if (endMin <= startMin) {
    return { instances: [], warnings }; // bad input; planner short-circuits
  }

  const timeStart = normalizeTime(intent.time_range.start);
  const timeEnd = normalizeTime(intent.time_range.end);

  const instances: ReservationInstance[] = [];
  for (const date of validDates) {
    if (!withinOperatingHours(date, startMin, endMin, ctx.operating_hours, ctx.timezone)) {
      warnings.push({ kind: 'outside_operating_hours', date });
      // Continue — emit anyway; the planner shows the warning in the
      // preview and the user explicitly accepts before write.
    }

    const startsAt = localToUtc(date, timeStart, ctx.timezone).toISOString();
    const endsAt = localToUtc(date, timeEnd, ctx.timezone).toISOString();

    for (const { court } of resolved) {
      instances.push({
        court_id: court.id,
        starts_at: startsAt,
        ends_at: endsAt,
        type: intent.type,
        title: intent.title,
        meta: intent.meta ?? {},
        color: intent.color ?? null,
        signups_open: intent.signups?.open ?? false,
        signups_capacity: intent.signups?.capacity ?? null,
        signups_pitch: intent.signups?.pitch ?? null,
      });
    }
  }

  return { instances, warnings };
}

/**
 * Find a court by label. Tries name first (exact), then number-as-string,
 * then number-as-int. Returns undefined if no match.
 */
function resolveCourt(ref: number | string, courts: Court[]): Court | undefined {
  if (typeof ref === 'number') {
    return courts.find((c) => c.number === ref);
  }
  const trimmed = ref.trim();
  const byName = courts.find((c) => c.name === trimmed);
  if (byName) return byName;
  const asInt = parseInt(trimmed, 10);
  if (!Number.isNaN(asInt)) {
    return courts.find((c) => c.number === asInt);
  }
  return undefined;
}

/**
 * Is [startMin, endMin) within any of this DOW's open windows?
 * An empty operating_hours object means 24/7 (no constraint).
 */
function withinOperatingHours(
  date: string,
  startMin: number,
  endMin: number,
  hours: OperatingHours,
  timezone: string
): boolean {
  if (!hours || Object.keys(hours).length === 0) return true;

  const dow = localDayOfWeek(date, timezone);
  const windows = hours[`${dow}` as keyof OperatingHours];
  if (windows === null || windows === undefined || windows.length === 0) return false;

  for (const w of windows) {
    const open = timeToMinutes(w.open);
    const close = timeToMinutes(w.close);
    if (startMin >= open && endMin <= close) return true;
  }
  return false;
}

/**
 * Numeric helper exposed for adapters that need to expand a single-shot
 * intent (no recurrence, single court, single time) without all the DOW
 * filtering. Equivalent to expandSeries() with one court + one date.
 */
export function singleInstance(args: {
  court: Court;
  date: string;
  time_start: string;
  time_end: string;
  timezone: string;
  type: BookingIntent['type'];
  title: string;
  meta?: Record<string, unknown>;
  signups?: BookingIntent['signups'];
}): ReservationInstance {
  const startsAt = localToUtc(args.date, args.time_start, args.timezone).toISOString();
  const endsAt = localToUtc(args.date, args.time_end, args.timezone).toISOString();
  return {
    court_id: args.court.id,
    starts_at: startsAt,
    ends_at: endsAt,
    type: args.type,
    title: args.title,
    meta: args.meta ?? {},
    color: null,
    signups_open: args.signups?.open ?? false,
    signups_capacity: args.signups?.capacity ?? null,
    signups_pitch: args.signups?.pitch ?? null,
  };
}
