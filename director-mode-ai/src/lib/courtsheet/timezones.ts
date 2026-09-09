/**
 * CourtSheet AI — timezone utilities.
 *
 * Single owner of all conversions between club-local wall-clock time and
 * UTC. Every other module in src/lib/courtsheet/ goes through these
 * helpers so there's no ad-hoc date math sprinkled across the codebase.
 *
 * Why this exists: DST. A "9 AM Tuesday clinic" must stay 9 AM in the
 * club's wall-clock across the spring-forward and fall-back transitions.
 * That means recurrence is computed in local time and only converted to
 * UTC per-instance — never the other way around.
 */

import { fromZonedTime, toZonedTime, formatInTimeZone } from 'date-fns-tz';
import { addDays, getDay, parseISO } from 'date-fns';
import type { DayOfWeek } from './types';

/**
 * Combine a club-local date (YYYY-MM-DD) + time (HH:MM) into a UTC Date.
 * The interpretation of (date, time) is in `timezone`.
 */
export function localToUtc(dateISO: string, timeHHMM: string, timezone: string): Date {
  const localISO = `${dateISO}T${normalizeTime(timeHHMM)}:00`;
  return fromZonedTime(localISO, timezone);
}

/*
 * Both of these must use formatInTimeZone, NOT date-fns-tz's `format` with a
 * `timeZone` option. They are not two spellings of the same thing: `format`
 * renders the instant as-is and uses `timeZone` only for the zone-NAME tokens
 * (z, zzz), so it returns UTC digits. formatInTimeZone shifts the instant into
 * the zone first, which is what "club-local" means here.
 *
 * Getting this wrong printed every CourtSheet time at the UTC offset — a 9 AM
 * clinic read 16:00 — and rolled any evening booking onto the next day, since
 * 7 PM Pacific is already tomorrow in UTC.
 */

/** UTC Date → club-local YYYY-MM-DD. */
export function utcToLocalDate(utc: Date | string, timezone: string): string {
  const d = typeof utc === 'string' ? parseISO(utc) : utc;
  return formatInTimeZone(d, timezone, 'yyyy-MM-dd');
}

/** UTC Date → club-local HH:MM. */
export function utcToLocalTime(utc: Date | string, timezone: string): string {
  const d = typeof utc === 'string' ? parseISO(utc) : utc;
  return formatInTimeZone(d, timezone, 'HH:mm');
}

/** DOW (0=Sun..6=Sat) of a club-local YYYY-MM-DD. */
export function localDayOfWeek(dateISO: string, timezone: string): DayOfWeek {
  // Convert noon-local to UTC, then read the DOW. Noon avoids any DST
  // edge cases at midnight.
  const noonUtc = localToUtc(dateISO, '12:00', timezone);
  const noonLocal = toZonedTime(noonUtc, timezone);
  return getDay(noonLocal) as DayOfWeek;
}

/** Enumerate every YYYY-MM-DD between two inclusive bounds, club-local. */
export function enumerateDates(startISO: string, endISO: string): string[] {
  if (endISO < startISO) return [];
  const out: string[] = [];
  let cursor = parseISO(startISO);
  const end = parseISO(endISO);
  while (cursor <= end) {
    out.push(formatYmd(cursor));
    cursor = addDays(cursor, 1);
  }
  return out;
}

function formatYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Accept "9", "9:00", "09:00" — normalize to "09:00". */
export function normalizeTime(s: string): string {
  const trimmed = s.trim();
  const [h, m = '0'] = trimmed.split(':');
  return `${h.padStart(2, '0')}:${m.padStart(2, '0')}`;
}

/** HH:MM comparison helpers. */
export function timeToMinutes(hhmm: string): number {
  const [h, m] = normalizeTime(hhmm).split(':').map((s) => parseInt(s, 10));
  return h * 60 + m;
}

export function minutesToTime(total: number): string {
  const h = Math.floor(total / 60)
    .toString()
    .padStart(2, '0');
  const m = (total % 60).toString().padStart(2, '0');
  return `${h}:${m}`;
}
