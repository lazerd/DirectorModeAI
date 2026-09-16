import { describe, expect, it } from 'vitest';
import {
  capForDay,
  insideWindow,
  minutesOfDayIn,
  normalizeSettings,
  zoneForRegion,
  DEFAULT_SETTINGS,
} from './settings';
import type { OutreachSettings } from './types';

const base: OutreachSettings = { ...DEFAULT_SETTINGS, warmup_start_date: '2026-09-16' };

describe('the warmup ramp', () => {
  it('starts at 5 for the first three days', () => {
    expect(capForDay(base, '2026-09-16')).toBe(5);
    expect(capForDay(base, '2026-09-17')).toBe(5);
    expect(capForDay(base, '2026-09-18')).toBe(5);
  });

  it('steps to 10 for the next three', () => {
    expect(capForDay(base, '2026-09-19')).toBe(10);
    expect(capForDay(base, '2026-09-21')).toBe(10);
  });

  it('reaches the full cap on day seven and stays there', () => {
    expect(capForDay(base, '2026-09-22')).toBe(15);
    expect(capForDay(base, '2027-01-01')).toBe(15);
  });

  it('treats a never-sent domain (null date) as day ZERO, not as warmed up', () => {
    // The column ships null, so this is the case that actually happens. If it
    // returned daily_cap the ramp would never run at all.
    expect(capForDay({ ...base, warmup_start_date: null }, '2026-09-16')).toBe(5);
  });

  it('opts out of warming up entirely when the steps are emptied', () => {
    expect(capForDay({ ...base, warmup_start_date: null, warmup_steps: [] }, '2026-09-16')).toBe(15);
  });

  it('never exceeds daily_cap — lowering the cap wins over the ramp', () => {
    // Day four of the ramp says 10; the rep has set the cap to 3 for the week.
    expect(capForDay({ ...base, daily_cap: 3 }, '2026-09-19')).toBe(3);
  });

  it('treats a day before the ramp began as day zero, not as finished', () => {
    expect(capForDay(base, '2026-09-10')).toBe(5);
  });

  it('honours a hand-edited ramp in the settings row', () => {
    const slow = { ...base, warmup_steps: [{ days: 10, cap: 2 }] };
    expect(capForDay(slow, '2026-09-20')).toBe(2);
    expect(capForDay(slow, '2026-09-27')).toBe(15);
  });
});

describe('normalizeSettings', () => {
  it('falls back cleanly on a null row', () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it('clamps nonsense rather than crashing the morning plan', () => {
    const s = normalizeSettings({
      daily_cap: -4,
      follow_up_days: 9999,
      send_window_start: 'nope',
      warmup_steps: [{ days: 2, cap: '7' }] as never,
    });
    expect(s.daily_cap).toBe(0);
    expect(s.follow_up_days).toBe(90);
    expect(s.send_window_start).toBe('08:00:00');
    expect(s.warmup_steps).toEqual([{ days: 2, cap: 7 }]);
  });

  it('accepts a bare HH:MM window', () => {
    expect(normalizeSettings({ send_window_start: '9:30' }).send_window_start).toBe('09:30:00');
  });
});

describe('the send window is the club\'s clock', () => {
  it('maps each region to a real zone', () => {
    expect(zoneForRegion('West')).toBe('America/Los_Angeles');
    expect(zoneForRegion('Central')).toBe('America/Chicago');
    expect(zoneForRegion('East')).toBe('America/New_York');
    // Unknown leans Eastern: arriving late for a West club beats arriving at
    // 5 AM for an East one.
    expect(zoneForRegion(null)).toBe('America/New_York');
  });

  it('reads real offsets, not a fixed guess', () => {
    // 2026-09-16T17:00Z — 10 AM PDT, 1 PM EDT.
    const now = new Date('2026-09-16T17:00:00Z');
    expect(minutesOfDayIn(now, 'America/Los_Angeles')).toBe(10 * 60);
    expect(minutesOfDayIn(now, 'America/New_York')).toBe(13 * 60);
  });

  it('opens for a West club at 10 AM Pacific and is already shut for an East one at 4 PM', () => {
    const now = new Date('2026-09-16T17:00:00Z'); // Wed
    expect(insideWindow(base, 'West', now)).toBe(true);
    expect(insideWindow(base, 'East', now)).toBe(true); // 1 PM Eastern, window ends 3 PM
    const later = new Date('2026-09-16T20:00:00Z'); // 4 PM Eastern, 1 PM Pacific
    expect(insideWindow(base, 'East', later)).toBe(false);
    expect(insideWindow(base, 'West', later)).toBe(true);
  });

  it('refuses a 5 AM landing for an East club when it is 8 AM here', () => {
    const now = new Date('2026-09-16T15:00:00Z'); // 8 AM Pacific, 11 AM Eastern
    expect(insideWindow(base, 'West', now)).toBe(true);
    // And the reverse: 5 AM Pacific is outside the West window.
    const early = new Date('2026-09-16T12:00:00Z');
    expect(insideWindow(base, 'West', early)).toBe(false);
    expect(insideWindow(base, 'East', early)).toBe(true); // 8 AM Eastern
  });

  it('never sends on a weekend', () => {
    const saturday = new Date('2026-09-19T17:00:00Z');
    expect(insideWindow(base, 'West', saturday)).toBe(false);
  });
});
