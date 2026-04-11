/**
 * Round robin bracket generator.
 *
 * Everyone in a flight plays everyone else exactly once. For N players,
 * that's N-1 rounds with N/2 matches per round (if N is even) or (N-1)/2
 * matches per round plus one player with a bye (if N is odd).
 *
 * We use the standard "circle method" to generate pairings:
 *   - Seat players in two rows of N/2 chairs
 *   - Rotate all but one player each round
 *   - Pairings are each column
 *
 * All matches are created up front at draw-generation time — unlike compass,
 * there's no "generate next round once the previous is done." Round deadlines
 * are staggered at 2 weeks apart starting from the league start date, but
 * a round robin works fine if players finish early because nothing depends
 * on which round someone's currently playing.
 */

import type { CompassEntry, CompassMatch } from './compassBracket';

/**
 * Circle-method round robin pairings.
 * Returns a list of rounds, each round is a list of [entryId1, entryId2] pairs.
 * Handles odd player counts by adding a "bye" slot (null).
 */
function circleRoundRobin(entryIds: string[]): Array<Array<[string | null, string | null]>> {
  const ids = [...entryIds];
  if (ids.length % 2 === 1) {
    ids.push('__BYE__'); // placeholder, converted to null on emit
  }
  const n = ids.length;
  const roundsCount = n - 1;

  const rounds: Array<Array<[string | null, string | null]>> = [];

  // Fixed first slot, rotate the rest.
  const arr = [...ids];
  for (let r = 0; r < roundsCount; r++) {
    const roundPairs: Array<[string | null, string | null]> = [];
    for (let i = 0; i < n / 2; i++) {
      const a = arr[i];
      const b = arr[n - 1 - i];
      const aOut = a === '__BYE__' ? null : a;
      const bOut = b === '__BYE__' ? null : b;
      // Skip matches where both sides are bye (shouldn't happen but be safe)
      // Emit even if one side is bye so the bye shows up as a pending match.
      roundPairs.push([aOut, bOut]);
    }
    rounds.push(roundPairs);

    // Rotate: keep arr[0] fixed, move arr[1] to the end, shift others up.
    const fixed = arr[0];
    const rest = arr.slice(1);
    rest.unshift(rest.pop()!);
    arr.splice(0, arr.length, fixed, ...rest);
  }

  return rounds;
}

/**
 * Build the full set of matches for a round robin flight. Returns every
 * match across every round, with match_index assigned sequentially within
 * each round.
 */
export function generateRoundRobin(entries: CompassEntry[]): {
  numRounds: number;
  matches: CompassMatch[];
} {
  const sorted = [...entries].sort((a, b) => a.seed - b.seed);
  const ids = sorted.map(e => e.id);
  const rounds = circleRoundRobin(ids);

  const matches: CompassMatch[] = [];
  rounds.forEach((roundPairs, roundIdx) => {
    // Filter out matches where either side is a bye — we just don't create
    // those matches. Everyone else in that round still plays.
    const realPairs = roundPairs.filter(([a, b]) => a !== null && b !== null);
    realPairs.forEach((pair, matchIdx) => {
      matches.push({
        round: roundIdx + 1,
        matchIndex: matchIdx,
        bracketPosition: `RR-R${roundIdx + 1}-M${matchIdx + 1}`,
        entryAId: pair[0],
        entryBId: pair[1],
      });
    });
  });

  return {
    numRounds: rounds.length,
    matches,
  };
}

/**
 * For a round robin, "final standings" are computed by counting wins.
 * Given the list of confirmed matches for a flight, returns a ranking
 * by (wins desc, losses asc, head-to-head asc as tiebreaker).
 */
export function computeRoundRobinStandings(
  entries: CompassEntry[],
  results: Array<{ winnerId: string; loserId: string }>
): Array<{ entryId: string; wins: number; losses: number; rank: number }> {
  const stats = new Map<string, { wins: number; losses: number }>();
  for (const e of entries) stats.set(e.id, { wins: 0, losses: 0 });

  for (const r of results) {
    const w = stats.get(r.winnerId);
    const l = stats.get(r.loserId);
    if (w) w.wins += 1;
    if (l) l.losses += 1;
  }

  const standings = Array.from(stats.entries()).map(([entryId, s]) => ({
    entryId,
    wins: s.wins,
    losses: s.losses,
  }));

  standings.sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    if (a.losses !== b.losses) return a.losses - b.losses;
    return 0;
  });

  return standings.map((s, idx) => ({ ...s, rank: idx + 1 }));
}
