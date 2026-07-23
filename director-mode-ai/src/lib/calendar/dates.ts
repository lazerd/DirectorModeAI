/**
 * CalendarMode — pure ISO-date arithmetic.
 *
 * Everything here operates on 'YYYY-MM-DD' strings via UTC internally. A year
 * plan is about DAYS, not instants: "the 4th of July event" is on July 4 in
 * the club's town regardless of what timezone the director's laptop is in.
 * Using UTC math on date-only strings keeps that true and sidesteps the class
 * of off-by-one-day bugs you get from `new Date('2027-07-04')` in a negative
 * offset (which lands on July 3 locally).
 *
 * date-fns is available in the app, but its Date-based API reintroduces exactly
 * the local-timezone coupling we're avoiding, so the arithmetic is inlined.
 */

import type { ISODate } from './types';

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isISODate(v: unknown): v is ISODate {
  return typeof v === 'string' && ISO_RE.test(v);
}

/** Build an ISO date from parts. month is 1-12. */
export function toISO(year: number, month: number, day: number): ISODate {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(year, 4)}-${p(month)}-${p(day)}`;
}

export function parseISO(iso: ISODate): { year: number; month: number; day: number } {
  const m = ISO_RE.exec(iso);
  if (!m) throw new Error(`Not an ISO date: ${iso}`);
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

/** Days since epoch — the canonical integer form for all comparisons. */
export function toEpochDay(iso: ISODate): number {
  const { year, month, day } = parseISO(iso);
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

export function fromEpochDay(epochDay: number): ISODate {
  const d = new Date(epochDay * 86_400_000);
  return toISO(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

export function addDays(iso: ISODate, n: number): ISODate {
  return fromEpochDay(toEpochDay(iso) + n);
}

/** Signed day count from `a` to `b`. Negative when b precedes a. */
export function daysBetween(a: ISODate, b: ISODate): number {
  return toEpochDay(b) - toEpochDay(a);
}

/** Absolute distance in days. */
export function daysApart(a: ISODate, b: ISODate): number {
  return Math.abs(daysBetween(a, b));
}

/** 0=Sunday .. 6=Saturday. */
export function dayOfWeek(iso: ISODate): number {
  const { year, month, day } = parseISO(iso);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function monthOf(iso: ISODate): number {
  return parseISO(iso).month;
}

export function yearOf(iso: ISODate): number {
  return parseISO(iso).year;
}

export function isWeekendDay(iso: ISODate): boolean {
  const d = dayOfWeek(iso);
  return d === 0 || d === 6;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** True when `iso` falls within [start, end] inclusive. */
export function withinRange(iso: ISODate, start: ISODate, end: ISODate): boolean {
  const d = toEpochDay(iso);
  return d >= toEpochDay(start) && d <= toEpochDay(end);
}

/** True when the two inclusive ranges share at least one day. */
export function rangesOverlap(aStart: ISODate, aEnd: ISODate, bStart: ISODate, bEnd: ISODate): boolean {
  return toEpochDay(aStart) <= toEpochDay(bEnd) && toEpochDay(bStart) <= toEpochDay(aEnd);
}

/**
 * The nth `dow` of a month. n is 1-based; pass -1 for "last".
 * nthWeekdayOfMonth(2027, 6, 6, 3) → the 3rd Saturday of June 2027.
 * Returns null when the month has no nth occurrence (e.g. a 5th Monday).
 */
export function nthWeekdayOfMonth(
  year: number,
  month: number,
  dow: number,
  n: number,
): ISODate | null {
  const last = daysInMonth(year, month);
  if (n > 0) {
    const firstDow = dayOfWeek(toISO(year, month, 1));
    const offset = (dow - firstDow + 7) % 7;
    const day = 1 + offset + (n - 1) * 7;
    return day <= last ? toISO(year, month, day) : null;
  }
  // Counting back from the end of the month.
  const lastDow = dayOfWeek(toISO(year, month, last));
  const offset = (lastDow - dow + 7) % 7;
  const day = last - offset + (n + 1) * 7;
  return day >= 1 ? toISO(year, month, day) : null;
}

/**
 * The occurrence of `dow` nearest to `iso`, ties going forward.
 * Used by the `nearest:MM-DD:DAY` anchor — "the Saturday nearest July 4".
 */
export function nearestWeekday(iso: ISODate, dow: number): ISODate {
  const base = dayOfWeek(iso);
  const forward = (dow - base + 7) % 7;
  const backward = (base - dow + 7) % 7;
  return forward <= backward ? addDays(iso, forward) : addDays(iso, -backward);
}

/** Every date in [start, end] inclusive. */
export function eachDay(start: ISODate, end: ISODate): ISODate[] {
  const out: ISODate[] = [];
  const last = toEpochDay(end);
  for (let d = toEpochDay(start); d <= last; d++) out.push(fromEpochDay(d));
  return out;
}

/**
 * Week bucket used for cadence spacing — weeks since epoch, Monday-aligned.
 * Two events in the same bucket are "the same weekend" for pacing purposes.
 */
export function weekIndex(iso: ISODate): number {
  // Epoch day 0 (1970-01-01) was a Thursday; shift by 3 to Monday-align.
  return Math.floor((toEpochDay(iso) + 3) / 7);
}

const DOW_NAMES: Record<string, number> = {
  SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6,
};

/** 'SAT' → 6. Returns null for anything unrecognised. */
export function parseDowName(name: string): number | null {
  const n = DOW_NAMES[name.trim().toUpperCase().slice(0, 3)];
  return n === undefined ? null : n;
}

export function dowName(dow: number): string {
  return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dow] ?? '';
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function monthName(month: number): string {
  return MONTH_NAMES[month - 1] ?? '';
}

/** "Sat, Jul 3" — the compact label used across the year grid. */
export function shortLabel(iso: ISODate): string {
  const { month, day } = parseISO(iso);
  return `${dowName(dayOfWeek(iso)).slice(0, 3)}, ${monthName(month).slice(0, 3)} ${day}`;
}
