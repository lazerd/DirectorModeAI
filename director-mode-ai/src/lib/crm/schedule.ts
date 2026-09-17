/**
 * "Send this on Thursday at 8."
 *
 * The rep picks a date and a time; those two boxes mean California, because
 * that is where Darrin and Kevin are and it is the same zone the rest of the
 * CRM already counts days in (CRM_TZ, lib/crm/dates.ts). Nothing here reads
 * the system zone — the browser, Vercel's UTC runtime and the database would
 * each give a different answer, and 8 AM would land at 1 AM for someone.
 *
 * What is stored is an INSTANT (timestamptz). What is shown is always that
 * instant formatted back into CRM_TZ. The round trip is the whole file.
 *
 * Two rules, enforced here and again in the route:
 *   - Not in the past. A time that has gone is not a schedule, it is a typo,
 *     and silently sending it now would be the worst possible reading.
 *   - Not more than MAX_DAYS_AHEAD out. An email approved today and sent in
 *     March would be sent by a version of this club that no longer exists.
 *
 * Pure: `now` is always passed in. Tested in schedule.test.ts.
 */

import { fromZonedTime, formatInTimeZone } from 'date-fns-tz';
import { CRM_TZ, type ISODate } from './dates';

/** Far enough for "after the board meets", short enough to still be true. */
export const MAX_DAYS_AHEAD = 60;

/** A minute of slack, so clicking Schedule on 8:00 at 8:00:00.4 is not "the past". */
const PAST_GRACE_MS = 60_000;

export interface LocalWhen {
  /** YYYY-MM-DD, as the rep's date box holds it. */
  date: ISODate;
  /** HH:MM, 24h, as the rep's time box holds it. */
  time: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * A date box and a time box, read as California wall-clock, as one instant.
 * Returns null for anything that is not two well-formed values — a half-filled
 * form must not become "now".
 */
export function instantFor(when: LocalWhen, timeZone = CRM_TZ): Date | null {
  const date = (when.date ?? '').trim();
  const time = (when.time ?? '').trim();
  if (!DATE_RE.test(date) || !TIME_RE.test(time)) return null;
  const at = fromZonedTime(`${date}T${time}:00`, timeZone);
  return Number.isNaN(at.getTime()) ? null : at;
}

export type ScheduleCheck = { ok: true; at: Date } | { ok: false; message: string };

/** Both rules, in the words the rep sees. */
export function checkSchedule(at: Date | null, now: Date = new Date()): ScheduleCheck {
  if (!at || Number.isNaN(at.getTime())) {
    return { ok: false, message: 'Pick a date and a time.' };
  }
  if (at.getTime() < now.getTime() - PAST_GRACE_MS) {
    return {
      ok: false,
      message: `That is in the past (${label(at.toISOString(), now)}). Pick a time that has not happened yet.`,
    };
  }
  const limit = now.getTime() + MAX_DAYS_AHEAD * 86_400_000;
  if (at.getTime() > limit) {
    return {
      ok: false,
      message: `That is more than ${MAX_DAYS_AHEAD} days out. Schedule it within ${MAX_DAYS_AHEAD} days and the text will still be true when it goes.`,
    };
  }
  return { ok: true, at };
}

/** Validate a date box and a time box in one go. */
export function checkLocalSchedule(
  when: LocalWhen,
  now: Date = new Date(),
  timeZone = CRM_TZ,
): ScheduleCheck {
  return checkSchedule(instantFor(when, timeZone), now);
}

// ------------------------------------------------------------------ presets
//
// The two a rep actually wants. Both are 8 AM, because a cold email that lands
// at the top of the working day gets read and one that lands at 9 PM does not.

/** Add whole days to a CRM_TZ calendar date without touching the clock. */
function addDaysLocal(date: ISODate, days: number): ISODate {
  const [y, m, d] = date.split('-').map(Number);
  const moved = new Date(Date.UTC(y, m - 1, d + days, 12));
  return moved.toISOString().slice(0, 10);
}

/** Today, where the reps are. */
function localToday(now: Date, timeZone: string): ISODate {
  return formatInTimeZone(now, timeZone, 'yyyy-MM-dd');
}

export const PRESET_TIME = '08:00';

export function tomorrowAt8(now: Date = new Date(), timeZone = CRM_TZ): LocalWhen {
  return { date: addDaysLocal(localToday(now, timeZone), 1), time: PRESET_TIME };
}

/**
 * The NEXT Monday. On a Monday that means a week today, not this morning —
 * "Monday 8am" clicked on Monday afternoon can only sensibly mean the one
 * coming, and the past-time rule would refuse the other reading anyway.
 */
export function mondayAt8(now: Date = new Date(), timeZone = CRM_TZ): LocalWhen {
  const today = localToday(now, timeZone);
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay(); // 0 Sun … 6 Sat
  const ahead = dow === 1 ? 7 : (8 - dow) % 7;
  return { date: addDaysLocal(today, ahead || 7), time: PRESET_TIME };
}

// ------------------------------------------------------------------ display

/** "8:00am" / "2:30pm", in CRM_TZ. */
export function timeLabel(iso: string, timeZone = CRM_TZ): string {
  return formatInTimeZone(new Date(iso), timeZone, 'h:mmaaa').replace(/\s/g, '');
}

/**
 * "today 8:00am", "tomorrow 8:00am", "Thursday 8:00am", "Oct 14 8:00am".
 *
 * Weekday names only inside a week, because "Thursday" three weeks out is a
 * date nobody can place. Beyond that it says the date.
 */
export function label(iso: string, now: Date = new Date(), timeZone = CRM_TZ): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  const when = formatInTimeZone(at, timeZone, 'yyyy-MM-dd');
  const today = localToday(now, timeZone);
  const days = Math.round(
    (Date.parse(`${when}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000,
  );
  const clock = timeLabel(iso, timeZone);

  if (days === 0) return `today ${clock}`;
  if (days === 1) return `tomorrow ${clock}`;
  if (days === -1) return `yesterday ${clock}`;
  if (days > 1 && days < 7) return `${formatInTimeZone(at, timeZone, 'EEEE')} ${clock}`;
  return `${formatInTimeZone(at, timeZone, 'MMM d')} ${clock}`;
}

/** Is this instant on today's calendar date, where the reps are? */
export function isOnDate(iso: string, date: ISODate, timeZone = CRM_TZ): boolean {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return false;
  return formatInTimeZone(at, timeZone, 'yyyy-MM-dd') === date;
}

/** The date and time boxes that would re-create this instant. */
export function localWhenOf(iso: string, timeZone = CRM_TZ): LocalWhen {
  const at = new Date(iso);
  return {
    date: formatInTimeZone(at, timeZone, 'yyyy-MM-dd'),
    time: formatInTimeZone(at, timeZone, 'HH:mm'),
  };
}
