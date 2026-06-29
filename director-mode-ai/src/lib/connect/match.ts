import { milesBetween } from '@/lib/geo';

// ClubMode Connect matching engine. Pure + testable: no DB, no I/O. The API
// routes load candidates / openings, call these, and persist the edges.

export type Candidate = {
  id: string;
  dept: string;
  current_comp: number;
  min_comp: number | null;
  home_lat: number | null;
  home_lng: number | null;
  radius_miles: number | null;
  open_to_work: boolean;
};

export type Opening = {
  id: string;
  dept: string;
  comp_max: number;
  lat: number | null;
  lng: number | null;
  status?: string;
};

export type MatchEdge = {
  opening_id: string;
  candidate_id: string;
  comp_delta: number;
  distance_miles: number;
  score: number;
};

const DEFAULT_RADIUS = 50;

/** The floor a job must clear to interest this candidate. */
function floorFor(c: Candidate): number {
  return c.min_comp ?? c.current_comp;
}

/**
 * Does this (opening, candidate) pair qualify as a match? All must hold:
 *   - candidate is open to work
 *   - same department
 *   - the offer (comp_max) beats the candidate's comp floor
 *   - the opening is within the candidate's relocation radius
 * Returns the scored edge, or null if not a match.
 */
export function evaluate(opening: Opening, candidate: Candidate): MatchEdge | null {
  if (!candidate.open_to_work) return null;
  if (candidate.dept !== opening.dept) return null;

  const floor = floorFor(candidate);
  if (opening.comp_max < floor) return null;

  if (
    opening.lat == null ||
    opening.lng == null ||
    candidate.home_lat == null ||
    candidate.home_lng == null
  ) {
    return null;
  }

  const radius = candidate.radius_miles ?? DEFAULT_RADIUS;
  const distance = milesBetween(
    candidate.home_lat,
    candidate.home_lng,
    opening.lat,
    opening.lng
  );
  if (distance > radius) return null;

  const comp_delta = opening.comp_max - candidate.current_comp;

  // Score (higher = better): normalized comp upside + a closeness bonus.
  // comp_delta scaled by $100k so a $50k bump ~= 0.5; closeness in [0,1].
  const compScore = comp_delta / 100_000;
  const closeness = radius > 0 ? 1 - distance / radius : 0;
  const score = compScore + closeness;

  return {
    opening_id: opening.id,
    candidate_id: candidate.id,
    comp_delta,
    distance_miles: Math.round(distance * 10) / 10,
    score: Math.round(score * 1000) / 1000,
  };
}

/** All candidates that match a given opening, best first. */
export function findMatchesForOpening(
  opening: Opening,
  candidates: Candidate[]
): MatchEdge[] {
  return candidates
    .map((c) => evaluate(opening, c))
    .filter((e): e is MatchEdge => e !== null)
    .sort((a, b) => b.score - a.score);
}

/** All open openings that match a given candidate, best first. */
export function findMatchesForCandidate(
  candidate: Candidate,
  openings: Opening[]
): MatchEdge[] {
  return openings
    .filter((o) => (o.status ?? 'open') === 'open')
    .map((o) => evaluate(o, candidate))
    .filter((e): e is MatchEdge => e !== null)
    .sort((a, b) => b.score - a.score);
}
