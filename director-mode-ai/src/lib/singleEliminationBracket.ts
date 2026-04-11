/**
 * Single elimination bracket generator.
 *
 * Classic knockout tournament: loser is out, winner advances to the next
 * round. Supports any power-of-2 size from 2 to 64. For non-power-of-2
 * entry counts, the highest seeds get byes in R1 until the count is
 * padded to the next power of 2.
 *
 * Seeding follows the standard rule: the top seeds are separated so they
 * can only meet in the final. For a 16-player bracket the R1 pairings
 * are: 1v16, 8v9, 5v12, 4v13, 3v14, 6v11, 7v10, 2v15.
 */

import type { CompassEntry, CompassMatch, MatchResult } from './compassBracket';

/**
 * Returns the standard seeded match pairings for a bracket of `size`
 * players (size must be a power of 2). Seeds are 1-indexed.
 *
 * The algorithm builds the pairings recursively so the #1 and #2 seeds
 * end up on opposite sides of the draw, #1 and #3 in opposite halves
 * within the same half, and so on.
 */
function standardSeedPairs(size: number): Array<[number, number]> {
  if (size < 2 || (size & (size - 1)) !== 0) {
    throw new Error(`Single elimination size must be a power of 2 (got ${size})`);
  }

  // Build the seed order using the classic "mirror" method:
  // Start with [1], then for each round double the array by appending
  // (N+1-x) for each existing x, placing each new value across from its
  // counterpart so top seeds stay apart.
  let order = [1];
  let round = 1;
  while (order.length < size) {
    const next: number[] = [];
    const target = order.length * 2;
    for (const s of order) {
      next.push(s);
      next.push(target + 1 - s);
    }
    order = next;
    round += 1;
  }

  // order is now size entries long, in positional order top→bottom of the draw.
  // R1 matches are adjacent pairs: (order[0], order[1]), (order[2], order[3]), ...
  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < size; i += 2) {
    pairs.push([order[i], order[i + 1]]);
  }
  return pairs;
}

/** Round up to the next power of 2 (at least 2). */
function nextPowerOfTwo(n: number): number {
  if (n <= 2) return 2;
  return 1 << Math.ceil(Math.log2(n));
}

/**
 * Create R1 matches for a single elimination bracket.
 *
 * For non-power-of-2 entry counts, the top seeds get byes (their R1 match
 * has `entryBId = null`). The progression code auto-advances bye winners
 * into R2 immediately.
 */
export function generateSingleEliminationRound1(
  entries: CompassEntry[]
): { bracketSize: number; numRounds: number; matches: CompassMatch[] } {
  const sorted = [...entries].sort((a, b) => a.seed - b.seed);
  const n = sorted.length;
  const bracketSize = nextPowerOfTwo(n);
  const numRounds = Math.log2(bracketSize);

  // Pad with `null` bye slots in the worst seeds.
  const padded: Array<{ id: string; seed: number } | null> = [...sorted];
  while (padded.length < bracketSize) {
    padded.push(null);
  }

  const pairs = standardSeedPairs(bracketSize);
  const matches: CompassMatch[] = [];

  pairs.forEach((pair, idx) => {
    const [seedA, seedB] = pair;
    const a = padded[seedA - 1];
    const b = padded[seedB - 1];
    matches.push({
      round: 1,
      matchIndex: idx,
      bracketPosition: `SE-R1-M${idx + 1}`,
      entryAId: a?.id || null,
      entryBId: b?.id || null,
    });
  });

  return { bracketSize, numRounds, matches };
}

/**
 * Given a completed round's results, generate the next round's matches.
 * Winners from adjacent matches pair up (M0 winner vs M1 winner, M2 vs M3, …).
 */
export function generateSingleEliminationNextRound(
  completedRound: number,
  totalRounds: number,
  results: MatchResult[]
): CompassMatch[] {
  if (completedRound >= totalRounds) return [];
  const nextRound = completedRound + 1;

  // Sort by match index so pairings are deterministic.
  const sorted = [...results].sort((a, b) => a.matchIndex - b.matchIndex);
  const winners = sorted.map(r => r.winnerId);

  const matches: CompassMatch[] = [];
  for (let i = 0; i < winners.length; i += 2) {
    matches.push({
      round: nextRound,
      matchIndex: i / 2,
      bracketPosition: nextRound === totalRounds
        ? 'SE-FINAL'
        : nextRound === totalRounds - 1
          ? `SE-SF-M${i / 2 + 1}`
          : `SE-R${nextRound}-M${i / 2 + 1}`,
      entryAId: winners[i] || null,
      entryBId: winners[i + 1] || null,
    });
  }
  return matches;
}

/**
 * Handle bye auto-advancement. After generating R1, any match with exactly
 * one entry (entryBId === null) should be marked as a bye — the present
 * player advances automatically without actually playing. Returns the
 * R1 matches unchanged and a list of bye winners that should immediately
 * be treated as confirmed results for the progression code.
 */
export function extractByes(r1Matches: CompassMatch[]): MatchResult[] {
  const byes: MatchResult[] = [];
  for (const m of r1Matches) {
    if (m.entryAId && !m.entryBId) {
      byes.push({
        round: 1,
        matchIndex: m.matchIndex,
        bracketPosition: m.bracketPosition,
        winnerId: m.entryAId,
        loserId: m.entryBId || '',
      });
    } else if (!m.entryAId && m.entryBId) {
      byes.push({
        round: 1,
        matchIndex: m.matchIndex,
        bracketPosition: m.bracketPosition,
        winnerId: m.entryBId,
        loserId: m.entryAId || '',
      });
    }
  }
  return byes;
}
