/**
 * The free, no-account mixer at /try.
 *
 * Everything lives in the visitor's browser: no auth, no rows, no email. The
 * pairing itself is the same RoundGenerator the signed-in MixerMode uses, so a
 * guest mixer rotates partners, spreads sit-outs and balances mixed courts
 * exactly like the real thing. This module is pure (no React, no storage) so
 * the whole flow is testable without a browser.
 */
import { RoundGenerator, type HistoricalMatch } from '@/lib/advancedMatchGeneration';

export type GuestFormat = 'doubles' | 'mixed-doubles' | 'singles';
export type Gender = 'male' | 'female';

export interface GuestPlayer {
  id: string;
  name: string;
  gender?: Gender;
  /** Left the event. Kept so their past rounds still show and still count. */
  out?: boolean;
}

export interface GuestMatch {
  court: number;
  /** One id for singles, two for doubles. */
  teamA: string[];
  teamB: string[];
  scoreA?: number | null;
  scoreB?: number | null;
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
}

export const FORMAT_LABELS: Record<GuestFormat, string> = {
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
  return format === 'singles' ? 2 : 4;
}

/** Why the next round can't be made yet, or null when it can. */
export function cannotGenerate(m: GuestMixer): string | null {
  const active = activePlayers(m);
  const need = minPlayers(m.format);
  if (m.courts < 1) return 'Add at least one court.';
  if (active.length < need) {
    return `Add at least ${need} players to make a round.`;
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

  const gen = new RoundGenerator(
    active.map((p) => ({ player_id: p.id, name: p.name, gender: p.gender })),
    base.courts,
    base.format,
  );
  gen.setRandomize(true);
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
}

/** Individual standings: every player on a winning side gets the win. */
export function standings(m: GuestMixer): Standing[] {
  const rows = new Map<string, Standing>();
  for (const p of m.players) {
    rows.set(p.id, { id: p.id, name: p.name, played: 0, wins: 0, losses: 0, gamesFor: 0, gamesAgainst: 0 });
  }
  for (const r of m.rounds) {
    for (const x of r.matches) {
      if (x.scoreA == null || x.scoreB == null) continue;
      const apply = (ids: string[], f: number, a: number) => {
        for (const id of ids) {
          const s = rows.get(id);
          if (!s) continue;
          s.played++;
          s.gamesFor += f;
          s.gamesAgainst += a;
          if (f > a) s.wins++;
          else if (f < a) s.losses++;
        }
      };
      apply(x.teamA, x.scoreA, x.scoreB);
      apply(x.teamB, x.scoreB, x.scoreA);
    }
  }
  return [...rows.values()]
    .filter((s) => s.played > 0)
    .sort(
      (a, b) =>
        b.wins - a.wins ||
        b.gamesFor - b.gamesAgainst - (a.gamesFor - a.gamesAgainst) ||
        b.gamesFor - a.gamesFor ||
        a.name.localeCompare(b.name),
    );
}

export function roundComplete(r: GuestRound): boolean {
  return r.matches.every((x) => x.scoreA != null && x.scoreB != null);
}

/** Saved state from localStorage, or null if it is missing or not ours. */
export function parseSaved(raw: string | null): GuestMixer | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    if (!v || v.version !== 1 || !Array.isArray(v.players) || !Array.isArray(v.rounds)) return null;
    if (!['doubles', 'mixed-doubles', 'singles'].includes(v.format)) return null;
    return v as GuestMixer;
  } catch {
    return null;
  }
}
