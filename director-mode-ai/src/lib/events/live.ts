/**
 * Is an event actually live, or is it just still flagged that way?
 *
 * The distinction is the whole value of the "happening now" bar. A real club
 * has events that were run months ago and never closed out — Sleepy Hollow had
 * nine marked 'running', eight of them from two months earlier — so a bar that
 * trusted the flag would show ten rows of which one mattered, and a director
 * would stop reading it on the first day.
 *
 * Pure, and shared by the route and its tests, so the rule cannot drift into
 * two versions that disagree.
 */

/** How long after its date an event may still claim to be underway. */
export const RUNNING_GRACE_DAYS = 2;
/** How far ahead a running event may be dated and still count as underway. */
export const RUNNING_LOOKAHEAD_DAYS = 1;

export type LivePhase = 'signup' | 'live';

export type Candidate = {
  public_status: string;
  /** Days from today to the event's date in club terms; null when undated. */
  daysAway: number | null;
};

export function livePhase(e: Candidate): LivePhase | null {
  if (e.public_status === 'open') {
    // Signing up for something that already happened is not a thing.
    if (e.daysAway !== null && e.daysAway < 0) return null;
    return 'signup';
  }
  if (e.public_status !== 'running') return null;
  // An undated event cannot be judged, and 'running' is the flag most likely
  // to be stale — so no date means not shown.
  if (e.daysAway === null) return null;
  if (e.daysAway > RUNNING_LOOKAHEAD_DAYS || e.daysAway < -RUNNING_GRACE_DAYS) return null;
  return 'live';
}

/** A 'running' event too old to be believed — worth counting, not listing. */
export function isStaleRunning(e: Candidate): boolean {
  return (
    e.public_status === 'running' &&
    e.daysAway !== null &&
    e.daysAway < -RUNNING_GRACE_DAYS
  );
}

/** Whole days from today to a YYYY-MM-DD date, both read at midday UTC. */
export function daysUntil(dateYmd: string | null, todayYmd: string): number | null {
  if (!dateYmd) return null;
  const target = Date.parse(`${dateYmd.slice(0, 10)}T12:00:00Z`);
  const today = Date.parse(`${todayYmd.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(target) || Number.isNaN(today)) return null;
  return Math.round((target - today) / 86_400_000);
}

/** Underway before upcoming, then soonest first. */
export function compareLive(
  a: { phase: LivePhase; daysAway: number | null },
  b: { phase: LivePhase; daysAway: number | null },
): number {
  if (a.phase !== b.phase) return a.phase === 'live' ? -1 : 1;
  return (a.daysAway ?? 9999) - (b.daysAway ?? 9999);
}
