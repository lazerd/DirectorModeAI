/**
 * Racquets IRL tournaments: the draw that lives in play_events.state.draw.
 *
 * Pure (no DB, no React), safe in the browser and the server. The brackets and
 * the round robin come from MixerMode's own generators (tournamentFormats.ts),
 * the advance rules are the pure half of tournamentScoring.recordTournamentScore
 * (winner_feeds_to / loser_feeds_to placement), and the court fill mirrors the
 * tournament desk: the next ready match goes to the first free court, a player
 * is never on two courts, and a court frees up the moment its match is done.
 *
 * The real draw type lives in `draw.format`, so later formats need no DB change.
 */
import {
  computeRRStandings,
  generateTournamentMatches,
  type GeneratedMatch,
  type TournamentFormat,
} from '@/lib/tournamentFormats';
import { buildRoundRobinGrid, type RRGrid } from '@/lib/roundRobinGrid';

/**
 * Draw formats Racquets IRL can run today.
 * Later (MixerMode generators already exist; each needs its own UI pass):
 *   'single-elim' | 'fmlc' | 'ffic' | 'compass' | 'quads'
 */
export type DrawFormat = 'rr-singles' | 'rr-doubles';
export const DRAW_FORMATS: DrawFormat[] = ['rr-singles', 'rr-doubles'];
export const DRAW_FORMAT_NAME: Record<DrawFormat, string> = {
  'rr-singles': 'Round Robin · Singles',
  'rr-doubles': 'Round Robin · Doubles',
};
export const DRAW_FORMAT_BLURB: Record<DrawFormat, string> = {
  'rr-singles': 'Everyone plays everyone once. Courts fill themselves as matches finish.',
  'rr-doubles': 'Fixed pairs, every pair plays every pair once. You set the pairs or we balance them.',
};
export const isDrawFormat = (v: unknown): v is DrawFormat => DRAW_FORMATS.includes(v as DrawFormat);
export const drawIsDoubles = (f: DrawFormat) => f.endsWith('-doubles');

/** The MixerMode generator behind each draw format. */
const GENERATOR: Record<DrawFormat, TournamentFormat> = {
  'rr-singles': 'rr-singles',
  'rr-doubles': 'rr-doubles',
  // 'single-elim': 'single-elim-singles' | 'single-elim-doubles' (by matchType), 'fmlc', 'ffic', 'compass' likewise.
};

/** Round robins past this get long (16 → 120 matches). Bigger fields want flights (later). */
export const MAX_RR_ENTRIES = 16;

export type DrawStatus = 'pending' | 'ready' | 'on_court' | 'done';
export type DrawHow = 'W/O' | 'RET' | 'DEF';

export interface DrawEntry {
  id: string;
  rsvpIds: string[];
  /** "Ann" or "Ann / Bo". */
  name: string;
  /** Each player's name, in rsvpIds order. */
  players: string[];
  seed: number;
  /** Average level of the entry's players (null if nobody gave one). */
  level?: number | null;
}

export type DrawMatch = GeneratedMatch & {
  /** `${bracket}:${round}:${slot}`: the same address feeds_to refs use. */
  key: string;
  winner?: 'a' | 'b' | null;
  /** Player1-first ("6-4, 3-6, 10-7"), or a marker: "W/O", "DEF", "6-4, 2-1, RET". */
  score?: string | null;
  court?: number | null;
  status: DrawStatus;
  startedAt?: string | null;
  finishedAt?: string | null;
  how?: DrawHow | null;
  /** The host took it off a court: the auto fill leaves it alone until the host puts it back. */
  held?: boolean;
};

export interface Draw {
  format: DrawFormat;
  matchType: 'singles' | 'doubles';
  entries: DrawEntry[];
  matches: DrawMatch[];
  courts: number;
  courtLabels?: string[] | null;
}

export class DrawError extends Error {}

export type DrawPlayer = { id: string; name: string; level?: number | null };

/* ------------------------------------------------------------------ */
/* Build                                                                */
/* ------------------------------------------------------------------ */

