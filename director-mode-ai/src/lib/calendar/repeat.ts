/**
 * CalendarMode — repeating last year.
 *
 * The first version of the importer treated a club's past events as CONFLICTS:
 * dates to plan around. That's backwards for a year that has already happened.
 * What a director wants from last year's calendar is the opposite — "here's
 * what you ran; which are you doing again?" — because their own proven events
 * beat anything a catalog can suggest.
 *
 * Three problems to solve, all of them pure functions:
 *
 *   1. Real event tables contain junk. A club's `events` rows include "test",
 *      "dsfdsf", and half-finished experiments. Importing those as constraints
 *      silently poisons three dates; importing them as suggestions is just
 *      embarrassing.
 *   2. A weekly social is a SERIES, not five events. "Summer Slam 2026",
 *      "Summer Slam #4", "July 16 Summer Slam" and "Summer Slam July 23" are
 *      one thing that happened repeatedly, and should be offered as one row.
 *   3. Dates don't transfer literally. An event held the 2nd Thursday of June
 *      wants the 2nd Thursday of June next year, not June 11th.
 */

import { dayOfWeek, monthOf, nthWeekdayOfMonth, toISO, daysInMonth, monthName, nearestWeekday } from './dates';
import type { ISODate } from './types';

/**
 * Rows that shouldn't be shown to anyone.
 *
 * Deliberately conservative: a false positive hides a real event from the
 * repeat list, which is worse than letting one stray "Test" through where the
 * director can untick it. Only obvious placeholders and keyboard mash.
 */
export function looksLikeJunk(title: string): boolean {
  const t = (title || '').trim();
  if (t.length < 3) return true;

  // Common placeholder names, as a whole leading word.
  if (/^(test|tests|testing|demo|sample|example|asdf|qwerty|delete|temp|tmp|untitled|new event|copy of)\b/i.test(t)) {
    return true;
  }

  // Keyboard mash: one lowercase token with no vowels ("dsfdsf").
  //
  // All-caps is excluded because clubs run plenty of vowel-free acronyms —
  // BBQ, JTT, USTA, TGIF — and hiding a real event is worse than letting a
  // stray placeholder through for the director to untick.
  const letters = t.replace(/[^a-z]/gi, '');
  if (
    !/\s/.test(t)
    && letters.length >= 5
    && letters.length <= 12
    && !/[aeiouy]/i.test(letters)
    && t !== t.toUpperCase()
  ) {
    return true;
  }

  return false;
}

const MONTH_WORDS =
  /\b(jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)\b/gi;

/**
 * Collapse a title to the thing that repeats.
 *
 * Directors name recurrences inconsistently — by year, by number, by date, or
 * all three — so strip everything that varies between occurrences and compare
 * what's left.
 */
