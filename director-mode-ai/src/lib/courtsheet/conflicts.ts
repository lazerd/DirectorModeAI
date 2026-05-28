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

  // Pre-compute the block set per court: { court_id → Set<court_id+
  // parent+children> }. Booking court X also blocks parent(X) and any
  // child(X) but NOT siblings of X. Single hop; no grandparents.
  const blockSetByCourt = new Map<string, Set<string>>();
  for (const c of courts) {
    const set = new Set<string>([c.id]);
    if (c.parent_court_id) set.add(c.parent_court_id);
    blockSetByCourt.set(c.id, set);
  }
  // Second pass: add children to each parent's block set.
  for (const c of courts) {
    if (!c.parent_court_id) continue;
    const parentSet = blockSetByCourt.get(c.parent_court_id);
    if (parentSet) parentSet.add(c.id);
  }

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
    const candBlocks = blockSetByCourt.get(cand.court_id) ?? new Set([cand.court_id]);
    for (const blockedCourtId of candBlocks) {
      const list = existingByCourt.get(blockedCourtId) ?? [];
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
  }

  // 2) Candidate vs candidate (same-batch self-collisions).
  // For same court_id: sort by start, check adjacent pairs. For different
  // court_ids in the same block-set (parent vs its child, or vice versa):
  // pairwise check since they can interleave arbitrarily.
  const candByCourt = new Map<string, ReservationInstance[]>();
  for (const c of candidates) {
    const arr = candByCourt.get(c.court_id) ?? [];
    arr.push(c);
    candByCourt.set(c.court_id, arr);
  }

  for (const [court_id, list] of candByCourt) {
    // Same-court adjacent check.
    if (list.length >= 2) {
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

    // Cross-court (group) check: this court's block-set minus self.
    const blockSet = blockSetByCourt.get(court_id);
    if (!blockSet) continue;
    for (const otherCourtId of blockSet) {
      if (otherCourtId === court_id) continue;
      const otherList = candByCourt.get(otherCourtId);
      if (!otherList) continue;
      for (const a of list) {
        for (const b of otherList) {
          // Avoid double-reporting (only count each cross pair once).
          if (a.court_id >= b.court_id) continue;
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
    }
  }

  return conflicts;
}

/** Half-open interval overlap: [aStart, aEnd) ∩ [bStart, bEnd). */
function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart < bEnd && bStart < aEnd;
}
