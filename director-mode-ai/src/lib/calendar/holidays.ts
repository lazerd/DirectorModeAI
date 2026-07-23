/**
 * CalendarMode — US holiday calculator. Pure, no data files, any year.
 *
 * Holidays matter to a club calendar in two opposite ways, and conflating them
 * is the most common planning mistake:
 *
 *   ANCHOR holidays pull an event onto them. Nobody wants the July 4th
 *   Stars & Stripes round robin on July 11.
 *
 *   TRAVEL holidays push events away. Memorial Day, Thanksgiving weekend and
 *   the week between Christmas and New Year empty the club out — half the
 *   membership is at a lake or an airport, and an event scheduled there will
 *   underperform no matter how good it is.
 *
 * A few (Memorial Day, Labor Day) are genuinely both: the club is quieter, but
 * the members who ARE around want something to do. Those carry `anchor: true`
 * and a softened travel weight, so the engine will use them for a deliberately
 * anchored event while still steering unanchored ones elsewhere.
 */

import { nthWeekdayOfMonth, toISO, dayOfWeek, addDays } from './dates';
import type { ISODate } from './types';

export interface Holiday {
  key: string;
  name: string;
  date: ISODate;
  /** Events may deliberately anchor to this day. */
  anchor: boolean;
  /**
   * 0-1. How much of the membership is away/unavailable. Used as a penalty
   * multiplier for events that did NOT anchor here on purpose.
   */
  travelWeight: number;
  /** Days around the holiday that inherit a share of the travel drag. */
  spreadDays: number;
}

/** Every observed US holiday relevant to club programming, for one year. */
export function usHolidays(year: number): Holiday[] {
  const h: Holiday[] = [];
  const push = (
    key: string,
    name: string,
    date: ISODate | null,
    anchor: boolean,
    travelWeight: number,
    spreadDays = 0,
  ) => {
    if (date) h.push({ key, name, date, anchor, travelWeight, spreadDays });
  };

  push('new-years-day', "New Year's Day", toISO(year, 1, 1), true, 0.5, 1);
  push('mlk', 'Martin Luther King Jr. Day', nthWeekdayOfMonth(year, 1, 1, 3), false, 0.35, 2);
  push('valentines', "Valentine's Day", toISO(year, 2, 14), true, 0.1, 0);
  push('presidents', 'Presidents Day', nthWeekdayOfMonth(year, 2, 1, 3), false, 0.5, 3);
  push('st-patricks', "St. Patrick's Day", toISO(year, 3, 17), true, 0.05, 0);
  push('easter', 'Easter', easterSunday(year), false, 0.45, 1);
  push('cinco', 'Cinco de Mayo', toISO(year, 5, 5), true, 0.05, 0);
  push('mothers-day', "Mother's Day", nthWeekdayOfMonth(year, 5, 0, 2), true, 0.3, 0);
  push('memorial', 'Memorial Day', nthWeekdayOfMonth(year, 5, 1, -1), true, 0.5, 3);
  push('fathers-day', "Father's Day", nthWeekdayOfMonth(year, 6, 0, 3), true, 0.25, 0);
  push('juneteenth', 'Juneteenth', toISO(year, 6, 19), false, 0.2, 1);
  push('independence', 'Independence Day', toISO(year, 7, 4), true, 0.4, 2);
  push('labor', 'Labor Day', nthWeekdayOfMonth(year, 9, 1, 1), true, 0.5, 3);
  push('halloween', 'Halloween', toISO(year, 10, 31), true, 0.15, 0);
  push('veterans', 'Veterans Day', toISO(year, 11, 11), false, 0.2, 1);
  push('thanksgiving', 'Thanksgiving', nthWeekdayOfMonth(year, 11, 4, 4), true, 0.75, 4);
  push('christmas-eve', 'Christmas Eve', toISO(year, 12, 24), false, 0.8, 1);
  push('christmas', 'Christmas', toISO(year, 12, 25), false, 0.85, 5);
  push('new-years-eve', "New Year's Eve", toISO(year, 12, 31), true, 0.5, 1);

  return h.sort((a, b) => (a.date < b.date ? -1 : 1));
}

