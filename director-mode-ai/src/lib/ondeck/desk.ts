/**
 * The tournament desk, for events that do not assign courts themselves.
 *
 * TopDog publishes an order of play and nothing else: no courts, no start
 * times, no "in progress". So the desk state lives here instead —
 *
 *   assign    a waiting match goes onto a named court, and the clock starts
 *   free      the players report a score, the court opens, the length of
 *             that match is remembered
 *
 * — and everything the public board shows is derived from it. Because the
 * desk knows exactly when each court started, the waits it predicts are
 * better than the Serve Tennis ones, which have to infer a start.
 *
 * The output is the same `WaitBoard` the Serve Tennis announcer publishes,
 * so /tournaments/wait/[slug] and its QR poster work unchanged.
 */

import {
  baselineFor, DEFAULT_LENGTHS, LATE_ROUND_EXTRA_MIN,
  type Bucket, type CourtRow, type MatchLengths, type Observation,
  type WaitBoard, type WaitRow,
} from './board';
import type { TopDogMatch } from './topdog';

const MS_PER_MIN = 60_000;

/** Below this many timed matches in a bucket, keep the director's figure. */
const MIN_SAMPLE = 3;

/** A court already past its expected finish is about to free up, not stuck. */
const IMMINENT_MIN = 2;

/** One court, as the desk sees it. */
export interface Assignment {
  court: string;
  matchId: string;
  /** ISO timestamp of when the players were sent out. */
  startedAt: string;
}

/**
 * TopDog spells rounds its own way: "Semis", "Consol Quarters", "Finals".
 * Word boundaries matter — "Quarters" must not read as a late round.
 */