export function seriesKey(title: string): string {
  return (title || '')
    .replace(/\b20\d{2}\b/g, ' ')            // years
    .replace(/#\s*\d+/g, ' ')                 // "#4"
    .replace(/\bweek\s*\d+\b/gi, ' ')         // "Week 3"
    .replace(MONTH_WORDS, ' ')                // month names
    .replace(/\b\d{1,2}(st|nd|rd|th)?\b/g, ' ') // day numbers
    .replace(/[^a-z0-9]+/gi, ' ')             // punctuation, em dashes
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const MONTHS_ALT =
  'jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december';

/**
 * Strip the parts of a title that vary between occurrences, keeping the name.
 *
 * Unlike seriesKey (which flattens to a comparison key) this preserves case and
 * punctuation, because the result is shown to the director. Day numbers are
 * only removed when attached to a month word — otherwise "10U Quads Coed"
 * would lose its age group.
 */
export function cleanTitle(title: string): string {
  return (title || '')
    .replace(/#\s*\d+/g, ' ')
    .replace(/\b20\d{2}\b/g, ' ')
    .replace(new RegExp(`\\b(${MONTHS_ALT})\\.?\\s+\\d{1,2}(st|nd|rd|th)?\\b`, 'gi'), ' ')
    .replace(new RegExp(`\\b\\d{1,2}(st|nd|rd|th)?\\s+(${MONTHS_ALT})\\b`, 'gi'), ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-–—:,·]+|[\s\-–—:,·]+$/g, '')
    .trim();
}

/**
 * A display name for a series.
 *
 * Takes the cleaned form that appears most often — a director who wrote
 * "Summer Slam" three times and "July 16 Summer Slam" once meant "Summer
 * Slam". Ties break toward the shorter name.
 */
export function seriesTitle(titles: string[]): string {
  const counts = new Map<string, number>();
  for (const t of titles) {
    const c = cleanTitle(t);
    if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  if (counts.size === 0) return titles[0] ?? '';

  return [...counts.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return a[0].length - b[0].length;
  })[0][0];
}

/**
 * Move a date to the equivalent slot in another year.
 *
 * Annual events recur by POSITION, not by date: the event on the 2nd Thursday
 * of June belongs on the 2nd Thursday of June, wherever that falls. Returns the
 * same nth-weekday-of-month, or the last occurrence when the original was a 5th
 * and the target month has only four.
 */
export function mapToYear(iso: ISODate, targetYear: number): ISODate {
  const month = monthOf(iso);
  const dow = dayOfWeek(iso);
  const day = Number(iso.slice(8, 10));
  const occurrence = Math.floor((day - 1) / 7) + 1; // 1-5

  const mapped = nthWeekdayOfMonth(targetYear, month, dow, occurrence);
  if (mapped) return mapped;

  // A 5th Saturday that doesn't exist next year → use the last one.
  return nthWeekdayOfMonth(targetYear, month, dow, -1)
    ?? toISO(targetYear, month, Math.min(day, daysInMonth(targetYear, month)));
}

export interface PastEvent {
  id: string;
  name: string;
  event_date: ISODate;
  end_date?: ISODate | null;
  match_format?: string | null;
  entry_fee_cents?: number | null;
  num_courts?: number | null;
  start_time?: string | null;
}

export interface RepeatCandidate {
  /** Stable key for the UI. */
  key: string;
  title: string;
  /** How many times it ran in the source year. */
  occurrences: number;
  /** Every source date, ascending. */
  sourceDates: ISODate[];
  /** The proposed date(s) in the target year. */
  proposedDates: ISODate[];
  /** True when it ran 3+ times — offered as a series, not a one-off. */
  isSeries: boolean;
  /** Human note: "Ran 5 times Jun–Jul". */
  note: string;
  match_format: string | null;
  entry_fee_cents: number | null;
  num_courts: number | null;
  start_time: string | null;
}

/** Group last year's events into things worth repeating. */
export function buildRepeatCandidates(
  events: PastEvent[],
  targetYear: number,
): RepeatCandidate[] {
  const groups = new Map<string, PastEvent[]>();

  for (const e of events) {
    if (!e?.event_date || looksLikeJunk(e.name)) continue;
    const key = seriesKey(e.name);
    if (!key) continue;
    const arr = groups.get(key);
    if (arr) arr.push(e); else groups.set(key, [e]);
  }

  const out: RepeatCandidate[] = [];

  for (const [key, group] of groups) {
    const sorted = [...group].sort((a, b) => (a.event_date < b.event_date ? -1 : 1));
    const sourceDates = sorted.map((e) => e.event_date);
    const isSeries = sorted.length >= 3;

    // Take logistics from the most complete row rather than the first: an early
    // occurrence is often the one created before anyone filled in the details.
    const richest = [...sorted].sort((a, b) => score(b) - score(a))[0];

    // A weekly social is a weekly social. Real tables drift — a couple of the
    // Summer Slams were entered on a Friday — so a series proposes a clean
    // cadence on the weekday it actually ran on most, rather than faithfully
    // reproducing last year's data-entry slips.
    const mapped = sourceDates.map((d) => mapToYear(d, targetYear));
    const proposedDates = isSeries
      ? dedupeDates(mapped.map((d) => nearestWeekday(d, modalWeekday(sourceDates))))
      : mapped;

    out.push({
      key,
      title: seriesTitle(sorted.map((e) => e.name)),
      occurrences: sorted.length,
      sourceDates,
      proposedDates,
      isSeries,
      note: describeRun(sourceDates),
      match_format: richest.match_format ?? null,
      entry_fee_cents: richest.entry_fee_cents ?? null,
      num_courts: richest.num_courts ?? null,
      start_time: richest.start_time ? String(richest.start_time).slice(0, 5) : null,
    });
  }

  // Series first (they're the backbone of the year), then by first date.
  return out.sort((a, b) => {
    if (a.isSeries !== b.isSeries) return a.isSeries ? -1 : 1;
    return a.sourceDates[0] < b.sourceDates[0] ? -1 : 1;
  });
}

function score(e: PastEvent): number {
  return (e.entry_fee_cents ? 2 : 0) + (e.num_courts ? 1 : 0) + (e.start_time ? 1 : 0) + (e.match_format ? 1 : 0);
}

function describeRun(dates: ISODate[]): string {
  if (dates.length === 1) return 'Ran once';
  const first = monthName(monthOf(dates[0])).slice(0, 3);
  const last = monthName(monthOf(dates[dates.length - 1])).slice(0, 3);
  const span = first === last ? first : `${first}–${last}`;
  return `Ran ${dates.length} times, ${span}`;
}

/** The weekday a series ran on most often. Ties go to the earliest occurrence. */
function modalWeekday(dates: ISODate[]): number {
  const counts = new Map<number, number>();
  for (const d of dates) {
    const dow = dayOfWeek(d);
    counts.set(dow, (counts.get(dow) ?? 0) + 1);
  }
  let best = dayOfWeek(dates[0]);
  let bestCount = 0;
  for (const [dow, n] of counts) {
    if (n > bestCount) { best = dow; bestCount = n; }
  }
  return best;
}

/** Snapping to a weekday can collide two occurrences; keep one of each date. */
function dedupeDates(dates: ISODate[]): ISODate[] {
  return [...new Set(dates)].sort();
}
