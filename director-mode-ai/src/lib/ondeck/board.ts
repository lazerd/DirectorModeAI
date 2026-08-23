/**
 * Wait-time board — "when will my match actually start?"
 *
 * The model is the one a tournament director already carries in their head:
 * you are running N courts, matches take about so long, and a match goes on
 * as soon as (a) its scheduled time has arrived and (b) a court is free.
 *
 * So we simulate exactly that. N court slots, each free at some moment; take
 * the next match in scheduled order, put it on whichever slot frees first,
 * and never earlier than its published time. The published schedule stays
 * authoritative — we only say when a court will realistically be free.
 *
 * Two things the feed forces on us:
 *   - Upcoming matches carry NO court. The desk assigns one when it calls
 *     the match, so capacity has to come from the director, not the data.
 *   - There is a start time but no end time, so match lengths are observed
 *     locally by watching matches leave IN_PROGRESS. The clock that drives
 *     everything is when the desk actually sends a match out.
 */

import type { NormalisedMatch } from './servetennis';

const MS_PER_MIN = 60_000;

/** Below this many observed matches in a bucket we keep the director's figure. */
const MIN_SAMPLE = 3;

/** A match already past its expected length is about to finish, not overdue. */
const IMMINENT_MIN = 2;

/**
 * Semifinals and finals run longer in both draws — the players left are
 * evenly matched. Added to the director's figure rather than asking for
 * four numbers when two will do.
 */
export const LATE_ROUND_EXTRA_MIN = 10;

export type Bucket = 'consolation_early' | 'consolation_late' | 'main_early' | 'main_late';

/** What the director says a match takes. Everything else derives from these. */
export interface MatchLengths {
  mainMinutes: number;
  consolationMinutes: number;
}

export const DEFAULT_LENGTHS: MatchLengths = {
  mainMinutes: 90,
  consolationMinutes: 60,
};

export function baselineFor(bucket: Bucket, lengths: MatchLengths): number {
  switch (bucket) {
    case 'main_early': return lengths.mainMinutes;
    case 'main_late': return lengths.mainMinutes + LATE_ROUND_EXTRA_MIN;
    case 'consolation_early': return lengths.consolationMinutes;
    case 'consolation_late': return lengths.consolationMinutes + LATE_ROUND_EXTRA_MIN;
  }
}

/**
 * Matched on word boundaries on purpose: "Quarterfinals" ends in "finals",
 * so a naive substring test prices every quarterfinal as a late round.
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
  event: string;
  round: string;
  playerA: string;
  playerB: string;
  /** Published start time, "HH:MM". The official number. */
  scheduledTime: string | null;
  /** Predicted start, "HH:MM". */
  estimatedStart: string | null;
  /** Matches that must finish on the same court before this one goes on. */
  ahead: number;
  etaLowMin: number;
  etaHighMin: number;
  /** A court is free and only the clock is holding this match back. */
  onSchedule: boolean;
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
  boardDate: string | null;
  isFutureDate: boolean;
  /** Courts the director says are running. */
  courtCount: number;
  /** Expected length per bucket, after any learning from today's play. */
  expectedMinutes: Record<Bucket, number>;
  lengths: MatchLengths;
  sampleSize: number;
  provisional: boolean;
  generatedAt: string;
}

