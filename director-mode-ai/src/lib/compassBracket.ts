/**
 * Compass draw bracket generator.
 *
 * A compass draw is a tournament format where losers continue playing in
 * consolation brackets, so every player plays the same number of matches
 * regardless of wins/losses. 16-player compasses run 4 rounds and rank
 * every player 1st through 16th; 8-player compasses run 3 rounds and rank
 * every player 1st through 8th.
 *
 * 16-player structure:
 *   R1  (8 matches): standard seeded R1 — 1v16, 8v9, 5v12, 4v13, 3v14, 6v11, 7v10, 2v15
 *                    Winners → East (E), losers → West (W)
 *   R2a (4 matches each bracket): within E and W, winners go deeper in championship path
 *                    (NE / NW), losers drop to consolation (SE / SW)
 *   R3  (2 matches each of 4 sub-brackets): semifinals
 *   R4  (1 match each of 4 sub-brackets): finals
 *
 * 8-player structure:
 *   R1 (4 matches): standard seeded — 1v8, 4v5, 3v6, 2v7
 *   R2 (2 matches each bracket): E winners vs losers, W winners vs losers
 *   R3 (finals for each of 4 final positions)
 *
 * R1 is generated fully at draw time. R2+ are generated after the previous
 * round's scores are confirmed, using progressBracket().
 */

export type CompassEntry = { id: string; seed: number };

export type CompassMatch = {
  round: number;
  matchIndex: number;
  bracketPosition: string;      // 'E1-4', 'W2-4', 'NE1-2', 'SW2-2', etc.
  entryAId: string | null;
  entryBId: string | null;
};

/**
 * Standard tournament seeding pairs for a bracket of N players.
 * For 16: 1v16, 8v9, 5v12, 4v13, 3v14, 6v11, 7v10, 2v15
 * For 8:  1v8, 4v5, 3v6, 2v7
 */
function standardSeedPairs(size: 8 | 16): Array<[number, number]> {
  if (size === 8) {
    return [
      [1, 8],
      [4, 5],
      [3, 6],
      [2, 7],
    ];
  }
  return [
    [1, 16],
    [8, 9],
    [5, 12],
    [4, 13],
    [3, 14],
    [6, 11],
    [7, 10],
    [2, 15],
  ];
}

/**
 * Generate the first round of matches for a compass draw.
 * Input: seeded entries (1 = best, N = worst).
 * Output: R1 matches with bracket positions.
 */
export function generateRound1(
  entries: CompassEntry[],
  size: 8 | 16
): CompassMatch[] {
  if (entries.length !== size) {
    throw new Error(`Compass draw of ${size} requires exactly ${size} entries, got ${entries.length}`);
  }

  const bySeed = new Map<number, CompassEntry>();
  for (const e of entries) bySeed.set(e.seed, e);

  const pairs = standardSeedPairs(size);
  const matches: CompassMatch[] = [];
  pairs.forEach((pair, idx) => {
    const [seedA, seedB] = pair;
    const a = bySeed.get(seedA);
    const b = bySeed.get(seedB);
    if (!a || !b) {
      throw new Error(`Missing entry for seed ${!a ? seedA : seedB}`);
    }
    matches.push({
      round: 1,
      matchIndex: idx,
      bracketPosition: `R1-M${idx + 1}`,
      entryAId: a.id,
      entryBId: b.id,
    });
  });
  return matches;
}

/**
 * How many rounds does a compass of this size run?
 * 16 → 4 rounds. 8 → 3 rounds.
 */
export function totalRounds(size: 8 | 16): number {
  return size === 16 ? 4 : 3;
}

