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
  /** Assigned court, when the desk has given it one. Usually null. */
  court: string | null;
  /** The court we predict it lands on. Advisory, never shown as a promise. */
  predictedCourt: string | null;
  event: string;
  round: string;
  playerA: string;
  playerB: string;
  /** Published start time, "HH:MM". The authoritative number. */
  scheduledTime: string | null;
  /** Predicted start, "HH:MM" — what people actually want to know. */
  estimatedStart: string | null;
  /** Matches ahead of this one on the court it is predicted to use. */
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
  /** The play date the board is showing, "YYYY-MM-DD". */
  boardDate: string | null;
  /**
   * True when the board has rolled on to a later day — once today's play is
   * done we show tomorrow's order of play, where a countdown would be
   * meaningless and the scheduled time is the only useful answer.
   */
  isFutureDate: boolean;
  /** Expected length per bucket, after any learning from today's play. */
  expectedMinutes: Record<Bucket, number>;
  sampleSize: number;
  provisional: boolean;
  generatedAt: string;
}

export interface WaitOptions {
  /** Matches timed today, tagged by bucket. */
  observations: Observation[];
  /**
   * Every court in play today. This is capacity, never a quota.
   *
   * It matters enormously: the desk assigns courts as matches are called,
   * so most upcoming matches have no court yet. Without the real court list
   * they all queue behind one another and a mid-morning match reads as a
   * 37-hour wait.
   */
  courts: string[];
  /**
   * Today's date, "YYYY-MM-DD". The board shows today while there is still
   * play left, then rolls forward to the next scheduled day.
   */
  today: string;
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

  const playing = live.filter((m) => m.status === 'IN_PROGRESS');
  const upcoming = live.filter((m) => m.status !== 'IN_PROGRESS');

  // Which day to show. Today, while anything is still on court or still to
  // be played today; otherwise the next day with matches on it, so the
  // evening before a tournament day shows tomorrow's order of play rather
  // than an empty board.
  const todaysUpcoming = upcoming.filter((m) => m.scheduledDate === opts.today);
  const futureDates = upcoming
    .map((m) => m.scheduledDate)
    .filter((d): d is string => Boolean(d) && d! > opts.today)
    .sort();
  // Note: a match still grinding on court does NOT hold the board on today.
  // Late on day one everything remaining is tomorrow's, and that is what
  // people are standing there asking about.
  const boardDate = todaysUpcoming.length ? opts.today : futureDates[0] ?? null;
  const isFutureDate = boardDate !== null && boardDate > opts.today;

  const queued = upcoming
    .filter((m) => m.scheduledDate === boardDate)
    .sort((a, b) => (a.scheduledTime ?? '99:99').localeCompare(b.scheduledTime ?? '99:99'));

  // --- simulate the day ---------------------------------------------
  // Every court starts free now. Courts currently in use become free when
  // the match on them is expected to end.
  const courtList = opts.courts.length
    ? [...opts.courts]
    : [...new Set(playing.map((m) => m.court).filter((c): c is string => Boolean(c)))];

  const freeAt = new Map<string, number>();
  for (const c of courtList) freeAt.set(c, nowMs);

