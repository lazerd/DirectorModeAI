import { describe, it, expect } from 'vitest';
import {
  localToUtc,
  utcToLocalDate,
  utcToLocalTime,
  localDayOfWeek,
  enumerateDates,
  normalizeTime,
  timeToMinutes,
  minutesToTime,
} from './timezones';

const TZ = 'America/Los_Angeles';

describe('localToUtc / utcToLocal round-trip', () => {
  it('round-trips a Pacific 9 AM correctly', () => {
    const utc = localToUtc('2026-06-15', '09:00', TZ);
    expect(utcToLocalDate(utc, TZ)).toBe('2026-06-15');
    expect(utcToLocalTime(utc, TZ)).toBe('09:00');
  });

  it('keeps 9 AM local across spring-forward (2026-03-08)', () => {
    // Day before DST kicks in.
    const beforeDst = localToUtc('2026-03-07', '09:00', TZ);
    // Day after DST kicks in.
    const afterDst = localToUtc('2026-03-09', '09:00', TZ);

    expect(utcToLocalTime(beforeDst, TZ)).toBe('09:00');
    expect(utcToLocalTime(afterDst, TZ)).toBe('09:00');

    // UTC values must differ by exactly 23h (lost hour) + 24h, NOT 48h.
    const diffHours = (afterDst.getTime() - beforeDst.getTime()) / 3_600_000;
    expect(diffHours).toBeCloseTo(47, 2);
  });

  it('keeps 9 AM local across fall-back (2026-11-01)', () => {
    const beforeDst = localToUtc('2026-10-31', '09:00', TZ);
    const afterDst = localToUtc('2026-11-02', '09:00', TZ);

    expect(utcToLocalTime(beforeDst, TZ)).toBe('09:00');
    expect(utcToLocalTime(afterDst, TZ)).toBe('09:00');

    // Two days = 49h across fall-back (gained hour).
    const diffHours = (afterDst.getTime() - beforeDst.getTime()) / 3_600_000;
    expect(diffHours).toBeCloseTo(49, 2);
  });
});

describe('localDayOfWeek', () => {
  it('returns Mon=1 for a known Monday', () => {
    expect(localDayOfWeek('2026-06-15', TZ)).toBe(1); // 2026-06-15 is a Monday
  });
  it('returns Fri=5 for a known Friday', () => {
    expect(localDayOfWeek('2026-06-19', TZ)).toBe(5);
  });
  it('returns Sat=6 for a known Saturday', () => {
    expect(localDayOfWeek('2026-06-20', TZ)).toBe(6);
  });
});

describe('enumerateDates', () => {
  it('enumerates June 1–7 inclusive', () => {
    expect(enumerateDates('2026-06-01', '2026-06-07')).toEqual([
      '2026-06-01',
      '2026-06-02',
      '2026-06-03',
      '2026-06-04',
      '2026-06-05',
      '2026-06-06',
      '2026-06-07',
    ]);
  });
  it('handles single-day ranges', () => {
    expect(enumerateDates('2026-06-15', '2026-06-15')).toEqual(['2026-06-15']);
  });
  it('returns empty on inverted ranges', () => {
    expect(enumerateDates('2026-06-15', '2026-06-01')).toEqual([]);
  });
});

describe('time helpers', () => {
  it('normalizes 9 to 09:00', () => {
    expect(normalizeTime('9')).toBe('09:00');
    expect(normalizeTime('9:00')).toBe('09:00');
    expect(normalizeTime('09:00')).toBe('09:00');
  });
  it('converts minutes round-trip', () => {
    expect(timeToMinutes('08:00')).toBe(480);
    expect(timeToMinutes('12:00')).toBe(720);
    expect(minutesToTime(480)).toBe('08:00');
    expect(minutesToTime(720)).toBe('12:00');
    expect(minutesToTime(540)).toBe('09:00');
  });
});