export interface WaitOptions {
  /**
   * How many courts the tournament is actually running. Not how many the
   * club has — the director may hold some back for members, and that
   * difference moves every estimate on the board.
   */
  courtCount: number;
  lengths?: MatchLengths;
  /** Matches timed today, tagged by bucket. */
  observations?: Observation[];
  /** Today's date, "YYYY-MM-DD". */
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

/** "HH:MM" on the given day -> ms. Null for anything unparseable. */
function timeMs(hhmmStr: string | null, now: Date): number | null {
  if (!hhmmStr) return null;
  const [h, m] = hhmmStr.split(':').map(Number);
  if (Number.isNaN(h)) return null;
  const d = new Date(now);
  d.setHours(h, m || 0, 0, 0);
  return d.getTime();
}

function toHHMM(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const round5 = (n: number) => Math.max(0, Math.round(n / 5) * 5);

export function computeWaitBoard(live: NormalisedMatch[], opts: WaitOptions): WaitBoard {
  const now = opts.now ?? new Date();
  const nowMs = now.getTime();
  const lengths = opts.lengths ?? DEFAULT_LENGTHS;
  const observations = opts.observations ?? [];
  const courtCount = Math.max(1, Math.floor(opts.courtCount) || 1);

  // --- how long a match takes -------------------------------------------
  const byBucket = new Map<Bucket, number[]>();
  for (const o of observations) {
    if (o.minutes < 10 || o.minutes > 300) continue;
    const arr = byBucket.get(o.bucket) ?? [];
    arr.push(o.minutes);
    byBucket.set(o.bucket, arr);
  }

  const expected = (b: Bucket): number => {
    const arr = (byBucket.get(b) ?? []).slice().sort((x, y) => x - y);
    // The director's figure holds until today's play actually disagrees.
    return arr.length >= MIN_SAMPLE ? Math.round(quantile(arr, 0.5)) : baselineFor(b, lengths);
  };
  const expectedFor = (m: Pick<NormalisedMatch, 'structure' | 'round'>) => expected(bucketOf(m));

  const allObs = observations
    .filter((o) => o.minutes >= 10 && o.minutes <= 300)
    .map((o) => o.minutes)
    .sort((a, b) => a - b);
  const provisional = allObs.length < MIN_SAMPLE;

  // Spread on the estimate: observed quartiles once we have them, otherwise
  // a deliberately generous band so nobody reads a default as a promise.
  const centre = allObs.length ? quantile(allObs, 0.5) || 1 : 1;
  const lowRatio = provisional ? 0.85 : Math.min(1, quantile(allObs, 0.25) / centre);
  const highRatio = provisional ? 1.25 : Math.max(1, quantile(allObs, 0.75) / centre);

  // --- which day are we showing ------------------------------------------
  const playing = live.filter((m) => m.status === 'IN_PROGRESS');
  const upcoming = live.filter((m) => m.status !== 'IN_PROGRESS');

  const todaysUpcoming = upcoming.filter((m) => m.scheduledDate === opts.today);
  const futureDates = upcoming
    .map((m) => m.scheduledDate)
    .filter((d): d is string => typeof d === 'string' && d > opts.today)
    .sort();
  // A match still grinding on court must not pin the board to today.
  const boardDate = todaysUpcoming.length ? opts.today : futureDates[0] ?? null;
  const isFutureDate = boardDate !== null && boardDate > opts.today;

  const queued = upcoming
    .filter((m) => m.scheduledDate === boardDate)
    .sort((a, b) => (a.scheduledTime ?? '99:99').localeCompare(b.scheduledTime ?? '99:99'));

  // --- what is already out there -----------------------------------------
  const onCourt: CourtRow[] = playing
    .map((m) => {
      const startMs = timeMs(m.startTime, now);
      return {
        court: m.court ?? '—',
        playerA: m.playerA,
        playerB: m.playerB,
        event: m.event,
        round: m.round,
        startedAt: m.startTime,
        elapsedMin: startMs === null ? null : Math.max(0, Math.round((nowMs - startMs) / MS_PER_MIN)),
      };
    })
    .sort((a, b) => a.court.localeCompare(b.court, undefined, { numeric: true }));

  /**
   * One slot per court in play: when it frees up, and how many matches are
   * stacked on it. Slots are anonymous on purpose — the feed never says
   * which court an upcoming match will get, and the director thinks in
   * "I'm running nine courts", not in court numbers.
   *
   * If more matches are somehow in progress than courts declared, widen to
   * fit rather than pretend a court is free.
   */
  const slotCount = Math.max(courtCount, playing.length);
  const slots = Array.from({ length: slotCount }, () => ({ freeAt: nowMs, stacked: 0 }));

  // The desk sends a match out and the feed records that start time; that is
  // our clock. Soonest-finishing matches occupy the first slots so the next
  // match to be called lands on the court that frees first.
  playing
    .map((m) => {
      const startMs = timeMs(m.startTime, now) ?? nowMs;
      return Math.max(startMs + expectedFor(m) * MS_PER_MIN, nowMs + IMMINENT_MIN * MS_PER_MIN);
    })
    .sort((a, b) => a - b)
    .forEach((end, i) => {
      if (i < slots.length) { slots[i].freeAt = end; slots[i].stacked = 1; }
    });

  const waiting: WaitRow[] = queued.map((m) => {
    // Whichever court frees up soonest is where the desk will send them.
    let slot = slots[0];
    for (const s of slots) if (s.freeAt < slot.freeAt) slot = s;

    const scheduled = timeMs(m.scheduledTime, now);
    // Cannot start before its published time, and an empty court beforehand
    // does not make it start early.
    const startsAt = Math.max(slot.freeAt, scheduled ?? 0, nowMs);
    const onSchedule = scheduled !== null && startsAt <= scheduled;

    const ahead = slot.stacked;
    slot.freeAt = startsAt + expectedFor(m) * MS_PER_MIN;
    slot.stacked += 1;

    const waitMin = isFutureDate ? 0 : (startsAt - nowMs) / MS_PER_MIN;

    return {
      id: m.id,
      court: m.court,
      event: m.event,
      round: m.round,
      playerA: m.playerA,
      playerB: m.playerB,
      scheduledTime: m.scheduledTime,
      estimatedStart: isFutureDate ? m.scheduledTime : toHHMM(startsAt),
      ahead,
      etaLowMin: round5(waitMin * lowRatio),
      etaHighMin: Math.max(5, round5(waitMin * highRatio)),
      onSchedule,
    };
  });

  return {
    onCourt,
    waiting,
    boardDate,
    isFutureDate,
    courtCount,
    lengths,
    expectedMinutes: {
      consolation_early: expected('consolation_early'),
      consolation_late: expected('consolation_late'),
      main_early: expected('main_early'),
      main_late: expected('main_late'),
    },
    sampleSize: allObs.length,
    provisional,
    generatedAt: now.toISOString(),
  };
}

/**
 * Draw-sheet shorthand made readable: "C-Quarterfinals-Q" -> "Consolation QF".
 * Short because a phone screen has no room, but it must never show the raw
 * code to a parent.
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
  return (prefix + (NAMES[s.toLowerCase()] ?? s.replace(/-/g, ' '))).trim();
}

/**
 * "9:45 AM" from "09:45". Clock times beat minute counts: nobody standing on
 * a court wants to convert 145 minutes into when to come back.
 */
export function formatClock(hhmmStr: string | null): string {
  if (!hhmmStr) return '';
  // Tolerate a full ISO datetime slipping through from the feed.
  const isoTime = hhmmStr.match(/T(\d{2}:\d{2})/);
  const value = isoTime ? isoTime[1] : hhmmStr;
  const [h, m] = value.split(':').map(Number);
  if (Number.isNaN(h)) return value;
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m || 0).padStart(2, '0')} ${suffix}`;
}

/** Beyond this a minute count stops meaning anything; use the clock instead. */
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
 * The single line a waiting player reads.
 *
 * A match whose court is free and is only waiting for its scheduled time
 * gets its scheduled time back — "9:00 AM" — because that is the honest
 * answer and the one already printed on the order of play.
 */
export function waitHeadline(
  row: Partial<Pick<WaitRow, 'etaLowMin' | 'etaHighMin' | 'estimatedStart' | 'onSchedule' | 'scheduledTime'>>
): string {
  const low = row.etaLowMin ?? 0;
  const high = row.etaHighMin ?? 0;
  const estimate = formatClock(row.estimatedStart ?? null);

  if (row.onSchedule) return formatClock(row.scheduledTime ?? row.estimatedStart ?? null) || '—';
  if (high > 0 && high <= MINUTES_USEFUL_UP_TO) return formatWait(low, high);

  // A snapshot published by an older tab can be missing the estimate. Fall
  // back through what we do have rather than rendering a bare "~", which
  // tells a waiting parent precisely nothing.
  if (estimate) return `~${estimate}`;
  if (high > 0) return formatWait(low, high);
  return formatClock(row.scheduledTime ?? null) || '—';
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
