/**
 * Wait-time board — "how many are in front of me, and how much longer?"
 *
 * Serve Tennis pre-assigns a court to every scheduled match, so a player's
 * wait is not a race against a general pool of courts: it is the queue on
 * THEIR court. That makes the estimate both simpler and more honest —
 * we chain each court's own matches behind whatever is currently on it.
 *
 * Durations come from matches observed finishing today (the feed has a
 * start time but no end time, so the announcer times them itself). Until
 * enough have finished we fall back to a configured default and widen the
 * quoted range to signal that we are still guessing.
 */

import type { NormalisedMatch } from './servetennis';

const MS_PER_MIN = 60_000;

/** Below this many observed matches in a bucket we keep the baseline. */
const MIN_SAMPLE = 3;

/** A match already past its expected length still reads as "about to finish". */
const IMMINENT_MIN = 2;

/**
 * Match length depends on which draw it is in and how deep it is, not on
 * some single tournament-wide average. Consolation matches are shorter
 * throughout, and both draws slow down at the semifinal and final because
 * the remaining players are evenly matched.
 *
 * Baselines from Darrin, who has run this event before. They are only a
 * starting point: once three matches in a bucket have been timed today,
 * the observed median for that bucket takes over.
 */
export type Bucket = 'consolation_early' | 'consolation_late' | 'main_early' | 'main_late';

export const BASELINE_MINUTES: Record<Bucket, number> = {
  consolation_early: 55,
  consolation_late: 60,
  main_early: 95,
  main_late: 100,
};

/**
 * Semifinals and finals in either draw run long — the players are closer.
 *
 * Matched on word boundaries on purpose: "Quarterfinals" ends in "finals",
 * so a naive substring test prices every quarterfinal as a late round and
 * inflates half the board's wait times.
 */
function isLateRound(round: string): boolean {
  return /(?:^|[^a-z])(?:semi-?finals?|finals?)(?:[^a-z]|$)/i.test(round);
}

function isConsolation(structure: string, round: string): boolean {
  // structureName is authoritative ("Consolation"); the C- prefix on the
  // round name is the fallback for feeds that omit it.
  return /consolation/i.test(structure) || /^C-/i.test(round.trim());
}

export function bucketOf(m: Pick<NormalisedMatch, 'structure' | 'round'>): Bucket {
  const consolation = isConsolation(m.structure, m.round);
  const late = isLateRound(m.round);
  if (consolation) return late ? 'consolation_late' : 'consolation_early';
  return late ? 'main_late' : 'main_early';
}

/** One timed match, tagged with the bucket it belonged to. */
export interface Observation { bucket: Bucket; minutes: number }

export interface WaitRow {
  id: string;
  court: string | null;
  event: string;
  round: string;
  playerA: string;
  playerB: string;
  scheduledTime: string | null;
  /** Matches ahead of this one on its own court. 0 = on next. */
  ahead: number;
  etaLowMin: number;
  etaHighMin: number;
}

export interface CourtRow {
  court: string;
  playerA: string;
  playerB: string;
  event: string;
  round: string;
  startedAt: string | null;
  elapsedMin: number | null;
}

export interface WaitBoard {
  onCourt: CourtRow[];
  waiting: WaitRow[];
  /** Expected length per bucket, after any learning from today's play. */
  expectedMinutes: Record<Bucket, number>;
  sampleSize: number;
  provisional: boolean;
  generatedAt: string;
}

