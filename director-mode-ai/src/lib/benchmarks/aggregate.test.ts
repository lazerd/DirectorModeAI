import { describe, it, expect } from 'vitest';
import {
  summarize, crossTab, clubSizeBand, clubType, publicSnapshot, MIN_GROUP_SIZE, type BenchmarkRow,
} from './aggregate';

const row = (over: Partial<BenchmarkRow> = {}): BenchmarkRow => ({
  club: 'SAMPLE RACQUET CLUB', ein: '00-0000001', state: 'NY', region: 'Northeast', dept: 'Tennis/Racquets',
  title: 'DIRECTOR OF TENNIS', name: 'ZZSENTINEL PERSON', reported: 0, other: 0, total: 150_000,
  revenue: 8_000_000, pct: 0.02, year: '2023', url: 'https://example.org', recent: true,
  ...over,
});
const many = (n: number, over: Partial<BenchmarkRow> = {}) =>
  Array.from({ length: n }, (_, i) => row({ ein: `00-${String(i).padStart(7, '0')}`, total: 100_000 + i * 10_000, ...over }));

describe('summarize — small-group suppression', () => {
  it('hides a group below the minimum size', () => {
    expect(MIN_GROUP_SIZE).toBe(5);
    expect(summarize(many(4))).toBeNull();
    expect(summarize(many(1))).toBeNull();
    expect(summarize([])).toBeNull();
  });

  it('publishes a group at the minimum size, rounded to $1k, without a p90', () => {
    const s = summarize(many(5, { total: 123_456 }))!;
    expect(s.n).toBe(5);
    expect(s.median).toBe(123_000);
    expect(s.p90).toBeNull();
  });

  it('adds p90 once the group is big enough', () => {
    expect(summarize(many(10))!.p90).not.toBeNull();
  });

  it('ignores zero/invalid comp when counting', () => {
    expect(summarize([...many(4), row({ total: 0 })])).toBeNull();
  });
});

describe('crossTab', () => {
  it('nulls sub-threshold cells, drops empty rows and counts what it hid', () => {
    const rows = [
      ...many(6, { region: 'West', dept: 'Golf' }),
      ...many(2, { region: 'West', dept: 'GM' }),
      ...many(3, { region: 'South', dept: 'Golf' }),
    ];
    const t = crossTab(rows, (r) => r.region, ['Northeast', 'South', 'West']);
    expect(t.rows.map((r) => r.label)).toEqual(['West']);
    const [tennis, golf, gm] = t.rows[0].cells;
    expect(tennis).toBeNull();
    expect(golf?.n).toBe(6);
    expect(gm).toBeNull();
    expect(t.hidden).toBe(2); // West/GM (2) + South/Golf (3)
  });
});

describe('bands', () => {
  it('buckets revenue and club type', () => {
    expect(clubSizeBand(0)).toBeNull();
    expect(clubSizeBand(4_999_999)).toBe('Under $5M');
    expect(clubSizeBand(25_000_000)).toBe('$20M+');
    expect(clubType('SAMPLE TENNIS & COUNTRY CLUB')).toBe('Racquet club');
    expect(clubType('SAMPLE COUNTRY CLUB INC')).toBe('Golf & country club');
    expect(clubType('SAMPLE YACHT CLUB')).toBe('Other private club');
  });
});

describe('publicSnapshot', () => {
  it('never carries names, EINs, club names or links', () => {
    const snap = publicSnapshot([...many(12), ...many(3, { recent: false })]);
    const json = JSON.stringify(snap);
    expect(json).not.toContain('ZZSENTINEL');
    expect(json).not.toContain('SAMPLE RACQUET CLUB');
    expect(json).not.toContain('00-0000001');
    expect(json).not.toContain('example.org');
    expect(snap.people).toBe(12);
  });
});
