import { describe, it, expect } from 'vitest';
import {
  availableSlots,
  bookableDates,
  windowsForDay,
  withinAdvanceWindow,
  type BusyBlock,
  type Court,
} from './availability';
import { toMinutes, type RateCard } from './pricing';

const courts: Court[] = [
  { id: 'c1', name: 'Court 1', number: 1, status: 'active' },
  { id: 'c2', name: 'Court 2', number: 2, status: 'active' },
];

const PUBLIC_RATE: RateCard[] = [
  {
    id: 'pub',
    label: 'Public',
    applies_to: 'public',
    days_of_week: [],
    time_start: '06:00',
    time_end: '22:00',
    price_cents: 2400,
    advance_days: 3,
    min_minutes: 60,
    max_minutes: 120,
    active: true,
  },
];

const busy = (court: string, from: string, to: string): BusyBlock => ({
  court_id: court,
  startMinute: toMinutes(from),
  endMinute: toMinutes(to),
});

const base = {
  courts,
  busy: [] as BusyBlock[],
  openWindows: [{ open: '08:00', close: '12:00' }],
  rateCards: PUBLIC_RATE,
  audience: 'public' as const,
  dayOfWeek: 2,
  minutes: 60,
  nowMinute: null,
};

describe('availableSlots', () => {
  it('offers every half hour that fits inside opening hours', () => {
    const r = availableSlots(base);
    // 08:00 through 11:00 start times for a 60-minute booking to 12:00.
    expect(r.slots.map((s) => s.time)).toEqual([
      '08:00', '08:30', '09:00', '09:30', '10:00', '10:30', '11:00',
    ]);
  });

  it('prices every slot', () => {
    expect(availableSlots(base).slots.every((s) => s.cents === 2400)).toBe(true);
  });

  it('drops a court that is already booked, and keeps the other', () => {
    const r = availableSlots({ ...base, busy: [busy('c1', '09:00', '10:00')] });
    const at9 = r.slots.find((s) => s.time === '09:00')!;
    expect(at9.courts.map((c) => c.id)).toEqual(['c2']);
  });

  it('drops the slot entirely when every court is taken', () => {
    const r = availableSlots({
      ...base,
      busy: [busy('c1', '09:00', '10:00'), busy('c2', '09:00', '10:00')],
    });
    expect(r.slots.map((s) => s.time)).not.toContain('09:00');
    // The overlapping starts go too: 08:30–09:30 and 09:30–10:30 both clash.
    expect(r.slots.map((s) => s.time)).not.toContain('08:30');
    expect(r.slots.map((s) => s.time)).not.toContain('09:30');
    expect(r.slots.map((s) => s.time)).toContain('10:00');
  });

  it('treats ranges as half-open, like the no_double_booking constraint', () => {
    // A booking ending at 10:00 must not block one starting at 10:00.
    const r = availableSlots({
      ...base,
      courts: [courts[0]],
      busy: [busy('c1', '09:00', '10:00')],
    });
    expect(r.slots.map((s) => s.time)).toContain('10:00');
    expect(r.slots.map((s) => s.time)).not.toContain('09:30');
  });

  it('will not offer a longer booking than the day has room for', () => {
    const r = availableSlots({ ...base, minutes: 120 });
    expect(r.slots.map((s) => s.time)).toEqual(['08:00', '08:30', '09:00', '09:30', '10:00']);
  });

  it('says so when the club is not open long enough', () => {
    const r = availableSlots({
      ...base,
      openWindows: [{ open: '08:00', close: '08:45' }],
      minutes: 60,
    });
    expect(r.slots).toHaveLength(0);
    expect(r.note).toMatch(/not open long enough/i);
  });

  it('hides slots that have already started today', () => {
    const r = availableSlots({ ...base, nowMinute: toMinutes('09:40') });
    expect(r.slots.map((s) => s.time)).toEqual(['10:00', '10:30', '11:00']);
  });

  it('says "nothing left today" rather than "every court is booked"', () => {
    const r = availableSlots({ ...base, nowMinute: toMinutes('23:00') });
    expect(r.slots).toHaveLength(0);
    expect(r.note).toMatch(/nothing left today/i);
  });

  it('skips hidden and maintenance courts', () => {
    const r = availableSlots({
      ...base,
      courts: [
        { id: 'c1', name: 'Court 1', number: 1, status: 'hidden' },
        { id: 'c2', name: 'Court 2', number: 2, status: 'maintenance' },
        { id: 'c3', name: 'Court 3', number: 3, status: 'active' },
      ],
    });
    expect(r.slots[0].courts.map((c) => c.id)).toEqual(['c3']);
  });

  it('says something useful when the club has no bookable courts', () => {
    const r = availableSlots({ ...base, courts: [] });
    expect(r.slots).toHaveLength(0);
    expect(r.note).toMatch(/no courts/i);
  });

  it('handles two opening windows in a day', () => {
    const r = availableSlots({
      ...base,
      openWindows: [
        { open: '08:00', close: '10:00' },
        { open: '17:00', close: '19:00' },
      ],
    });
    expect(r.slots.map((s) => s.time)).toEqual(['08:00', '08:30', '09:00', '17:00', '17:30', '18:00']);
  });

  it('never offers a slot it cannot price', () => {
    // The rate only covers the morning; the afternoon must simply not appear,
    // rather than being offered and rejected at checkout.
    const morningOnly: RateCard[] = [{ ...PUBLIC_RATE[0], time_start: '08:00', time_end: '10:00' }];
    const r = availableSlots({
      ...base,
      rateCards: morningOnly,
      openWindows: [{ open: '08:00', close: '14:00' }],
    });
    // 08:00, 08:30 and 09:00 all END by 10:00 and are priceable; 09:30 would
    // run past the rate's window, so it is not offered at all.
    expect(r.slots.map((s) => s.time)).toEqual(['08:00', '08:30', '09:00']);
  });

  it('falls back to sane hours rather than offering 3am tennis', () => {
    // CourtSheet reads an empty operating_hours as 24/7, which is right for a
    // staff grid and wrong for a public booking page.
    const r = availableSlots({
      ...base,
      openWindows: [],
      rateCards: [{ ...PUBLIC_RATE[0], time_start: '00:00', time_end: '23:59' }],
    });
    expect(r.slots[0].time).toBe('07:00');
    expect(r.slots[r.slots.length - 1].time).toBe('21:00');
  });

  it('reports the audience’s advance window back to the caller', () => {
    expect(availableSlots(base).advanceDays).toBe(3);
  });
});

