/**
 * A class's meeting dates.
 *
 * The one calculation the whole club-site feature turns on. A director's
 * complaint about their old website was that changing a skip date was a
 * project; here it is one element of an array, and every surface that shows
 * dates — the public program page, the confirmation email, the editor's date
 * grid, the "we skip" line — reads them from this function.
 *
 * PURE, and NOTHING IS STORED. Meeting dates are a function of
 * (range, days_of_week, exclusions, timezone). A sessions table would be a
 * cache needing invalidation on exactly the edit that has to feel instant.
 *
 * The day-of-week test runs in CLUB-LOCAL time, reusing the same helpers as
 * lib/courtsheet/recurrence.ts. This is not fussiness: Vercel runs UTC, so a
 * Tuesday 5:30pm class in California is Wednesday 00:30 UTC, and a naive
 * `new Date(iso).getDay()` puts every session on the wrong day of the week —
 * which would silently drop every single meeting from a Tue/Thu class.
 */

import { enumerateDates, localDayOfWeek } from '@/lib/courtsheet/timezones';
import type { DayOfWeek } from '@/lib/courtsheet/types';

/** Just the fields a schedule needs — any row or draft shaped like this works. */
export type ProgramSchedule = {
  range_start: string;
  range_end: string;
  /** Postgres DOW: 0=Sun..6=Sat. Empty means every day in the range. */
  days_of_week: number[] | null;
  /** Skip dates, as YYYY-MM-DD. */
  exclusions: string[] | null;
};

export type ProgramSessions = {
  /** Every date the class actually meets, ascending. */
  dates: string[];
  /**
   * Skip dates that would otherwise have been a meeting — i.e. they fall in
   * range and on a matching day of week. An exclusion for a date the class was
   * never going to meet is not reported, because telling a parent "we skip
   * Sunday Nov 30" about a Tue/Thu class is noise.
   */
  skipped: string[];
  /** dates.length — what the page and the email both call "N sessions". */
  count: number;
};

/** Dates come out of Postgres as 'YYYY-MM-DD' or a full timestamp; want the day. */
function ymd(value: string): string {
  return value.slice(0, 10);
}

export function programSessions(
  program: ProgramSchedule,
  timeZone: string,
): ProgramSessions {
  const start = ymd(program.range_start);
  const end = ymd(program.range_end);

  const allowed = new Set<DayOfWeek>(
    program.days_of_week && program.days_of_week.length > 0
      ? (program.days_of_week as DayOfWeek[])
      : ([0, 1, 2, 3, 4, 5, 6] as DayOfWeek[]),
  );
  const excluded = new Set((program.exclusions ?? []).map(ymd));

  const dates: string[] = [];
  const skipped: string[] = [];

  for (const date of enumerateDates(start, end)) {
    // Day-of-week first: an exclusion only counts as a skipped SESSION if the
    // class would have met that day.
    if (!allowed.has(localDayOfWeek(date, timeZone))) continue;
    if (excluded.has(date)) {
      skipped.push(date);
      continue;
    }
    dates.push(date);
  }

  return { dates, skipped, count: dates.length };
}

/** The next meeting on or after a given day, or null once the class is over. */
export function nextSession(
  program: ProgramSchedule,
  timeZone: string,
  fromYmd: string,
): string | null {
  return programSessions(program, timeZone).dates.find((d) => d >= fromYmd) ?? null;
}

const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * "Tue & Thu" / "Mon, Wed & Fri" — how a class describes itself in a heading.
 * Ordered Sunday-first to match Postgres DOW rather than the order the director
 * happened to click the checkboxes in.
 */
export function daysLabel(daysOfWeek: number[] | null): string {
  const days = [...new Set(daysOfWeek ?? [])].filter((d) => d >= 0 && d <= 6).sort((a, b) => a - b);
  if (days.length === 0) return 'Daily';
  const names = days.map((d) => DOW_LABELS[d]);
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`;
}

/**
 * "Sep 15" — a meeting date for a human, in club time.
 *
 * Intl with an explicit timeZone and a midday UTC instant: parsing
 * 'YYYY-MM-DD' alone gives midnight UTC, which formats as the PREVIOUS day
 * anywhere west of Greenwich.
 */
export function formatSessionDate(
  dateYmd: string,
  timeZone: string,
  opts: { weekday?: boolean; year?: boolean } = {},
): string {
  const d = new Date(`${ymd(dateYmd)}T12:00:00Z`);
  return new Intl.DateTimeFormat('en-US', {
    ...(opts.weekday ? { weekday: 'short' as const } : {}),
    month: 'short',
    day: 'numeric',
    ...(opts.year ? { year: 'numeric' as const } : {}),
    timeZone,
  }).format(d);
}

/**
 * "3:30 – 5:00 PM" from two club-local HH:MM(:SS) strings.
 *
 * Minutes are all-or-nothing across the range: if either end has them, both
 * show them. Otherwise a 3:30–5:00 class prints as "3:30 – 5 PM", which reads
 * like a typo on a page a parent is deciding from.
 */
export function formatTimeRange(timeStart: string, timeEnd: string): string {
  const parse = (hhmm: string) => {
    const [h, m] = hhmm.split(':').map((s) => parseInt(s, 10));
    return { h, m: m || 0 };
  };
  const a = parse(timeStart);
  const b = parse(timeEnd);
  const withMinutes = a.m !== 0 || b.m !== 0;

  const show = ({ h, m }: { h: number; m: number }) => {
    const hour = h % 12 === 0 ? 12 : h % 12;
    return withMinutes ? `${hour}:${String(m).padStart(2, '0')}` : `${hour}`;
  };
  const meridiem = (h: number) => (h >= 12 ? 'PM' : 'AM');

  // Drop the first AM/PM when both sides share it.
  return meridiem(a.h) === meridiem(b.h)
    ? `${show(a)} – ${show(b)} ${meridiem(b.h)}`
    : `${show(a)} ${meridiem(a.h)} – ${show(b)} ${meridiem(b.h)}`;
}

/** "$240" / "$35" / "Free" — cents to what a parent reads. */
export function formatPrice(cents: number | null | undefined): string {
  if (cents == null || cents <= 0) return 'Free';
  return cents % 100 === 0
    ? `$${cents / 100}`
    : `$${(cents / 100).toFixed(2)}`;
}
