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
import { buildCompassGroups } from '@/lib/compassLayout';
import { DrawError } from './drawError';
import {
  DEFAULT_QUADS_SCORING, allowedCourts, betweenStages, buildPools, buildQuads, groupKeys, groupRoundLabel, isGroupedFormat, isQuadsScoring,
  matchesToCome, syncGroups,
} from './drawGroups';

/**
 * Draw formats Racquets IRL runs: the MixerMode tournament formats, singles or doubles.
 * The value is the MixerMode TournamentFormat itself ('compass-doubles', ...), so the
 * desk's DrawView / BracketDrawSvg / CompassDrawSvg read it as is. Plus the grouped
 * draws (drawGroups.ts): 'quads' (MixerMode Quads: always singles + one doubles round)
 * and 'rr-pools-*' (round robin pools, then placement playoffs).
 */
export type DrawFormat = TournamentFormat | 'quads' | 'rr-pools-singles' | 'rr-pools-doubles';
export type DrawKind = 'rr' | 'single-elim' | 'fmlc' | 'ffic' | 'compass' | 'quads' | 'rr-pools';
export const DRAW_KINDS: DrawKind[] = ['rr', 'single-elim', 'fmlc', 'ffic', 'compass', 'quads', 'rr-pools'];
export const DRAW_FORMATS: DrawFormat[] = DRAW_KINDS.flatMap((k) => (k === 'quads' ? ['quads'] : [`${k}-singles`, `${k}-doubles`]) as DrawFormat[]);
export const DRAW_KIND_NAME: Record<DrawKind, string> = {
  rr: 'Round Robin',
  'single-elim': 'Single Elimination',
  fmlc: 'First-Match Consolation',
  ffic: 'Feed-In Consolation',
  compass: 'Compass',
  quads: 'Quads',
  'rr-pools': 'Pools + Playoffs',
};
export const DRAW_KIND_BLURB: Record<DrawKind, string> = {
  rr: 'Everyone plays everyone once. Courts fill themselves as matches finish.',
  'single-elim': 'Single elimination: win and you move on, lose and you’re out.',
  fmlc: 'First-match loser consolation: lose your first match, play in the back draw.',
  ffic: 'Feed-in consolation: every loser drops into the back draw (2+ matches each).',
  compass: 'Compass: 8 or 16 players, everyone plays 3–4 matches, all places decided.',
  quads: 'Quads: groups of 4 by level, 3 singles + 1 doubles each.',
  'rr-pools': 'Pools + playoffs: round robin groups, then 1st vs 1st, 2nd vs 2nd...',
};
export const drawKind = (f: DrawFormat): DrawKind => f.replace(/-(singles|doubles)$/, '') as DrawKind;
/** Quads has no singles / doubles switch: it is both, by design. */
export const drawFormatFor = (k: DrawKind, doubles: boolean): DrawFormat => (k === 'quads' ? 'quads' : `${k}-${doubles ? 'doubles' : 'singles'}` as DrawFormat);
export const DRAW_FORMAT_NAME = Object.fromEntries(DRAW_FORMATS.map((f) => [f, f === 'quads' ? 'Quads' : `${DRAW_KIND_NAME[drawKind(f)]} · ${drawIsDoubles(f) ? 'Doubles' : 'Singles'}`])) as Record<DrawFormat, string>;
export const DRAW_FORMAT_BLURB = Object.fromEntries(DRAW_FORMATS.map((f) => [f,
  f === 'rr-doubles' ? 'Fixed pairs, every pair plays every pair once. You set the pairs or we balance them.'
    : `${DRAW_KIND_BLURB[drawKind(f)]}${drawIsDoubles(f) ? ' Fixed pairs.' : ''}`])) as Record<DrawFormat, string>;
export const isDrawFormat = (v: unknown): v is DrawFormat => DRAW_FORMATS.includes(v as DrawFormat);
export function drawIsDoubles(f: DrawFormat) { return f.endsWith('-doubles'); }
/** A bracket (anything but the round robin): no late entries, placements instead of a table. */
export const isBracket = (f: DrawFormat) => drawKind(f) !== 'rr';
/** Quads or pools: flights / pools of their own (drawGroups.ts). */
export const isGrouped = (f: DrawFormat) => isGroupedFormat(f);

/** Round robins past this get long (16 → 120 matches). Bigger fields want flights (later). */
export const MAX_RR_ENTRIES = 16;
/** Entries (players, or pairs in doubles) each draw takes. */
export const DRAW_LIMITS: Record<DrawKind, { min: number; max: number }> = {
  rr: { min: 2, max: MAX_RR_ENTRIES },
  'single-elim': { min: 2, max: 32 },
  fmlc: { min: 4, max: 32 },
  ffic: { min: 4, max: 32 },
  compass: { min: 5, max: 16 },
  quads: { min: 4, max: 40 },
  'rr-pools': { min: 6, max: 32 },
};