export function bucketOfTopDog(m: Pick<TopDogMatch, 'round'>): Bucket {
  const round = (m.round ?? '').toLowerCase();
  const consolation = /^consol(ation)?\b/.test(round.trim());
  const late = /(?:^|[^a-z])(?:semis?|semi-?finals?|finals?)(?:[^a-z]|$)/.test(round);
  if (consolation) return late ? 'consolation_late' : 'consolation_early';
  return late ? 'main_late' : 'main_early';
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * What a match in each bucket is actually taking today. The director's
 * numbers hold until enough matches have been timed to beat them; after
 * that, the club's own Saturday is a better predictor than any default.
 */
export function expectedMinutes(
  lengths: MatchLengths,
  observations: Observation[]
): Record<Bucket, number> {
  const buckets: Bucket[] = ['main_early', 'main_late', 'consolation_early', 'consolation_late'];
  const out = {} as Record<Bucket, number>;
  for (const b of buckets) {
    const seen = observations.filter((o) => o.bucket === b).map((o) => o.minutes);
    out[b] = seen.length >= MIN_SAMPLE ? Math.round(median(seen)) : baselineFor(b, lengths);
  }
  return out;
}

/** TopDog's "9/19/2026" -> "2026-09-19". */
export function toIsoDate(topdogDate: string): string | null {
  const m = topdogDate.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

/** "08:00" on the board's day, in ms. */
function slotMs(slot24: string, day: Date): number | null {
  const [h, m] = slot24.split(':').map(Number);
  if (!Number.isFinite(h)) return null;
  const d = new Date(day);
  d.setHours(h, m || 0, 0, 0);
  return d.getTime();
}

function toHHMM(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const round5 = (n: number) => Math.max(0, Math.round(n / 5) * 5);

export interface DeskBoardOptions {
  matches: TopDogMatch[];
  /** Courts the tournament is running, in the order they should be filled. */
  courts: string[];
  assignments: Assignment[];
  /** Matches the desk has already taken a score for. */
  completedIds: string[];
  lengths?: MatchLengths;
  observations?: Observation[];
  /** The day the schedule is for, as TopDog spells it ("9/19/2026"). */
  boardDate: string;
  now?: Date;
}

/**
 * Everything the public board needs, derived from the sheet plus what the
 * desk has done to it.
 */
export function buildDeskBoard(opts: DeskBoardOptions): WaitBoard {
  const now = opts.now ?? new Date();
  const nowMs = now.getTime();
  const lengths = opts.lengths ?? DEFAULT_LENGTHS;
  const observations = opts.observations ?? [];
  const expected = expectedMinutes(lengths, observations);
  const courts = opts.courts.length ? opts.courts : [];

  const done = new Set(opts.completedIds);
  const byId = new Map(opts.matches.map((m) => [m.id, m]));

  // --- what is out there now ---------------------------------------------
  const live = opts.assignments.filter((a) => byId.has(a.matchId) && !done.has(a.matchId));
  const busyMatchIds = new Set(live.map((a) => a.matchId));

  const onCourt: CourtRow[] = live
    .map((a) => {
      const m = byId.get(a.matchId)!;
      const startMs = new Date(a.startedAt).getTime();
      const elapsed = Number.isFinite(startMs) ? Math.round((nowMs - startMs) / MS_PER_MIN) : null;
      return {
        court: a.court,
        playerA: m.playerA,
        playerB: m.playerB,
        event: m.event,
        round: m.round,
        startedAt: Number.isFinite(startMs) ? toHHMM(startMs) : null,
        elapsedMin: elapsed !== null ? Math.max(0, elapsed) : null,
      };
    })
    .sort((a, b) => a.court.localeCompare(b.court, undefined, { numeric: true }));

  // --- when each court comes free ----------------------------------------
  const freeAt = new Map<string, number>();
  for (const court of courts) freeAt.set(court, nowMs);
  for (const a of live) {
    const m = byId.get(a.matchId)!;
    const startMs = new Date(a.startedAt).getTime();
    const predicted = Number.isFinite(startMs)
      ? startMs + expected[bucketOfTopDog(m)] * MS_PER_MIN
      : nowMs + IMMINENT_MIN * MS_PER_MIN;
    // A court that is already over its expected time is nearly free, not
    // free an hour ago — otherwise every wait behind it reads as zero.
    freeAt.set(a.court, Math.max(predicted, nowMs + IMMINENT_MIN * MS_PER_MIN));
  }

  // --- the queue ----------------------------------------------------------
  // Order on the sheet is the order the desk works through: published time
  // first, then the order the draw prints them in.
  const sheetOrder = new Map(opts.matches.map((m, i) => [m.id, i]));
  const queue = opts.matches
    .filter((m) => m.ready && !busyMatchIds.has(m.id) && !done.has(m.id))
    .sort((a, b) =>
      a.slot24 === b.slot24
        ? (sheetOrder.get(a.id)! - sheetOrder.get(b.id)!)
        : a.slot24.localeCompare(b.slot24)
    );

  const day = (() => {
    const iso = toIsoDate(opts.boardDate);
    if (!iso) return now;
    const [y, mo, d] = iso.split('-').map(Number);
    const dt = new Date(now);
    dt.setFullYear(y, mo - 1, d);
    return dt;
  })();

  const aheadOnCourt = new Map<string, number>();
  const waiting: WaitRow[] = [];

  for (const m of queue) {
    const published = slotMs(m.slot24, day);

    // No court running at all: the sheet is the only answer we have.
    if (!courts.length) {
      const startMs = published ?? nowMs;
      const mins = Math.max(0, Math.round((startMs - nowMs) / MS_PER_MIN));
      waiting.push({
        id: m.id, court: null, event: m.event, round: m.round,
        playerA: m.playerA, playerB: m.playerB,
        scheduledTime: m.slot24,
        estimatedStart: toHHMM(startMs),
        ahead: 0,
        etaLowMin: round5(mins), etaHighMin: round5(mins + 15),
        onSchedule: true, isNext: false, delayMin: 0,
      });
      continue;
    }

    // Earliest court wins; ties go to the lowest-numbered court so the desk
    // fills predictably instead of scattering matches across the club.
    let bestCourt = courts[0];
    let bestFree = freeAt.get(courts[0]) ?? nowMs;
    for (const c of courts) {
      const f = freeAt.get(c) ?? nowMs;
      if (f < bestFree) { bestCourt = c; bestFree = f; }
    }

    // A match cannot start before the time it is published for, however
    // empty the club is.
    const startMs = Math.max(bestFree, published ?? bestFree);
    const lengthMin = expected[bucketOfTopDog(m)];
    freeAt.set(bestCourt, startMs + lengthMin * MS_PER_MIN);

    const ahead = aheadOnCourt.get(bestCourt) ?? 0;
    aheadOnCourt.set(bestCourt, ahead + 1);

    const mins = Math.max(0, Math.round((startMs - nowMs) / MS_PER_MIN));
    const delay = published ? Math.max(0, Math.round((startMs - published) / MS_PER_MIN)) : 0;

    waiting.push({
      id: m.id,
      court: null, // the desk decides at the moment of assignment, not now
      event: m.event,
      round: m.round,
      playerA: m.playerA,
      playerB: m.playerB,
      scheduledTime: m.slot24,
      estimatedStart: toHHMM(startMs),
      ahead,
      etaLowMin: round5(mins * 0.8),
      etaHighMin: round5(mins * 1.15 + 10),
      onSchedule: !published || startMs <= published + MS_PER_MIN,
      isNext: false,
      delayMin: round5(delay),
    });
  }

  if (waiting.length) waiting[0].isNext = true;

  const sampleSize = observations.length;
  const boardIso = toIsoDate(opts.boardDate);
  const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  return {
    onCourt,
    waiting,
    boardDate: boardIso,
    isFutureDate: !!boardIso && boardIso > todayIso,
    courtCount: courts.length,
    expectedMinutes: expected,
    lengths,
    sampleSize,
    provisional: sampleSize < MIN_SAMPLE,
    generatedAt: new Date(nowMs).toISOString(),
  };
}

/**
 * The observation a finished match contributes.
 *
 * Nonsense is dropped rather than averaged in: a court freed by accident a
 * minute after it was assigned, or one nobody cleared until the next
 * morning, would both poison the estimates for the rest of the day.
 */
export const MIN_CREDIBLE_MIN = 10;
export const MAX_CREDIBLE_MIN = 240;

export function observationFor(
  m: TopDogMatch,
  startedAt: string,
  endedAt: Date = new Date()
): Observation | null {
  const startMs = new Date(startedAt).getTime();
  if (!Number.isFinite(startMs)) return null;
  const minutes = Math.round((endedAt.getTime() - startMs) / MS_PER_MIN);
  if (minutes < MIN_CREDIBLE_MIN || minutes > MAX_CREDIBLE_MIN) return null;
  return { bucket: bucketOfTopDog(m), minutes };
}

export { LATE_ROUND_EXTRA_MIN };
