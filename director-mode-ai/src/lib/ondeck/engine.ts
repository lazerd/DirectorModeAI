/**
 * On Deck — court queue + wait-time engine.
 *
 * Answers the only two questions a tournament desk gets asked:
 *   "how many are in front of me?"  → aheadCount
 *   "how much longer?"              → etaLowMin .. etaHighMin
 *
 * The ETA is simulated, not guessed. We take the matches actually finished
 * at THIS site TODAY, measure how long they really took, then walk the
 * waiting line down onto whichever court frees up first. Before enough
 * matches have finished we fall back to the event's configured match
 * length, and we widen the range to signal that we're still guessing.
 *
 * Deliberately pure: no DB, no clock reads except the `now` you pass in,
 * so it can be unit-tested and so the board and the SMS pager compute
 * identical numbers from the same snapshot.
 */

export type QueueStatus =
  | 'waiting'
  | 'on_deck'
  | 'on_court'
  | 'completed'
  | 'bumped'
  | 'withdrawn';

export interface QueueRow {
  id: string;
  division: string;
  round_label: string | null;
  player_a: string;
  player_b: string;
  court: string | null;
  status: QueueStatus;
  queue_position: number;
  called_at: string | null;
  court_assigned_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  bumped_count: number;
}

export interface BoardRow extends QueueRow {
  /** Matches that must go on before this one. 0 = you're next. */
  aheadCount: number;
  /** Wait range in minutes. Null for matches already on court. */
  etaLowMin: number | null;
  etaHighMin: number | null;
  /** Which court we predict they'll land on. Advisory only — never shown as a promise. */
  predictedCourt: string | null;
  /** Minutes since this match started. Only for on_court. */
  elapsedMin: number | null;
  /** True once a page has gone out. */
  called: boolean;
}

export interface Board {
  onCourt: BoardRow[];
  onDeck: BoardRow[];
  waiting: BoardRow[];
  /** Median observed match length driving the estimates. */
  medianMin: number;
  /** How many finished matches fed that median. <3 means we're still on the default. */
  sampleSize: number;
  /** True while estimates are based on the configured default, not observation. */
  provisional: boolean;
  generatedAt: string;
}

const MS_PER_MIN = 60_000;

