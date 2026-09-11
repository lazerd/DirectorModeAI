/**
 * Club-local dates for MaintenanceMode.
 *
 * Vercel runs in UTC, and "today" in UTC flips at 5 PM Pacific — so a crew
 * finishing up at 6 PM would see tomorrow's checklist. Every date here is
 * computed in the CLUB's time zone, and nothing reads the clock itself: the
 * caller passes `now` so tests can pin it.
 *
 * Once a date is a club-local YYYY-MM-DD string, the arithmetic below is pure
 * calendar maths (done at UTC noon internally), so DST can never shift it.
 */
import type { ISODate } from './types';

/** The club's calendar date at instant `now`, as YYYY-MM-DD. */
export function clubToday(now: Date, timeZone: string): ISODate {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** The club's wall-clock time at `now`, as 'HH:MM' (24-hour). */
export function clubNowHHMM(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const h = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const m = parts.find((p) => p.type === 'minute')?.value ?? '00';
  return `${h}:${m}`;
}

function toUtcNoon(iso: ISODate): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
}

export function addDays(iso: ISODate, n: number): ISODate {
  const t = toUtcNoon(iso);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOf(iso: ISODate): number {
  return toUtcNoon(iso).getUTCDay();
}

/** Whole days from `a` to `b` (positive when b is later). */
export function daysBetween(a: ISODate, b: ISODate): number {
  return Math.round((toUtcNoon(b).getTime() - toUtcNoon(a).getTime()) / 86_400_000);
}

export function isISODate(v: unknown): v is ISODate {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(toUtcNoon(v).getTime());
}

/** "Thursday, Sep 11" for a club-local date. */
export function longDate(iso: ISODate): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(toUtcNoon(iso));
}

/** "Thu Sep 11" for a club-local date (no comma — it reads as a label). */
export function shortDate(iso: ISODate): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
    .format(toUtcNoon(iso))
    .replace(',', '');
}

/** '07:00' / '07:00:00' → '7:00 AM'. */
export function time12(hhmm: string | null | undefined): string {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  if (Number.isNaN(h)) return '';
  const ampm = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m || 0).padStart(2, '0')} ${ampm}`;
}

/** Normalise Postgres `time` ('07:00:00') to 'HH:MM'. */
export function hhmm(t: string | null | undefined): string | null {
  if (!t) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(t);
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null;
}