/** Strongest first; anyone without a level goes last, in signup order (the input order). */
export function seedPlayers<T extends { level?: number | null }>(players: T[]): T[] {
  return players
    .map((p, i) => ({ p, i }))
    .sort((a, b) => {
      const la = a.p.level, lb = b.p.level;
      const na = la == null || !Number.isFinite(la), nb = lb == null || !Number.isFinite(lb);
      if (na !== nb) return na ? 1 : -1;
      if (!na && la !== lb) return (lb as number) - (la as number);
      return a.i - b.i;
    })
    .map((x) => x.p);
}

const avgLevel = (ps: DrawPlayer[]) => {
  const v = ps.map((p) => p.level).filter((x): x is number => x != null && Number.isFinite(x));
  return v.length ? Math.round((v.reduce((s, x) => s + x, 0) / v.length) * 100) / 100 : null;
};

/**
 * Doubles pairs: the host's pairs first (any pair whose player isn't here is dropped
 * and the partner goes back in the pool), then the rest auto-paired strongest with weakest.
 */
export function makePairs(players: DrawPlayer[], hostPairs?: string[][] | null): DrawPlayer[][] {
  const byId = new Map(players.map((p) => [p.id, p]));
  const used = new Set<string>();
  const pairs: DrawPlayer[][] = [];
  for (const raw of hostPairs ?? []) {
    if (!Array.isArray(raw) || raw.length !== 2) throw new DrawError('Each pair needs exactly two players.');
    const [a, b] = raw;
    if (a === b) throw new DrawError('A player can’t partner themselves.');
    for (const id of raw) if (used.has(id)) throw new DrawError(`${byId.get(id)?.name ?? 'A player'} is in two pairs.`);
    if (!byId.has(a) || !byId.has(b)) continue; // not checked in: the partner gets auto-paired
    used.add(a); used.add(b);
    pairs.push([byId.get(a)!, byId.get(b)!]);
  }
  const pool = seedPlayers(players.filter((p) => !used.has(p.id)));
  if (pool.length % 2) {
    throw new DrawError(`Doubles needs an even number of players: ${players.length} checked in. Check one more in (or one out)${pool.length === 1 ? `, ${pool[0].name} has no partner` : ''}.`);
  }
  for (let i = 0; i < pool.length / 2; i++) pairs.push([pool[i], pool[pool.length - 1 - i]]);
  return pairs;
}

export function matchKey(m: Pick<GeneratedMatch, 'bracket' | 'round' | 'slot'>) {
  return `${m.bracket}:${m.round}:${m.slot}`;
}

/** Build the draw from the checked-in players (signup order). Courts are filled separately (fillCourts). */
export function buildDraw(
  format: DrawFormat,
  players: DrawPlayer[],
  courts: number,
  opts: { pairs?: string[][] | null; courtLabels?: string[] | null } = {},
): Draw {
  if (!isDrawFormat(format)) throw new DrawError('That tournament format isn’t ready yet.');
  const seen = new Set<string>();
  for (const p of players) { if (seen.has(p.id)) throw new DrawError('A player is listed twice.'); seen.add(p.id); }
  const doubles = drawIsDoubles(format);
  const groups = doubles ? makePairs(players, opts.pairs) : players.map((p) => [p]);
  const order = new Map(players.map((p, i) => [p.id, i]));
  const firstSignup = (g: DrawPlayer[]) => Math.min(...g.map((p) => order.get(p.id) ?? 0));
  const seeded = groups
    .map((g) => ({ g, level: avgLevel(g), at: firstSignup(g) }))
    .sort((a, b) => {
      if ((a.level == null) !== (b.level == null)) return a.level == null ? 1 : -1;
      if (a.level != null && b.level != null && a.level !== b.level) return b.level - a.level;
      return a.at - b.at;
    });
  const need = 2;
  if (seeded.length < need) throw new DrawError(doubles ? 'A doubles round robin needs at least 2 pairs (4 players checked in).' : 'A round robin needs at least 2 players checked in.');
  if (seeded.length > MAX_RR_ENTRIES) throw new DrawError(`A round robin tops out at ${MAX_RR_ENTRIES} ${doubles ? 'pairs' : 'players'} (${seeded.length} here). Bigger fields need flights, coming soon.`);
  const entries: DrawEntry[] = seeded.map((x, i) => ({
    id: `e${i + 1}`,
    rsvpIds: x.g.map((p) => p.id),
    name: x.g.map((p) => p.name).join(' / '),
    players: x.g.map((p) => p.name),
    seed: i + 1,
    level: x.level,
  }));
  const generated = generateTournamentMatches(GENERATOR[format], entries.map((e) => e.id));
  const matches: DrawMatch[] = generated.map((m) => ({
    ...m,
    key: matchKey(m),
    winner: null,
    score: null,
    court: null,
    status: sideOf(m, 'a') && sideOf(m, 'b') ? 'ready' : 'pending',
    startedAt: null,
    finishedAt: null,
  }));
  return {
    format,
    matchType: doubles ? 'doubles' : 'singles',
    entries,
    matches,
    courts: Math.max(1, Math.min(24, Math.round(courts) || 1)),
    courtLabels: opts.courtLabels ?? null,
  };
}

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

