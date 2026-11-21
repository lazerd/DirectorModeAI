/**
 * The free, no-account mixer at /try.
 *
 * Everything lives in the visitor's browser: no auth, no rows, no email. The
 * pairing itself is the same RoundGenerator the signed-in MixerMode uses, so a
 * guest mixer rotates partners, spreads sit-outs and balances mixed courts
 * exactly like the real thing. This module is pure (no React, no storage) so
 * the whole flow is testable without a browser.
 */
import { RoundGenerator, type GenerationMode, type HistoricalMatch } from '@/lib/advancedMatchGeneration';
import { computeIndividualStandings } from '@/lib/mixerBoard';

export type GuestFormat = 'maximize-courts' | 'king-of-court' | 'team-battle' | 'doubles' | 'mixed-doubles' | 'singles';
export type Team = 'A' | 'B';
export type Gender = 'male' | 'female';

export interface GuestPlayer {
  id: string;
  name: string;
  gender?: Gender;
  /** Left the event. Kept so their past rounds still show and still count. */
  out?: boolean;
  /** Team Battle side. */
  team?: Team;
  /** Rating on the sport's scale (NTRP / DUPR / Playtomic). Higher = stronger. Used to balance courts. */
  level?: number | null;
}

export interface GuestMatch {
  court: number;
  /** One id for singles, two for doubles. */
  teamA: string[];
  teamB: string[];
  scoreA?: number | null;
  scoreB?: number | null;
  /** Who won a tied score (tiebreak / coin flip), like MixerMode's score dialog. */
  tiebreak?: Team | null;
}

export interface GuestRound {
  number: number;
  matches: GuestMatch[];
  sittingOut: string[];
}

export interface GuestMixer {
  version: 1;
  name: string;
  courts: number;
  format: GuestFormat;
  players: GuestPlayer[];
  rounds: GuestRound[];
  createdAt: string;
  /**
   * 'smart' = MixerMode's policy: round 1 balanced by level (each court gets
   * strong + weaker players), later rounds tiered by live standings.
   * 'random' (or unset, as on /try) = shuffled, still avoiding repeat partners.
   */
  pairing?: 'smart' | 'random';
  /** Team Battle: host-chosen court split. Unset = as many doubles as fit. */
  teamSplit?: { singles: number; doubles: number } | null;
  /** Club court numbers/names in order, e.g. ['5','6','7','8']. Unset = 1..N. */
  courtLabels?: string[] | null;
}

/** The side that won a scored match, or null when it isn't decided yet. */
export function winnerOf(x: GuestMatch): Team | null {
  if (x.scoreA == null || x.scoreB == null) return null;
  if (x.scoreA > x.scoreB) return 'A';
  if (x.scoreB > x.scoreA) return 'B';
  return x.tiebreak ?? null;
}

/** A match counts once both scores are in and a winner is known (ties need a tiebreak). */
export function isScored(x: GuestMatch): boolean {
  return winnerOf(x) != null;
}

/** What a court is called on the night: the club's own number when set. */
export function courtLabel(m: Pick<GuestMixer, 'courtLabels'>, court: number): string {
  const l = m.courtLabels?.[court - 1];
  return l && l.trim() ? l.trim() : String(court);
}

export const FORMAT_LABELS: Record<GuestFormat, string> = {
  // Darrin's #1 event: doubles wherever possible, singles with the rest, every court full.
  'maximize-courts': 'Optimize Courts',
  'king-of-court': 'King of the Court',
  'team-battle': 'Team Battle',
  doubles: 'Doubles',
  'mixed-doubles': 'Mixed doubles',
  singles: 'Singles',
};

export const MAX_COURTS = 24;

export function newMixer(): GuestMixer {
  return {
    version: 1,
    name: '',
    courts: 4,
    format: 'doubles',
    players: [],
    rounds: [],
    createdAt: new Date().toISOString(),
  };
}

export function makeId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * Turn a pasted list into names. Accepts one per line, commas, or a numbered
 * sign-up sheet ("1. Jane Doe"). A trailing "(M)"/"(W)"/"- F" marks gender
 * for mixed doubles. Duplicates (case-insensitive) are dropped.
 */