export interface WaitOptions {
  /** Matches timed today, tagged by bucket. */
  observations: Observation[];
  /** Restrict to one play date, so tomorrow's matches don't appear as waits. */
  onDate?: string;
  now?: Date;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** "HH:MM" today -> ms. Returns null for anything unparseable. */
function timeMs(hhmm: string | null, now: Date): number | null {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(':').map(Number);
  if (Number.isNaN(h)) return null;
  const d = new Date(now);
  d.setHours(h, m || 0, 0, 0);
  return d.getTime();
}

const round5 = (n: number) => Math.max(0, Math.round(n / 5) * 5);

export function computeWaitBoard(live: NormalisedMatch[], opts: WaitOptions): WaitBoard {
  const now = opts.now ?? new Date();
  const nowMs = now.getTime();

  // Per-bucket expected length: observed median once we have enough of that
  // kind of match today, otherwise Darrin's baseline for it.
  const byBucket = new Map<Bucket, number[]>();
  for (const o of opts.observations) {
    if (o.minutes < 10 || o.minutes > 300) continue;
    const arr = byBucket.get(o.bucket) ?? [];
    arr.push(o.minutes);
    byBucket.set(o.bucket, arr);
  }

  const expected = (b: Bucket): number => {
    const arr = (byBucket.get(b) ?? []).slice().sort((x, y) => x - y);
    return arr.length >= MIN_SAMPLE ? Math.round(quantile(arr, 0.5)) : BASELINE_MINUTES[b];
  };
  const expectedFor = (m: Pick<NormalisedMatch, 'structure' | 'round'>) => expected(bucketOf(m));

  const allObs = opts.observations
    .filter((o) => o.minutes >= 10 && o.minutes <= 300)
    .map((o) => o.minutes)
    .sort((a, b) => a - b);
  const sampleSize = allObs.length;
  const provisional = sampleSize < MIN_SAMPLE;

  // Spread around each estimate. Observed quartiles once we have them, and
  // a deliberately generous band before that so nobody reads a baseline as
  // a promise.
  const centre = allObs.length ? quantile(allObs, 0.5) || 1 : 1;
  const lowRatio = provisional ? 0.85 : Math.min(1, quantile(allObs, 0.25) / centre);
  const highRatio = provisional ? 1.3 : Math.max(1, quantile(allObs, 0.75) / centre);

  const forDate = (m: NormalisedMatch) => !opts.onDate || m.scheduledDate === opts.onDate;

  const playing = live.filter((m) => m.status === 'IN_PROGRESS');
  const queued = live
    .filter((m) => m.status !== 'IN_PROGRESS' && forDate(m))
    .sort((a, b) => (a.scheduledTime ?? '99:99').localeCompare(b.scheduledTime ?? '99:99'));

  // When each court is expected to free up.
  const freeAt = new Map<string, number>();
  const onCourt: CourtRow[] = [];

  for (const m of playing) {
    const court = m.court ?? '—';
    const startMs = timeMs(m.startTime, now);
    const predicted = (startMs ?? nowMs) + expectedFor(m) * MS_PER_MIN;
    freeAt.set(court, Math.max(predicted, nowMs + IMMINENT_MIN * MS_PER_MIN));
    onCourt.push({
      court,
      playerA: m.playerA,
      playerB: m.playerB,
      event: m.event,
      round: m.round,
      startedAt: m.startTime,
      elapsedMin: startMs === null ? null : Math.max(0, Math.round((nowMs - startMs) / MS_PER_MIN)),
    });
  }
  onCourt.sort((a, b) => a.court.localeCompare(b.court, undefined, { numeric: true }));

  // How many are already stacked on each court, so "3 ahead of you" counts
  // the match being played as well as the ones queued in front.
  const aheadOn = new Map<string, number>();
  for (const m of playing) aheadOn.set(m.court ?? '—', 1);

  const waiting: WaitRow[] = queued.map((m) => {
    const court = m.court;
    const key = court ?? '—';

    // A court nobody is on is free now; one we've never seen is free now too.
    const base = freeAt.get(key) ?? nowMs;
    // Never promise earlier than the published start time.
    const scheduled = timeMs(m.scheduledTime, now);
    const startsAt = Math.max(base, scheduled ?? 0, nowMs);

    freeAt.set(key, startsAt + expectedFor(m) * MS_PER_MIN);
    const ahead = aheadOn.get(key) ?? 0;
    aheadOn.set(key, ahead + 1);

    const waitMin = (startsAt - nowMs) / MS_PER_MIN;
    return {
      id: m.id,
      court,
      event: m.event,
      round: m.round,
      playerA: m.playerA,
      playerB: m.playerB,
      scheduledTime: m.scheduledTime,
      ahead,
      etaLowMin: round5(waitMin * lowRatio),
      etaHighMin: Math.max(5, round5(waitMin * highRatio)),
    };
  });

  return {
    onCourt,
    waiting,
    expectedMinutes: {
      consolation_early: expected('consolation_early'),
      consolation_late: expected('consolation_late'),
      main_early: expected('main_early'),
      main_late: expected('main_late'),
    },
    sampleSize,
    provisional,
    generatedAt: now.toISOString(),
  };
}

/** "~45–70 min" / "Next up" / "On now" — one wording everywhere. */
export function formatWait(low: number, high: number): string {
  if (high <= 5) return 'Next up';
  if (low <= 0) return `under ${high} min`;
  if (low === high) return `~${low} min`;
  return `~${low}–${high} min`;
}

export function formatAhead(ahead: number): string {
  if (ahead <= 0) return 'On next';
  if (ahead === 1) return '1 match ahead';
  return `${ahead} matches ahead`;
}

/** Everything a player needs, found by typing part of their name. */
export function findPlayer(board: WaitBoard, query: string) {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return null;
  const hit = (a: string, b: string) => a.toLowerCase().includes(q) || b.toLowerCase().includes(q);

  const playing = board.onCourt.find((r) => hit(r.playerA, r.playerB));
  if (playing) return { kind: 'on_court' as const, row: playing };

  const wait = board.waiting.find((r) => hit(r.playerA, r.playerB));
  if (wait) return { kind: 'waiting' as const, row: wait };

  return { kind: 'not_found' as const };
}
