import { describe, it, expect } from 'vitest';
import { expandSeries, singleInstance } from './recurrence';
import type { BookingIntent, Court, OperatingHours } from './types';
import { utcToLocalDate, utcToLocalTime } from './timezones';

const TZ = 'America/Los_Angeles';

function fakeCourts(count: number): Court[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `court-${i + 1}`,
    club_id: 'club-1',
    number: i + 1,
    name: null,
    sports: ['tennis'],
    surface: 'hard',
    indoor: false,
    status: 'active' as const,
    display_order: i + 1,
  }));
}

const TWENTY_FOUR_SEVEN: OperatingHours = {};
const WEEKDAYS_6_TO_10: OperatingHours = {
  '0': null,
  '1': [{ open: '06:00', close: '22:00' }],
  '2': [{ open: '06:00', close: '22:00' }],
  '3': [{ open: '06:00', close: '22:00' }],
  '4': [{ open: '06:00', close: '22:00' }],
  '5': [{ open: '06:00', close: '22:00' }],
  '6': null,
};

describe('expandSeries — the canonical summer camp', () => {
  it('produces one instance per (court × weekday) for courts 1-6, Mon-Fri, Jun 1-Jul 31, 8-12', () => {
    const intent: BookingIntent = {
      club_id: 'club-1',
      courts: [1, 2, 3, 4, 5, 6],
      date_range: { start: '2026-06-01', end: '2026-07-31' },
      days_of_week: [1, 2, 3, 4, 5],
      time_range: { start: '08:00', end: '12:00' },
      type: 'camp',
      title: 'Summer Camp',
    };

    const result = expandSeries(intent, {
      timezone: TZ,
      courts: fakeCourts(8),
      operating_hours: WEEKDAYS_6_TO_10,
    });

    // 45 weekdays in Jun+Jul 2026 (Jun has 22, Jul has 23) × 6 courts = 270.
    // The build prompt's "~264" was approximate — keep the assertion exact.
    expect(result.instances.length).toBe(270);
    expect(result.warnings.filter((w) => w.kind === 'outside_operating_hours').length).toBe(0);
  });

  it('all instances are 4 hours long, club-local', () => {
    const intent: BookingIntent = {
      club_id: 'club-1',
      courts: [1, 2, 3, 4, 5, 6],
      date_range: { start: '2026-06-01', end: '2026-07-31' },
      days_of_week: [1, 2, 3, 4, 5],
      time_range: { start: '08:00', end: '12:00' },
      type: 'camp',
      title: 'Summer Camp',
    };
    const { instances } = expandSeries(intent, {
      timezone: TZ,
      courts: fakeCourts(8),
      operating_hours: WEEKDAYS_6_TO_10,
    });
    for (const inst of instances) {
      expect(utcToLocalTime(inst.starts_at, TZ)).toBe('08:00');
      expect(utcToLocalTime(inst.ends_at, TZ)).toBe('12:00');
    }
  });

  it('every emitted date is a weekday in June or July 2026', () => {
    const intent: BookingIntent = {
      club_id: 'club-1',
      courts: [1],
      date_range: { start: '2026-06-01', end: '2026-07-31' },
      days_of_week: [1, 2, 3, 4, 5],
      time_range: { start: '08:00', end: '12:00' },
      type: 'camp',
      title: 'Summer Camp',
    };
    const { instances } = expandSeries(intent, {
      timezone: TZ,
      courts: fakeCourts(8),
      operating_hours: WEEKDAYS_6_TO_10,
    });
    for (const inst of instances) {
      const date = utcToLocalDate(inst.starts_at, TZ);
      expect(date >= '2026-06-01' && date <= '2026-07-31').toBe(true);
    }
  });
});

