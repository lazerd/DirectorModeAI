/**
 * Round-robin draw sheet builder.
 *
 * Turns a flat list of round-robin `tournament_matches` into the classic
 * crosstab draw sheet: one grid per flight, each player a row AND a column,
 * head-to-head result in every cell, plus a W-L record and final placement.
 *
 * Flights are derived from the data, not a schema column:
 *   - Matches are bucketed by slot (slots 1..99 = flight A, 100..199 = flight B,
 *     …) — the same convention the print draw already uses for two-flight RR.
 *   - Each player's "home" flight is the bucket they play the most matches in.
 *   - A flight's grid uses only matches where BOTH players are home to it;
 *     any match across two flights is a crossover/placement match, surfaced
 *     separately so it never pollutes a flight's head-to-head record.
 *
 * The common case — a single round-robin event (the generic `rr-*` generator
 * makes exactly one flight) — collapses to one grid with everyone in it.
 */

import { computeRRStandings } from './tournamentFormats';

export type RRMatchInput = {
  id: string;
  round: number;
  slot: number;
  player1_id: string | null;
  player3_id: string | null;
  score: string | null;
  winner_side: 'a' | 'b' | null;
  status: string;
};

export type RREntryInput = {
  id: string;
  player_name: string;
  partner_name: string | null;
  seed: number | null;
};

export type RRCell =
  | { kind: 'self' }
  | { kind: 'empty' }
  | { kind: 'pending' }
  | { kind: 'result'; text: string; won: boolean };

export type RRRow = {
  id: string;
  name: string;
  seed: number | null;
  cells: RRCell[]; // aligned to the flight's players order (self at own index)
  wins: number;
  losses: number;
  finish: number | null; // placement 1..k, or null until the flight is complete
};

export type RRFlight = {
  key: number;
  name: string;
  players: { id: string; name: string; seed: number | null }[];
  rows: RRRow[];
  complete: boolean;
};

export type RRCrossMatch = {
  id: string;
  slot: number;
  /** What this playoff decides, e.g. "1st / 2nd Place" (slot i → 2i-1 / 2i). */
  label: string;
  aName: string;
  bName: string;
  score: string | null;
  winner: 'a' | 'b' | null;
  pending: boolean;
};

export type RRGrid = { flights: RRFlight[]; crossover: RRCrossMatch[] };

const FLIGHT_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function teamName(e: RREntryInput | undefined): string {
  if (!e) return 'TBD';
  return e.partner_name ? `${e.player_name} / ${e.partner_name}` : e.player_name;
}

/** Split a stored score ("6-4, 6-2") into per-side game lists from side A's view. */
function parseSets(score: string | null): { a: string[]; b: string[] } | null {
  if (!score) return null;
  const cleaned = score.replace(/,?\s*RET$/i, '').replace(/^(W\/O|WO|DEF)$/i, '');
  if (!cleaned.trim()) return null;
  const pairs = cleaned.split(/[,\s]+/).filter(Boolean);
  const a: string[] = [];
  const b: string[] = [];
  for (const s of pairs) {
    const m = s.match(/^(\d+)-(\d+)$/);
    if (!m) return null;
    a.push(m[1]);
    b.push(m[2]);
  }
  return a.length ? { a, b } : null;
}