export function parsePlayerList(
  text: string,
  existing: string[] = [],
): { name: string; gender?: Gender }[] {
  const seen = new Set(existing.map((n) => n.trim().toLowerCase()));
  const out: { name: string; gender?: Gender }[] = [];
  for (const raw of text.split(/[\n,;]+/)) {
    let s = raw.replace(/^\s*(\d+[.)]|[-*•])\s*/, '').trim();
    if (!s) continue;
    let gender: Gender | undefined;
    const g = /\s*[([\-–]\s*(m|w|f|male|female|man|woman)\s*[)\]]?\s*$/i.exec(s);
    if (g) {
      const k = g[1].toLowerCase();
      gender = k === 'm' || k === 'male' || k === 'man' ? 'male' : 'female';
      s = s.slice(0, g.index).trim();
    }
    if (!s) continue;
    s = s.slice(0, 60);
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(gender ? { name: s, gender } : { name: s });
  }
  return out;
}

export function activePlayers(m: GuestMixer): GuestPlayer[] {
  return m.players.filter((p) => !p.out);
}

/** Smallest roster that fills one court in this format. */
export function minPlayers(format: GuestFormat): number {
  return format === 'singles' || format === 'maximize-courts' ? 2 : 4;
}

/** Why the next round can't be made yet, or null when it can. */
export function cannotGenerate(m: GuestMixer): string | null {
  const active = activePlayers(m);
  const need = minPlayers(m.format);
  if (m.courts < 1) return 'Add at least one court.';
  if (active.length < need) {
    return `Add at least ${need} players to make a round.`;
  }
  if (m.format === 'team-battle') {
    const a = active.filter((p) => p.team === 'A').length, b = active.filter((p) => p.team === 'B').length;
    const none = active.length - a - b;
    if (none) return `Put ${none === 1 ? 'one player' : `${none} players`} on a team first.`;
    if (!a || !b) return 'Team Battle needs players on both teams.';
  }
  if (m.format === 'king-of-court' && m.rounds.length) {
    const last = m.rounds[m.rounds.length - 1];
    const missing = last.matches.filter((x) => !isScored(x)).length;
    if (missing) return `Enter ${missing === 1 ? 'the last court' : `${missing} courts`}' score${missing === 1 ? '' : 's'} first: winners move up, losers move down.`;
  }
  if (m.format === 'mixed-doubles') {
    const unset = active.filter((p) => !p.gender).length;
    if (unset > 0) return `Mark ${unset === 1 ? 'one player' : `${unset} players`} as M or W for mixed doubles.`;
  }
  return null;
}

/** Every past round as the rows RoundGenerator replays. */
function history(m: GuestMixer): HistoricalMatch[] {
  const rows: HistoricalMatch[] = [];
  for (const r of m.rounds) {
    for (const x of r.matches) {
      rows.push({
        player1_id: x.teamA[0] ?? null,
        player2_id: x.teamB[0] ?? null,
        player3_id: x.teamA[1] ?? null,
        player4_id: x.teamB[1] ?? null,
        round_number: r.number,
      });
    }
    for (const id of r.sittingOut) {
      rows.push({ player1_id: id, player2_id: null, player3_id: null, player4_id: null, round_number: r.number });
    }
  }
  return rows;
}

/**
 * Build the next round from the current roster and everything played so far.
 * `seed` makes it repeatable (tests); the app leaves it random.
 */