  const onCourt: CourtRow[] = [];
  for (const m of playing) {
    const court = m.court ?? '—';
    const startMs = timeMs(m.startTime, now);
    const predictedEnd = (startMs ?? nowMs) + expectedFor(m) * MS_PER_MIN;
    // A match already past its expected length is about to finish, not overdue.
    freeAt.set(court, Math.max(predictedEnd, nowMs + IMMINENT_MIN * MS_PER_MIN));
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

  // How many matches are already stacked on each court, so "2 ahead" counts
  // the one being played plus anything we have queued in front.
  const stacked = new Map<string, number>();
  for (const m of playing) stacked.set(m.court ?? '—', 1);

  /** The court that frees up soonest — where the desk will realistically send them. */
  const earliestCourt = (): string => {
    let best = courtList[0] ?? '—';
    let bestAt = Number.POSITIVE_INFINITY;
    for (const c of courtList) {
      const at = freeAt.get(c) ?? nowMs;
      if (at < bestAt) { bestAt = at; best = c; }
    }
    return best;
  };

  const waiting: WaitRow[] = queued.map((m) => {
    // Most upcoming matches have no court yet — the desk assigns them as it
    // calls them — so we place them on whichever court frees up first.
    const court = m.court && freeAt.has(m.court) ? m.court : earliestCourt();

    const courtFree = freeAt.get(court) ?? nowMs;
    const scheduled = timeMs(m.scheduledTime, now);
    // Never earlier than the published time, and never in the past.
    const startsAt = Math.max(courtFree, scheduled ?? 0, nowMs);

    freeAt.set(court, startsAt + expectedFor(m) * MS_PER_MIN);
    const ahead = stacked.get(court) ?? 0;
    stacked.set(court, ahead + 1);

    const waitMin = isFutureDate ? 0 : (startsAt - nowMs) / MS_PER_MIN;
    const startDate = new Date(startsAt);

    return {
      id: m.id,
      court: m.court,
      predictedCourt: court,
      event: m.event,
      round: m.round,
      playerA: m.playerA,
      playerB: m.playerB,
      scheduledTime: m.scheduledTime,
      estimatedStart: isFutureDate
        ? m.scheduledTime
        : `${String(startDate.getHours()).padStart(2, '0')}:${String(startDate.getMinutes()).padStart(2, '0')}`,
      ahead,
      etaLowMin: round5(waitMin * lowRatio),
      etaHighMin: Math.max(5, round5(waitMin * highRatio)),
    };
  });

  return {
    onCourt,
    waiting,
    boardDate,
    isFutureDate,
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

/**
 * Draw-sheet shorthand made readable for the screen: "C-Quarterfinals-Q"
 * becomes "Consolation QF". Shorter than the spoken form because a phone
 * screen has no room, but it must never show the raw code to a parent.
 */
export function prettyRound(roundName: string): string {
  if (!roundName) return '';
  let s = roundName.trim();
  let prefix = '';
  if (/^C-/i.test(s)) { prefix = 'Consolation '; s = s.slice(2); }
  else if (/^PL-/i.test(s)) { prefix = 'Playoff '; s = s.slice(3); }
  s = s.replace(/-Q$/i, '');
  const NAMES: Record<string, string> = {
    quarterfinals: 'QF', quarterfinal: 'QF',
    semifinals: 'SF', semifinal: 'SF',
    final: 'Final', r16: 'Round of 16', r32: 'Round of 32', r64: 'Round of 64',
  };
  const key = s.toLowerCase();
  return (prefix + (NAMES[key] ?? s.replace(/-/g, ' '))).trim();
}

/**
 * "9:45 AM" from a 24-hour "09:45". Clock times beat minute counts: nobody
 * standing on a court wants to convert 145 minutes into when to come back.
 */
export function formatClock(hhmm: string | null): string {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  if (Number.isNaN(h)) return hhmm;
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m || 0).padStart(2, '0')} ${suffix}`;
}

/**
 * Short wait, expressed in minutes. Only used close in — beyond about two
 * hours the minute count stops meaning anything and the clock time is the
 * honest answer, so callers show `estimatedStart` instead.
 */
export const MINUTES_USEFUL_UP_TO = 120;

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

/**
 * The single line a waiting player should read. Close in, minutes are the
 * most useful thing; further out, a clock time is. Past two hours we stop
 * pretending to a precision we do not have.
 */
export function waitHeadline(row: Pick<WaitRow, 'etaLowMin' | 'etaHighMin' | 'estimatedStart'>): string {
  if (row.etaHighMin <= MINUTES_USEFUL_UP_TO) return formatWait(row.etaLowMin, row.etaHighMin);
  return `~${formatClock(row.estimatedStart)}`;
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