/**
 * Given the current round's confirmed matches + winners, produce the next
 * round's matches. Called once per bracket progression (after all matches
 * in the previous round have status 'confirmed').
 *
 * Logic walkthrough for 16-player compass:
 *
 *   After R1 (8 matches, 16 players):
 *     - 8 winners go into the East bracket
 *     - 8 losers  go into the West bracket
 *   R2 East:  4 matches pairing E winners — top 2 winners of R1 face bottom 2 winners
 *   R2 West:  4 matches pairing W losers  — top 2 losers of R1 face bottom 2 losers
 *     - Winners of R2E → NE (championship semi)
 *     - Losers  of R2E → SE (5-8 consolation semi)
 *     - Winners of R2W → NW (9-12 consolation)
 *     - Losers  of R2W → SW (13-16 bottom)
 *   R3 : 2 matches in each of NE / SE / NW / SW = 8 matches total
 *   R4 : 1 match in each sub-bracket (4 finals)
 *
 * For 8-player compass we skip a level: R1 → E/W → R2 → semifinals → R3 → finals.
 */
export type MatchResult = {
  round: number;
  matchIndex: number;
  bracketPosition: string;
  winnerId: string;
  loserId: string;
};

export function generateNextRound(
  size: 8 | 16,
  completedRound: number,
  results: MatchResult[]
): CompassMatch[] {
  const nextRound = completedRound + 1;
  if (nextRound > totalRounds(size)) return [];

  // Sort results by matchIndex to have a stable ordering.
  const sorted = [...results].sort((a, b) => a.matchIndex - b.matchIndex);

  if (size === 16) {
    if (completedRound === 1) {
      // R1 → R2: split winners into East (championship path), losers into West (consolation path).
      // The E1-E2 pair is made from the winners of R1 M1 and M2, E3-E4 from M3 and M4, etc.
      // This preserves the top-of-draw vs bottom-of-draw seeding split.
      const east = sorted.map(r => r.winnerId);
      const west = sorted.map(r => r.loserId);
      return sequentialIndex([
        ...pairForNextRound(east, 2, 'E'),
        ...pairForNextRound(west, 2, 'W'),
      ]);
    }
    if (completedRound === 2) {
      // R2 → R3: four directional sub-brackets.
      //   NE = East R2 winners   (2W-0L, championship semi, going for 1st-4th)
      //   SE = East R2 losers    (1W-1L, consolation for R1 winners, going for 5th-8th)
      //   NW = West R2 winners   (1W-1L, consolation for R1 losers, going for 9th-12th)
      //   SW = West R2 losers    (0W-2L, bottom bracket, going for 13th-16th)
      const eastMatches = sorted.filter(r => r.bracketPosition.startsWith('E'));
      const westMatches = sorted.filter(r => r.bracketPosition.startsWith('W'));
      const ne = eastMatches.map(r => r.winnerId);
      const se = eastMatches.map(r => r.loserId);
      const nw = westMatches.map(r => r.winnerId);
      const sw = westMatches.map(r => r.loserId);
      return sequentialIndex([
        ...pairForNextRound(ne, 3, 'NE'),
        ...pairForNextRound(se, 3, 'SE'),
        ...pairForNextRound(nw, 3, 'NW'),
        ...pairForNextRound(sw, 3, 'SW'),
      ]);
    }
    if (completedRound === 3) {
      // R3 → R4: finals — within each of NE/SE/NW/SW, winner vs winner (1st place)
      // and loser vs loser (3rd place). 2 matches per sub-bracket × 4 = 8 matches.
      const byPrefix: Record<string, MatchResult[]> = { NE: [], SE: [], NW: [], SW: [] };
      for (const r of sorted) {
        const prefix = r.bracketPosition.slice(0, 2);
        if (byPrefix[prefix]) byPrefix[prefix].push(r);
      }
      const out: CompassMatch[] = [];
      (['NE', 'SE', 'NW', 'SW'] as const).forEach(prefix => {
        const rs = byPrefix[prefix];
        if (rs.length !== 2) return;
        // Final for 1st in this sub-bracket: winner of M1 vs winner of M2
        out.push({
          round: 4,
          matchIndex: out.length,
          bracketPosition: `${prefix}-FINAL`,
          entryAId: rs[0].winnerId,
          entryBId: rs[1].winnerId,
        });
        // 3rd place match: loser of M1 vs loser of M2
        out.push({
          round: 4,
          matchIndex: out.length,
          bracketPosition: `${prefix}-3RD`,
          entryAId: rs[0].loserId,
          entryBId: rs[1].loserId,
        });
      });
      return out;
    }
  }

  if (size === 8) {
    if (completedRound === 1) {
      // R1 → R2: split winners east, losers west. 4 players each, 2 matches each.
      const east = sorted.map(r => r.winnerId);
      const west = sorted.map(r => r.loserId);
      return sequentialIndex([
        ...pairForNextRound(east, 2, 'E'),
        ...pairForNextRound(west, 2, 'W'),
      ]);
    }
    if (completedRound === 2) {
      // R2 → R3: final for each of NE/SE/NW/SW (one match each, 4 matches total)
      const eastMatches = sorted.filter(r => r.bracketPosition.startsWith('E'));
      const westMatches = sorted.filter(r => r.bracketPosition.startsWith('W'));
      const out: CompassMatch[] = [];
      // Championship (NE) final: winners of R2E
      if (eastMatches.length === 2) {
        out.push({
          round: 3,
          matchIndex: out.length,
          bracketPosition: 'NE-FINAL',
          entryAId: eastMatches[0].winnerId,
          entryBId: eastMatches[1].winnerId,
        });
        out.push({
          round: 3,
          matchIndex: out.length,
          bracketPosition: 'SE-FINAL',
          entryAId: eastMatches[0].loserId,
          entryBId: eastMatches[1].loserId,
        });
      }
      if (westMatches.length === 2) {
        out.push({
          round: 3,
          matchIndex: out.length,
          bracketPosition: 'NW-FINAL',
          entryAId: westMatches[0].winnerId,
          entryBId: westMatches[1].winnerId,
        });
        out.push({
          round: 3,
          matchIndex: out.length,
          bracketPosition: 'SW-FINAL',
          entryAId: westMatches[0].loserId,
          entryBId: westMatches[1].loserId,
        });
      }
      return out;
    }
  }

  return [];
}

