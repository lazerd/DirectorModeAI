/**
 * Mixer board — the pure half of the player-facing court sheet for rotating-
 * partner mixers: which formats get it, and individual standings computed
 * from the stored match rows.
 *
 * Formats: doubles, mixed doubles and maximize-courts rebuild partners every
 * round from the whole roster, so a printed round sheet, a "find your name"
 * master sheet and a per-player phone view all make sense. Not included on
 * purpose: king-of-court (winners stay, rounds can't be printed ahead),
 * team-battle (two named teams), round-robin (fixed pairs), and tournament
 * formats (brackets have their own pages).
 */

export const ROTATING_PARTNER_FORMATS = new Set<string>(['doubles', 'mixed-doubles', 'maximize-courts']);

export function isRotatingPartnerFormat(format: string | null | undefined): boolean {
  return !!format && ROTATING_PARTNER_FORMATS.has(format);
}

export interface ScoredMatchRow {
  player1_id: string | null;
  player2_id: string | null;
  player3_id: string | null;
  player4_id: string | null;
  team1_score: number | null;
  team2_score: number | null;
  winner_team: number | null;
}

export interface IndividualStanding {
  id: string;
  name: string;
  played: number;
  wins: number;
  losses: number;
  gamesWon: number;
  gamesLost: number;
  /** "1", "2", "T-3" … */
  rank: string;
}

/**
 * Individual standings from match rows, ranked exactly like the director's
 * Standings tab and the public event page: win %, then game difference, then
 * fewest games lost, then head-to-head, then name. Only rows with a declared
 * winner count (the score dialog always sets one, via tiebreak when tied).
 */
export function computeIndividualStandings(
  players: { id: string; name: string }[],
  matches: ScoredMatchRow[],
): IndividualStanding[] {
  const scored = matches.filter((m) => m.winner_team != null && (m.player2_id || m.player4_id));
  const rows = new Map<string, IndividualStanding>(
    players.map((p) => [p.id, { id: p.id, name: p.name, played: 0, wins: 0, losses: 0, gamesWon: 0, gamesLost: 0, rank: '' }]),
  );

  for (const m of scored) {
    const s1 = m.team1_score ?? 0;
    const s2 = m.team2_score ?? 0;
    const sides: Array<[Array<string | null>, number, number, number]> = [
      [[m.player1_id, m.player3_id], s1, s2, 1],
      [[m.player2_id, m.player4_id], s2, s1, 2],
    ];
    for (const [ids, gw, gl, side] of sides) {
      for (const id of ids) {
        const row = id ? rows.get(id) : undefined;
        if (!row) continue;
        row.played++;
        row.gamesWon += gw;
        row.gamesLost += gl;
        if (m.winner_team === side) row.wins++;
        else row.losses++;
      }
    }
  }

  const pct = (r: IndividualStanding) => (r.played > 0 ? r.wins / r.played : 0);
  const diff = (r: IndividualStanding) => r.gamesWon - r.gamesLost;
  const headToHead = (a: string, b: string) => {
    let aWins = 0;
    let bWins = 0;
    for (const m of scored) {
      const t1 = [m.player1_id, m.player3_id];
      const t2 = [m.player2_id, m.player4_id];
      const aSide = t1.includes(a) ? 1 : t2.includes(a) ? 2 : 0;
      const bSide = t1.includes(b) ? 1 : t2.includes(b) ? 2 : 0;
      if (aSide && bSide && aSide !== bSide) {
        if (m.winner_team === aSide) aWins++;
        if (m.winner_team === bSide) bWins++;
      }
    }
    return { aWins, bWins };
  };

  const list = [...rows.values()].sort((a, b) => {
    if (pct(b) !== pct(a)) return pct(b) - pct(a);
    if (diff(b) !== diff(a)) return diff(b) - diff(a);
    if (a.gamesLost !== b.gamesLost) return a.gamesLost - b.gamesLost;
    const h = headToHead(a.id, b.id);
    if (h.aWins !== h.bWins) return h.bWins - h.aWins;
    return a.name.localeCompare(b.name);
  });

  list.forEach((row, i) => {
    const prev = list[i - 1];
    const tied =
      prev &&
      pct(row) === pct(prev) &&
      diff(row) === diff(prev) &&
      row.gamesLost === prev.gamesLost &&
      (() => {
        const h = headToHead(row.id, prev.id);
        return h.aWins === h.bWins;
      })();
    if (tied) {
      if (!prev.rank.startsWith('T-')) prev.rank = `T-${prev.rank}`;
      row.rank = prev.rank;
    } else {
      row.rank = String(i + 1);
    }
  });
  return list;
}
