/**
 * CalendarMode — candidate date generation.
 *
 * (The plan called this weekends.ts; it generates weeknight slots too, so the
 * name follows the behaviour.)
 *
 * Club events overwhelmingly happen on Saturdays, then Sundays, then Friday
 * nights — but not exclusively, and a planner that only ever offers Saturdays
 * is useless for a Thursday-night summer social series. So the generator emits
 * every plausible slot in the year and lets score.ts express the preference as
 * points rather than hard-coding it as availability.
 */

import { toISO, dayOfWeek, weekIndex, daysInMonth, eachDay } from './dates';
import { holidayIndex } from './holidays';
import type { ISODate, Slot } from './types';

export interface SlotOptions {
  /**
   * Days of week to emit. Default = Fri/Sat/Sun, the club-event core.
   * Pass [1,2,3,4,5,6,0] to consider the whole week.
   */
  daysOfWeek?: number[];
  /** Restrict to these months (1-12). Empty/undefined = the whole year. */
  months?: number[];
  /** Earliest acceptable date, inclusive. */
  notBefore?: ISODate;
  /** Latest acceptable date, inclusive. */
  notAfter?: ISODate;
}

const DEFAULT_DOWS = [5, 6, 0]; // Friday, Saturday, Sunday

/**
 * Every candidate slot in a year. Holiday Mondays are always included even when
 * Monday isn't in `daysOfWeek` — a Memorial Day or Labor Day Monday behaves
 * like a weekend day and is often the single best date of the month.
 */
export function generateSlots(year: number, opts: SlotOptions = {}): Slot[] {
  const dows = new Set(opts.daysOfWeek?.length ? opts.daysOfWeek : DEFAULT_DOWS);
  const months = opts.months?.length ? new Set(opts.months) : null;
  const holidays = holidayIndex(year);

  const out: Slot[] = [];
  for (let month = 1; month <= 12; month++) {
    if (months && !months.has(month)) continue;
    for (let day = 1; day <= daysInMonth(year, month); day++) {
      const date = toISO(year, month, day);
      if (opts.notBefore && date < opts.notBefore) continue;
      if (opts.notAfter && date > opts.notAfter) continue;

      const dow = dayOfWeek(date);
      const holiday = holidays.get(date) ?? null;
      const isHolidayMonday = dow === 1 && !!holiday;
      if (!dows.has(dow) && !isHolidayMonday) continue;

      out.push({
        date,
        dow,
        isWeekend: dow === 0 || dow === 6 || isHolidayMonday,
        holiday: holiday?.name ?? null,
        weekIndex: weekIndex(date),
      });
    }
  }
  return out;
}

/**
 * Group slots into weekends for the year-grid UI: a Fri/Sat/Sun (plus trailing
 * holiday Monday) cluster is one column the director thinks of as "that
 * weekend", not three independent dates.
 */
export interface WeekendGroup {
  /** Monday-aligned week bucket, from dates.weekIndex. */
  weekIndex: number;
  month: number;
  /** The Saturday, when the group has one — the natural label date. */
  anchorDate: ISODate;
  slots: Slot[];
}

export function groupIntoWeekends(slots: Slot[]): WeekendGroup[] {
  const byWeek = new Map<number, Slot[]>();
  for (const s of slots) {
    const arr = byWeek.get(s.weekIndex);
    if (arr) arr.push(s);
    else byWeek.set(s.weekIndex, [s]);
  }

  const groups: WeekendGroup[] = [];
  for (const [wi, group] of byWeek) {
    const sorted = [...group].sort((a, b) => (a.date < b.date ? -1 : 1));
    const saturday = sorted.find((s) => s.dow === 6);
    const anchorDate = (saturday ?? sorted[0]).date;
    groups.push({
      weekIndex: wi,
      month: Number(anchorDate.slice(5, 7)),
      anchorDate,
      slots: sorted,
    });
  }
  return groups.sort((a, b) => a.weekIndex - b.weekIndex);
}

/**
 * Whether a date falls inside any of the club's operating windows.
 * Windows are MM-DD strings so they repeat every year; a window whose end
 * precedes its start wraps across New Year (e.g. an indoor season 11-01→03-31).
 */
export function inSeasonWindows(
  date: ISODate,
  windows: Array<{ label: string; start: string; end: string }> | undefined,
): { inSeason: boolean; label: string | null } {
  if (!windows || windows.length === 0) return { inSeason: true, label: null };
  const mmdd = date.slice(5);
  for (const w of windows) {
    const wraps = w.end < w.start;
    const hit = wraps ? mmdd >= w.start || mmdd <= w.end : mmdd >= w.start && mmdd <= w.end;
    if (hit) return { inSeason: true, label: w.label };
  }
  return { inSeason: false, label: null };
}

/** Every date an item occupies, for conflict and hold purposes. */
export function itemDates(start: ISODate, end: ISODate | null): ISODate[] {
  return end && end > start ? eachDay(start, end) : [start];
}
