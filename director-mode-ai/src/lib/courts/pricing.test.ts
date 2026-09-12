import { describe, it, expect } from 'vitest';
import {
  bookingEnabled,
  bookingRules,
  cardsFor,
  durationOptions,
  priceBooking,
  toHHMM,
  toMinutes,
  type RateCard,
} from './pricing';

const card = (over: Partial<RateCard> & { id: string }): RateCard => ({
  label: over.label ?? over.id,
  applies_to: 'public',
  days_of_week: [],
  time_start: '00:00',
  time_end: '23:59',
  price_cents: 2400,
  advance_days: 3,
  min_minutes: 60,
  max_minutes: 120,
  active: true,
  ...over,
});

/** Lafayette's real setup: free to members, $24/hr to the public. */
const LAFAYETTE: RateCard[] = [
  card({ id: 'mem', label: 'Members', applies_to: 'member', price_cents: 0, advance_days: 7 }),
  card({ id: 'pub', label: 'Public', applies_to: 'public', price_cents: 2400, advance_days: 3 }),
];

/** A club with peak pricing — the case that makes straddling real. */
const PEAK: RateCard[] = [
  card({ id: 'off', label: 'Off-peak', time_start: '06:00', time_end: '16:00', price_cents: 2000 }),
  card({ id: 'peak', label: 'Peak', time_start: '16:00', time_end: '22:00', price_cents: 3600 }),
];

