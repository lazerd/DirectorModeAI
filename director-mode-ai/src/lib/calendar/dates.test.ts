import { describe, it, expect } from 'vitest';
import {
  toISO, parseISO, addDays, daysBetween, daysApart, dayOfWeek, nthWeekdayOfMonth,
  nearestWeekday, weekIndex, daysInMonth, withinRange, rangesOverlap, eachDay,
  parseDowName, shortLabel,
} from './dates';

describe('ISO date arithmetic', () => {
  it('builds and parses', () => {
    expect(toISO(2027, 7, 4)).toBe('2027-07-04');
    expect(parseISO('2027-07-04')).toEqual({ year: 2027, month: 7, day: 4 });
  });

  it('adds days across month and year boundaries', () => {
    expect(addDays('2027-01-31', 1)).toBe('2027-02-01');
    expect(addDays('2027-12-31', 1)).toBe('2028-01-01');
    expect(addDays('2027-03-01', -1)).toBe('2027-02-28');
  });

  it('handles leap years', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2027, 2)).toBe(28);
  });

  it('measures distance with sign and without', () => {
    expect(daysBetween('2027-07-01', '2027-07-08')).toBe(7);
    expect(daysBetween('2027-07-08', '2027-07-01')).toBe(-7);
    expect(daysApart('2027-07-08', '2027-07-01')).toBe(7);
  });

  // The bug this whole module exists to avoid: a date-only string parsed as a
  // local Date lands on the previous day west of UTC.
  it('is timezone-stable for day-of-week', () => {
    expect(dayOfWeek('2027-07-04')).toBe(0); // a Sunday
    expect(dayOfWeek('2026-07-04')).toBe(6); // a Saturday
  });
});

describe('nthWeekdayOfMonth', () => {
  it('finds the nth weekday', () => {
    // 3rd Saturday of June 2027 — June 1 2027 is a Tuesday.
    const d = nthWeekdayOfMonth(2027, 6, 6, 3);
    expect(d).toBe('2027-06-19');
    expect(dayOfWeek(d!)).toBe(6);
  });

  it('finds the last weekday with n = -1', () => {
    const memorial = nthWeekdayOfMonth(2027, 5, 1, -1);
    expect(memorial).toBe('2027-05-31');
    expect(dayOfWeek(memorial!)).toBe(1);
  });

  it('returns null when the occurrence does not exist', () => {
    expect(nthWeekdayOfMonth(2027, 2, 1, 5)).toBeNull();
  });
});

describe('nearestWeekday', () => {
  it('finds the closest occurrence, ties going forward', () => {
    // 2027-07-04 is a Sunday; the nearest Saturday is the 3rd (1 day back).
    expect(nearestWeekday('2027-07-04', 6)).toBe('2027-07-03');
    // A Wednesday is equidistant from the Saturdays either side; go forward.
    expect(dayOfWeek('2027-07-07')).toBe(3);
    expect(nearestWeekday('2027-07-07', 6)).toBe('2027-07-10');
  });

  it('returns the date itself when it already matches', () => {
    expect(nearestWeekday('2027-07-03', 6)).toBe('2027-07-03');
  });
});

describe('ranges and weeks', () => {
  it('detects containment and overlap', () => {
    expect(withinRange('2027-07-04', '2027-07-01', '2027-07-10')).toBe(true);
    expect(withinRange('2027-07-11', '2027-07-01', '2027-07-10')).toBe(false);
    expect(rangesOverlap('2027-07-01', '2027-07-05', '2027-07-05', '2027-07-09')).toBe(true);
    expect(rangesOverlap('2027-07-01', '2027-07-04', '2027-07-05', '2027-07-09')).toBe(false);
  });

  it('groups Fri/Sat/Sun of one weekend into the same week bucket', () => {
    const fri = weekIndex('2027-07-02');
    expect(weekIndex('2027-07-03')).toBe(fri); // Sat
    expect(weekIndex('2027-07-04')).toBe(fri); // Sun
    expect(weekIndex('2027-07-09')).toBe(fri + 1);
  });

  it('enumerates inclusive day ranges', () => {
    expect(eachDay('2027-07-01', '2027-07-03')).toEqual(['2027-07-01', '2027-07-02', '2027-07-03']);
  });
});

describe('labels', () => {
  it('parses day names', () => {
    expect(parseDowName('SAT')).toBe(6);
    expect(parseDowName('saturday')).toBe(6);
    expect(parseDowName('nope')).toBeNull();
  });

  it('formats a short label', () => {
    expect(shortLabel('2027-07-03')).toBe('Sat, Jul 3');
  });
});