/** Why this many entries can't make this draw (null = fine). */
export function drawSizeProblem(format: DrawFormat, entries: number): string | null {
  const k = drawKind(format);
  const { min, max } = DRAW_LIMITS[k];
  const doubles = drawIsDoubles(format);
  const unit = doubles ? 'pairs' : 'players';
  if (k === 'rr') {
    if (entries < min) return doubles ? 'A doubles round robin needs at least 2 pairs (4 players checked in).' : 'A round robin needs at least 2 players checked in.';
    if (entries > max) return `A round robin tops out at ${max} ${unit} (${entries} here). Bigger fields need flights, coming soon.`;
    return null;
  }
  const here = `${entries} ${entries === 1 ? unit.slice(0, -1) : unit} here${doubles ? `, ${entries * 2} players` : ''}`;
  if (k === 'quads') {
    if (entries < min) return `Quads needs at least 4 players checked in (${entries} here).`;
    if (entries > max) return `Quads tops out at ${max} players, ${max / 4} flights (${entries} here).`;
    return null;
  }
  if (k === 'rr-pools') {
    if (entries < min) return `Pools + playoffs needs at least ${min} ${unit} (${here}): two pools of three.`;
    if (entries > max) return `Pools + playoffs tops out at ${max} ${unit} (${here}).`;
    return null;
  }
  if (k === 'compass' && (entries < min || entries > max)) return `A compass draw needs ${min}–${max} ${unit} (${here}). It runs as an 8 or a 16.`;
  if (entries < min) return `${DRAW_KIND_NAME[k]} needs at least ${min} ${unit} (${here}).`;
  if (entries > max) return `${DRAW_KIND_NAME[k]} tops out at ${max} ${unit} (${here}).`;
  return null;
}

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
  /** A compass padding slot: loses every match by walkover, never gets a place. */
  bye?: boolean;
}

/** A quads flight or a pool: its letter id, its name ("Flight B", "Pool A"), its entries in seed order. */
export interface DrawGroup {
  id: string;
  name: string;
  entryIds: string[];
  /** Quads: MixerMode's tier label ("Top tier", "Tier 2"). */
  tier?: string | null;
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
  /** Settled by itself because a side is a BYE (compass padding). Not a real match. */
  bye?: boolean;
  /** Quads / pools: the flight or pool this match belongs to (null for a placement playoff). */
  group?: string | null;
  /** Pools: the placement playoff tier (1 = the pool winners). */
  tier?: number | null;
  /** Pools playoff: the place the winner / loser takes (null = they play on). */
  places?: [number | null, number | null] | null;
};

export interface Draw {
  format: DrawFormat;
  matchType: 'singles' | 'doubles';
  entries: DrawEntry[];
  matches: DrawMatch[];
  courts: number;
  courtLabels?: string[] | null;
  /** Quads / pools: the flights or pools, in order. */
  groups?: DrawGroup[] | null;
  /** Quads: the field wasn't a multiple of 4, so these (lowest seeds) wait, as MixerMode waitlists them. */
  alternates?: DrawEntry[] | null;
  /** Quads: the scoring format the host picked (lib/quads QUAD_SCORING_FORMATS id). */
  scoring?: string | null;
}

export { DrawError };

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
  opts: { pairs?: string[][] | null; courtLabels?: string[] | null; seeds?: string[] | null; now?: string; pools?: number | null; scoring?: string | null } = {},
): Draw {
  if (!isDrawFormat(format)) throw new DrawError('That tournament format isn’t ready yet.');
  const seen = new Set<string>();
  for (const p of players) { if (seen.has(p.id)) throw new DrawError('A player is listed twice.'); seen.add(p.id); }
  const doubles = drawIsDoubles(format);
  const groups = doubles ? makePairs(players, opts.pairs) : players.map((p) => [p]);
  const order = new Map(players.map((p, i) => [p.id, i]));
  const firstSignup = (g: DrawPlayer[]) => Math.min(...g.map((p) => order.get(p.id) ?? 0));
  // The host's seed order (rsvp ids) wins; everyone else follows by level, then signup.
  const hostSeed = new Map((opts.seeds ?? []).map((id, i) => [id, i]));
  const hostRank = (g: DrawPlayer[]) => Math.min(...g.map((p) => hostSeed.get(p.id) ?? Infinity));
  const seeded = groups
    .map((g) => ({ g, level: avgLevel(g), at: firstSignup(g), host: hostRank(g) }))
    .sort((a, b) => {
      if (a.host !== b.host) return a.host - b.host;
      if ((a.level == null) !== (b.level == null)) return a.level == null ? 1 : -1;
      if (a.level != null && b.level != null && a.level !== b.level) return b.level - a.level;
      return a.at - b.at;
    });
  const problem = drawSizeProblem(format, seeded.length);
  if (problem) throw new DrawError(problem);
  const entries: DrawEntry[] = seeded.map((x, i) => ({
    id: `e${i + 1}`,
    rsvpIds: x.g.map((p) => p.id),
    name: x.g.map((p) => p.name).join(' / '),
    players: x.g.map((p) => p.name),
    seed: i + 1,
    level: x.level,
  }));
  const kind = drawKind(format);
  if (isGroupedFormat(format)) {
    const g = kind === 'quads' ? buildQuads(entries) : buildPools(entries, doubles ? 'doubles' : 'singles', opts.pools);
    return {
      format,
      matchType: doubles ? 'doubles' : 'singles',
      entries: g.entries,
      matches: g.matches.map((m) => ({ ...m, key: matchKey(m), winner: null, score: null, court: null, status: 'ready', startedAt: null, finishedAt: null })),
      courts: Math.max(1, Math.min(24, Math.round(courts) || 1)),
      courtLabels: opts.courtLabels ?? null,
      groups: g.groups,
      alternates: g.alternates.length ? g.alternates : null,
      ...(kind === 'quads' ? { scoring: isQuadsScoring(opts.scoring) ? opts.scoring : DEFAULT_QUADS_SCORING } : {}),
    };
  }
  // A compass runs as an 8 or a 16: the short field is padded with BYEs seeded last.
  if (kind === 'compass') {
    const size = entries.length <= 8 ? 8 : 16;
    for (let i = entries.length; i < size; i++) entries.push({ id: `e${i + 1}`, rsvpIds: [], name: 'BYE', players: [], seed: i + 1, level: null, bye: true });
  }
  const ids = entries.map((e) => e.id);
  const generated = kind === 'compass' && ids.length === 8
    ? generateCompass8(ids, doubles ? 'doubles' : 'singles')
    : generateTournamentMatches(format as TournamentFormat, ids);
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
  const d: Draw = {
    format,
    matchType: doubles ? 'doubles' : 'singles',
    entries,
    matches,
    courts: Math.max(1, Math.min(24, Math.round(courts) || 1)),
    courtLabels: opts.courtLabels ?? null,
  };
  resolveByes(d, opts.now ?? new Date().toISOString());
  return d;
}

