/**
 * The cold list: search, filters, sort, and the paging that stops it being one
 * endless scroll.
 */

import { describe, expect, it } from 'vitest';
import { PAGE_SIZE, coerceFilters, coldSummary, DEFAULT_FILTERS, filterCold } from './coldList';
import type { ColdRow } from './types';

function row(over: Partial<ColdRow> = {}): ColdRow {
  return {
    id: over.name ? `id-${over.name}` : `id-${Math.random()}`,
    name: 'A Club',
    region: null,
    state: null,
    stage: 'researching',
    contact_count: 0,
    contact_names: '',
    last_activity_at: null,
    queued_at: null,
    ...over,
  };
}

const ROWS: ColdRow[] = [
  row({ name: 'Orinda Country Club', region: 'West', state: 'CA', contact_count: 2, contact_names: 'mary benin mary@orinda.org' }),
  row({ name: 'Dallas Athletic Club', region: 'Central', state: 'TX', contact_count: 1, contact_names: 'bert sebilia bert@dac.com' }),
  row({ name: 'Baltimore Country Club', region: 'East', state: 'MD', contact_count: 0, contact_names: '' }),
  row({ name: 'Zebra Racquet Club', region: 'East', state: 'NY', contact_count: 5, contact_names: 'chris slee chris@zebra.org' }),
];

describe('filterCold', () => {
  it('returns everything, by name, with no filters', () => {
    const p = filterCold(ROWS, DEFAULT_FILTERS);
    expect(p.total).toBe(4);
    expect(p.rows.map((r) => r.name)).toEqual([
      'Baltimore Country Club',
      'Dallas Athletic Club',
      'Orinda Country Club',
      'Zebra Racquet Club',
    ]);
  });

  it('searches the club name', () => {
    const p = filterCold(ROWS, { ...DEFAULT_FILTERS, q: 'orinda' });
    expect(p.rows.map((r) => r.name)).toEqual(['Orinda Country Club']);
  });

  it('searches contacts by name and by email', () => {
    expect(filterCold(ROWS, { ...DEFAULT_FILTERS, q: 'benin' }).total).toBe(1);
    expect(filterCold(ROWS, { ...DEFAULT_FILTERS, q: 'chris@zebra.org' }).total).toBe(1);
  });

  it('requires every word, so two words are not an OR', () => {
    // "country club" matches two; "dallas country" matches neither.
    expect(filterCold(ROWS, { ...DEFAULT_FILTERS, q: 'country club' }).total).toBe(2);
    expect(filterCold(ROWS, { ...DEFAULT_FILTERS, q: 'dallas country' }).total).toBe(0);
  });

  it('filters by region', () => {
    expect(filterCold(ROWS, { ...DEFAULT_FILTERS, region: 'East' }).total).toBe(2);
    expect(filterCold(ROWS, { ...DEFAULT_FILTERS, region: 'West' }).total).toBe(1);
  });

  it('filters by whether anybody is on file — the 128-club question', () => {
    expect(filterCold(ROWS, { ...DEFAULT_FILTERS, hasContact: 'no' }).rows.map((r) => r.name)).toEqual([
      'Baltimore Country Club',
    ]);
    expect(filterCold(ROWS, { ...DEFAULT_FILTERS, hasContact: 'yes' }).total).toBe(3);
  });

  it('combines filters', () => {
    const p = filterCold(ROWS, { ...DEFAULT_FILTERS, region: 'East', hasContact: 'no' });
    expect(p.rows.map((r) => r.name)).toEqual(['Baltimore Country Club']);
  });

  it('sorts by contact count, most first', () => {
    const p = filterCold(ROWS, { ...DEFAULT_FILTERS, sort: 'contacts' });
    expect(p.rows.map((r) => r.contact_count)).toEqual([5, 2, 1, 0]);
  });

  it('sorts by last touch, never-touched last', () => {
    const rows = [
      row({ name: 'Never' }),
      row({ name: 'Old', last_activity_at: '2026-01-01T00:00:00Z' }),
      row({ name: 'Recent', last_activity_at: '2026-09-01T00:00:00Z' }),
    ];
    expect(filterCold(rows, { ...DEFAULT_FILTERS, sort: 'touched' }).rows.map((r) => r.name)).toEqual([
      'Recent',
      'Old',
      'Never',
    ]);
  });

  it('pages at fifty and never returns the whole list at once', () => {
    const many = Array.from({ length: 519 }, (_, i) =>
      row({ name: `Club ${String(i).padStart(3, '0')}`, id: `id-${i}` }),
    );
    const first = filterCold(many, DEFAULT_FILTERS);
    expect(first.rows).toHaveLength(PAGE_SIZE);
    expect(first.total).toBe(519);
    expect(first.pageCount).toBe(11);
    expect(first.rows[0].name).toBe('Club 000');

    const last = filterCold(many, { ...DEFAULT_FILTERS, page: 10 });
    expect(last.rows).toHaveLength(19);
    expect(last.rows[0].name).toBe('Club 500');
  });

  it('clamps a page that is past the end rather than showing nothing', () => {
    const p = filterCold(ROWS, { ...DEFAULT_FILTERS, page: 99 });
    expect(p.page).toBe(0);
    expect(p.rows).toHaveLength(4);
  });

  it('hands back every matching id, not just this page, so select-all means all', () => {
    const many = Array.from({ length: 120 }, (_, i) => row({ name: `C${i}`, id: `id-${i}` }));
    const p = filterCold(many, DEFAULT_FILTERS);
    expect(p.rows).toHaveLength(50);
    expect(p.matchedIds).toHaveLength(120);
  });

  it('matches nothing for a search with no hits', () => {
    const p = filterCold(ROWS, { ...DEFAULT_FILTERS, q: 'sleepy hollow' });
    expect(p.total).toBe(0);
    expect(p.rows).toEqual([]);
    expect(p.pageCount).toBe(1);
  });
});

describe('coerceFilters', () => {
  it('takes a saved shape back', () => {
    const f = coerceFilters({ q: 'orinda', region: 'West', hasContact: 'no', stage: 'contacted', sort: 'contacts', page: 3 });
    expect(f).toEqual({ q: 'orinda', region: 'West', hasContact: 'no', stage: 'contacted', sort: 'contacts', page: 3 });
  });

  it('survives anything localStorage could be holding', () => {
    expect(coerceFilters(null)).toEqual(DEFAULT_FILTERS);
    expect(coerceFilters('nonsense')).toEqual(DEFAULT_FILTERS);
    expect(coerceFilters({ sort: 'by_vibes', hasContact: 'maybe', page: -4 })).toEqual(DEFAULT_FILTERS);
  });

  it('keeps the good fields when one is bad', () => {
    const f = coerceFilters({ region: 'East', sort: 'nope' });
    expect(f.region).toBe('East');
    expect(f.sort).toBe('name');
  });
});

describe('coldSummary', () => {
  it('says how many, and out of how many when filtered', () => {
    expect(coldSummary(519, 519)).toBe('519 clubs');
    expect(coldSummary(32, 519)).toBe('32 of 519 clubs');
    expect(coldSummary(0, 519)).toBe('No clubs match that.');
  });
});
