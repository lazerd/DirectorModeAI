import { describe, it, expect } from 'vitest';
import {
  daysLabel,
  formatPrice,
  formatSessionDate,
  formatTimeRange,
  nextSession,
  programSessions,
} from './sessions';

const TZ = 'America/Los_Angeles';

/** A Tue/Thu after-school class — the shape the whole feature was built for. */
const afterSchool = {
  range_start: '2026-09-15',
  range_end: '2026-10-08',
  days_of_week: [2, 4], // Tue, Thu
  exclusions: [] as string[],
};

describe('programSessions', () => {
  it('lists only the matching days of week, in order', () => {
    const s = programSessions(afterSchool, TZ);
    expect(s.dates).toEqual([
      '2026-09-15', '2026-09-17',
      '2026-09-22', '2026-09-24',
      '2026-09-29', '2026-10-01',
      '2026-10-06', '2026-10-08',
    ]);
    expect(s.count).toBe(8);
    expect(s.skipped).toEqual([]);
  });

  it('drops a skip date and reports it', () => {
    // The whole product in one assertion: one array element, one fewer session.
    const s = programSessions({ ...afterSchool, exclusions: ['2026-09-24'] }, TZ);
    expect(s.count).toBe(7);
    expect(s.dates).not.toContain('2026-09-24');
    expect(s.skipped).toEqual(['2026-09-24']);
  });

  it('ignores a skip date the class was never going to meet on', () => {
    // Sep 20 is a Sunday. Telling a parent "we skip Sunday" about a Tue/Thu
    // class is noise, so it is not reported as a skipped session.
    const s = programSessions({ ...afterSchool, exclusions: ['2026-09-20'] }, TZ);
    expect(s.count).toBe(8);
    expect(s.skipped).toEqual([]);
  });

  it('computes the day of week in CLUB time, not UTC', () => {
    /*
     * The bug this guards: Vercel runs UTC, and a Tuesday evening class in
     * California is already Wednesday in UTC. A naive getDay() would match
     * zero dates for a Tue/Thu class and silently report a class with no
     * sessions at all.
     */
    const west = programSessions(afterSchool, TZ);
    const utc = programSessions(afterSchool, 'UTC');
    expect(west.count).toBe(8);
    // Same calendar dates either way for a date-only comparison — the point is
    // that the helper is zone-aware rather than reading the host's clock.
    expect(utc.dates).toEqual(west.dates);

    // Across the DST boundary the count must still be exact.
    const acrossDst = programSessions(
      { range_start: '2026-10-27', range_end: '2026-11-10', days_of_week: [2], exclusions: [] },
      TZ,
    );
    expect(acrossDst.dates).toEqual(['2026-10-27', '2026-11-03', '2026-11-10']);
  });

  it('treats empty days_of_week as every day in range', () => {
    const s = programSessions(
      { range_start: '2026-09-15', range_end: '2026-09-18', days_of_week: [], exclusions: [] },
      TZ,
    );
    expect(s.count).toBe(4);
  });

  it('handles nulls from the database without throwing', () => {
    const s = programSessions(
      { range_start: '2026-09-15', range_end: '2026-09-16', days_of_week: null, exclusions: null },
      TZ,
    );
    expect(s.count).toBe(2);
  });

  it('accepts full timestamps, not just YYYY-MM-DD', () => {
    const s = programSessions(
      {
        range_start: '2026-09-15T00:00:00.000Z',
        range_end: '2026-09-17T00:00:00.000Z',
        days_of_week: [2, 4],
        exclusions: ['2026-09-17T00:00:00.000Z'],
      },
      TZ,
    );
    expect(s.dates).toEqual(['2026-09-15']);
    expect(s.skipped).toEqual(['2026-09-17']);
  });

  it('returns nothing for an inverted range rather than looping', () => {
    const s = programSessions(
      { range_start: '2026-10-08', range_end: '2026-09-15', days_of_week: [2], exclusions: [] },
      TZ,
    );
    expect(s).toEqual({ dates: [], skipped: [], count: 0 });
  });

  it('survives a class whose every meeting is skipped', () => {
    const all = programSessions(afterSchool, TZ).dates;
    const s = programSessions({ ...afterSchool, exclusions: all }, TZ);
    expect(s.count).toBe(0);
    expect(s.skipped).toHaveLength(8);
  });
});