/**
 * The 8-player compass with feeds, in the shape compassLayout / CompassDrawSvg draw:
 *   main:1 R1 (1v8, 4v5, 3v6, 2v7) → winners East main:2, losers West consolation:1
 *   main:2 East semis → final main:3 (1st–2nd), losers North main:4 (3rd–4th)
 *   consolation:1 West semis → consolation:2 (5th–6th), losers South consolation:3 (7th–8th)
 * (compassBracket.ts builds the same draw round by round for leagues; a live draw needs feeds.)
 */
const COMPASS8: Record<string, { bracket: 'main' | 'consolation'; round: number; n: number; w: string | null; l: string | null }> = {
  R1: { bracket: 'main', round: 1, n: 4, w: 'ES', l: 'WS' },
  ES: { bracket: 'main', round: 2, n: 2, w: 'EF', l: 'NF' },
  EF: { bracket: 'main', round: 3, n: 1, w: null, l: null },
  NF: { bracket: 'main', round: 4, n: 1, w: null, l: null },
  WS: { bracket: 'consolation', round: 1, n: 2, w: 'WF', l: 'SF' },
  WF: { bracket: 'consolation', round: 2, n: 1, w: null, l: null },
  SF: { bracket: 'consolation', round: 3, n: 1, w: null, l: null },
};
const COMPASS8_R1: [number, number][] = [[1, 8], [4, 5], [3, 6], [2, 7]];