export function generateRound(m: GuestMixer, opts: { seed?: number; replaceLast?: boolean } = {}): GuestRound {
  const reason = cannotGenerate(m);
  if (reason) throw new Error(reason);

  const base = opts.replaceLast ? { ...m, rounds: m.rounds.slice(0, -1) } : m;
  const number = base.rounds.length + 1;
  const active = activePlayers(base);
  if (base.format === 'king-of-court' && base.rounds.length) {
    const r = riverRound(base, number);
    if (r) return r;
  }

  // Strength order: by level when known (strongest first), otherwise sign-up order.
  const order = strengthOrder(active);
  const st = new Map(standings(base).map((x) => [x.id, x]));
  const gen = new RoundGenerator(
    active.map((p) => ({
      player_id: p.id, name: p.name, gender: p.gender, team_id: p.team, strength_order: order.get(p.id)!,
      wins: st.get(p.id)?.wins ?? 0, losses: st.get(p.id)?.losses ?? 0,
      games_won: st.get(p.id)?.gamesFor ?? 0, games_lost: st.get(p.id)?.gamesAgainst ?? 0,
    })),
    base.courts,
    base.format === 'king-of-court' ? 'doubles' : base.format,
  );
  if (base.format === 'team-battle') {
    const n = Math.min(active.filter((p) => p.team === 'A').length, active.filter((p) => p.team === 'B').length);
    let doublesCourts = Math.min(base.courts, Math.floor(n / 2));
    let singlesCourts = Math.min(base.courts - doublesCourts, n - 2 * doublesCourts);
    if (base.teamSplit) { // host's split, trimmed to what the smaller team can fill
      doublesCourts = Math.max(0, Math.min(base.teamSplit.doubles, base.courts, Math.floor(n / 2)));
      singlesCourts = Math.max(0, Math.min(base.teamSplit.singles, base.courts - doublesCourts, n - 2 * doublesCourts));
    }
    gen.setTeamBattleConfig({ singlesCourts, doublesCourts, team1Id: 'A', team2Id: 'B' });
  }
  // Same as MixerMode's round button: randomize on, and when generating one round at a
  // time the mode decides doubles/Optimize Courts placement (singles, mixed and Team
  // Battle have their own rules inside RoundGenerator).
  gen.setRandomize(true);
  if (base.pairing === 'smart') {
    const hasLevels = active.filter((p) => p.level != null).length >= Math.ceil(active.length / 2);
    const mode: GenerationMode = base.rounds.length === 0 ? (hasLevels ? 'single-r1-balanced' : 'multi-random') : 'single-rN-tiered';
    gen.setMode(mode);
  }
  if (opts.seed != null) gen.setSeed(opts.seed);
  const past = history(base);
  if (past.length) gen.seedMatchHistory(past, { beforeRound: number });

  const pairings = gen.generateMultipleRounds(1)[0] ?? [];
  const matches: GuestMatch[] = [];
  const sittingOut: string[] = [];
  for (const p of pairings) {
    const ids = [p.player1_id, p.player2_id, p.player3_id, p.player4_id];
    if (ids[0] && !ids[1] && !ids[2] && !ids[3]) {
      sittingOut.push(ids[0]);
      continue;
    }
    const teamA = [p.player1_id, p.player3_id].filter(Boolean) as string[];
    const teamB = [p.player2_id, p.player4_id].filter(Boolean) as string[];
    if (!teamA.length || !teamB.length) continue;
    matches.push({ court: matches.length + 1, teamA, teamB, scoreA: null, scoreB: null });
  }

  // Anyone the generator left out entirely still has to be shown as sitting.
  const placed = new Set([...matches.flatMap((x) => [...x.teamA, ...x.teamB]), ...sittingOut]);
  for (const p of active) if (!placed.has(p.id)) sittingOut.push(p.id);

  return { number, matches: matches.slice(0, base.courts), sittingOut };
}

export interface Standing {
  id: string;
  name: string;
  played: number;
  wins: number;
  losses: number;
  gamesFor: number;
  gamesAgainst: number;
  /** "1", "2", "T-3" (shared place), exactly like MixerMode's Standings tab. */
  rank: string;
}

/**
 * Individual standings, ranked exactly like MixerMode (lib/mixerBoard): win %,
 * then game difference, then fewest games lost, then head-to-head, then name.
 * Every player on the winning side gets the win; a tie counts only once its
 * tiebreak winner is set.
 */
export function standings(m: GuestMixer): Standing[] {
  const rows = [];
  for (const r of m.rounds) for (const x of r.matches) {
    const w = winnerOf(x);
    if (!w) continue;
    rows.push({
      player1_id: x.teamA[0] ?? null, player3_id: x.teamA[1] ?? null,
      player2_id: x.teamB[0] ?? null, player4_id: x.teamB[1] ?? null,
      team1_score: x.scoreA ?? 0, team2_score: x.scoreB ?? 0, winner_team: w === 'A' ? 1 : 2,
    });
  }
  return computeIndividualStandings(m.players.map((p) => ({ id: p.id, name: p.name })), rows)
    .filter((x) => x.played > 0)
    .map((x) => ({ id: x.id, name: x.name, played: x.played, wins: x.wins, losses: x.losses, gamesFor: x.gamesWon, gamesAgainst: x.gamesLost, rank: x.rank }));
}

/** Strongest first by level; players without a level keep their sign-up order after those with one. */
function strengthOrder(active: GuestPlayer[]): Map<string, number> {
  const ranked = active.map((p, i) => ({ p, i })).sort((a, b) => {
    const la = a.p.level, lb = b.p.level;
    if (la != null && lb != null && la !== lb) return lb - la;
    if (la != null && lb == null) return -1;
    if (la == null && lb != null) return 1;
    return a.i - b.i;
  });
  return new Map(ranked.map((x, k) => [x.p.id, k + 1]));
}