/** The entry id on a side (entries are stored in player1_id / player3_id). */
export const sideOf = (m: Pick<GeneratedMatch, 'player1_id' | 'player3_id'>, side: 'a' | 'b') => (side === 'a' ? m.player1_id : m.player3_id);
export const entryOf = (d: Draw, id: string | null | undefined) => (id ? d.entries.find((e) => e.id === id) : undefined);
export const courtName = (d: Pick<Draw, 'courtLabels'>, n: number) => d.courtLabels?.[n - 1]?.trim() || String(n);
const entriesIn = (m: DrawMatch) => [m.player1_id, m.player3_id].filter((x): x is string => !!x);

/** Fill order: round, then main before consolation, then slot. */
export function fillOrder(a: DrawMatch, b: DrawMatch) {
  return a.round - b.round || (a.bracket === b.bracket ? 0 : a.bracket === 'main' ? -1 : 1) || a.slot - b.slot;
}

function parseRef(ref: string | null): { key: string; side: 'a' | 'b' } | null {
  if (!ref) return null;
  const p = ref.split(':');
  if (p.length !== 4 || (p[3] !== 'a' && p[3] !== 'b')) return null;
  return { key: `${p[0]}:${p[1]}:${p[2]}`, side: p[3] };
}

const cloneDraw = (d: Draw): Draw => ({ ...d, entries: d.entries.map((e) => ({ ...e })), matches: d.matches.map((m) => ({ ...m })) });
const started = (m: DrawMatch) => m.status === 'on_court' || m.status === 'done';
const settle = (m: DrawMatch) => {
  if (m.status === 'done' || m.status === 'on_court') return;
  m.status = m.player1_id && m.player3_id ? 'ready' : 'pending';
};

/* ------------------------------------------------------------------ */
/* Scores                                                               */
/* ------------------------------------------------------------------ */

/**
 * Read a typed score into sets: "6-4 6-3", "6-4, 3-6, 10-7", "8-6", "7-6(5) 6-4".
 * Tiebreak points in brackets are dropped. Throws a message the player can act on.
 */
export function parseSets(raw: string, opts: { allowTiedLast?: boolean } = {}): [number, number][] {
  const t = String(raw ?? '').trim().replace(/[–—:]/g, '-').replace(/\(\d+\)/g, '').replace(/\s*-\s*/g, '-');
  if (!t) throw new DrawError('Enter the score, like 6-4 6-3.');
  const parts = t.split(/[,;\s]+/).filter(Boolean);
  if (parts.length > 5) throw new DrawError('That’s more than five sets.');
  return parts.map((s, i) => {
    const m = s.match(/^(\d{1,2})-(\d{1,2})$/);
    if (!m) throw new DrawError(`“${s}” isn’t a set score. Type it like 6-4.`);
    const a = +m[1], b = +m[2];
    if (a === b && !(opts.allowTiedLast && i === parts.length - 1)) throw new DrawError(`${a}-${b} is tied. Every set needs a winner (a tiebreak set is 7-6).`);
    return [a, b];
  });
}
export const setsText = (sets: [number, number][]) => sets.map(([a, b]) => `${a}-${b}`).join(', ');

