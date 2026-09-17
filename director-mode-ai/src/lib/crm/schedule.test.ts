import { describe, it, expect } from 'vitest';
import {
  MAX_DAYS_AHEAD,
  checkLocalSchedule,
  checkSchedule,
  instantFor,
  isOnDate,
  label,
  localWhenOf,
  mondayAt8,
  timeLabel,
  tomorrowAt8,
} from './schedule';

/**
 * The reps are in California and the servers are in UTC. Every test here pins
 * a `now` so the suite says the same thing in June as in December.
 *
 * 2026-09-17T19:30:00Z is 12:30 PM Pacific on Thursday 17 September 2026 —
 * daylight time, UTC-7.
 */
const NOW = new Date('2026-09-17T19:30:00Z');

describe('instantFor', () => {
  it('reads the two boxes as California wall-clock', () => {
    // 8 AM Pacific on 18 Sep 2026 (PDT, UTC-7) is 15:00 UTC.
    expect(instantFor({ date: '2026-09-18', time: '08:00' })?.toISOString()).toBe(
      '2026-09-18T15:00:00.000Z',
    );
  });

  it('follows the clocks back in November', () => {
    // After 1 Nov 2026 California is UTC-8, so the same 8 AM is 16:00 UTC.
    expect(instantFor({ date: '2026-11-18', time: '08:00' })?.toISOString()).toBe(
      '2026-11-18T16:00:00.000Z',
    );
  });

  it('refuses a half-filled form rather than guessing', () => {
    expect(instantFor({ date: '2026-09-18', time: '' })).toBeNull();
    expect(instantFor({ date: '', time: '08:00' })).toBeNull();
    expect(instantFor({ date: '18/09/2026', time: '08:00' })).toBeNull();
    expect(instantFor({ date: '2026-09-18', time: '25:00' })).toBeNull();
  });
});

describe('checkSchedule', () => {
  it('takes a time later today', () => {
    const out = checkSchedule(new Date('2026-09-17T22:00:00Z'), NOW);
    expect(out.ok).toBe(true);
  });

  /* --------------------------------------------------------- the two rules */
  it('REFUSES a time that has already gone', () => {
    const out = checkSchedule(new Date('2026-09-17T16:00:00Z'), NOW);
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error('unreachable');
    expect(out.message).toContain('in the past');
  });

  it('refuses yesterday even by a wide margin', () => {
    const out = checkLocalSchedule({ date: '2026-09-16', time: '08:00' }, NOW);
    expect(out.ok).toBe(false);
  });

  it('allows the last minute inside the window', () => {
    const at = new Date(NOW.getTime() + MAX_DAYS_AHEAD * 86_400_000 - 60_000);
    expect(checkSchedule(at, NOW).ok).toBe(true);
  });

  it(`REFUSES more than ${MAX_DAYS_AHEAD} days out, and says so`, () => {
    const at = new Date(NOW.getTime() + (MAX_DAYS_AHEAD + 1) * 86_400_000);
    const out = checkSchedule(at, NOW);
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error('unreachable');
    expect(out.message).toContain(`${MAX_DAYS_AHEAD} days`);
  });

  it('asks for a date and a time when there is not one', () => {
    const out = checkSchedule(null, NOW);
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error('unreachable');
    expect(out.message).toContain('Pick a date');
  });

  it('forgives the second that ticks over while the button is being clicked', () => {
    expect(checkSchedule(new Date(NOW.getTime() - 5_000), NOW).ok).toBe(true);
  });
});

describe('the two presets', () => {
  it('tomorrow 8am is tomorrow in California', () => {
    expect(tomorrowAt8(NOW)).toEqual({ date: '2026-09-18', time: '08:00' });
  });

  it('Monday 8am from a Thursday is the Monday coming', () => {
    // 17 Sep 2026 is a Thursday; the next Monday is the 21st.
    expect(mondayAt8(NOW)).toEqual({ date: '2026-09-21', time: '08:00' });
  });

  it('Monday 8am ON a Monday means next Monday, not this morning', () => {
    const monday = new Date('2026-09-21T19:00:00Z'); // Mon 21 Sep, midday Pacific
    expect(mondayAt8(monday)).toEqual({ date: '2026-09-28', time: '08:00' });
  });

  it('both presets pass their own check', () => {
    expect(checkLocalSchedule(tomorrowAt8(NOW), NOW).ok).toBe(true);
    expect(checkLocalSchedule(mondayAt8(NOW), NOW).ok).toBe(true);
  });

  it('reads back into the same two boxes', () => {
    const at = instantFor(tomorrowAt8(NOW))!;
    expect(localWhenOf(at.toISOString())).toEqual({ date: '2026-09-18', time: '08:00' });
  });
});

describe('what the rep reads', () => {
  it('says the clock in Pacific, not UTC', () => {
    expect(timeLabel('2026-09-18T15:00:00Z')).toBe('8:00am');
    expect(timeLabel('2026-09-18T21:30:00Z')).toBe('2:30pm');
  });

  it('names the day inside a week and the date beyond it', () => {
    expect(label('2026-09-17T22:00:00Z', NOW)).toBe('today 3:00pm');
    expect(label('2026-09-18T15:00:00Z', NOW)).toBe('tomorrow 8:00am');
    expect(label('2026-09-21T15:00:00Z', NOW)).toBe('Monday 8:00am');
    expect(label('2026-10-14T15:00:00Z', NOW)).toBe('Oct 14 8:00am');
  });

  it('knows what is due before midnight, Pacific', () => {
    // 2026-09-18T05:00Z is still the evening of the 17th in California.
    expect(isOnDate('2026-09-18T05:00:00Z', '2026-09-17')).toBe(true);
    expect(isOnDate('2026-09-18T15:00:00Z', '2026-09-17')).toBe(false);
  });
});