function minutesBetween(a: string, b: string): number {
  return (new Date(b).getTime() - new Date(a).getTime()) / MS_PER_MIN;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * Observed durations from matches that both started and finished. A match
 * someone forgot to press Start on has no duration and is skipped rather
 * than counted as zero — one missed tap must not drag the median down.
 */
function observedDurations(rows: QueueRow[]): number[] {
  return rows
    .filter((r) => r.status === 'completed' && r.started_at && r.completed_at)
    .map((r) => minutesBetween(r.started_at!, r.completed_at!))
    // Guard against a mis-tap producing a 2-minute or 6-hour "match".
    .filter((m) => m >= 10 && m <= 300)
    .sort((a, b) => a - b);
}

/**
 * Minimum sample before we trust observation over the configured default.
 * Three is enough to beat a guess and small enough to kick in by mid-morning.
 */
const MIN_SAMPLE = 3;

export interface ComputeOptions {
  /** Court names available today. This is capacity, never a quota. */
  courts: string[];
  /** Event's configured match length, used until real matches finish. */
  defaultMatchMinutes: number;
  now?: Date;
}

export function computeBoard(rows: QueueRow[], opts: ComputeOptions): Board {
  const now = opts.now ?? new Date();
  const nowMs = now.getTime();

  const durations = observedDurations(rows);
  const sampleSize = durations.length;
  const provisional = sampleSize < MIN_SAMPLE;

  const medianMin = provisional
    ? opts.defaultMatchMinutes
    : Math.round(quantile(durations, 0.5));

  // Spread for the range. With real data we use the observed quartiles; a
  // wide observed spread honestly produces a wide quote. Without data we
  // apply a deliberately generous band so nobody treats it as a promise.
  const lowMin = provisional
    ? opts.defaultMatchMinutes * 0.8
    : quantile(durations, 0.25);
  const highMin = provisional
    ? opts.defaultMatchMinutes * 1.35
    : quantile(durations, 0.75);

  const onCourt = rows
    .filter((r) => r.status === 'on_court')
    .sort((a, b) => (a.court ?? '').localeCompare(b.court ?? '', undefined, { numeric: true }));
  const onDeck = rows
    .filter((r) => r.status === 'on_deck')
    .sort((a, b) => a.queue_position - b.queue_position);
  const waiting = rows
    .filter((r) => r.status === 'waiting')
    .sort((a, b) => a.queue_position - b.queue_position);

  // --- Simulate court availability -------------------------------------
  // Each court gets the moment it is expected to free up, in ms. A court
  // with nobody on it is free now. A court running a match is free at
  // start + median, but never in the past: a match already past the median
  // is treated as finishing imminently rather than "5 minutes ago".
  const freeAt = new Map<string, number>();
  for (const court of opts.courts) freeAt.set(court, nowMs);

  for (const r of onCourt) {
    if (!r.court) continue;
    const startedMs = r.started_at ? new Date(r.started_at).getTime() : nowMs;
    const predictedEnd = startedMs + medianMin * MS_PER_MIN;
    freeAt.set(r.court, Math.max(predictedEnd, nowMs + 2 * MS_PER_MIN));
  }

  // On-deck matches have already claimed a court; they consume the next slot.
  const claim = (court: string | null): { court: string; at: number } => {
    if (court && freeAt.has(court)) {
      const at = freeAt.get(court)!;
      freeAt.set(court, at + medianMin * MS_PER_MIN);
      return { court, at };
    }
    // Earliest-freeing court wins.
    let bestCourt = opts.courts[0] ?? '—';
    let bestAt = Number.POSITIVE_INFINITY;
    for (const [c, at] of freeAt) {
      if (at < bestAt) { bestAt = at; bestCourt = c; }
    }
    if (!Number.isFinite(bestAt)) bestAt = nowMs;
    freeAt.set(bestCourt, bestAt + medianMin * MS_PER_MIN);
    return { court: bestCourt, at: bestAt };
  };

  const decorate = (r: QueueRow, aheadCount: number, predicted: { court: string; at: number } | null): BoardRow => {
    const waitMs = predicted ? Math.max(0, predicted.at - nowMs) : 0;
    const waitMin = waitMs / MS_PER_MIN;
    // Scale the point estimate by the low/high duration ratio so the band
    // widens the further down the line you are — which is the truth.
    const ratioLow = medianMin > 0 ? lowMin / medianMin : 0.8;
    const ratioHigh = medianMin > 0 ? highMin / medianMin : 1.35;
    return {
      ...r,
      aheadCount,
      etaLowMin: predicted ? Math.max(0, Math.round((waitMin * ratioLow) / 5) * 5) : null,
      etaHighMin: predicted ? Math.max(5, Math.round((waitMin * ratioHigh) / 5) * 5) : null,
      predictedCourt: predicted?.court ?? null,
      elapsedMin: r.started_at ? Math.round(minutesBetween(r.started_at, now.toISOString())) : null,
      called: Boolean(r.called_at),
    };
  };

  const onDeckOut = onDeck.map((r) => decorate(r, 0, claim(r.court)));

  // Everyone on court or on deck is "ahead" of the first waiting match.
  const baseAhead = onDeck.length;
  const waitingOut = waiting.map((r, i) => decorate(r, baseAhead + i, claim(null)));

  const onCourtOut = onCourt.map((r) => decorate(r, 0, null));

  return {
    onCourt: onCourtOut,
    onDeck: onDeckOut,
    waiting: waitingOut,
    medianMin,
    sampleSize,
    provisional,
    generatedAt: now.toISOString(),
  };
}

/** "~45–70 min" / "~10 min" / "Next up" — one place so board and SMS agree. */
export function formatEta(low: number | null, high: number | null): string {
  if (low === null || high === null) return '';
  if (high <= 5) return 'Next up';
  if (low === high) return `~${low} min`;
  if (low === 0) return `under ${high} min`;
  return `~${low}–${high} min`;
}

/** "3 matches ahead" / "You're next" — same wording everywhere. */
export function formatAhead(aheadCount: number): string {
  if (aheadCount <= 0) return "You're next";
  if (aheadCount === 1) return '1 match ahead';
  return `${aheadCount} matches ahead`;
}

/**
 * Sparse positions (10, 20, 30…) so moving one match is a single UPDATE
 * rather than renumbering everything behind it.
 */
export const POSITION_STEP = 10;

export function nextPosition(rows: Pick<QueueRow, 'queue_position'>[]): number {
  const max = rows.reduce((m, r) => Math.max(m, r.queue_position), 0);
  return max + POSITION_STEP;
}

/**
 * Position that drops a bumped match `slots` places down the waiting line.
 * Returns a value strictly between its new neighbours so no renumbering is
 * needed. A kid who isn't there yet goes behind the next two matches, not
 * to the back of the draw — they've usually just wandered to the snack bar.
 */
export function bumpedPosition(
  waitingSorted: Pick<QueueRow, 'queue_position'>[],
  currentPosition: number,
  slots = 2
): number {
  const after = waitingSorted.filter((r) => r.queue_position > currentPosition);
  if (after.length === 0) return currentPosition + POSITION_STEP;
  const target = Math.min(slots, after.length) - 1;
  const anchor = after[target].queue_position;
  const beyond = after[target + 1]?.queue_position;
  return beyond === undefined ? anchor + POSITION_STEP : (anchor + beyond) / 2;
}