/**
 * The side whose games come first in a player1-first score won the match:
 * more sets, or (one set) more games. A tie in sets is decided by the last set.
 */
export function winnerOfScore(p1First: string): 'a' | 'b' | null {
  let sets: [number, number][];
  try { sets = parseSets(p1First); } catch { return null; }
  let a = 0, b = 0;
  for (const [x, y] of sets) { if (x > y) a++; else b++; }
  if (a !== b) return a > b ? 'a' : 'b';
  const [x, y] = sets[sets.length - 1];
  return x > y ? 'a' : 'b';
}

/* ------------------------------------------------------------------ */
/* Results                                                              */
/* ------------------------------------------------------------------ */

/**
 * Record a result (score already player1-first, or a marker: "W/O", "DEF", "…, RET").
 * Winner and loser move along winner_feeds_to / loser_feeds_to. Re-scoring a done
 * match with a different winner swaps who went where, but only while the match they
 * went to hasn't started; otherwise it throws and nothing changes.
 */
export function applyResult(
  draw: Draw,
  key: string,
  winner: 'a' | 'b',
  score: string | null,
  opts: { how?: DrawHow | null; now?: string } = {},
): Draw {
  if (winner !== 'a' && winner !== 'b') throw new DrawError('Pick who won.');
  const d = cloneDraw(draw);
  const m = d.matches.find((x) => x.key === key);
  if (!m) throw new DrawError('That match isn’t in the draw.');
  if (!m.player1_id || !m.player3_id) throw new DrawError('That match isn’t set yet: both sides need to be known.');
  const prev = m.status === 'done' ? (m.winner ?? null) : null;
  const winnerId = sideOf(m, winner)!, loserId = sideOf(m, winner === 'a' ? 'b' : 'a')!;

  if (prev !== winner) {
    const moves: { ref: string | null; id: string; was: string | null }[] = [
      { ref: m.winner_feeds_to, id: winnerId, was: prev ? sideOf(m, prev) : null },
      { ref: m.loser_feeds_to, id: loserId, was: prev ? sideOf(m, prev === 'a' ? 'b' : 'a') : null },
    ];
    // Check every destination first so a refused re-score changes nothing.
    for (const mv of moves) {
      const r = parseRef(mv.ref);
      if (!r) continue;
      const dest = d.matches.find((x) => x.key === r.key);
      if (!dest) continue;
      const cur = sideOf(dest, r.side);
      if (cur !== mv.id && cur != null && started(dest)) {
        throw new DrawError(`Can’t change that result: the next match (${matchLabel(d, dest)}) has already ${dest.status === 'done' ? 'been played' : 'started'}. Fix that one first.`);
      }
    }
    for (const mv of moves) {
      const r = parseRef(mv.ref);
      if (!r) continue;
      const dest = d.matches.find((x) => x.key === r.key);
      if (!dest) continue;
      if (r.side === 'a') { dest.player1_id = mv.id; dest.player2_id = null; } else { dest.player3_id = mv.id; dest.player4_id = null; }
      settle(dest);
    }
  }

  m.winner = winner;
  m.score = score;
  m.how = opts.how ?? null;
  m.status = 'done';
  m.held = false;
  m.finishedAt = opts.now ?? new Date().toISOString();
  return d;
}

/* ------------------------------------------------------------------ */
/* Courts                                                               */
/* ------------------------------------------------------------------ */

const busyEntries = (d: Draw) => new Set(d.matches.filter((m) => m.status === 'on_court').flatMap(entriesIn));
const usedCourts = (d: Draw) => new Set(d.matches.filter((m) => m.status === 'on_court' && m.court != null).map((m) => m.court as number));

/**
 * Put ready matches on free courts, earliest round first. A match waits while either
 * side is still playing somewhere else. Done matches free their court. Returns a new draw.
 */