export function roundComplete(r: GuestRound): boolean {
  return r.matches.every(isScored);
}

/** Saved state from localStorage, or null if it is missing or not ours. */
export function parseSaved(raw: string | null): GuestMixer | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    if (!v || v.version !== 1 || !Array.isArray(v.players) || !Array.isArray(v.rounds)) return null;
    if (!['maximize-courts', 'king-of-court', 'team-battle', 'doubles', 'mixed-doubles', 'singles'].includes(v.format)) return null;
    return v as GuestMixer;
  } catch {
    return null;
  }
}

/**
 * King of the Court ("up and down the river"): winners move up a court, losers
 * move down; court 1 is the King court (its winners stay), the bottom court's
 * losers stay or rotate out for anyone who sat. Winners split up so nobody keeps
 * a partner. Returns null when the roster or courts changed (then it reshuffles).
 */
function riverRound(m: GuestMixer, number: number): GuestRound | null {
  const prev = m.rounds[m.rounds.length - 1];
  const ms = [...prev.matches].sort((a, b) => a.court - b.court);
  if (!ms.length || ms.some((x) => x.teamA.length !== 2 || x.teamB.length !== 2 || !isScored(x))) return null;
  const active = new Set(activePlayers(m).map((p) => p.id));
  const onCourt = ms.flatMap((x) => [...x.teamA, ...x.teamB]);
  if (onCourt.some((id) => !active.has(id))) return null; // someone left mid-night
  if (ms.length !== Math.min(m.courts, Math.floor(active.size / 4))) return null;
  const W = ms.map((x) => (winnerOf(x) === 'A' ? x.teamA : x.teamB));
  const L = ms.map((x) => (winnerOf(x) === 'A' ? x.teamB : x.teamA));
  const n = ms.length;
  const groups: string[][][] = Array.from({ length: n }, () => []);
  for (let i = 0; i < n; i++) {
    groups[Math.max(0, i - 1)].push(W[i]);
    groups[Math.min(n - 1, i + 1)].push(L[i]);
  }
  // anyone who sat (or just arrived) comes in on the bottom court; the bottom losers sit
  // Longest wait comes in first, so nobody sits twice while someone else keeps playing.
  const satStreak = (id: string) => { let n = 0; for (let i = m.rounds.length - 1; i >= 0 && m.rounds[i].sittingOut.includes(id); i--) n++; return n; };
  const waiting = [...active].filter((id) => !onCourt.includes(id)).sort((a, b) => satStreak(b) - satStreak(a));
  let sittingOut: string[] = [];
  if (waiting.length >= 2) {
    const inc = waiting.slice(0, 2);
    const bottom = groups[n - 1];
    const losersHere = bottom[bottom.length - 1];
    sittingOut = [...losersHere, ...waiting.slice(2)];
    bottom[bottom.length - 1] = inc;
  } else sittingOut = waiting;
  const matches: GuestMatch[] = groups.map((g, i) => {
    const [x, y] = g; // split each incoming pair across the net-side teams
    return { court: i + 1, teamA: [x[0], y[1]], teamB: [x[1], y[0]], scoreA: null, scoreB: null };
  });
  return { number, matches, sittingOut };
}

/** Team Battle scoreboard: courts won per team, and games. */
export function teamScore(m: GuestMixer): { A: number; B: number; gamesA: number; gamesB: number } {
  const t = new Map(m.players.map((p) => [p.id, p.team]));
  const out = { A: 0, B: 0, gamesA: 0, gamesB: 0 };
  for (const r of m.rounds) for (const x of r.matches) {
    if (x.scoreA == null || x.scoreB == null) continue;
    const sideA = t.get(x.teamA[0]) === 'B' ? 'B' : 'A';
    const sideB = sideA === 'A' ? 'B' : 'A';
    out[sideA === 'A' ? 'gamesA' : 'gamesB'] += x.scoreA;
    out[sideB === 'A' ? 'gamesA' : 'gamesB'] += x.scoreB;
    const w = winnerOf(x);
    if (w === 'A') out[sideA]++; else if (w === 'B') out[sideB]++;
  }
  return out;
}
