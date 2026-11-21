/**
 * Racquets IRL tournaments in groups: QUADS and ROUND-ROBIN POOLS WITH PLACEMENT PLAYOFFS.
 *
 * Pure (no DB, no React). draw.ts calls in here for the parts that only grouped draws
 * have; everything else (scores, court fill, phone cards, standings plumbing) is the
 * same draw code the round robin and the brackets run.
 *
 * QUADS is MixerMode's format, on MixerMode's own pure engine (lib/quads.ts):
 *   - assignToFlights: strongest four are Flight A, next four Flight B, ... Anyone left
 *     over (the field isn't a multiple of 4) is WAITLISTED, exactly as MixerMode does:
 *     the lowest seeds become the draw's `alternates` and their phones say so.
 *     MixerMode has no flight of 3 or 5 (generateQuadSingles is strictly four), so
 *     neither do we.
 *   - generateQuadSingles: three singles rounds (1v4 2v3, 1v3 2v4, 1v2 3v4).
 *   - buildQuadDoublesRound: the moment a flight's sixth singles score is in, its round-4
 *     doubles (1st + 4th vs 2nd + 3rd, computeFlightStandings) is added to the draw.
 *     A corrected singles score re-pairs a doubles that hasn't started; a played doubles
 *     stands as played (MixerMode's syncQuadDoublesRound does the same).
 *   - computeQuadFinalStandings: the flight's places (games across all four rounds, then
 *     match wins, head-to-head, games lost, singles rank).
 *   - autoScheduleQuads: each flight keeps one fixed court pair all day (Flight A courts
 *     1-2, B 3-4, ...); with fewer courts than 2 per flight, later flights share the first
 *     pairs. The court fill only ever puts a flight's match on its own pair.
 *
 * POOLS reuses lib/tournamentPools.ts: seeds are snaked into 2-4 pools, every pool plays a
 * round robin (generateRRMatches), pool standings come from poolStandings, and once every
 * pool match is done the PLACEMENT PLAYOFFS are added to the same draw: the i-th finishers
 * of every pool play off for places. Two pools is planPlacementPlayoffs exactly (Pool A #i
 * vs Pool B #i). Three or four pools: the i-th finishers are ordered by record and play a
 * one-match final (2), a semi + final (3: the best record waits in the final) or semis,
 * final and a 3rd-place match (4). A finisher with nobody to play (uneven pools) takes the
 * tier's place straight away.
 */