describe('priceBooking', () => {
  it('prices a flat hour', () => {
    const r = priceBooking(LAFAYETTE, {
      audience: 'public',
      dayOfWeek: 2,
      startTime: '10:00',
      minutes: 60,
    });
    expect(r.ok && r.cents).toBe(2400);
  });

  it('pro-rates a 90-minute booking', () => {
    const r = priceBooking(LAFAYETTE, {
      audience: 'public',
      dayOfWeek: 2,
      startTime: '10:00',
      minutes: 90,
    });
    expect(r.ok && r.cents).toBe(3600);
  });

  it('charges a member nothing, and says so as a real price', () => {
    const r = priceBooking(LAFAYETTE, {
      audience: 'member',
      dayOfWeek: 2,
      startTime: '10:00',
      minutes: 120,
    });
    expect(r.ok).toBe(true);
    expect(r.ok && r.cents).toBe(0);
    // Zero is a priced booking, not an unpriced one — the distinction the
    // no_rate branch exists to keep.
    expect(r.ok && r.segments).toHaveLength(1);
  });

  it('splits a booking that straddles a rate boundary', () => {
    // 3:30–5:30 with off-peak until 4: 30 min at $20/hr, 90 min at $36/hr.
    const r = priceBooking(PEAK, {
      audience: 'public',
      dayOfWeek: 2,
      startTime: '15:30',
      minutes: 120,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.segments).toHaveLength(2);
    expect(r.segments[0]).toMatchObject({ label: 'Off-peak', minutes: 30, cents: 1000 });
    expect(r.segments[1]).toMatchObject({ label: 'Peak', minutes: 90, cents: 5400 });
    expect(r.cents).toBe(6400);
    // Charging the whole thing at either rate would be 4000 or 7200 — both
    // wrong in a way a member notices.
    expect(r.cents).not.toBe(4000);
    expect(r.cents).not.toBe(7200);
  });

  it('gives the narrower window precedence where two overlap', () => {
    // An all-day base rate plus an evening peak: the evening must cost peak.
    const cards = [
      card({ id: 'base', label: 'Base', price_cents: 2000, time_start: '06:00', time_end: '22:00' }),
      card({ id: 'eve', label: 'Evening', price_cents: 4000, time_start: '18:00', time_end: '22:00' }),
    ];
    const evening = priceBooking(cards, {
      audience: 'public',
      dayOfWeek: 2,
      startTime: '19:00',
      minutes: 60,
    });
    expect(evening.ok && evening.cents).toBe(4000);

    const morning = priceBooking(cards, {
      audience: 'public',
      dayOfWeek: 2,
      startTime: '09:00',
      minutes: 60,
    });
    expect(morning.ok && morning.cents).toBe(2000);
  });

  it('prefers a day-specific card over an all-week one', () => {
    const cards = [
      card({ id: 'week', label: 'Weekdays', price_cents: 2000 }),
      card({ id: 'sat', label: 'Saturday', price_cents: 3000, days_of_week: [6] }),
    ];
    const saturday = priceBooking(cards, {
      audience: 'public',
      dayOfWeek: 6,
      startTime: '10:00',
      minutes: 60,
    });
    expect(saturday.ok && saturday.cents).toBe(3000);
    const tuesday = priceBooking(cards, {
      audience: 'public',
      dayOfWeek: 2,
      startTime: '10:00',
      minutes: 60,
    });
    expect(tuesday.ok && tuesday.cents).toBe(2000);
  });

  it('refuses to guess when the club has no rate for the time', () => {
    // The booking page must not offer a slot it cannot price, and the message
    // has to name the hole so a director can go fix it.
    const r = priceBooking(PEAK, {
      audience: 'public',
      dayOfWeek: 2,
      startTime: '05:00',
      minutes: 60,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('no_rate');
    expect(r.uncoveredFrom).toBe('05:00');
    expect(r.uncoveredTo).toBe('06:00');
  });

  it('reports a gap that starts mid-booking', () => {
    const cards = [card({ id: 'am', time_start: '08:00', time_end: '10:00', price_cents: 2400 })];
    const r = priceBooking(cards, {
      audience: 'public',
      dayOfWeek: 2,
      startTime: '09:00',
      minutes: 120,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.uncoveredFrom).toBe('10:00');
    expect(r.uncoveredTo).toBe('11:00');
  });

  it('refuses when the audience has no cards at all', () => {
    const publicOnly = [card({ id: 'pub' })];
    const r = priceBooking(publicOnly, {
      audience: 'member',
      dayOfWeek: 2,
      startTime: '10:00',
      minutes: 60,
    });
    expect(r.ok).toBe(false);
  });

  it('ignores an inactive card', () => {
    const cards = [
      card({ id: 'old', label: 'Old', price_cents: 1000, active: false }),
      card({ id: 'new', label: 'New', price_cents: 2400 }),
    ];
    const r = priceBooking(cards, {
      audience: 'public',
      dayOfWeek: 2,
      startTime: '10:00',
      minutes: 60,
    });
    expect(r.ok && r.segments[0].label).toBe('New');
  });

  it('rounds to the cent rather than carrying a fraction', () => {
    // $25/hr for 50 minutes is 2083.33 cents.
    const cards = [card({ id: 'odd', price_cents: 2500 })];
    const r = priceBooking(cards, {
      audience: 'public',
      dayOfWeek: 2,
      startTime: '10:00',
      minutes: 50,
    });
    expect(r.ok && r.cents).toBe(2083);
    expect(Number.isInteger(r.ok && r.cents)).toBe(true);
  });

  it('collapses two visits to the same card into one receipt line', () => {
    const cards = [
      card({ id: 'base', label: 'Base', price_cents: 2000, time_start: '08:00', time_end: '20:00' }),
      card({ id: 'lunch', label: 'Lunch', price_cents: 1000, time_start: '12:00', time_end: '13:00' }),
    ];
    const r = priceBooking(cards, {
      audience: 'public',
      dayOfWeek: 2,
      startTime: '11:30',
      minutes: 120,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // 11:30–12:00 base, 12:00–13:00 lunch, 13:00–13:30 base → 2 lines, 3 spans.
    expect(r.segments).toHaveLength(2);
    const base = r.segments.find((s) => s.label === 'Base')!;
    expect(base.minutes).toBe(60);
    expect(base.cents).toBe(2000);
    expect(r.cents).toBe(3000);
  });
});

describe('bookingRules', () => {
  it('reads the advance window off the club’s cards', () => {
    expect(bookingRules(LAFAYETTE, 'member').advanceDays).toBe(7);
    expect(bookingRules(LAFAYETTE, 'public').advanceDays).toBe(3);
  });

  it('takes the most generous window, not the strictest', () => {
    // Otherwise adding one peak-hour card silently shortens the whole club's
    // booking window.
    const cards = [
      card({ id: 'a', applies_to: 'member', advance_days: 7 }),
      card({ id: 'b', applies_to: 'member', advance_days: 2, time_start: '18:00', time_end: '22:00' }),
    ];
    expect(bookingRules(cards, 'member').advanceDays).toBe(7);
  });

  it('has a safe answer for an audience with no cards', () => {
    // advanceDays 0 means "cannot book ahead", which reads as booking being
    // switched off rather than accidentally wide open.
    expect(bookingRules([], 'public')).toEqual({
      advanceDays: 0,
      minMinutes: 60,
      maxMinutes: 120,
    });
  });
});

describe('cardsFor', () => {
  it('keeps only the audience and the day', () => {
    const cards = [
      card({ id: 'sat', days_of_week: [6] }),
      card({ id: 'week', days_of_week: [1, 2, 3, 4, 5] }),
      card({ id: 'mem', applies_to: 'member' }),
    ];
    expect(cardsFor(cards, 'public', 6).map((c) => c.id)).toEqual(['sat']);
    expect(cardsFor(cards, 'public', 2).map((c) => c.id)).toEqual(['week']);
    expect(cardsFor(cards, 'member', 2).map((c) => c.id)).toEqual(['mem']);
  });
});

describe('bookingEnabled', () => {
  it('is off for a club with no cards, and off if every card is inactive', () => {
    expect(bookingEnabled([])).toBe(false);
    expect(bookingEnabled([card({ id: 'x', active: false })])).toBe(false);
    expect(bookingEnabled(LAFAYETTE)).toBe(true);
  });
});

describe('durationOptions', () => {
  it('steps in half hours between the club’s limits', () => {
    expect(durationOptions({ minMinutes: 60, maxMinutes: 120 })).toEqual([60, 90, 120]);
    expect(durationOptions({ minMinutes: 30, maxMinutes: 60 })).toEqual([30, 60]);
  });

  it('never returns an empty list', () => {
    expect(durationOptions({ minMinutes: 200, maxMinutes: 60 })).toEqual([60]);
  });
});

describe('time helpers', () => {
  it('round-trips', () => {
    expect(toMinutes('15:30')).toBe(930);
    expect(toHHMM(930)).toBe('15:30');
    expect(toMinutes('15:30:00')).toBe(930);
    expect(toHHMM(0)).toBe('00:00');
  });
});
