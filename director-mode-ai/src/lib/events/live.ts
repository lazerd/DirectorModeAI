/**
 * Is this actually live, or is it just still flagged that way?
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


/* ============================================================ leagues ==== */

/**
 * A league is the one thing here with honest dates.
 *
 * `leagues` carries start_date and end_date, so "is it on" is knowable rather
 * than inferred from a status somebody forgot to change — and it needs to be.
 * Of six leagues in the database, four were still flagged 'running' with end
 * dates in July and August; exactly one was actually on.
 *
 * A league can be underway AND still taking entries, which is normal for a
 * flex format. Underway wins, because that is the more urgent fact.
 */
export type LeagueCandidate = {
  status: string;
  startsIn: number | null;
  endsIn: number | null;
  registrationOpensIn: number | null;
  registrationClosesIn: number | null;
};

export function leaguePhase(l: LeagueCandidate): LivePhase | null {
  // Over is over, whatever the status column still says.
  if (l.endsIn !== null && l.endsIn < -RUNNING_GRACE_DAYS) return null;

  // Under way: it has started and has not finished.
  if (l.startsIn !== null && l.startsIn <= 0) return 'live';

  // Not started, but taking entries. A null open date on an 'open' league means
  // entries are already being taken — that is how the flex leagues are set up.
  const registrationStarted =
    l.registrationOpensIn === null ? l.status === 'open' : l.registrationOpensIn <= 0;
  const registrationEnded = l.registrationClosesIn !== null && l.registrationClosesIn < 0;
  if (registrationStarted && !registrationEnded) return 'signup';

  return null;
}

/* =========================================================== classes ==== */

/**
 * A class only earns a place in the bar while it is TAKING SIGN-UPS.
 *
 * A class already running does not need a link at the top of every screen —
 * the director knows about it, and a club with ten of them would fill the bar
 * with things needing no attention. What is worth surfacing is the one people
 * can still join.
 */
export type ClassCandidate = {
  status: string;
  registrationMode: string;
  startsIn: number | null;
  endsIn: number | null;
  registrationOpensIn: number | null;
  registrationClosesIn: number | null;
};

export function classPhase(c: ClassCandidate): LivePhase | null {
  if (c.status !== 'published') return null;
  if (c.registrationMode !== 'online') return null;
  // Finished, or already begun — neither is something to promote.
  if (c.endsIn !== null && c.endsIn < 0) return null;
  if (c.startsIn !== null && c.startsIn < 0) return null;
  if (c.registrationOpensIn !== null && c.registrationOpensIn > 0) return null;
  if (c.registrationClosesIn !== null && c.registrationClosesIn < 0) return null;
  return 'signup';
}

/* ============================================================= sorting === */

export type LiveKind = 'event' | 'league' | 'class';

/**
 * What to show first.
 *
 * Under way before upcoming, because something happening today is the thing a
 * director might have to walk out and deal with. Within a phase, soonest
 * first; classes last, since a sign-up window open for weeks is never the most
 * urgent row on the bar.
 */
export function compareItems(
  a: { phase: LivePhase; daysAway: number | null; kind: LiveKind },
  b: { phase: LivePhase; daysAway: number | null; kind: LiveKind },
): number {
  if (a.phase !== b.phase) return a.phase === 'live' ? -1 : 1;
  const rank = (k: LiveKind) => (k === 'class' ? 1 : 0);
  if (rank(a.kind) !== rank(b.kind)) return rank(a.kind) - rank(b.kind);
  return (a.daysAway ?? 9999) - (b.daysAway ?? 9999);
}