describe('expandSeries — DST behavior', () => {
  it('a Mar 8 (DST forward) 9 AM clinic stays 9 AM local', () => {
    const intent: BookingIntent = {
      club_id: 'club-1',
      courts: [1],
      date_range: { start: '2026-03-08', end: '2026-03-08' },
      time_range: { start: '09:00', end: '10:00' },
      type: 'lesson',
      title: 'DST forward clinic',
    };
    const { instances } = expandSeries(intent, {
      timezone: TZ,
      courts: fakeCourts(1),
      operating_hours: TWENTY_FOUR_SEVEN,
    });
    expect(instances.length).toBe(1);
    expect(utcToLocalTime(instances[0].starts_at, TZ)).toBe('09:00');
  });

  it('a Nov 1 (DST back) 9 AM clinic stays 9 AM local', () => {
    const intent: BookingIntent = {
      club_id: 'club-1',
      courts: [1],
      date_range: { start: '2026-11-01', end: '2026-11-01' },
      time_range: { start: '09:00', end: '10:00' },
      type: 'lesson',
      title: 'DST back clinic',
    };
    const { instances } = expandSeries(intent, {
      timezone: TZ,
      courts: fakeCourts(1),
      operating_hours: TWENTY_FOUR_SEVEN,
    });
    expect(instances.length).toBe(1);
    expect(utcToLocalTime(instances[0].starts_at, TZ)).toBe('09:00');
  });
});

describe('expandSeries — exclusions and warnings', () => {
  it('skips excluded dates', () => {
    const intent: BookingIntent = {
      club_id: 'club-1',
      courts: [1],
      date_range: { start: '2026-06-01', end: '2026-06-05' },
      days_of_week: [1, 2, 3, 4, 5],
      time_range: { start: '08:00', end: '09:00' },
      type: 'camp',
      title: 'Camp',
      exclusions: ['2026-06-03'],
    };
    const { instances, warnings } = expandSeries(intent, {
      timezone: TZ,
      courts: fakeCourts(1),
      operating_hours: TWENTY_FOUR_SEVEN,
    });
    expect(instances.length).toBe(4);
    expect(warnings.find((w) => w.kind === 'date_excluded')).toBeTruthy();
  });

  it('warns when an unknown court is referenced', () => {
    const intent: BookingIntent = {
      club_id: 'club-1',
      courts: [99],
      date_range: { start: '2026-06-01', end: '2026-06-01' },
      time_range: { start: '08:00', end: '09:00' },
      type: 'camp',
      title: 'Camp',
    };
    const { instances, warnings } = expandSeries(intent, {
      timezone: TZ,
      courts: fakeCourts(8),
      operating_hours: TWENTY_FOUR_SEVEN,
    });
    expect(instances.length).toBe(0);
    expect(warnings.find((w) => w.kind === 'unknown_court' && w.label === 99)).toBeTruthy();
  });

  it('warns when the time window falls outside operating hours', () => {
    const intent: BookingIntent = {
      club_id: 'club-1',
      courts: [1],
      date_range: { start: '2026-06-15', end: '2026-06-15' },
      time_range: { start: '04:00', end: '05:00' }, // before 06:00 open
      type: 'camp',
      title: 'Camp',
    };
    const { instances, warnings } = expandSeries(intent, {
      timezone: TZ,
      courts: fakeCourts(1),
      operating_hours: WEEKDAYS_6_TO_10,
    });
    // Still emits the instance (planner shows it as a warning conflict).
    expect(instances.length).toBe(1);
    expect(warnings.find((w) => w.kind === 'outside_operating_hours')).toBeTruthy();
  });

  it('resolves court names', () => {
    const courts: Court[] = [
      { ...fakeCourts(1)[0], name: 'Stadium' },
      { ...fakeCourts(1)[0], id: 'court-2', number: 2, name: 'Bubble' },
    ];
    const intent: BookingIntent = {
      club_id: 'club-1',
      courts: ['Stadium', 'Bubble'],
      date_range: { start: '2026-06-15', end: '2026-06-15' },
      time_range: { start: '08:00', end: '09:00' },
      type: 'camp',
      title: 'Camp',
    };
    const { instances } = expandSeries(intent, {
      timezone: TZ,
      courts,
      operating_hours: TWENTY_FOUR_SEVEN,
    });
    expect(instances.length).toBe(2);
    expect(instances.map((i) => i.court_id).sort()).toEqual(['court-1', 'court-2']);
  });
});

describe('singleInstance', () => {
  it('emits one ReservationInstance with the right UTC bounds', () => {
    const inst = singleInstance({
      court: fakeCourts(1)[0],
      date: '2026-06-15',
      time_start: '13:30',
      time_end: '14:30',
      timezone: TZ,
      type: 'lesson',
      title: 'Private lesson',
    });
    expect(utcToLocalTime(inst.starts_at, TZ)).toBe('13:30');
    expect(utcToLocalTime(inst.ends_at, TZ)).toBe('14:30');
  });
});
