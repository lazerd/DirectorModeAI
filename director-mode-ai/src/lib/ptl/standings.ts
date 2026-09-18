/**
 * PTL season standings.
 *
 * A division of 4 plays a full round robin every night, so after five nights
 * every team has met every other team five times and ties on meetings won are
 * normal rather than exceptional. The cascade:
 *
 *   1. Meetings won
 *   2. Head-to-head among the teams that are level
 *   3. Total games won
 *   4. Game differential
 *   5. Name, so the order is at least stable
 *
 * Head-to-head is applied as a MINI-LEAGUE, not as a pairwise comparison.
 * Pairwise looks simpler and is wrong: with three teams level, A can beat B,
 * B beat C and C beat A, and a pairwise comparator then produces a different
 * table depending on which two rows the sort happens to compare first. Scoring
 * the tied teams only against each other has no such cycle problem.
 *
 * Modelled on computeIndividualStandings in src/lib/mixerBoard.ts, which is the
 * only existing cascade in the app that does head-to-head at all.
 */

export type PtlTeamRef = {
  id: string;
  name: string;
  shortCode: string;
  divisionId?: string | null;
};

export type PtlMeetingRow = {
  homeTeamId: string;
  awayTeamId: string;
  /** Only 'home' and 'away' count; 'pending' is skipped. PTL has no ties. */
  result: 'home' | 'away' | 'tie' | 'pending';
  homeGames: number;
  awayGames: number;
};

export type PtlStandingRow = {
  teamId: string;
  name: string;
  shortCode: string;
  played: number;
  won: number;
  lost: number;
  gamesFor: number;
  gamesAgainst: number;
  gameDiff: number;
  /** 1-based finishing position. */
  rank: number;
  /** '1', or 'T-2' when teams are level on every criterion. */
  rankLabel: string;
};

type Acc = {
  teamId: string;
  name: string;
  shortCode: string;
  played: number;
  won: number;
  lost: number;
  gamesFor: number;
  gamesAgainst: number;
};

const decided = (m: PtlMeetingRow) => m.result === 'home' || m.result === 'away';

/**
 * Meetings won counting ONLY the games between the given teams. Used to break
 * a tie without letting results against the rest of the division leak in.
 */
function headToHeadWins(teamIds: string[], meetings: PtlMeetingRow[]): Map<string, number> {
  const inGroup = new Set(teamIds);
  const wins = new Map(teamIds.map((id) => [id, 0]));
  for (const m of meetings) {
    if (!decided(m)) continue;
    if (!inGroup.has(m.homeTeamId) || !inGroup.has(m.awayTeamId)) continue;
    const winner = m.result === 'home' ? m.homeTeamId : m.awayTeamId;
    wins.set(winner, (wins.get(winner) ?? 0) + 1);
  }
  return wins;
}