/**
 * Anonymous Gregorian computus. Easter itself is rarely an event date, but it
 * anchors school spring break across much of the country, so the planner needs
 * to know where it lands.
 */
export function easterSunday(year: number): ISODate {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const hh = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - hh - k) % 7;
  const m = Math.floor((a + 11 * hh + 22 * l) / 451);
  const month = Math.floor((hh + l - 7 * m + 114) / 31);
  const day = ((hh + l - 7 * m + 114) % 31) + 1;
  return toISO(year, month, day);
}

/**
 * The four Grand Slam windows, for the Slam-themed mixers.
 *
 * Exact dates shift year to year and aren't published far enough ahead to be
 * worth hard-coding, so these are the well-established patterns:
 *   Australian Open — starts the second Monday of January (roughly)
 *   Roland Garros   — main draw starts the Sunday nearest May 25
 *   Wimbledon       — starts the Monday nearest June 28 (never before Jun 24)
 *   US Open         — starts the Monday before the last Monday of August
 *
 * The engine treats these as soft anchors and the director can always override
 * the date, so an approximation is honest and sufficient.
 */
export interface SlamWindow {
  key: 'australian' | 'roland-garros' | 'wimbledon' | 'us-open';
  name: string;
  start: ISODate;
  end: ISODate;
}

export function slamWindows(year: number): SlamWindow[] {
  const ao = nthWeekdayOfMonth(year, 1, 1, 2) ?? toISO(year, 1, 14);

  // Sunday nearest May 25.
  const may25 = toISO(year, 5, 25);
  const rgOffset = (7 - dayOfWeek(may25)) % 7;
  const rg = rgOffset <= 3 ? addDays(may25, rgOffset) : addDays(may25, rgOffset - 7);

  // Monday nearest June 28, floored at June 24 (Wimbledon never starts earlier).
  const jun28 = toISO(year, 6, 28);
  const wOffset = (1 - dayOfWeek(jun28) + 7) % 7;
  let wim = wOffset <= 3 ? addDays(jun28, wOffset) : addDays(jun28, wOffset - 7);
  if (wim < toISO(year, 6, 24)) wim = addDays(wim, 7);

  // The Monday before the last Monday of August.
  const lastAugMon = nthWeekdayOfMonth(year, 8, 1, -1) ?? toISO(year, 8, 26);
  const uso = addDays(lastAugMon, -7);

  return [
    { key: 'australian', name: 'Australian Open', start: ao, end: addDays(ao, 13) },
    { key: 'roland-garros', name: 'Roland Garros', start: rg, end: addDays(rg, 14) },
    { key: 'wimbledon', name: 'Wimbledon', start: wim, end: addDays(wim, 13) },
    { key: 'us-open', name: 'US Open', start: uso, end: addDays(uso, 14) },
  ];
}

/** Index holidays by date for O(1) lookup while scoring. */
export function holidayIndex(year: number): Map<ISODate, Holiday> {
  const m = new Map<ISODate, Holiday>();
  for (const h of usHolidays(year)) m.set(h.date, h);
  return m;
}

/**
 * Total travel drag on a date: the holiday's own weight, plus a linearly
 * decaying share from any holiday whose spread reaches this far. Returns 0-1.
 */
export function travelDrag(date: ISODate, holidays: Holiday[]): { drag: number; cause: Holiday | null } {
  let drag = 0;
  let cause: Holiday | null = null;
  for (const h of holidays) {
    const dist = Math.abs(
      Math.floor(Date.UTC(...isoParts(date)) / 86_400_000) -
      Math.floor(Date.UTC(...isoParts(h.date)) / 86_400_000),
    );
    if (dist > h.spreadDays) continue;
    const decayed = h.spreadDays === 0 ? h.travelWeight : h.travelWeight * (1 - dist / (h.spreadDays + 1));
    if (decayed > drag) { drag = decayed; cause = h; }
  }
  return { drag, cause };
}

function isoParts(iso: ISODate): [number, number, number] {
  const [y, m, d] = iso.split('-').map(Number);
  return [y, m - 1, d];
}
