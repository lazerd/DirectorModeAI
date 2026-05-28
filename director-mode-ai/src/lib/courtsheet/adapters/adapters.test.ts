/**
 * Adapter tests — focused on the pure helpers (label resolution, time
 * math). The DB-touching code paths are covered indirectly via the
 * Phase 1 engine tests + the (opt-in) constraint integration test.
 */

import { describe, it, expect } from 'vitest';

// Lift the internal label resolver out for testing.
function resolveCourtLabels(event: {
  court_names: string[] | null;
  num_courts: number | null;
}): Array<string | number> {
  if (event.court_names && event.court_names.length > 0) return event.court_names;
  if (event.num_courts && event.num_courts > 0) {
    return Array.from({ length: event.num_courts }, (_, i) => i + 1);
  }
  return [];
}

describe('resolveCourtLabels', () => {
  it('prefers court_names when set', () => {
    expect(
      resolveCourtLabels({ court_names: ['1', '2', 'Stadium'], num_courts: 8 })
    ).toEqual(['1', '2', 'Stadium']);
  });
  it('falls back to numbered courts from num_courts', () => {
    expect(resolveCourtLabels({ court_names: null, num_courts: 4 })).toEqual([1, 2, 3, 4]);
  });
  it('falls back when court_names is empty', () => {
    expect(resolveCourtLabels({ court_names: [], num_courts: 3 })).toEqual([1, 2, 3]);
  });
  it('returns empty when neither is set', () => {
    expect(resolveCourtLabels({ court_names: null, num_courts: null })).toEqual([]);
    expect(resolveCourtLabels({ court_names: null, num_courts: 0 })).toEqual([]);
  });
});

function addHours(hhmm: string, hours: number): string {
  const [h, m] = hhmm.split(':').map((s) => parseInt(s, 10));
  const total = h * 60 + (m || 0) + hours * 60;
  const hh = Math.floor(total / 60) % 24;
  const mm = total % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

describe('addHours (default-end-time helper)', () => {
  it('adds whole hours', () => {
    expect(addHours('09:00', 4)).toBe('13:00');
    expect(addHours('20:00', 2)).toBe('22:00');
  });
  it('wraps across midnight (modular)', () => {
    expect(addHours('22:00', 4)).toBe('02:00');
  });
  it('handles HH:MM with non-zero minutes', () => {
    expect(addHours('08:30', 1)).toBe('09:30');
    expect(addHours('11:45', 2)).toBe('13:45');
  });
});

describe('ADAPTERS_ENABLED env flag', () => {
  it('is off by default in test env', async () => {
    // We don't set ENABLE_COURTSHEET_WRITES in tests.
    delete process.env.ENABLE_COURTSHEET_WRITES;
    // Re-import so the const re-reads — but consts are evaluated at module load.
    // The flag is a one-shot read; this test documents the contract.
    const { ADAPTERS_ENABLED } = await import('./common');
    expect(ADAPTERS_ENABLED).toBe(false);
  });
});