export function fillCourts(draw: Draw, now: string = new Date().toISOString()): Draw {
  const d = cloneDraw(draw);
  for (const m of d.matches) settle(m);
  const used = usedCourts(d);
  const busy = busyEntries(d);
  const free: number[] = [];
  for (let c = 1; c <= d.courts; c++) if (!used.has(c)) free.push(c);
  if (!free.length) return d;
  const queue = d.matches.filter((m) => m.status === 'ready' && !m.held).sort(fillOrder);
  for (const m of queue) {
    if (!free.length) break;
    const ids = entriesIn(m);
    if (ids.some((id) => busy.has(id))) continue;
    m.status = 'on_court';
    m.court = free.shift()!;
    m.startedAt = now;
    ids.forEach((id) => busy.add(id));
  }
  return d;
}

/**
 * The host moves a match: onto court n, off its court (it waits until the host puts it back),
 * or 'auto' (back in line for the next free court).
 */
export function moveMatch(draw: Draw, key: string, court: number | null | 'auto', now: string = new Date().toISOString()): Draw {
  const d = cloneDraw(draw);
  const m = d.matches.find((x) => x.key === key);
  if (!m) throw new DrawError('That match isn’t in the draw.');
  if (m.status === 'done') throw new DrawError('That match is already done.');
  if (court === null || court === 'auto') {
    if (m.status === 'on_court') { m.status = 'ready'; m.court = null; m.startedAt = null; }
    m.held = court === null;
    settle(m);
    return d;
  }
  if (m.status === 'pending') throw new DrawError('That match isn’t set yet: both sides need to be known.');
  const n = Math.round(Number(court));
  if (!Number.isFinite(n) || n < 1 || n > d.courts) throw new DrawError(`Pick a court from 1 to ${d.courts}.`);
  const other = d.matches.find((x) => x !== m && x.status === 'on_court' && x.court === n);
  if (other) throw new DrawError(`Court ${courtName(d, n)} has ${matchLabel(d, other)} on it. Take that one off first.`);
  const elsewhere = d.matches.filter((x) => x !== m && x.status === 'on_court');
  const busy = new Set(elsewhere.flatMap(entriesIn));
  const clash = entriesIn(m).find((id) => busy.has(id));
  if (clash) throw new DrawError(`${entryOf(d, clash)?.name ?? 'A player'} is still playing on another court.`);
  if (m.status !== 'on_court') m.startedAt = now;
  m.status = 'on_court';
  m.court = n;
  m.held = false;
  return d;
}

/** "Ann vs Bo" (or "Ann vs TBD"). */
export function matchLabel(d: Draw, m: DrawMatch): string {
  return `${entryOf(d, m.player1_id)?.name ?? 'TBD'} vs ${entryOf(d, m.player3_id)?.name ?? 'TBD'}`;
}

/* ------------------------------------------------------------------ */
/* What a phone shows                                                   */
/* ------------------------------------------------------------------ */

export type NextFor =
  | { kind: 'not_in' }
  | { kind: 'done'; entry: DrawEntry; wins: number; losses: number }
  | { kind: 'on_court'; entry: DrawEntry; match: DrawMatch; side: 'a' | 'b'; court: number; courtName: string; opponent: string }
  | { kind: 'up_next'; entry: DrawEntry; match: DrawMatch; side: 'a' | 'b'; opponent: string; ahead: number }
  | { kind: 'waiting'; entry: DrawEntry; match: DrawMatch; side: 'a' | 'b'; opponent: string; waitingOn: string };

