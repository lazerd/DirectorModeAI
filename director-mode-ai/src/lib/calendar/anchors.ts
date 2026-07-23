/**
 * CalendarMode — anchor rules.
 *
 * An anchor answers "when does this event WANT to happen?" It's the difference
 * between the two kinds of event on a club calendar:
 *
 *   Anchored   — the 4th of July round robin is on the 4th of July. Placing it
 *                anywhere else makes it a different, worse event.
 *   Floating   — the fall Calcutta just wants a good October weekend. The
 *                engine is free to put it wherever it scores best.
 *
 * Grammar (stored in calendar_items.anchor_rule, seeded from catalog.ts):
 *
 *   fixed:MM-DD              exact calendar date            fixed:07-04
 *   nearest:MM-DD:DAY        nearest weekday to a date      nearest:07-04:SAT
 *   nth:N:MONTH:DAY          nth weekday of a month         nth:3:6:SAT
 *                            N may be -1 for "last"         nth:-1:5:SAT
 *   holiday:KEY              a holiday itself               holiday:halloween
 *   holiday-weekend:KEY      the Saturday of its weekend    holiday-weekend:memorial
 *   grand-slam:KEY           inside a Slam's window         grand-slam:wimbledon
 *   month:N                  anywhere that month            month:10
 *
 * `strength` distinguishes a hard date from a preferred one. Only `fixed` and
 * `holiday` are exact; everything else gives the engine a window to optimise
 * inside, which is what lets it dodge a school conflict without abandoning the
 * event's seasonal identity.
 */

import {
  addDays, nearestWeekday, nthWeekdayOfMonth, parseDowName, toISO, daysInMonth,
  dayOfWeek, monthName,
} from './dates';
import { usHolidays, slamWindows } from './holidays';
import type { ISODate } from './types';

export interface ResolvedAnchor {
  /** The ideal date. */
  date: ISODate;
  /** Acceptable window — outside it the anchor bonus is gone. Inclusive. */
  start: ISODate;
  end: ISODate;
  /** 'exact' = must be `date`; 'window' = best at `date`, acceptable in range. */
  strength: 'exact' | 'window';
  /** Human label, shown in the UI: "Independence Day". */
  label: string;
}

/**
 * Resolve an anchor rule for a given year. Returns null for a floating event
 * or an unparseable rule — an unknown rule degrades to "place it anywhere"
 * rather than throwing, because a bad string in one catalog entry should never
 * take down a whole year plan.
 */
export function resolveAnchor(rule: string | null | undefined, year: number): ResolvedAnchor | null {
  if (!rule) return null;
  const parts = rule.trim().split(':');
  const kind = (parts[0] || '').toLowerCase();

  switch (kind) {
    case 'fixed': {
      const date = mmddToISO(parts[1], year);
      if (!date) return null;
      return { date, start: date, end: date, strength: 'exact', label: prettyDate(date) };
    }

    case 'nearest': {
      const base = mmddToISO(parts[1], year);
      const dow = parseDowName(parts[2] ?? '');
      if (!base || dow === null) return null;
      const date = nearestWeekday(base, dow);
      // A week either side still reads as "the July 4th event".
      return {
        date,
        start: addDays(date, -7),
        end: addDays(date, 7),
        strength: 'window',
        label: `${dowLabel(dow)} nearest ${prettyDate(base)}`,
      };
    }

    case 'nth': {
      const n = Number(parts[1]);
      const month = Number(parts[2]);
      const dow = parseDowName(parts[3] ?? '');
      if (!Number.isFinite(n) || !Number.isFinite(month) || dow === null) return null;
      const date = nthWeekdayOfMonth(year, month, dow, n);
      if (!date) return null;
      return {
        date,
        start: toISO(year, month, 1),
        end: toISO(year, month, daysInMonth(year, month)),
        strength: 'window',
        label: `${ordinal(n)} ${dowLabel(dow)} of ${monthName(month)}`,
      };
    }

    case 'holiday': {
      const key = (parts[1] || '').toLowerCase();
      const h = usHolidays(year).find((x) => x.key === key);
      if (!h) return null;
      return { date: h.date, start: h.date, end: h.date, strength: 'exact', label: h.name };
    }

    case 'holiday-weekend': {
      const key = (parts[1] || '').toLowerCase();
      const h = usHolidays(year).find((x) => x.key === key);
      if (!h) return null;
      // Monday holidays anchor to the Saturday that opens the long weekend;
      // everything else to whichever Saturday sits closest.
      const sat = dayOfWeek(h.date) === 1 ? addDays(h.date, -2) : nearestWeekday(h.date, 6);
      return {
        date: sat,
        start: addDays(sat, -1),
        end: addDays(sat, 2),
        strength: 'window',
        label: `${h.name} weekend`,
      };
    }

    case 'grand-slam': {
      const key = (parts[1] || '').toLowerCase();
      const w = slamWindows(year).find((x) => x.key === key);
      if (!w) return null;
      // Best on the middle Saturday — the tournament is in full swing and
      // members have been watching it all week.
      const mid = addDays(w.start, 5);
      const date = nearestWeekday(mid, 6);
      return {
        date,
        start: addDays(w.start, -3),
        end: addDays(w.end, 3),
        strength: 'window',
        label: `${w.name} fortnight`,
      };
    }

    case 'month': {
      const month = Number(parts[1]);
      if (!Number.isFinite(month) || month < 1 || month > 12) return null;
      const start = toISO(year, month, 1);
      const end = toISO(year, month, daysInMonth(year, month));
      // Mid-month Saturday as the nominal ideal; the window is the whole month.
      const date = nearestWeekday(toISO(year, month, 15), 6);
      return { date, start, end, strength: 'window', label: `${monthName(month)}` };
    }

    default:
      return null;
  }
}

/** 'MM-DD' → ISO date in the given year. */
function mmddToISO(mmdd: string | undefined, year: number): ISODate | null {
  const m = /^(\d{1,2})-(\d{1,2})$/.exec((mmdd || '').trim());
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  return toISO(year, month, day);
}

function prettyDate(iso: ISODate): string {
  const [, m, d] = iso.split('-').map(Number);
  return `${monthName(m)} ${d}`;
}

function dowLabel(dow: number): string {
  return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dow];
}

function ordinal(n: number): string {
  if (n === -1) return 'last';
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
