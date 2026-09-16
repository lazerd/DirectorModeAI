/**
 * Settings, the warmup ramp, and the send window.
 *
 * All three answer questions the planner and the sender must not answer for
 * themselves:
 *
 *   How many today?      capForDay() — the warmup ramp, read out of the
 *                        settings row, not a constant in plan.ts.
 *   May we send NOW?     insideWindow() — in the CLUB's local time, because
 *                        8 AM in Boston is 5 AM here and a 5 AM cold email
 *                        is the single loudest "this is a robot" signal.
 *   May we send AT ALL?  settings.paused, checked in three places.
 *
 * Everything here is pure and takes `now`, so the tests pin the clock.
 */

import { CRM_TZ, crmToday, daysBetween, type ISODate } from '@/lib/crm/dates';
import type { OutreachSettings } from './types';

/** What a fresh install behaves like, and what a missing row falls back to. */
export const DEFAULT_SETTINGS: OutreachSettings = {
  daily_cap: 15,
  send_window_start: '08:00:00',
  send_window_end: '15:00:00',
  paused: false,
  warmup_start_date: null,
  warmup_steps: [
    { days: 3, cap: 5 },
    { days: 3, cap: 10 },
  ],
  follow_up_days: 8,
};

/**
 * Coerce whatever the settings row holds into something the planner can use.
 *
 * Deliberately forgiving about shape and strict about sense: a hand-edited
 * warmup_steps with a string cap should not crash the morning plan, but a
 * negative cap must not become a negative cap.
 */
export function normalizeSettings(row: Partial<OutreachSettings> | null | undefined): OutreachSettings {
  const r = row ?? {};
  const steps = Array.isArray(r.warmup_steps) ? r.warmup_steps : DEFAULT_SETTINGS.warmup_steps;
  return {
    daily_cap: clampInt(r.daily_cap, DEFAULT_SETTINGS.daily_cap, 0, 200),
    send_window_start: timeOf(r.send_window_start, DEFAULT_SETTINGS.send_window_start),
    send_window_end: timeOf(r.send_window_end, DEFAULT_SETTINGS.send_window_end),
    paused: r.paused === true,
    warmup_start_date: typeof r.warmup_start_date === 'string' ? r.warmup_start_date.slice(0, 10) : null,
    warmup_steps: steps
      .map((s) => ({ days: clampInt((s as { days?: unknown })?.days, 0, 0, 365), cap: clampInt((s as { cap?: unknown })?.cap, 0, 0, 200) }))
      .filter((s) => s.days > 0),
    follow_up_days: clampInt(r.follow_up_days, DEFAULT_SETTINGS.follow_up_days, 1, 90),
  };
}

function clampInt(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function timeOf(v: unknown, fallback: string): string {
  if (typeof v !== 'string') return fallback;
  const m = v.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return fallback;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return fallback;
  return `${String(h).padStart(2, '0')}:${m[2]}:${m[3] ?? '00'}`;
}

/**
 * Today's cap.
 *
 * Walks warmup_steps in order from warmup_start_date and returns the first
 * step the day still falls inside; past the end of the ramp it is the full
 * daily_cap.
 *
 * A NULL warmup_start_date means the domain has never sent anything, and that
 * is day ZERO of the ramp — not "finished". Getting this backwards is how a
 * two-week-old domain sends fifteen cold emails on its first morning, and the
 * column ships null, so null is the case that actually happens. The sender
 * stamps the date on the first successful send, so the ramp measures real
 * sending rather than the day somebody happened to open the planner.
 *
 * To opt out of warming up entirely, empty warmup_steps — then there are no
 * steps to fall inside and the full cap applies from the first day.
 *
 * The ramp is never allowed to EXCEED daily_cap: someone lowering the cap to 3
 * for a quiet week should get 3, not 5 because day two of the ramp says so.
 */
export function capForDay(settings: OutreachSettings, today: ISODate): number {
  const start = settings.warmup_start_date;
  const elapsed = start ? daysBetween(start, today) : 0;
  // Before the ramp begins, nothing is warmed up yet — treat it as day zero
  // rather than as "finished", which is what a negative index would do.
  let cursor = 0;
  for (const step of settings.warmup_steps) {
    cursor += step.days;
    if (elapsed < cursor) return Math.min(step.cap, settings.daily_cap);
  }
  return settings.daily_cap;
}

/**
 * Which clock a club reads.
 *
 * Region is the only geography the DCA list gives us for most of these clubs
 * — no city, no state on 500 of them — so the region IS the time zone. An
 * unknown region gets Eastern rather than Pacific: the failure mode is then
 * "arrived at 11 AM instead of 8" for a West-coast club, not "arrived at 5 AM"
 * for an East-coast one, and only one of those gets you marked as spam.
 */
export function zoneForRegion(region: string | null | undefined): string {
  switch ((region ?? '').trim()) {
    case 'West':
      return 'America/Los_Angeles';
    case 'Central':
      return 'America/Chicago';
    case 'East':
      return 'America/New_York';
    case 'International':
      // No country on these rows. The reps are in California and a reply lands
      // in their inbox whenever it lands, so use their clock rather than guess.
      return CRM_TZ;
    default:
      return 'America/New_York';
  }
}

/** Minutes past midnight, in `timeZone`, at `now`. Real offsets, not a guess. */
export function minutesOfDayIn(now: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  // Intl renders midnight as 24 in some ICU versions of hourCycle h23/h24.
  return (h % 24) * 60 + m;
}

export function minutesOfTime(hhmmss: string): number {
  const [h, m] = hhmmss.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/**
 * Is it a decent hour where this club is?
 *
 * Also refuses weekends. A cold email to a volunteer club president that
 * arrives on Sunday morning is read on Monday at the bottom of 40 others, and
 * nothing about this list is urgent enough to spend that.
 */
export function insideWindow(
  settings: OutreachSettings,
  region: string | null | undefined,
  now: Date = new Date(),
): boolean {
  const zone = zoneForRegion(region);
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'short' }).format(now);
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  const mins = minutesOfDayIn(now, zone);
  return mins >= minutesOfTime(settings.send_window_start) && mins < minutesOfTime(settings.send_window_end);
}

/**
 * Plain English for the deck: "queued — goes out at 8 AM Eastern". The rep
 * approving at 9 PM should know the email is not landing at 9 PM.
 */
export function windowLabel(settings: OutreachSettings, region: string | null | undefined, now: Date = new Date()): string {
  const zone = zoneForRegion(region);
  if (insideWindow(settings, region, now)) return 'goes out in the next few minutes';
  const start = settings.send_window_start.slice(0, 5);
  const [h, m] = start.split(':').map(Number);
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  const stamp = m ? `${hour12}:${String(m).padStart(2, '0')}` : `${hour12}`;
  const short = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'short' })
    .formatToParts(now)
    .find((p) => p.type === 'timeZoneName')?.value;
  return `goes out at ${stamp} ${h < 12 ? 'AM' : 'PM'}${short ? ` ${short}` : ''}`;
}

/** Today where the reps are. One import site for the rest of the module. */
export function outreachToday(now: Date = new Date()): ISODate {
  return crmToday(now);
}