describe('withinAdvanceWindow', () => {
  it('counts the last day as bookable', () => {
    // "3 days in advance" means today plus three, which is what a club means
    // and what a member will argue.
    expect(withinAdvanceWindow('2026-09-12', '2026-09-15', 3).ok).toBe(true);
  });

  it('refuses the day after the window', () => {
    const r = withinAdvanceWindow('2026-09-12', '2026-09-16', 3);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('too_far');
    expect(r.lastBookable).toBe('2026-09-15');
  });

  it('refuses the past', () => {
    const r = withinAdvanceWindow('2026-09-12', '2026-09-11', 3);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('past');
  });

  it('allows today with a zero-day window', () => {
    expect(withinAdvanceWindow('2026-09-12', '2026-09-12', 0).ok).toBe(true);
    expect(withinAdvanceWindow('2026-09-12', '2026-09-13', 0).ok).toBe(false);
  });

  it('crosses a month boundary correctly', () => {
    expect(withinAdvanceWindow('2026-09-29', '2026-10-02', 3).ok).toBe(true);
    expect(withinAdvanceWindow('2026-09-29', '2026-10-03', 3).ok).toBe(false);
  });
});

describe('bookableDates', () => {
  it('returns today through the window, inclusive', () => {
    expect(bookableDates('2026-09-12', 3)).toEqual([
      '2026-09-12', '2026-09-13', '2026-09-14', '2026-09-15',
    ]);
  });

  it('returns just today for a zero window', () => {
    expect(bookableDates('2026-09-12', 0)).toEqual(['2026-09-12']);
  });
});

describe('windowsForDay', () => {
  it('reads the club’s hours for one weekday', () => {
    const hours = { '2': [{ open: '06:00', close: '22:00' }] };
    expect(windowsForDay(hours, 2)).toEqual([{ open: '06:00', close: '22:00' }]);
    expect(windowsForDay(hours, 3)).toEqual([]);
  });

  it('treats an unset operating_hours as unset, not as closed', () => {
    // availableSlots turns [] into sensible defaults; the distinction matters
    // because {} means "never configured" and {"2":[]} means "closed Tuesday".
    expect(windowsForDay({}, 2)).toEqual([]);
    expect(windowsForDay(null, 2)).toEqual([]);
    expect(windowsForDay({ '2': [] }, 2)).toEqual([]);
  });
});