function scoreMarker(score: string | null): string | null {
  if (!score) return null;
  const s = score.trim().toUpperCase();
  if (s === 'W/O' || s === 'WO') return 'W/O';
  if (s === 'DEF') return 'DEF';
  if (s.endsWith(', RET') || s === 'RET') return 'RET';
  return null;
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

const flightOf = (slot: number): number => (slot >= 100 ? Math.floor(slot / 100) : 0);

export function buildRoundRobinGrid(
  entries: RREntryInput[],
  matches: RRMatchInput[]
): RRGrid {
  const entryById = new Map(entries.map((e) => [e.id, e]));

  // Only fully-populated, real matches count toward the draw sheet — a phantom
  // self-match (a player vs itself) is ignored so it can't jam a flight's record.
  const playable = matches.filter((m) => m.player1_id && m.player3_id && m.player1_id !== m.player3_id);

  // 1. Home flight per player = the slot-bucket they appear in most.
  const flightVotes = new Map<string, Map<number, number>>();
  const vote = (pid: string | null, f: number) => {
    if (!pid) return;
    const m = flightVotes.get(pid) ?? new Map<number, number>();
    m.set(f, (m.get(f) ?? 0) + 1);
    flightVotes.set(pid, m);
  };
  for (const m of playable) {
    const f = flightOf(m.slot);
    vote(m.player1_id, f);
    vote(m.player3_id, f);
  }
  const homeFlight = new Map<string, number>();
  for (const [pid, votes] of flightVotes) {
    let best = 0;
    let bestN = -1;
    for (const [f, n] of votes) {
      if (n > bestN) {
        bestN = n;
        best = f;
      }
    }
    homeFlight.set(pid, best);
  }

  // 2. Partition matches into within-flight vs crossover.
  const withinByFlight = new Map<number, RRMatchInput[]>();
  const crossover: RRCrossMatch[] = [];
  for (const m of playable) {
    const fa = homeFlight.get(m.player1_id!);
    const fb = homeFlight.get(m.player3_id!);
    if (fa === fb && fa !== undefined) {
      const list = withinByFlight.get(fa) ?? [];
      list.push(m);
      withinByFlight.set(fa, list);
    } else {
      // Cross-pool = placement playoff. Slot i decides placements (2i-1)/(2i):
      // slot 1 → 1st/2nd, slot 2 → 3rd/4th, and so on.
      crossover.push({
        id: m.id,
        slot: m.slot,
        label: `${ordinal(2 * m.slot - 1)} / ${ordinal(2 * m.slot)} Place`,
        aName: teamName(entryById.get(m.player1_id!)),
        bName: teamName(entryById.get(m.player3_id!)),
        score: m.score,
        winner: m.winner_side,
        pending: m.status !== 'completed',
      });
    }
  }

  const flightKeys = [...withinByFlight.keys()].sort((a, b) => a - b);
  const multi = flightKeys.length > 1;

  const flights: RRFlight[] = flightKeys.map((fk) => {
    const fMatches = withinByFlight.get(fk)!;
    const playerIds = new Set<string>();
    for (const m of fMatches) {
      playerIds.add(m.player1_id!);
      playerIds.add(m.player3_id!);
    }
    const players = [...playerIds]
      .map((id) => entryById.get(id))
      .filter((e): e is RREntryInput => !!e);

    // W-L per player from completed within-flight matches.
    const rec = new Map<string, { w: number; l: number }>();
    players.forEach((p) => rec.set(p.id, { w: 0, l: 0 }));
    let completed = 0;
    for (const m of fMatches) {
      if (m.status !== 'completed' || !m.winner_side) continue;
      completed++;
      const winnerId = m.winner_side === 'a' ? m.player1_id! : m.player3_id!;
      const loserId = m.winner_side === 'a' ? m.player3_id! : m.player1_id!;
      const wr = rec.get(winnerId);
      const lr = rec.get(loserId);
      if (wr) wr.w++;
      if (lr) lr.l++;
    }
    const complete = fMatches.length > 0 && completed === fMatches.length;

    // Finish order uses the SAME ranking as the standings table and the
    // placement-playoff seeding (match wins → head-to-head → game differential →
    // fewest games lost), so "Fin" never disagrees with who actually advances.
    // Ties beyond that fall back to seed for a stable order. Only assigned once
    // every match in the flight is scored.
    const standing = computeRRStandings(players, fMatches);
    const rankByEntry = new Map(standing.map((s) => [s.entry_id, s.rank]));
    const ranked = [...players].sort((a, b) => {
      const ra = rankByEntry.get(a.id) ?? 999;
      const rb = rankByEntry.get(b.id) ?? 999;
      if (ra !== rb) return ra - rb;
      return (a.seed ?? 999) - (b.seed ?? 999);
    });
    const finishById = new Map<string, number>();
    ranked.forEach((p, i) => finishById.set(p.id, i + 1));

    // Present players in finish order when complete, else by seed then name.
    const ordered = complete
      ? ranked
      : [...players].sort(
          (a, b) => (a.seed ?? 999) - (b.seed ?? 999) || a.player_name.localeCompare(b.player_name)
        );
    const orderIndex = new Map(ordered.map((p, i) => [p.id, i]));

    // Fast lookup: match between two players.
    const pairMatch = (x: string, y: string): RRMatchInput | undefined =>
      fMatches.find(
        (m) =>
          (m.player1_id === x && m.player3_id === y) ||
          (m.player1_id === y && m.player3_id === x)
      );

    const rows: RRRow[] = ordered.map((p) => {
      const cells: RRCell[] = ordered.map((opp) => {
        if (opp.id === p.id) return { kind: 'self' };
        const m = pairMatch(p.id, opp.id);
        if (!m) return { kind: 'empty' };
        if (m.status !== 'completed' || !m.winner_side) return { kind: 'pending' };
        const rowIsA = m.player1_id === p.id;
        const won = m.winner_side === (rowIsA ? 'a' : 'b');
        const marker = scoreMarker(m.score);
        const sets = parseSets(m.score);
        let text: string;
        if (sets) {
          const rowSets = rowIsA ? sets.a : sets.b;
          const oppSets = rowIsA ? sets.b : sets.a;
          text = rowSets.map((g, i) => `${g}-${oppSets[i]}`).join(' ');
        } else {
          text = marker ?? (won ? 'W' : 'L');
        }
        return { kind: 'result', text, won };
      });
      const r = rec.get(p.id)!;
      return {
        id: p.id,
        name: teamName(p),
        seed: p.seed,
        cells,
        wins: r.w,
        losses: r.l,
        finish: complete ? finishById.get(p.id) ?? null : null,
      };
    });
    // Keep rows in the same order as players for column alignment.
    rows.sort((a, b) => (orderIndex.get(a.id)! - orderIndex.get(b.id)!));

    return {
      key: fk,
      name: multi ? `Flight ${FLIGHT_LETTERS[flightKeys.indexOf(fk)] ?? fk + 1}` : 'Round Robin',
      players: ordered.map((p) => ({ id: p.id, name: teamName(p), seed: p.seed })),
      rows,
      complete,
    };
  });

  // Order the placement playoffs top-down: 1st/2nd, 3rd/4th, …
  crossover.sort((a, b) => a.slot - b.slot);

  return { flights, crossover };
}