import {
  assignToFlights,
  autoScheduleQuads,
  buildQuadDoublesRound,
  computeFlightStandings,
  computeQuadFinalStandings,
  generateQuadSingles,
  isFlightComplete,
  isValidQuadScore,
  QUAD_SCORING_FORMATS,
  type QuadMatchView,
} from '@/lib/quads';
import { generateRRMatches, type GeneratedMatch } from '@/lib/tournamentFormats';
import { isPoolComplete, planPlacementPlayoffs, poolStandings, type PoolMatch } from '@/lib/tournamentPools';
import { buildRoundRobinGrid, type RRFlight } from '@/lib/roundRobinGrid';
import type { RRStanding } from '@/lib/tournamentFormats';
import { DrawError } from './drawError';
import type { Draw, DrawEntry, DrawGroup, DrawMatch } from './draw';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const ord = (n: number) => {
  const t = n % 100;
  return `${n}${t >= 11 && t <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
};
const key = (round: number, slot: number) => `main:${round}:${slot}`;
const started = (m: DrawMatch) => m.status === 'on_court' || m.status === 'done';

export const isQuadsFormat = (f: string) => f === 'quads';
export const isPoolsFormat = (f: string) => f === 'rr-pools-singles' || f === 'rr-pools-doubles';
/** Quads or pools: the draw is made of groups (flights / pools). */
export const isGroupedFormat = (f: string) => isQuadsFormat(f) || isPoolsFormat(f);

/* ------------------------------------------------------------------ */
/* Scoring (quads)                                                      */
/* ------------------------------------------------------------------ */

/** The quads scoring formats a host can pick (MixerMode's list, minus "write your own"). */
export const QUADS_SCORING = QUAD_SCORING_FORMATS.filter((f) => f.id !== 'custom');
export const DEFAULT_QUADS_SCORING = 'pro8';
export const isQuadsScoring = (v: unknown): v is string => typeof v === 'string' && QUADS_SCORING.some((f) => f.id === v);
export const quadsScoringName = (v: string | null | undefined) => QUADS_SCORING.find((f) => f.id === v)?.label ?? QUADS_SCORING.find((f) => f.id === DEFAULT_QUADS_SCORING)!.label;

/** The score box's hint for a scoring format (winner first, like every draw score). */
export function scoreHint(scoring: string | null | undefined): string {
  const s = scoring ?? '';
  if (/^pro(\d+)$/.test(s)) { const n = +s.slice(3); return `Winner first: ${n}-${Math.max(0, n - 3)}`; }
  if (s === 'fast4' || s === 'set4') return 'Winner first: 4-2';
  if (s === 'set6') return 'Winner first: 6-4';
  if (s === 'best3') return 'Winner first: 6-4 6-3';
  if (s === 'best3_mtb') return 'Winner first: 6-4 3-6 10-7';
  if (s.startsWith('timed')) return 'Winner first, total games: 14-11';
  return 'Winner first: 6-4 6-3';
}

/* ------------------------------------------------------------------ */
/* Build                                                                */
/* ------------------------------------------------------------------ */

export type GroupedBuild = {
  entries: DrawEntry[];
  alternates: DrawEntry[];
  groups: DrawGroup[];
  matches: (GeneratedMatch & { group: string })[];
};

/**
 * Quads: the seeded field (best first) into flights of four with MixerMode's assignToFlights.
 * The rating handed in is the seed order itself, so the host's seeds, then levels, then
 * signup order decide the flights. Leftovers (fewer than four) are the alternates.
 */
export function buildQuads(seeded: DrawEntry[]): GroupedBuild {
  const n = seeded.length;
  const { flights, waitlistIds } = assignToFlights(seeded.map((e, i) => ({ id: e.id, composite_rating: n - i })));
  if (!flights.length) throw new DrawError(`Quads needs at least 4 players checked in (${n} here).`);
  const groups: DrawGroup[] = flights.map((f, i) => ({ id: LETTERS[i], name: f.name, entryIds: f.entryIds, tier: f.tier_label }));
  const matches: GroupedBuild['matches'] = [];
  groups.forEach((g, fi) => {
    const seen = new Map<number, number>();
    for (const q of generateQuadSingles(g.entryIds as [string, string, string, string])) {
      const k = seen.get(q.round) ?? 0;
      seen.set(q.round, k + 1);
      matches.push({
        bracket: 'main', round: q.round, slot: fi * 2 + k + 1, match_type: 'singles',
        player1_id: q.player1_id, player2_id: null, player3_id: q.player3_id, player4_id: null,
        winner_feeds_to: null, loser_feeds_to: null, group: g.id,
      });
    }
  });
  const waiting = new Set(waitlistIds);
  return { entries: seeded.filter((e) => !waiting.has(e.id)), alternates: seeded.filter((e) => waiting.has(e.id)), groups, matches };
}

/** Pools a field of n entries can take (each pool needs 3+). */
export const MAX_POOLS = 4;
export const poolChoices = (n: number) => [2, 3, 4].filter((k) => k <= MAX_POOLS && n >= k * 3);
/** About six to a pool: 6-12 → 2 pools, 13-18 → 3, 19+ → 4. */
export const autoPools = (n: number) => Math.max(2, Math.min(MAX_POOLS, Math.ceil(n / 6), Math.floor(n / 3)));
export const poolCountFor = (n: number, want?: number | null) => (want && poolChoices(n).includes(want) ? want : autoPools(n));

/** Pools: seeds snaked into pools (1 2 3 / 6 5 4 / 7 8 9 ...), a round robin in each. */
export function buildPools(seeded: DrawEntry[], matchType: 'singles' | 'doubles', want?: number | null): GroupedBuild {
  const k = poolCountFor(seeded.length, want);
  const ids: string[][] = Array.from({ length: k }, () => []);
  seeded.forEach((e, i) => {
    const row = Math.floor(i / k), col = i % k;
    ids[row % 2 === 0 ? col : k - 1 - col].push(e.id);
  });
  const groups: DrawGroup[] = ids.map((entryIds, i) => ({ id: LETTERS[i], name: `Pool ${LETTERS[i]}`, entryIds }));
  const next = new Map<number, number>();
  const matches: GroupedBuild['matches'] = [];
  for (const g of groups) {
    for (const m of generateRRMatches(g.entryIds, matchType)) {
      const slot = (next.get(m.round) ?? 0) + 1;
      next.set(m.round, slot);
      matches.push({ ...m, match_type: matchType, slot, group: g.id });
    }
  }
  return { entries: seeded, alternates: [], groups, matches };
}

/* ------------------------------------------------------------------ */
/* Courts (quads: each flight on its own pair)                          */
/* ------------------------------------------------------------------ */

/** Each flight's courts, from MixerMode's autoScheduleQuads (court numbers, 1-based). */
export function quadCourtPairs(courts: number, flights: number): number[][] {
  const sched = autoScheduleQuads({
    startTime: '00:00', roundDurationMinutes: 1, numCourts: Math.max(1, courts),
    flights: Array.from({ length: flights }, (_, i) => ({ id: String(i), sort_order: i, matches: [{ id: `${i}a`, round: 1 }, { id: `${i}b`, round: 1 }] })),
  });
  return Array.from({ length: flights }, (_, i) => [...new Set([sched.get(`${i}a`)?.court, sched.get(`${i}b`)?.court].filter(Boolean).map(Number))]);
}

/** The courts a match may go on (null = any free court). */
export function allowedCourts(d: Draw, m: DrawMatch): number[] | null {
  if (!isQuadsFormat(d.format) || !m.group || !d.groups?.length) return null;
  const gi = d.groups.findIndex((g) => g.id === m.group);
  return gi < 0 ? null : quadCourtPairs(d.courts, d.groups.length)[gi] ?? null;
}

/** "Courts 1 & 2" for a flight (court names, as the club numbers them). */
export function groupCourtsText(d: Draw, g: DrawGroup, name: (n: number) => string): string | null {
  if (!isQuadsFormat(d.format) || !d.groups) return null;
  const cs = quadCourtPairs(d.courts, d.groups.length)[d.groups.indexOf(g)] ?? [];
  return cs.length ? `Court${cs.length > 1 ? 's' : ''} ${cs.map(name).join(' & ')}` : null;
}

/* ------------------------------------------------------------------ */
/* Quads: views, the doubles round, places                              */
/* ------------------------------------------------------------------ */

const qView = (m: DrawMatch): QuadMatchView => ({
  player1_id: m.player1_id, player2_id: m.player2_id, player3_id: m.player3_id, player4_id: m.player4_id,
  score: m.score ?? null, winner_side: m.status === 'done' ? (m.winner ?? null) : null,
  status: m.status === 'done' ? 'completed' : m.status, match_type: m.match_type, round: m.round,
});
const flightEntries = (g: DrawGroup) => g.entryIds.map((id, i) => ({ id, flight_seed: i + 1 }));
const groupMatches = (d: Draw, g: DrawGroup) => d.matches.filter((m) => m.group === g.id);

/** Same two teams, whichever side or slot each player sits in (quadDoubles.sameDoublesPairing). */
const teams = (m: Pick<DrawMatch, 'player1_id' | 'player2_id' | 'player3_id' | 'player4_id'>) =>
  [[m.player1_id, m.player2_id].sort().join('+'), [m.player3_id, m.player4_id].sort().join('+')].sort().join('|');

/** After a result: any flight whose six singles are in gets its doubles (or a fresh pairing). */
function syncQuadDoubles(d: Draw) {
  (d.groups ?? []).forEach((g, fi) => {
    const ms = groupMatches(d, g);
    const singles = ms.filter((m) => m.match_type === 'singles');
    if (singles.length !== 6 || singles.some((m) => m.status !== 'done')) return;
    const p = buildQuadDoublesRound(computeFlightStandings(flightEntries(g), singles.map(qView)));
    if (!p) return;
    const want = { player1_id: p.player1_id, player2_id: p.player2_id, player3_id: p.player3_id, player4_id: p.player4_id };
    const dbl = ms.find((m) => m.match_type === 'doubles');
    if (!dbl) {
      d.matches.push({
        bracket: 'main', round: 4, slot: fi + 1, match_type: 'doubles', ...want,
        winner_feeds_to: null, loser_feeds_to: null, group: g.id,
        key: key(4, fi + 1), winner: null, score: null, court: null, status: 'ready', startedAt: null, finishedAt: null,
      });
      return;
    }
    if (teams(dbl) === teams(want)) return;
    // Played: it stands as played (MixerMode). On a court: the players are mid-match.
    if (dbl.status === 'done') return;
    if (dbl.status === 'on_court') throw new DrawError(`That changes ${g.name}’s doubles pairs, and the doubles is on a court. Take it off the court first, then fix the score.`);
    Object.assign(dbl, want);
  });
}

/* ------------------------------------------------------------------ */
/* Pools: standings, the placement playoffs                             */
/* ------------------------------------------------------------------ */

const poolRows = (d: Draw): PoolMatch[] => d.matches.filter((m) => m.group).map((m) => ({
  player1_id: m.player1_id, player3_id: m.player3_id, score: m.score ?? null,
  winner_side: m.status === 'done' ? (m.winner ?? null) : null, status: m.status === 'done' ? 'completed' : m.status,
  bracket: m.bracket, round: m.round, slot: m.slot,
}));
export const poolsComplete = (d: Draw) => {
  const rows = poolRows(d);
  return (d.groups ?? []).every((g) => isPoolComplete(g.entryIds, rows) || g.entryIds.length < 2);
};
/** Each pool's standings (MixerMode's computeRRStandings, within-pool matches only). */
export const poolTables = (d: Draw): RRStanding[][] => {
  const rows = poolRows(d);
  return (d.groups ?? []).map((g) => poolStandings(g.entryIds, rows));
};

type Tier = { tier: number; offset: number; ids: string[] };

/** The i-th finishers of every pool, ordered for the playoff: places offset .. offset+size-1. */
function tiers(d: Draw): Tier[] {
  const tabs = poolTables(d);
  const seed = (id: string) => d.entries.find((e) => e.id === id)?.seed ?? 999;
  const longest = Math.max(0, ...tabs.map((t) => t.length));
  const out: Tier[] = [];
  let offset = 1;
  if (tabs.length === 2) {
    const { pairs, unpaired } = planPlacementPlayoffs(d.groups!.map((g) => g.entryIds), tabs);
    for (const p of pairs) { out.push({ tier: p.slot, offset, ids: [p.sideA, p.sideB] }); offset += 2; }
    for (const u of unpaired.sort((a, b) => a.poolRank - b.poolRank || a.poolIndex - b.poolIndex)) { out.push({ tier: u.poolRank, offset, ids: [u.entry] }); offset += 1; }
    return out;
  }
  for (let i = 0; i < longest; i++) {
    const rows = tabs.map((t) => t[i]).filter((r): r is RRStanding => !!r);
    rows.sort((a, b) => b.match_wins - a.match_wins || (b.games_won - b.games_lost) - (a.games_won - a.games_lost) || a.games_lost - b.games_lost || seed(a.entry_id) - seed(b.entry_id));
    out.push({ tier: i + 1, offset, ids: rows.map((r) => r.entry_id) });
    offset += rows.length;
  }
  return out;
}

/** Tier sizes from the pool sizes alone (known before a ball is hit). */
const tierSizes = (d: Draw) => {
  const sizes = (d.groups ?? []).map((g) => g.entryIds.length);
  if (sizes.length === 2) {
    const n = Math.min(...sizes);
    return [...Array(n).fill(2), ...Array(Math.max(...sizes) - n).fill(1)] as number[];
  }
  return Array.from({ length: Math.max(0, ...sizes) }, (_, i) => sizes.filter((s) => s > i).length);
};
const playoffCount = (size: number) => (size === 2 ? 1 : size === 3 ? 2 : size === 4 ? 4 : 0);

/** The playoff matches the finished pools call for (seats filled; fed sides left TBD). */
function planPlayoffs(d: Draw): DrawMatch[] {
  const R = Math.max(0, ...d.matches.filter((m) => m.group).map((m) => m.round));
  const slots = new Map<number, number>();
  const at = (round: number) => { const s = (slots.get(round) ?? 0) + 1; slots.set(round, s); return s; };
  const out: DrawMatch[] = [];
  const mk = (round: number, slot: number, tier: number, a: string | null, b: string | null, places: [number | null, number | null], w: string | null = null, l: string | null = null): DrawMatch => ({
    bracket: 'main', round, slot, match_type: d.matchType, player1_id: a, player2_id: null, player3_id: b, player4_id: null,
    winner_feeds_to: w, loser_feeds_to: l, group: null, tier, places,
    key: key(round, slot), winner: null, score: null, court: null, status: a && b ? 'ready' : 'pending', startedAt: null, finishedAt: null,
  });
  for (const t of tiers(d)) {
    const [s1, s2, s3, s4] = t.ids, o = t.offset;
    if (t.ids.length === 2) out.push(mk(R + 1, at(R + 1), t.tier, s1, s2, [o, o + 1]));
    else if (t.ids.length === 3) {
      const fin = at(R + 2), semi = at(R + 1);
      out.push(mk(R + 1, semi, t.tier, s2, s3, [null, o + 2], `${key(R + 2, fin)}:b`));
      out.push(mk(R + 2, fin, t.tier, s1, null, [o, o + 1]));
    } else if (t.ids.length === 4) {
      const sa = at(R + 1), sb = at(R + 1), fin = at(R + 2), third = at(R + 2);
      out.push(mk(R + 1, sa, t.tier, s1, s4, [null, null], `${key(R + 2, fin)}:a`, `${key(R + 2, third)}:a`));
      out.push(mk(R + 1, sb, t.tier, s2, s3, [null, null], `${key(R + 2, fin)}:b`, `${key(R + 2, third)}:b`));
      out.push(mk(R + 2, fin, t.tier, null, null, [o, o + 1]));
      out.push(mk(R + 2, third, t.tier, null, null, [o + 2, o + 3]));
    }
  }
  return out;
}

/**
 * After a result: once every pool match is done, the playoffs go in. A corrected pool score
 * that changes who is seated where re-seats any playoff match that hasn't started; one that
 * has started can't be changed under the players (fix that match first).
 */
function syncPlayoffs(d: Draw) {
  if (!poolsComplete(d)) return;
  const plan = planPlayoffs(d);
  const have = d.matches.filter((m) => m.tier != null);
  if (!have.length) { d.matches.push(...plan); return; }
  for (const want of plan) {
    const m = d.matches.find((x) => x.key === want.key);
    if (!m) { d.matches.push(want); continue; }
    for (const s of ['a', 'b'] as const) {
      const id = s === 'a' ? want.player1_id : want.player3_id;
      const cur = s === 'a' ? m.player1_id : m.player3_id;
      if (!id || id === cur) continue;
      if (started(m)) throw new DrawError(`Can’t change that result: it changes who plays in the playoffs, and that match has already ${m.status === 'done' ? 'been played' : 'started'}. Fix that one first.`);
      if (s === 'a') m.player1_id = id; else m.player3_id = id;
      m.status = m.player1_id && m.player3_id ? 'ready' : 'pending';
    }
  }
}

/** Called by applyResult: whatever a grouped draw adds once a result is in. */
export function syncGroups(d: Draw) {
  if (isQuadsFormat(d.format)) syncQuadDoubles(d);
  else if (isPoolsFormat(d.format)) syncPlayoffs(d);
}

/** Matches still to be added (quads doubles not yet paired, playoffs not yet set): for the progress count. */
export function matchesToCome(d: Draw): number {
  if (isQuadsFormat(d.format)) return (d.groups ?? []).filter((g) => !groupMatches(d, g).some((m) => m.match_type === 'doubles')).length;
  if (isPoolsFormat(d.format) && !d.matches.some((m) => m.tier != null)) return tierSizes(d).reduce((s, n) => s + playoffCount(n), 0);
  return 0;
}

/* ------------------------------------------------------------------ */
/* Labels, places, the phone's "between stages"                         */
/* ------------------------------------------------------------------ */

const placeText = (a: number, b: number) => (a === b ? ord(a) : `${ord(a)}–${ord(b)}`);

/** "Flight B · Round 2", "Flight B · Round 4 doubles", "Pool A · Round 3", "Final (1st–2nd)", "Playoff semis (5th–8th)". */
export function groupRoundLabel(d: Draw, m: Pick<DrawMatch, 'group' | 'round' | 'match_type' | 'tier' | 'places' | 'winner_feeds_to'>): string {
  const g = m.group ? d.groups?.find((x) => x.id === m.group) : null;
  if (g) return `${g.name} · Round ${m.round}${isQuadsFormat(d.format) && m.match_type === 'doubles' ? ' doubles' : ''}`;
  if (m.tier == null) return `Round ${m.round}`;
  const t = d.matches.filter((x) => x.tier === m.tier && x.places);
  const ps = t.flatMap((x) => x.places!.filter((p): p is number => p != null));
  const lo = Math.min(...ps), hi = Math.max(...ps);
  const [w, l] = m.places ?? [null, null];
  if (w != null && l != null) return w === 1 ? 'Final (1st–2nd)' : w === 3 && lo === 1 ? '3rd-place match' : `Playoff for ${placeText(w, l)}`;
  return `Playoff semi${t.filter((x) => x.winner_feeds_to).length > 1 ? 's' : ''} (${placeText(lo, hi)})`;
}

/** Per entry: a sort key (bigger = better finish) and its label. Feeds standingsFor. */
export function groupKeys(d: Draw): Map<string, { key: number[]; label: string }> {
  const out = new Map<string, { key: number[]; label: string }>();
  if (isQuadsFormat(d.format)) {
    (d.groups ?? []).forEach((g, fi) => {
      const ms = groupMatches(d, g).map(qView);
      const complete = isFlightComplete(ms);
      for (const r of computeQuadFinalStandings(flightEntries(g), ms)) {
        out.set(r.entry_id, { key: [-(fi * 4 + r.rank)], label: complete && r.rank === 1 ? `${g.name} champion` : `${g.name} · ${ord(r.rank)}` });
      }
    });
    return out;
  }
  const tabs = poolTables(d);
  if (!d.matches.some((m) => m.tier != null)) {
    // Pool play: the pool rank is the whole story so far (ties across pools share it).
    d.groups?.forEach((g, gi) => tabs[gi].forEach((r) => out.set(r.entry_id, { key: [-r.rank], label: `${g.name} · ${ord(r.rank)}` })));
    return out;
  }
  for (const t of tiers(d)) {
    const last = t.offset + t.ids.length - 1;
    for (const id of t.ids) {
      let lo = t.offset, hi = last;
      if (t.ids.length > 1) {
        const mine = d.matches.filter((m) => m.tier === t.tier && (m.player1_id === id || m.player3_id === id));
        const won = (m: DrawMatch) => (m.winner === 'b' ? m.player3_id : m.player1_id) === id;
        const fixed = mine.map((m) => (m.status === 'done' ? m.places?.[won(m) ? 0 : 1] ?? null : null)).find((p) => p != null);
        const open = mine.find((m) => m.status !== 'done');
        if (fixed != null) lo = hi = fixed;
        else if (open?.places && open.places[0] != null && open.places[1] != null) { lo = open.places[0]; hi = open.places[1]; }
      }
      const label = lo !== hi ? `Playing for ${placeText(lo, hi)}` : lo === 1 ? 'Champion' : lo === 2 && t.offset === 1 ? 'Finalist' : ord(lo);
      out.set(id, { key: [-lo, -hi], label });
    }
  }
  return out;
}

/** A player with nothing on the draw yet but more to come (quads doubles, pool playoffs): what they wait on. */
export function betweenStages(d: Draw, entryId: string): { stage: string; waitingOn: string } | null {
  if (isQuadsFormat(d.format)) {
    const g = d.groups?.find((x) => x.entryIds.includes(entryId));
    if (!g || groupMatches(d, g).some((m) => m.match_type === 'doubles')) return null;
    const left = groupMatches(d, g).filter((m) => m.status !== 'done').length;
    return { stage: `${g.name} · Round 4 doubles`, waitingOn: `the rest of ${g.name}’s singles (${left} to go): the doubles pairs come from the singles places` };
  }
  if (isPoolsFormat(d.format) && !d.matches.some((m) => m.tier != null)) {
    const left = d.matches.filter((m) => m.group && m.status !== 'done').length;
    return { stage: 'Placement playoffs', waitingOn: `the other pools (${left} match${left === 1 ? '' : 'es'} to go): the playoffs are set when every pool match is done` };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* The tables a phone, the TV and the print sheet show                  */
/* ------------------------------------------------------------------ */

export type GroupRow = { id: string; name: string; seed: number; rank: number; wins: number; losses: number; gamesWon: number; gamesLost: number; label: string | null };
export type GroupTable = {
  group: DrawGroup;
  courts: string | null;
  rows: GroupRow[];
  grid: RRFlight | null;
  /** Quads: the round-4 doubles (or null until it is paired). */
  doubles: DrawMatch | null;
};

/** One table per flight / pool: its standings, its crosstab grid, and (quads) its doubles. */
export function groupTables(d: Draw, courtLabel: (n: number) => string): GroupTable[] {
  const name = (id: string) => d.entries.find((e) => e.id === id)?.name ?? '?';
  const seed = (id: string) => d.entries.find((e) => e.id === id)?.seed ?? 0;
  const quads = isQuadsFormat(d.format);
  const tabs = quads ? null : poolTables(d);
  return (d.groups ?? []).map((g, gi) => {
    const ms = groupMatches(d, g);
    const singles = ms.filter((m) => m.match_type === 'singles' || !quads);
    let rows: GroupRow[];
    if (quads) {
      const views = ms.map(qView);
      const complete = isFlightComplete(views);
      rows = computeQuadFinalStandings(flightEntries(g), views).map((r) => ({
        id: r.entry_id, name: name(r.entry_id), seed: seed(r.entry_id), rank: r.rank, wins: r.match_wins, losses: r.match_losses,
        gamesWon: r.games_won, gamesLost: r.games_lost, label: complete && r.rank === 1 ? 'Champion' : null,
      }));
    } else {
      rows = tabs![gi].map((r) => ({ id: r.entry_id, name: name(r.entry_id), seed: seed(r.entry_id), rank: r.rank, wins: r.match_wins, losses: r.match_losses, gamesWon: r.games_won, gamesLost: r.games_lost, label: null }));
    }
    const grid = buildRoundRobinGrid(
      g.entryIds.map((id) => ({ id, player_name: name(id), partner_name: null, seed: seed(id) })),
      singles.map((m) => ({ id: m.key, round: m.round, slot: m.slot, player1_id: m.player1_id, player3_id: m.player3_id, score: m.score ?? null, winner_side: m.status === 'done' ? (m.winner ?? null) : null, status: m.status === 'done' ? 'completed' : m.status })),
    ).flights[0] ?? null;
    return { group: g, courts: groupCourtsText(d, g, courtLabel), rows, grid, doubles: quads ? ms.find((m) => m.match_type === 'doubles') ?? null : null };
  });
}

/** Pools: the playoff matches in play order (empty until the pools are done). */
export const playoffMatches = (d: Draw) => d.matches.filter((m) => m.tier != null).sort((a, b) => (a.tier! - b.tier!) || a.round - b.round || a.slot - b.slot);

/**
 * Quads scores: MixerMode's isValidQuadScore on the stored text, and the set count the
 * host's format allows (a pro set, Fast4, one set or a timed match is one score; best of
 * three is up to three). Null = fine.
 */
export function quadsScoreProblem(scoring: string | null | undefined, text: string): string | null {
  if (!isValidQuadScore(text)) return 'Type the score like 8-5 (winner first).';
  const sets = text.split(',').filter((x) => x.trim()).length;
  const s = scoring ?? DEFAULT_QUADS_SCORING;
  if (s.startsWith('best3')) return sets > 3 ? 'Best of three is three sets at most.' : null;
  return sets > 1 ? `This is played as one score (${quadsScoringName(s)}): type just that, like ${scoreHint(s).replace(/^.*: /, '')}.` : null;
}
