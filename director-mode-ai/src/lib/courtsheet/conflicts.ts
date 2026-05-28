/**
 * CourtSheet AI — conflict detection.
 *
 * Pure function: given a set of candidate ReservationInstances + the
 * existing non-cancelled reservations in the affected window, return
 * every overlap, including candidates that collide with each other.
 *
 * Set-based, not loops of single lookups. For a 264-instance preview the
 * planner does ONE existing-rows query (by club + time window) and feeds
 * it here.
 */

import type {
  Reservation,
  ReservationInstance,
  Conflict,
  Court,
} from './types';

export interface DetectInput {
  candidates: ReservationInstance[];
  existing: Reservation[];
  courts: Court[];
}

export function detectConflicts(input: DetectInput): Conflict[] {
  const { candidates, existing, courts } = input;
  const conflicts: Conflict[] = [];

  const courtLabel = (id: string): string => {
    const c = courts.find((cc) => cc.id === id);
    if (!c) return '?';
    return c.name ?? `Court ${c.number}`;
  };

  // 1) Existing vs candidate.
  // Index existing by court_id for O(c × e_per_court) instead of O(c × e).
  const existingByCourt = new Map<string, Reservation[]>();
  for (const r of existing) {
    if (r.status === 'cancelled') continue;
    const arr = existingByCourt.get(r.court_id) ?? [];
    arr.push(r);
    existingByCourt.set(r.court_id, arr);
  }

  for (const cand of candidates) {
    const list = existingByCourt.get(cand.court_id) ?? [];
    for (const r of list) {
      if (overlaps(cand.starts_at, cand.ends_at, r.starts_at, r.ends_at)) {
        conflicts.push({
          candidate: {
            court_id: cand.court_id,
            court_label: courtLabel(cand.court_id),
            starts_at: cand.starts_at,
            ends_at: cand.ends_at,
            title: cand.title,
          },
          against: {
            kind: 'existing',
            reservation_id: r.id,
            title: r.title,
            starts_at: r.starts_at,
            ends_at: r.ends_at,
            source: r.source,
          },
        });
      }
    }
  }

  // 2) Candidate vs candidate (same-batch self-collisions).
  // Group by court_id first; only same-court candidates can collide.
  const candByCourt = new Map<string, ReservationInstance[]>();
  for (const c of candidates) {
    const arr = candByCourt.get(c.court_id) ?? [];
    arr.push(c);
    candByCourt.set(c.court_id, arr);
  }

  for (const [court_id, list] of candByCourt) {
    if (list.length < 2) continue;
    // Sort by start so we only check adjacent pairs.
    const sorted = list.slice().sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i];
      const b = sorted[i + 1];
      if (overlaps(a.starts_at, a.ends_at, b.starts_at, b.ends_at)) {
        conflicts.push({
          candidate: {
            court_id: b.court_id,
            court_label: courtLabel(b.court_id),
            starts_at: b.starts_at,
            ends_at: b.ends_at,
            title: b.title,
          },
          against: {
            kind: 'same-batch',
            court_id: a.court_id,
            starts_at: a.starts_at,
            ends_at: a.ends_at,
          },
        });
      }
    }
  }

  return conflicts;
}

/** Half-open interval overlap: [aStart, aEnd) ∩ [bStart, bEnd). */
function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart < bEnd && bStart < aEnd;
}