/**
 * Given an ordered list of player IDs, pair them up for the next round.
 * For a bracket of 8: produces 4 matches (pairs 0-1, 2-3, 4-5, 6-7).
 * For a bracket of 4: produces 2 matches (pairs 0-1, 2-3).
 *
 * matchIndex is intentionally set to 0 here — the caller combines the
 * output from multiple prefixes and must assign unique, sequential
 * matchIndex values across the whole round via sequentialIndex().
 */
function pairForNextRound(
  playerIds: string[],
  round: number,
  prefix: string
): CompassMatch[] {
  const matches: CompassMatch[] = [];
  for (let i = 0; i < playerIds.length; i += 2) {
    matches.push({
      round,
      matchIndex: 0, // overwritten by sequentialIndex()
      bracketPosition: `${prefix}-R${round}-M${i / 2 + 1}`,
      entryAId: playerIds[i] || null,
      entryBId: playerIds[i + 1] || null,
    });
  }
  return matches;
}

/**
 * Assigns sequential match_index values (0, 1, 2, …) to a list of matches.
 * This is the only correct way to avoid UNIQUE(flight_id, round, match_index)
 * collisions when combining matches from multiple directional sub-brackets
 * (NE, SE, NW, SW) into a single round's output. Must be called AFTER all
 * pairForNextRound calls for a given round are concatenated.
 */
function sequentialIndex(matches: CompassMatch[]): CompassMatch[] {
  return matches.map((m, idx) => ({ ...m, matchIndex: idx }));
}

/**
 * Compute the deadline for a given round, given the league start date and
 * a 2-week-per-round cadence. R1 deadline = start + 14 days,
 * R2 = start + 28 days, etc.
 */
export function roundDeadline(leagueStart: Date, round: number): Date {
  const ms = 14 * round * 24 * 60 * 60 * 1000;
  return new Date(leagueStart.getTime() + ms);
}