describe('nextSession', () => {
  it('finds the next meeting on or after a day', () => {
    expect(nextSession(afterSchool, TZ, '2026-09-18')).toBe('2026-09-22');
    // On a meeting day, that day counts — a class at 3:30pm has not happened
    // yet when someone loads the page that morning.
    expect(nextSession(afterSchool, TZ, '2026-09-22')).toBe('2026-09-22');
  });

  it('is null once the class is over', () => {
    expect(nextSession(afterSchool, TZ, '2026-11-01')).toBeNull();
  });

  it('skips past an excluded date', () => {
    expect(nextSession({ ...afterSchool, exclusions: ['2026-09-22'] }, TZ, '2026-09-18')).toBe(
      '2026-09-24',
    );
  });
});

describe('daysLabel', () => {
  it('reads the way a director says it', () => {
    expect(daysLabel([2, 4])).toBe('Tue & Thu');
    expect(daysLabel([1, 3, 5])).toBe('Mon, Wed & Fri');
    expect(daysLabel([6])).toBe('Sat');
  });

  it('orders Sunday-first regardless of click order, and dedupes', () => {
    expect(daysLabel([4, 2, 2])).toBe('Tue & Thu');
    expect(daysLabel([5, 0])).toBe('Sun & Fri');
  });

  it('calls an everyday class Daily', () => {
    expect(daysLabel([])).toBe('Daily');
    expect(daysLabel(null)).toBe('Daily');
  });
});

describe('formatSessionDate', () => {
  it('does not slip a day west of Greenwich', () => {
    // 'YYYY-MM-DD' parsed alone is midnight UTC, which formats as the previous
    // day in California. This is the UTC bug that has bitten this app before.
    expect(formatSessionDate('2026-09-15', TZ)).toBe('Sep 15');
    expect(formatSessionDate('2026-01-01', TZ)).toBe('Jan 1');
  });

  it('adds weekday and year on request', () => {
    expect(formatSessionDate('2026-09-15', TZ, { weekday: true })).toBe('Tue, Sep 15');
    expect(formatSessionDate('2026-09-15', TZ, { year: true })).toBe('Sep 15, 2026');
  });
});

describe('formatTimeRange', () => {
  it('drops the repeated meridiem', () => {
    expect(formatTimeRange('15:30', '17:00')).toBe('3:30 – 5:00 PM');
  });

  it('keeps both when they differ', () => {
    expect(formatTimeRange('11:00', '13:00')).toBe('11 AM – 1 PM');
  });

  it('handles noon and midnight without printing 0', () => {
    expect(formatTimeRange('12:00', '13:30')).toBe('12:00 – 1:30 PM');
    expect(formatTimeRange('00:30', '01:00')).toBe('12:30 – 1:00 AM');
  });

  it('shows minutes on both ends or neither', () => {
    // "3:30 – 5 PM" reads like a typo on a page a parent is deciding from.
    expect(formatTimeRange('15:30', '17:00')).toBe('3:30 – 5:00 PM');
    expect(formatTimeRange('09:00', '10:00')).toBe('9 – 10 AM');
  });

  it('accepts the HH:MM:SS Postgres hands back', () => {
    expect(formatTimeRange('15:30:00', '17:00:00')).toBe('3:30 – 5:00 PM');
  });
});

describe('formatPrice', () => {
  it('drops the cents on whole dollars', () => {
    expect(formatPrice(24000)).toBe('$240');
    expect(formatPrice(3500)).toBe('$35');
  });

  it('keeps them when there are any', () => {
    expect(formatPrice(2499)).toBe('$24.99');
  });

  it('calls nothing Free', () => {
    expect(formatPrice(0)).toBe('Free');
    expect(formatPrice(null)).toBe('Free');
    expect(formatPrice(undefined)).toBe('Free');
  });
});
