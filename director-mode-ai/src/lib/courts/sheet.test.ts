import { describe, it, expect } from 'vitest';
import { sheetGrid } from './sheet';
import type { BusyBlock, Court } from './availability';
import { toMinutes, type RateCard } from './pricing';

const courts: Court[] = [
  { id: 'c1', name: 'Court 1', number: 1, status: 'active' },
  { id: 'c2', name: null, number: 2, status: 'active' },
  { id: 'c3', name: 'Court 3', number: 3, status: 'hidden' },
];

const card = (over: Partial<RateCard>): RateCard => ({
  id: 'x', label: 'x', applies_to: 'public', days_of_week: [], time_start: '06:00',
  time_end: '22:00', price_cents: 2400, advance_days: 3, min_minutes: 60, max_minutes: 120,
  active: true, ...over,
});

const busy = (court: string, from: string, to: string): BusyBlock => ({
  court_id: court, startMinute: toMinutes(from), endMinute: toMinutes(to),
});

const base = {
  courts,
  busy: [] as BusyBlock[],
  openWindows: [{ open: '08:00', close: '10:00' }],
  rateCards: [card({})],
  audience: 'public' as const,
  dayOfWeek: 2,
  nowMinute: null,
};

describe('sheetGrid', () => {
  it('shows every visible court and every half hour', () => {
    const g = sheetGrid(base);
    expect(g.courts.map((c) => c.name)).toEqual(['Court 1', 'Court 2']);
    expect(g.rows.map((r) => r.time)).toEqual(['08:00', '08:30', '09:00', '09:30']);
  });

  it('prices open cells per hour for the audience', () => {
    const g = sheetGrid(base);
    expect(g.rows[0].cells[0]).toEqual({ state: 'open', centsPerHour: 2400 });
  });

  it('marks a booking on the courts and half hours it covers, with no price', () => {
    const g = sheetGrid({ ...base, busy: [busy('c1', '08:30', '09:30')] });
    expect(g.rows.map((r) => r.cells[0].state)).toEqual(['open', 'booked', 'booked', 'open']);
    expect(g.rows[1].cells[1].state).toBe('open');
    expect(g.rows[1].cells[0].centsPerHour).toBeNull();
  });

  it('changes price at a peak boundary', () => {
    const g = sheetGrid({
      ...base,
      rateCards: [card({ time_end: '09:00' }), card({ id: 'peak', time_start: '09:00', price_cents: 3200 })],
    });
    expect(g.rows.map((r) => r.cells[0].centsPerHour)).toEqual([2400, 2400, 3200, 3200]);
  });

  it('members at a free club see $0, not "no price"', () => {
    const g = sheetGrid({ ...base, audience: 'member', rateCards: [card({ applies_to: 'member', price_cents: 0 })] });
    expect(g.rows[0].cells[0]).toEqual({ state: 'open', centsPerHour: 0 });
  });

  it('still shows open courts when the club has no rates', () => {
    const g = sheetGrid({ ...base, rateCards: [] });
    expect(g.rows[0].cells[0]).toEqual({ state: 'open', centsPerHour: null });
  });

  it('greys out finished half hours today but keeps the one in progress', () => {
    const g = sheetGrid({ ...base, nowMinute: toMinutes('08:45') });
    expect(g.rows.map((r) => r.cells[0].state)).toEqual(['past', 'open', 'open', 'open']);
    expect(g.rows.map((r) => r.past)).toEqual([true, false, false, false]);
  });

  it('assumes 7am–10pm when the club set no hours', () => {
    const g = sheetGrid({ ...base, openWindows: [] });
    expect(g.assumedHours).toBe(true);
    expect(g.rows[0].time).toBe('07:00');
    expect(g.rows.at(-1)?.time).toBe('21:30');
  });
});