export function computePtlStandings(
  teams: PtlTeamRef[],
  meetings: PtlMeetingRow[],
): PtlStandingRow[] {
  const acc = new Map<string, Acc>(
    teams.map((t) => [
      t.id,
      {
        teamId: t.id,
        name: t.name,
        shortCode: t.shortCode,
        played: 0,
        won: 0,
        lost: 0,
        gamesFor: 0,
        gamesAgainst: 0,
      },
    ]),
  );

  for (const m of meetings) {
    if (!decided(m)) continue;
    const home = acc.get(m.homeTeamId);
    const away = acc.get(m.awayTeamId);
    // A meeting against a team outside this division is not this table's
    // business — skip rather than half-count it.
    if (!home || !away) continue;

    home.played++;
    away.played++;
    home.gamesFor += m.homeGames;
    home.gamesAgainst += m.awayGames;
    away.gamesFor += m.awayGames;
    away.gamesAgainst += m.homeGames;

    if (m.result === 'home') {
      home.won++;
      away.lost++;
    } else {
      away.won++;
      home.lost++;
    }
  }

  const rows = [...acc.values()];

  // Step 1: group by meetings won.
  const byWins = new Map<number, Acc[]>();
  for (const r of rows) {
    const g = byWins.get(r.won);
    if (g) g.push(r);
    else byWins.set(r.won, [r]);
  }

  const ordered: Acc[] = [];
  for (const wins of [...byWins.keys()].sort((a, b) => b - a)) {
    const group = byWins.get(wins)!;
    if (group.length === 1) {
      ordered.push(group[0]);
      continue;
    }
    // Steps 2-5 inside the tied group.
    const h2h = headToHeadWins(group.map((g) => g.teamId), meetings);
    group.sort(
      (a, b) =>
        (h2h.get(b.teamId) ?? 0) - (h2h.get(a.teamId) ?? 0) ||
        b.gamesFor - a.gamesFor ||
        b.gamesFor - b.gamesAgainst - (a.gamesFor - a.gamesAgainst) ||
        a.name.localeCompare(b.name),
    );
    ordered.push(...group);
  }

  // Rank, marking genuine ties (level on every criterion that matters).
  const level = (a: Acc, b: Acc, h2h: Map<string, number>) =>
    a.won === b.won &&
    (h2h.get(a.teamId) ?? 0) === (h2h.get(b.teamId) ?? 0) &&
    a.gamesFor === b.gamesFor &&
    a.gamesFor - a.gamesAgainst === b.gamesFor - b.gamesAgainst;

  const allH2h = headToHeadWins(rows.map((r) => r.teamId), meetings);

  const out: PtlStandingRow[] = [];
  let rank = 0;
  for (let i = 0; i < ordered.length; i++) {
    const r = ordered[i];
    const prev = ordered[i - 1];
    const tiedWithPrev = prev ? level(r, prev, allH2h) : false;
    if (!tiedWithPrev) rank = i + 1;
    const tiedWithNext = ordered[i + 1] ? level(r, ordered[i + 1], allH2h) : false;
    out.push({
      teamId: r.teamId,
      name: r.name,
      shortCode: r.shortCode,
      played: r.played,
      won: r.won,
      lost: r.lost,
      gamesFor: r.gamesFor,
      gamesAgainst: r.gamesAgainst,
      gameDiff: r.gamesFor - r.gamesAgainst,
      rank,
      rankLabel: tiedWithPrev || tiedWithNext ? `T-${rank}` : String(rank),
    });
  }

  return out;
}

/**
 * Promotion and relegation: the bottom team of every division except the last
 * drops a tier, and the top team of every division except the first climbs one.
 *
 * Returned as a proposal rather than applied, because the commissioner should
 * see "Ridgeline drops to Championship" and confirm it before a team's season
 * is filed away. Divisions must be passed in tier order, 1 first.
 */
export type PtlMovement = {
  teamId: string;
  teamName: string;
  fromDivisionId: string;
  toDivisionId: string;
  direction: 'promoted' | 'relegated';
};

export function proposeMovements(
  divisions: Array<{ id: string; name: string; tier: number }>,
  standingsByDivision: Map<string, PtlStandingRow[]>,
): PtlMovement[] {
  const tiers = [...divisions].sort((a, b) => a.tier - b.tier);
  const moves: PtlMovement[] = [];

  for (let i = 0; i < tiers.length; i++) {
    const table = standingsByDivision.get(tiers[i].id) ?? [];
    if (table.length < 2) continue;

    // Bottom drops, unless this is already the entry tier.
    if (i < tiers.length - 1) {
      const bottom = table[table.length - 1];
      moves.push({
        teamId: bottom.teamId,
        teamName: bottom.name,
        fromDivisionId: tiers[i].id,
        toDivisionId: tiers[i + 1].id,
        direction: 'relegated',
      });
    }
    // Top climbs, unless this is already the top tier.
    if (i > 0) {
      const top = table[0];
      moves.push({
        teamId: top.teamId,
        teamName: top.name,
        fromDivisionId: tiers[i].id,
        toDivisionId: tiers[i - 1].id,
        direction: 'promoted',
      });
    }
  }

  return moves;
}
