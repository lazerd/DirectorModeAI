import { describe, it, expect } from 'vitest';
import { detectConflicts } from './conflicts';
import type { Court, Reservation, ReservationInstance } from './types';

function court(id: string, number: number): Court {
  return {
    id,
    club_id: 'c1',
    number,
    name: null,
    sports: ['tennis'],
    surface: 'hard',
    indoor: false,
    status: 'active',
    display_order: number,
  };
}

function existing(
  id: string,
  court_id: string,
  starts: string,
  ends: string,
  status: Reservation['status'] = 'confirmed'
): Reservation {
  return {
    id,
    club_id: 'c1',
    court_id,
    series_id: null,
    starts_at: starts,
    ends_at: ends,
    type: 'lesson',
    source: 'lessons',
    source_id: null,
    title: 'existing',
    status,
    color: null,
    signups_open: false,
    signups_capacity: null,
    signups_pitch: null,
    meta: {},
    created_by: 'u1',
    created_at: starts,
    updated_at: starts,
  };
}

function candidate(court_id: string, starts: string, ends: string, title = 'new'): ReservationInstance {
  return {
    court_id,
    starts_at: starts,
    ends_at: ends,
    type: 'camp',
    title,
    meta: {},
    color: null,
    signups_open: false,
    signups_capacity: null,
    signups_pitch: null,
  };
}

const courts = [court('court-1', 1), court('court-2', 2)];

describe('detectConflicts — existing vs candidate', () => {
  it('flags an overlap on the same court', () => {
    const conflicts = detectConflicts({
      candidates: [candidate('court-1', '2026-06-15T16:00:00Z', '2026-06-15T17:00:00Z')],
      existing: [existing('e1', 'court-1', '2026-06-15T16:30:00Z', '2026-06-15T17:30:00Z')],
      courts,
    });
    expect(conflicts.length).toBe(1);
    expect(conflicts[0].against.kind).toBe('existing');
  });

  it('does NOT flag touching intervals (half-open)', () => {
    const conflicts = detectConflicts({
      candidates: [candidate('court-1', '2026-06-15T16:00:00Z', '2026-06-15T17:00:00Z')],
      existing: [existing('e1', 'court-1', '2026-06-15T17:00:00Z', '2026-06-15T18:00:00Z')],
      courts,
    });
    expect(conflicts.length).toBe(0);
  });

  it('does NOT flag overlaps on a different court', () => {
    const conflicts = detectConflicts({
      candidates: [candidate('court-1', '2026-06-15T16:00:00Z', '2026-06-15T17:00:00Z')],
      existing: [existing('e1', 'court-2', '2026-06-15T16:00:00Z', '2026-06-15T17:00:00Z')],
      courts,
    });
    expect(conflicts.length).toBe(0);
  });

  it('ignores cancelled existing rows', () => {
    const conflicts = detectConflicts({
      candidates: [candidate('court-1', '2026-06-15T16:00:00Z', '2026-06-15T17:00:00Z')],
      existing: [existing('e1', 'court-1', '2026-06-15T16:00:00Z', '2026-06-15T17:00:00Z', 'cancelled')],
      courts,
    });
    expect(conflicts.length).toBe(0);
  });
});

describe('detectConflicts — candidate vs candidate', () => {
  it('flags two overlapping candidates on the same court', () => {
    const conflicts = detectConflicts({
      candidates: [
        candidate('court-1', '2026-06-15T16:00:00Z', '2026-06-15T17:00:00Z', 'a'),
        candidate('court-1', '2026-06-15T16:30:00Z', '2026-06-15T17:30:00Z', 'b'),
      ],
      existing: [],
      courts,
    });
    expect(conflicts.length).toBe(1);
    expect(conflicts[0].against.kind).toBe('same-batch');
  });

  it('does NOT flag non-overlapping candidates on the same court', () => {
    const conflicts = detectConflicts({
      candidates: [
        candidate('court-1', '2026-06-15T16:00:00Z', '2026-06-15T17:00:00Z', 'a'),
        candidate('court-1', '2026-06-15T17:00:00Z', '2026-06-15T18:00:00Z', 'b'),
      ],
      existing: [],
      courts,
    });
    expect(conflicts.length).toBe(0);
  });
});

describe('detectConflicts — court label resolution', () => {
  it('includes the court label in the conflict for nicer error messages', () => {
    const conflicts = detectConflicts({
      candidates: [candidate('court-1', '2026-06-15T16:00:00Z', '2026-06-15T17:00:00Z')],
      existing: [existing('e1', 'court-1', '2026-06-15T16:30:00Z', '2026-06-15T17:30:00Z')],
      courts,
    });
    expect(conflicts[0].candidate.court_label).toBe('Court 1');
  });
});