/** A player's card: on a court now, up next, or waiting on someone (and who). */
export function nextFor(draw: Draw, rsvpId: string | null | undefined): NextFor {
  const entry = rsvpId ? draw.entries.find((e) => e.rsvpIds.includes(rsvpId)) : undefined;
  if (!entry) return { kind: 'not_in' };
  const mine = (m: DrawMatch) => m.player1_id === entry.id || m.player3_id === entry.id;
  const sideFor = (m: DrawMatch): 'a' | 'b' => (m.player1_id === entry.id ? 'a' : 'b');
  const oppName = (m: DrawMatch) => entryOf(draw, sideOf(m, sideFor(m) === 'a' ? 'b' : 'a'))?.name ?? 'TBD';

  const now = draw.matches.find((m) => m.status === 'on_court' && mine(m));
  if (now) return { kind: 'on_court', entry, match: now, side: sideFor(now), court: now.court ?? 0, courtName: courtName(draw, now.court ?? 0), opponent: oppName(now) };

  const left = draw.matches.filter((m) => m.status !== 'done' && mine(m)).sort(fillOrder);
  if (!left.length) {
    let wins = 0, losses = 0;
    for (const m of draw.matches) {
      if (m.status !== 'done' || !mine(m)) continue;
      if (m.winner === sideFor(m)) wins++; else losses++;
    }
    return { kind: 'done', entry, wins, losses };
  }

  const busy = busyEntries(draw);
  const startable = (m: DrawMatch) => m.status === 'ready' && !m.held && !entriesIn(m).some((id) => busy.has(id));
  const go = left.find(startable);
  if (go) {
    // Matches the court fill would start before this one.
    const queue = draw.matches.filter(startable).sort(fillOrder);
    const ahead = queue.indexOf(go);
    return { kind: 'up_next', entry, match: go, side: sideFor(go), opponent: oppName(go), ahead: Math.max(0, ahead) };
  }
  const m = left[0];
  const side = sideFor(m);
  const oppId = sideOf(m, side === 'a' ? 'b' : 'a');
  let waitingOn: string;
  if (!oppId) {
    const feeder = draw.matches.find((x) => {
      const w = parseRef(x.winner_feeds_to), l = parseRef(x.loser_feeds_to);
      const want = side === 'a' ? 'b' : 'a';
      return (w?.key === m.key && w.side === want) || (l?.key === m.key && l.side === want);
    });
    waitingOn = feeder ? `${parseRef(feeder.loser_feeds_to)?.key === m.key ? 'the loser' : 'the winner'} of ${matchLabel(draw, feeder)}` : 'an opponent';
  } else if (busy.has(oppId)) {
    const at = draw.matches.find((x) => x.status === 'on_court' && entriesIn(x).includes(oppId));
    waitingOn = `${entryOf(draw, oppId)?.name ?? 'your opponent'}${at?.court ? ` (on Court ${courtName(draw, at.court)})` : ''}`;
  } else {
    waitingOn = 'the host to put it on a court';
  }
  return { kind: 'waiting', entry, match: m, side, opponent: oppName(m), waitingOn };
}

/* ------------------------------------------------------------------ */
/* Standings and the grid                                               */
/* ------------------------------------------------------------------ */

export type DrawStanding = { id: string; name: string; seed: number; rank: number; wins: number; losses: number; gamesWon: number; gamesLost: number; played: number };

const asTournamentRows = (d: Draw) => d.matches.map((m) => ({
  id: m.key, round: m.round, slot: m.slot,
  player1_id: m.player1_id, player3_id: m.player3_id,
  score: m.score ?? null, winner_side: m.status === 'done' ? (m.winner ?? null) : null,
  status: m.status === 'done' ? 'completed' : m.status,
}));

/** Round robin standings (MixerMode's computeRRStandings). Elimination placements come with those formats. */
export function standingsFor(draw: Draw): DrawStanding[] {
  if (!draw.format.startsWith('rr-')) return [];
  const rows = computeRRStandings(draw.entries, asTournamentRows(draw));
  return rows.map((r) => {
    const e = entryOf(draw, r.entry_id)!;
    return { id: r.entry_id, name: e.name, seed: e.seed, rank: r.rank, wins: r.match_wins, losses: r.match_losses, gamesWon: r.games_won, gamesLost: r.games_lost, played: r.match_wins + r.match_losses };
  });
}

/** The classic crosstab sheet (MixerMode's buildRoundRobinGrid). */
export function rrGridFor(draw: Draw): RRGrid {
  return buildRoundRobinGrid(
    draw.entries.map((e) => ({ id: e.id, player_name: e.name, partner_name: null, seed: e.seed })),
    asTournamentRows(draw),
  );
}

/** Counts for the host: how far along the draw is. */
export function drawProgress(d: Draw) {
  const n = (s: DrawStatus) => d.matches.filter((m) => m.status === s).length;
  return { total: d.matches.length, done: n('done'), onCourt: n('on_court'), ready: n('ready'), pending: n('pending'), complete: d.matches.length > 0 && n('done') === d.matches.length };
}