export function generateCompass8(ids: string[], matchType: 'singles' | 'doubles' = 'singles'): GeneratedMatch[] {
  if (ids.length !== 8) throw new DrawError('An 8-player compass needs exactly 8 entries.');
  const feed = (to: string | null, slot: number) => {
    if (!to) return null;
    const n = COMPASS8[to];
    return `${n.bracket}:${n.round}:${Math.ceil(slot / 2)}:${slot % 2 === 1 ? 'a' : 'b'}`;
  };
  const out: GeneratedMatch[] = [];
  for (const [k, n] of Object.entries(COMPASS8)) {
    for (let slot = 1; slot <= n.n; slot++) {
      const pair = k === 'R1' ? COMPASS8_R1[slot - 1] : null;
      out.push({
        bracket: n.bracket, round: n.round, slot, match_type: matchType,
        player1_id: pair ? ids[pair[0] - 1] : null, player2_id: null,
        player3_id: pair ? ids[pair[1] - 1] : null, player4_id: null,
        winner_feeds_to: feed(n.w, slot), loser_feeds_to: feed(n.l, slot),
      });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

/** The entry id on a side (entries are stored in player1_id / player3_id). */
export const sideOf = (m: Pick<GeneratedMatch, 'player1_id' | 'player3_id'>, side: 'a' | 'b') => (side === 'a' ? m.player1_id : m.player3_id);
export const entryOf = (d: Draw, id: string | null | undefined) => (id ? d.entries.find((e) => e.id === id) : undefined);
export const courtName = (d: Pick<Draw, 'courtLabels'>, n: number) => d.courtLabels?.[n - 1]?.trim() || String(n);
/** Every entry on a match: both sides, both slots (a quads doubles has four single-player entries). */
const entriesIn = (m: Pick<DrawMatch, 'player1_id' | 'player2_id' | 'player3_id' | 'player4_id'>) => [m.player1_id, m.player2_id, m.player3_id, m.player4_id].filter((x): x is string => !!x);
export const matchEntries = entriesIn;
/** The entry ids on one side (one, or two in a quads doubles). */
export const sideIds = (m: Pick<DrawMatch, 'player1_id' | 'player2_id' | 'player3_id' | 'player4_id'>, side: 'a' | 'b') =>
  (side === 'a' ? [m.player1_id, m.player2_id] : [m.player3_id, m.player4_id]).filter((x): x is string => !!x);
/** "Ann", "Ann / Bo" (a pair, or a quads doubles side), or "TBD". */
export function sideName(d: Draw, m: Pick<DrawMatch, 'player1_id' | 'player2_id' | 'player3_id' | 'player4_id'>, side: 'a' | 'b'): string {
  const ids = sideIds(m, side);
  return ids.length ? ids.map((id) => entryOf(d, id)?.name ?? 'TBD').join(' / ') : 'TBD';
}
/** Every person's name on one side (a pair's two players each). */
export const sidePlayers = (d: Draw, m: Pick<DrawMatch, 'player1_id' | 'player2_id' | 'player3_id' | 'player4_id'>, side: 'a' | 'b') =>
  sideIds(m, side).flatMap((id) => entryOf(d, id)?.players ?? []);

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
  const t = String(raw ?? '').trim().replace(/[–—:]/g, '-').replace(/\(\s*\d+(?:\s*-\s*\d+)?\s*\)/g, '').replace(/\s*-\s*/g, '-');
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
 * went to hasn't started; otherwise it throws and nothing changes. A BYE match that
 * already settled itself downstream is simply re-settled with the new player.
 */
export function applyResult(
  draw: Draw,
  key: string,
  winner: 'a' | 'b',
  score: string | null,
  opts: { how?: DrawHow | null; now?: string } = {},
): Draw {
  if (winner !== 'a' && winner !== 'b') throw new DrawError('Pick who won.');
  const now = opts.now ?? new Date().toISOString();
  const d = cloneDraw(draw);
  const m = d.matches.find((x) => x.key === key);
  if (!m) throw new DrawError('That match isn’t in the draw.');
  if (!m.player1_id || !m.player3_id) throw new DrawError('That match isn’t set yet: both sides need to be known.');
  if (m.bye || isByeId(d, m.player1_id) || isByeId(d, m.player3_id)) throw new DrawError('That one is a bye: it settles itself.');
  const prev = m.status === 'done' ? (m.winner ?? null) : null;
  if (prev !== winner) {
    // Working on a copy: a refused move throws and the caller's draw is untouched.
    advance(d, m, sideOf(m, winner)!, sideOf(m, winner === 'a' ? 'b' : 'a')!);
  }
  m.winner = winner;
  m.score = score;
  m.how = opts.how ?? null;
  m.status = 'done';
  m.held = false;
  m.finishedAt = now;
  // Quads: a flight's doubles once its singles are in. Pools: the playoffs once the pools are.
  syncGroups(d);
  resolveByes(d, now);
  return d;
}

const isByeId = (d: Draw, id: string | null | undefined) => !!id && !!d.entries.find((e) => e.id === id)?.bye;

/** Put the winner / loser of `m` where its feeds say, re-settling any BYE match in the way. */
function advance(d: Draw, m: DrawMatch, winnerId: string, loserId: string) {
  for (const [ref, id] of [[m.winner_feeds_to, winnerId], [m.loser_feeds_to, loserId]] as const) {
    const r = parseRef(ref);
    if (!r) continue;
    const dest = d.matches.find((x) => x.key === r.key);
    if (!dest) continue;
    const cur = sideOf(dest, r.side);
    if (cur === id) continue;
    if (cur != null && started(dest)) {
      if (dest.bye && dest.status === 'done') unsettle(d, dest);
      else throw new DrawError(`Can’t change that result: the next match (${matchLabel(d, dest)}) has already ${dest.status === 'done' ? 'been played' : 'started'}. Fix that one first.`);
    }
    if (r.side === 'a') { dest.player1_id = id; dest.player2_id = null; } else { dest.player3_id = id; dest.player4_id = null; }
    settle(dest);
  }
}

/** Undo a self-settled BYE match (and any BYE matches it fed): its players go back to TBD downstream. */
function unsettle(d: Draw, m: DrawMatch) {
  for (const ref of [m.winner_feeds_to, m.loser_feeds_to]) {
    const r = parseRef(ref);
    if (!r) continue;
    const dest = d.matches.find((x) => x.key === r.key);
    if (!dest || sideOf(dest, r.side) == null) continue;
    if (started(dest)) {
      if (dest.bye && dest.status === 'done') unsettle(d, dest);
      else throw new DrawError(`Can’t change that result: the next match (${matchLabel(d, dest)}) has already ${dest.status === 'done' ? 'been played' : 'started'}. Fix that one first.`);
    }
    if (r.side === 'a') { dest.player1_id = null; dest.player2_id = null; } else { dest.player3_id = null; dest.player4_id = null; }
    dest.status = 'pending';
    settle(dest);
  }
  Object.assign(m, { status: 'pending', winner: null, score: null, how: null, bye: false, finishedAt: null, startedAt: null, court: null });
  settle(m);
}

/**
 * Any match with both sides known and a BYE on one of them settles at once: the real
 * side wins by walkover (BYE vs BYE: side a goes on, so the padding keeps flowing).
 */
export function resolveByes(d: Draw, now: string): void {
  if (!d.entries.some((e) => e.bye)) return;
  for (let guard = 0; guard < d.matches.length + 1; guard++) {
    const m = d.matches.find((x) => x.status !== 'done' && x.player1_id && x.player3_id && (isByeId(d, x.player1_id) || isByeId(d, x.player3_id)));
    if (!m) return;
    const w: 'a' | 'b' = isByeId(d, m.player1_id) && !isByeId(d, m.player3_id) ? 'b' : 'a';
    advance(d, m, sideOf(m, w)!, sideOf(m, w === 'a' ? 'b' : 'a')!);
    Object.assign(m, { winner: w, score: null, how: 'W/O', status: 'done', bye: true, held: false, court: null, startedAt: null, finishedAt: now });
  }
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
    // Quads: a flight only ever plays on its own court pair.
    const allowed = allowedCourts(d, m);
    const at = allowed ? free.findIndex((c) => allowed.includes(c)) : 0;
    if (at < 0) continue;
    m.status = 'on_court';
    m.court = free.splice(at, 1)[0];
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
  return `${sideName(d, m, 'a')} vs ${sideName(d, m, 'b')}`;
}

/* ------------------------------------------------------------------ */
/* What a phone shows                                                   */
/* ------------------------------------------------------------------ */

export type NextFor =
  | { kind: 'not_in' }
  /** Quads: the field wasn't a multiple of 4 and this player is waitlisted (MixerMode's waitlist). */
  | { kind: 'alternate'; entry: DrawEntry; position: number; of: number }
  | { kind: 'done'; entry: DrawEntry; wins: number; losses: number }
  | { kind: 'on_court'; entry: DrawEntry; match: DrawMatch; side: 'a' | 'b'; court: number; courtName: string; opponent: string; partner: string | null }
  | { kind: 'up_next'; entry: DrawEntry; match: DrawMatch; side: 'a' | 'b'; opponent: string; ahead: number; partner: string | null; courts: string | null }
  | { kind: 'waiting'; entry: DrawEntry; match: DrawMatch; side: 'a' | 'b'; opponent: string; waitingOn: string; partner: string | null }
  /** Quads / pools: nothing on the draw for them right now, but more to come (the doubles, the playoffs). */
  | { kind: 'between'; entry: DrawEntry; stage: string; waitingOn: string; wins: number; losses: number };

/** A player's card: on a court now, up next, or waiting on someone (and who). */
export function nextFor(draw: Draw, rsvpId: string | null | undefined): NextFor {
  const entry = rsvpId ? draw.entries.find((e) => e.rsvpIds.includes(rsvpId)) : undefined;
  if (!entry) {
    const alt = rsvpId ? (draw.alternates ?? []).findIndex((e) => e.rsvpIds.includes(rsvpId)) : -1;
    return alt >= 0 ? { kind: 'alternate', entry: draw.alternates![alt], position: alt + 1, of: draw.alternates!.length } : { kind: 'not_in' };
  }
  const mine = (m: DrawMatch) => entriesIn(m).includes(entry.id);
  const sideFor = (m: DrawMatch): 'a' | 'b' => (sideIds(m, 'a').includes(entry.id) ? 'a' : 'b');
  const oppName = (m: DrawMatch) => sideName(draw, m, sideFor(m) === 'a' ? 'b' : 'a');
  const partnerOf = (m: DrawMatch) => {
    const p = sideIds(m, sideFor(m)).find((id) => id !== entry.id);
    return p ? entryOf(draw, p)?.name ?? null : null;
  };
  const record = () => {
    let wins = 0, losses = 0;
    for (const m of draw.matches) {
      if (m.status !== 'done' || !mine(m) || m.bye) continue;
      if (m.winner === sideFor(m)) wins++; else losses++;
    }
    return { wins, losses };
  };

  const now = draw.matches.find((m) => m.status === 'on_court' && mine(m));
  if (now) return { kind: 'on_court', entry, match: now, side: sideFor(now), court: now.court ?? 0, courtName: courtName(draw, now.court ?? 0), opponent: oppName(now), partner: partnerOf(now) };

  const left = draw.matches.filter((m) => m.status !== 'done' && mine(m)).sort(fillOrder);
  if (!left.length) {
    const more = betweenStages(draw, entry.id);
    if (more) return { kind: 'between', entry, ...more, ...record() };
    return { kind: 'done', entry, ...record() };
  }

  const busy = busyEntries(draw);
  const startable = (m: DrawMatch) => m.status === 'ready' && !m.held && !entriesIn(m).some((id) => busy.has(id));
  const go = left.find(startable);
  if (go) {
    // Matches the court fill would start before this one (quads: on the same court pair).
    const pair = allowedCourts(draw, go);
    const shares = (m: DrawMatch) => { if (!pair) return true; const c = allowedCourts(draw, m); return !c || c.some((x) => pair.includes(x)); };
    const queue = draw.matches.filter((m) => startable(m) && shares(m)).sort(fillOrder);
    const ahead = queue.indexOf(go);
    const courts = pair ? `Court${pair.length > 1 ? 's' : ''} ${pair.map((c) => courtName(draw, c)).join(' & ')}` : null;
    return { kind: 'up_next', entry, match: go, side: sideFor(go), opponent: oppName(go), ahead: Math.max(0, ahead), partner: partnerOf(go), courts };
  }
  const m = left[0];
  const side = sideFor(m);
  const others = entriesIn(m).filter((id) => id !== entry.id);
  const oppId = sideOf(m, side === 'a' ? 'b' : 'a');
  const busyId = others.find((id) => busy.has(id));
  let waitingOn: string;
  if (!oppId) {
    const feeder = draw.matches.find((x) => {
      const w = parseRef(x.winner_feeds_to), l = parseRef(x.loser_feeds_to);
      const want = side === 'a' ? 'b' : 'a';
      return (w?.key === m.key && w.side === want) || (l?.key === m.key && l.side === want);
    });
    waitingOn = feeder ? `${parseRef(feeder.loser_feeds_to)?.key === m.key ? 'the loser' : 'the winner'} of ${matchLabel(draw, feeder)}` : 'an opponent';
  } else if (busyId) {
    const at = draw.matches.find((x) => x.status === 'on_court' && entriesIn(x).includes(busyId));
    waitingOn = `${entryOf(draw, busyId)?.name ?? 'your opponent'}${at?.court ? ` (on Court ${courtName(draw, at.court)})` : ''}`;
  } else {
    waitingOn = 'the host to put it on a court';
  }
  return { kind: 'waiting', entry, match: m, side, opponent: oppName(m), waitingOn, partner: partnerOf(m) };
}

/* ------------------------------------------------------------------ */
/* Standings and the grid                                               */
/* ------------------------------------------------------------------ */

export type DrawStanding = {
  id: string; name: string; seed: number;
  /** Unique finishing order, 1..n (ties broken by wins, game difference, seed). */
  rank: number;
  /** Shared place: both semifinal losers of a single elimination are 3rd. */
  place: number;
  /** "Champion", "Finalist", "Semifinalist", "Consolation champion", "3rd", "5th–6th"... */
  label: string;
  wins: number; losses: number; gamesWon: number; gamesLost: number; played: number;
};

const asTournamentRows = (d: Draw) => d.matches.map((m) => ({
  id: m.key, round: m.round, slot: m.slot,
  player1_id: m.player1_id, player3_id: m.player3_id,
  score: m.score ?? null, winner_side: m.status === 'done' ? (m.winner ?? null) : null,
  status: m.status === 'done' ? 'completed' : m.status,
}));

export const ordinal = (n: number) => {
  const t = n % 100;
  return `${n}${t >= 11 && t <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
};

/** Games each side won in a stored (player1-first) score; markers count nothing. */
export function gamesOf(score: string | null | undefined): [number, number] {
  let a = 0, b = 0;
  for (const part of String(score ?? '').split(',')) {
    const g = part.trim().match(/^(\d+)-(\d+)$/);
    if (g) { a += +g[1]; b += +g[2]; }
  }
  return [a, b];
}

/** Per entry: real matches only (BYEs don't count); W/O and DEF count as a result with no games. */
function tallies(d: Draw) {
  const t = new Map(d.entries.filter((e) => !e.bye).map((e) => [e.id, { wins: 0, losses: 0, gamesWon: 0, gamesLost: 0, played: 0 }]));
  for (const m of d.matches) {
    if (m.status !== 'done' || m.bye || !m.player1_id || !m.player3_id) continue;
    // Every player on a side (a quads doubles has two entries a side): games count in full for each.
    const as = sideIds(m, 'a').map((id) => t.get(id)), bs = sideIds(m, 'b').map((id) => t.get(id));
    if (as.some((x) => !x) || bs.some((x) => !x)) continue;
    const [ga, gb] = gamesOf(m.score);
    for (const a of as) { a!.played++; a!.gamesWon += ga; a!.gamesLost += gb; if (m.winner === 'a') a!.wins++; else a!.losses++; }
    for (const b of bs) { b!.played++; b!.gamesWon += gb; b!.gamesLost += ga; if (m.winner === 'a') b!.losses++; else b!.wins++; }
  }
  return t;
}

/**
 * Standings / placements. Round robin: MixerMode's computeRRStandings (wins, game
 * difference, fewest games lost). Brackets: where each entry finished, or the places
 * it is still playing for (bracketKey / compassKey). BYEs are never listed.
 */
export function standingsFor(draw: Draw): DrawStanding[] {
  if (drawKind(draw.format) === 'rr') {
    const rows = computeRRStandings(draw.entries, asTournamentRows(draw));
    return rows.map((r) => {
      const e = entryOf(draw, r.entry_id)!;
      return { id: r.entry_id, name: e.name, seed: e.seed, rank: r.rank, place: r.rank, label: ordinal(r.rank), wins: r.match_wins, losses: r.match_losses, gamesWon: r.games_won, gamesLost: r.games_lost, played: r.match_wins + r.match_losses };
    });
  }
  const t = tallies(draw);
  const compass = drawKind(draw.format) === 'compass';
  const grouped = isGroupedFormat(draw.format) ? groupKeys(draw) : null;
  const keyed = draw.entries.filter((e) => !e.bye).map((e) => ({ e, ...(grouped ? grouped.get(e.id) ?? { key: [-999], label: null } : compass ? compassKey(draw, e.id) : bracketKey(draw, e.id)), t: t.get(e.id)! }));
  // Bigger key = better finish.
  const cmp = (x: number[], y: number[]) => { for (let i = 0; i < Math.max(x.length, y.length); i++) { const v = (y[i] ?? 0) - (x[i] ?? 0); if (v) return v; } return 0; };
  keyed.sort((x, y) => cmp(x.key, y.key) || y.t.wins - x.t.wins || (y.t.gamesWon - y.t.gamesLost) - (x.t.gamesWon - x.t.gamesLost) || x.e.seed - y.e.seed);
  return keyed.map((x, i) => {
    const place = 1 + keyed.filter((y) => cmp(y.key, x.key) < 0).length;
    const tied = keyed.filter((y) => cmp(y.key, x.key) === 0).length;
    const label = x.label ?? (tied > 1 ? `${ordinal(place)}–${ordinal(place + tied - 1)}` : ordinal(place));
    return { id: x.e.id, name: x.e.name, seed: x.e.seed, rank: i + 1, place, label, ...x.t };
  });
}

/** Main-draw rounds of a bracket (the final is the last). */
const mainRounds = (d: Draw) => Math.max(0, ...d.matches.filter((m) => m.bracket === 'main').map((m) => m.round));

/** "Final", "Semifinals", "Quarterfinals", "Round of 16"; the back draw's and the compass's own names. */
export function roundLabel(d: Draw, m: Pick<DrawMatch, 'bracket' | 'round'> & Partial<Pick<DrawMatch, 'group' | 'match_type' | 'tier' | 'places' | 'winner_feeds_to'>>): string {
  const k = drawKind(d.format);
  if (k === 'rr') return `Round ${m.round}`;
  if (isGroupedFormat(d.format)) return groupRoundLabel(d, { group: m.group ?? null, round: m.round, match_type: m.match_type ?? d.matchType, tier: m.tier ?? null, places: m.places ?? null, winner_feeds_to: m.winner_feeds_to ?? null });
  if (k === 'compass') {
    for (const g of buildCompassGroups(d.matches) ?? []) for (const st of g.stages) if (st.bracket === m.bracket && st.round === m.round) {
      if (g.id === 'r1') return 'Round 1';
      // The place goes on the match that decides it (a direction's last stage).
      const last = g.stages[g.stages.length - 1] === st;
      return `${g.direction.split(/ [·—] /)[0]} ${st.roundName.toLowerCase()}${last ? ` (${g.place.replace(/ /g, '')})` : ''}`;
    }
    return `Round ${m.round}`;
  }
  if (m.bracket === 'main') {
    const R = mainRounds(d);
    return m.round === R ? 'Final' : m.round === R - 1 ? 'Semifinals' : m.round === R - 2 ? 'Quarterfinals' : `Round of ${2 ** (R - m.round + 1)}`;
  }
  const cons = d.matches.filter((x) => x.bracket === 'consolation');
  const top = Math.max(...cons.map((x) => x.round));
  return m.round === top && cons.filter((x) => x.round === top).length === 1 ? 'Back draw final' : `Back draw · round ${m.round}`;
}

/**
 * Single elimination / FMLC / FFIC: a sort key (bigger = better) and, where it has a
 * name, the label. Main draw first; FFIC's back draw orders everyone behind the two
 * finalists (its winner is 3rd); FMLC's back draw only orders the first-round losers.
 */
function bracketKey(d: Draw, id: string): { key: number[]; label: string | null } {
  const k = drawKind(d.format);
  const R = mainRounds(d);
  const mine = d.matches.filter((m) => !m.bye && (m.player1_id === id || m.player3_id === id));
  const won = (m: DrawMatch) => m.status === 'done' && sideOf(m, m.winner === 'b' ? 'b' : 'a') === id;
  const main = mine.filter((m) => m.bracket === 'main');
  const final = main.find((m) => m.round === R);
  const champion = !!final && final.status === 'done' && won(final);
  const lostMain = main.find((m) => m.status === 'done' && !won(m));
  const mainReach = champion ? R + 1 : Math.max(0, ...main.map((m) => m.round));
  const finalTier = champion ? 2 : final ? 1 : 0;
  const cons = mine.filter((m) => m.bracket === 'consolation').sort((a, b) => a.round - b.round);
  const last = cons[cons.length - 1];
  const consReach = !lostMain ? 99 : last ? last.round * 2 + (won(last) ? 1 : 0) : 0;
  // The back draw's champion: the winner of its one top match.
  const allCons = d.matches.filter((m) => m.bracket === 'consolation');
  const top = allCons.length ? Math.max(...allCons.map((m) => m.round)) : 0;
  const topMatches = allCons.filter((m) => m.round === top);
  const consFinal = topMatches.length === 1 && !topMatches[0].winner_feeds_to ? topMatches[0] : null;
  let label: string | null = null;
  if (champion) label = 'Champion';
  else if (final) label = final.status === 'done' ? 'Finalist' : 'In the final';
  else if (consFinal && last === consFinal && consFinal.status === 'done') label = won(consFinal) ? 'Consolation champion' : 'Consolation finalist';
  else if (!lostMain) label = 'Still in';
  else if (k !== 'ffic' || !last) {
    const r = lostMain.round;
    label = r === R - 1 ? 'Semifinalist' : r === R - 2 ? 'Quarterfinalist' : `Round of ${2 ** (R - r + 1)}`;
  }
  const key = k === 'single-elim' ? [mainReach] : k === 'fmlc' ? [mainReach, consReach] : [finalTier, consReach, mainReach];
  return { key, label };
}

/** Compass places decided by each terminal match (bracket:round → the winner's place; the loser is next). */
const COMPASS_PLACES: Record<8 | 16, Record<string, number>> = {
  16: { 'main:4': 1, 'consolation:8': 3, 'consolation:5': 5, 'consolation:10': 7, 'consolation:3': 9, 'consolation:9': 11, 'consolation:7': 13, 'consolation:11': 15 },
  8: { 'main:3': 1, 'main:4': 3, 'consolation:2': 5, 'consolation:3': 7 },
};

/** The places a compass match still decides between: [best, worst]. */
function placeRange(d: Draw, m: DrawMatch, memo = new Map<string, [number, number]>()): [number, number] {
  const hit = memo.get(m.key);
  if (hit) return hit;
  const size = d.entries.length === 8 ? 8 : 16;
  const p = COMPASS_PLACES[size][`${m.bracket}:${m.round}`];
  let out: [number, number];
  if (p != null && !m.winner_feeds_to) out = [p, p + 1];
  else {
    const kids = [m.winner_feeds_to, m.loser_feeds_to]
      .map((r) => parseRef(r))
      .map((r) => (r ? d.matches.find((x) => x.key === r.key) : undefined))
      .filter((x): x is DrawMatch => !!x);
    const rs = kids.map((x) => placeRange(d, x, memo));
    out = rs.length ? [Math.min(...rs.map((r) => r[0])), Math.max(...rs.map((r) => r[1]))] : [1, size];
  }
  memo.set(m.key, out);
  return out;
}

/** Compass: the place an entry finished (BYEs included, compressed later), or the range it is still playing for. */
function compassKey(d: Draw, id: string): { key: number[]; label: string | null } {
  const mine = d.matches.filter((m) => m.player1_id === id || m.player3_id === id);
  const open = mine.find((m) => m.status !== 'done');
  let range: [number, number];
  if (open) range = placeRange(d, open);
  else {
    // Every match is done: the terminal one (it decides exactly two places) says where they finished.
    const last = mine.find((m) => !m.winner_feeds_to);
    if (!last) range = [1, d.entries.length];
    else {
      const [best] = placeRange(d, last);
      const p = sideOf(last, last.winner === 'b' ? 'b' : 'a') === id ? best : best + 1;
      range = [p, p];
    }
  }
  return { key: [-range[0], -range[1]], label: null };
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
  const real = d.matches.filter((m) => !m.bye);
  const n = (s: DrawStatus) => real.filter((m) => m.status === s).length;
  // Quads doubles / pool playoffs not added yet still count: they're coming.
  const toCome = matchesToCome(d);
  return { total: real.length + toCome, done: n('done'), onCourt: n('on_court'), ready: n('ready'), pending: n('pending') + toCome, complete: d.matches.length > 0 && !toCome && d.matches.every((m) => m.status === 'done') };
}

/** Matches grouped for a list: "Flight A · Round 1", ..., then the playoffs; a bracket's main draw before its back draw. */
export const stageKey = (m: DrawMatch) => `${m.group ?? ''}|${m.tier != null ? 'p' : m.bracket}:${m.round}`;
export function stageOrder(d: Draw, m: DrawMatch): number {
  if (isGroupedFormat(d.format)) {
    const gi = m.group ? (d.groups ?? []).findIndex((g) => g.id === m.group) : -1;
    return (gi >= 0 ? gi * 100 : 9000) + m.round;
  }
  return (isBracket(d.format) && m.bracket === 'consolation' ? 1000 : 0) + m.round;
}

/* ------------------------------------------------------------------ */
/* Late arrivals and the pre-start math                                 */
/* ------------------------------------------------------------------ */

const pairOf = (m: Pick<DrawMatch, 'player1_id' | 'player3_id'>) => [m.player1_id, m.player3_id].sort().join('|');

/**
 * A late arrival joins a round robin, only while no match is finished: the schedule is
 * remade with them added last, and every match already on a court (or held) stays exactly
 * where it is (every pair still meets once, so it is in the new schedule too). Brackets
 * never take late entries: the lines are set when the draw is made.
 */
export function addLateEntry(draw: Draw, group: DrawPlayer[], now: string = new Date().toISOString()): Draw {
  if (drawKind(draw.format) === 'quads') throw new DrawError('The flights are set once the quads draw is made, so nobody new can join. They can play the next one.');
  if (drawKind(draw.format) === 'rr-pools') throw new DrawError('The pools are set once the draw is made, so nobody new can join. They can play the next one.');
  if (drawKind(draw.format) !== 'rr') throw new DrawError('A bracket can’t take late entries once the draw is made: the lines are set. They can play the next one.');
  if (draw.matches.some((m) => m.status === 'done')) throw new DrawError('The draw is already under way (a match is finished), so nobody new can join it. If someone in the draw has to leave, give their opponents a walkover.');
  const doubles = draw.matchType === 'doubles';
  if (group.length !== (doubles ? 2 : 1)) throw new DrawError(doubles ? 'A late doubles entry is a pair: pick two players.' : 'Pick one player to add.');
  if (doubles && group[0].id === group[1].id) throw new DrawError('A player can’t partner themselves.');
  for (const p of group) if (draw.entries.some((e) => e.rsvpIds.includes(p.id))) throw new DrawError(`${p.name} is already in the draw.`);
  const problem = drawSizeProblem(draw.format, draw.entries.length + 1);
  if (problem) throw new DrawError(problem);
  let n = draw.entries.length + 1;
  while (draw.entries.some((e) => e.id === `e${n}`)) n++;
  const entry: DrawEntry = { id: `e${n}`, rsvpIds: group.map((p) => p.id), name: group.map((p) => p.name).join(' / '), players: group.map((p) => p.name), seed: draw.entries.length + 1, level: avgLevel(group) };
  const entries = [...draw.entries.map((e) => ({ ...e })), entry];
  const keep = new Map(draw.matches.filter((m) => m.status === 'on_court' || m.held).map((m) => [pairOf(m), m]));
  const matches: DrawMatch[] = generateTournamentMatches(draw.format as TournamentFormat, entries.map((e) => e.id)).map((m) => {
    const o = keep.get(pairOf(m));
    return {
      ...m, key: matchKey(m), winner: null, score: null, how: null,
      court: o?.status === 'on_court' ? o.court ?? null : null,
      status: o?.status === 'on_court' ? 'on_court' : 'ready',
      startedAt: o?.status === 'on_court' ? o.startedAt ?? now : null,
      finishedAt: null,
      held: o?.held ?? false,
    };
  });
  return fillCourts({ ...draw, entries, matches }, now);
}

/** What a draw of this many entries looks like: real matches in all, and per entry (from a played-out copy). */
export function drawPlan(format: DrawFormat, entries: number, opts: { pools?: number | null } = {}): { problem: string } | { matches: number; minEach: number; maxEach: number; groups?: number; alternates?: number } {
  const problem = drawSizeProblem(format, entries);
  if (problem) return { problem };
  const doubles = drawIsDoubles(format);
  const ps: DrawPlayer[] = Array.from({ length: entries * (doubles ? 2 : 1) }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));
  const t0 = '2000-01-01T00:00:00.000Z';
  let d = buildDraw(format, ps, 1, { now: t0, pools: opts.pools ?? null });
  const groups = d.groups?.length ?? 0, alternates = d.alternates?.length ?? 0;
  for (let guard = 0; guard < 2000; guard++) {
    const m = d.matches.find((x) => x.status === 'ready');
    if (!m) break;
    d = applyResult(d, m.key, 'a', '6-0', { now: t0 });
  }
  const counts = d.entries.filter((e) => !e.bye).map((e) => d.matches.filter((m) => !m.bye && entriesIn(m).includes(e.id)).length);
  return { matches: d.matches.filter((m) => !m.bye).length, minEach: Math.min(...counts), maxEach: Math.max(...counts), ...(isGroupedFormat(format) ? { groups, alternates } : {}) };
}

/** Stored player1-first; read out winner-first ("6-4, 3-6, 10-7"), markers as they are. */
export function scoreWinnerFirst(m: Pick<DrawMatch, 'score' | 'winner'>): string {
  const s = m.score ?? '';
  if (m.winner !== 'b') return s;
  return s.split(',').map((x) => { const t = x.trim(); const g = t.match(/^(\d+)-(\d+)$/); return g ? `${g[2]}-${g[1]}` : t; }).join(', ');
}

/** Who won and lost a done match (entry ids). */
export function resultOf(m: DrawMatch): { winner: string; loser: string } | null {
  if (m.status !== 'done' || !m.player1_id || !m.player3_id) return null;
  return m.winner === 'b' ? { winner: m.player3_id, loser: m.player1_id } : { winner: m.player1_id, loser: m.player3_id };
}

/** The back draw's (or compass West's) champion entry id, once that final is played. */
export function consolationChampion(d: Draw): string | null {
  const k = drawKind(d.format);
  if (k === 'rr' || k === 'single-elim' || isGroupedFormat(d.format)) return null;
  if (k === 'compass') {
    const m = d.matches.find((x) => x.key === (d.entries.length === 8 ? 'consolation:2:1' : 'consolation:3:1'));
    const r = m ? resultOf(m) : null;
    return r && !d.entries.find((e) => e.id === r.winner)?.bye ? r.winner : null;
  }
  return standingsFor(d).find((s) => s.label === 'Consolation champion')?.id ?? null;
}
