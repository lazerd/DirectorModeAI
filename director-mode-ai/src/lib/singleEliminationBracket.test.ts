import { describe, it, expect } from 'vitest';
import {
  generateSingleEliminationRound1,
  generateSingleEliminationNextRound,
  extractByes,
} from './singleEliminationBracket';
import type { CompassEntry, CompassMatch, MatchResult } from './compassBracket';

function makeEntries(count: number): CompassEntry[] {
  return Array.from({ length: count }, (_, i) => ({ id: `e${i + 1}`, seed: i + 1 }));
}

function topSeedWins(matches: CompassMatch[], entries: CompassEntry[]): MatchResult[] {
  const seedById = new Map(entries.map(e => [e.id, e.seed]));
  return matches
    .filter(m => m.entryAId && m.entryBId)
    .map(m => {
      const sA = seedById.get(m.entryAId!)!;
      const sB = seedById.get(m.entryBId!)!;
      const winnerId = sA < sB ? m.entryAId! : m.entryBId!;
      const loserId = sA < sB ? m.entryBId! : m.entryAId!;
      return {
        round: m.round,
        matchIndex: m.matchIndex,
        bracketPosition: m.bracketPosition,
        winnerId,
        loserId,
      };
    });
}

describe('generateSingleEliminationRound1', () => {
  it('16-player: bracketSize=16, numRounds=4, standard seed pairings', () => {
    const entries = makeEntries(16);
    const { bracketSize, numRounds, matches } = generateSingleEliminationRound1(entries);

    expect(bracketSize).toBe(16);
    expect(numRounds).toBe(4);
    expect(matches).toHaveLength(8);

    const expected: Array<[number, number]> = [
      [1, 16],
      [8, 9],
      [5, 12],
      [4, 13],
      [3, 14],
      [6, 11],
      [7, 10],
      [2, 15],
    ];
    for (let i = 0; i < 8; i++) {
      expect(matches[i].matchIndex).toBe(i);
      expect(matches[i].bracketPosition).toBe(`SE-R1-M${i + 1}`);
      expect(matches[i].entryAId).toBe(`e${expected[i][0]}`);
      expect(matches[i].entryBId).toBe(`e${expected[i][1]}`);
    }
  });

  it('8-player: bracketSize=8, numRounds=3', () => {
    const entries = makeEntries(8);
    const { bracketSize, numRounds, matches } = generateSingleEliminationRound1(entries);
    expect(bracketSize).toBe(8);
    expect(numRounds).toBe(3);
    expect(matches).toHaveLength(4);
  });

  it('4-player: bracketSize=4, numRounds=2', () => {
    const entries = makeEntries(4);
    const { bracketSize, numRounds, matches } = generateSingleEliminationRound1(entries);
    expect(bracketSize).toBe(4);
    expect(numRounds).toBe(2);
    expect(matches).toHaveLength(2);
  });

  it('12-player pads to 16 with byes on the bottom seeds', () => {
    const entries = makeEntries(12);
    const { bracketSize, numRounds, matches } = generateSingleEliminationRound1(entries);
    expect(bracketSize).toBe(16);
    expect(numRounds).toBe(4);
    expect(matches).toHaveLength(8);

    // Seeds 13, 14, 15, 16 don't exist → 4 bye matches (exactly one entry slot null)
    const byes = matches.filter(m => !m.entryAId || !m.entryBId);
    expect(byes).toHaveLength(4);
  });

  it('extractByes returns MatchResult rows for every bye', () => {
    const entries = makeEntries(12);
    const { matches } = generateSingleEliminationRound1(entries);
    const byes = extractByes(matches);
    expect(byes).toHaveLength(4);
    for (const bye of byes) {
      expect(bye.winnerId).toBeTruthy();
      expect(bye.loserId).toBe('');
    }
  });
});

describe('generateSingleEliminationNextRound', () => {
  it('R1 → R2 pairs adjacent winners and halves the match count', () => {
    const entries = makeEntries(16);
    const { matches: r1, numRounds } = generateSingleEliminationRound1(entries);
    const results = topSeedWins(r1, entries);
    const r2 = generateSingleEliminationNextRound(1, numRounds, results);

    expect(r2).toHaveLength(4);
    expect(r2.every(m => m.round === 2)).toBe(true);
    expect(r2[0].entryAId).toBe(results[0].winnerId);
    expect(r2[0].entryBId).toBe(results[1].winnerId);
    expect(r2[1].entryAId).toBe(results[2].winnerId);
    expect(r2[1].entryBId).toBe(results[3].winnerId);
  });

  it('last round uses SE-FINAL; second-to-last uses SE-SF-M*', () => {
    const entries = makeEntries(16);
    const { matches: r1, numRounds } = generateSingleEliminationRound1(entries);

    const r1r = topSeedWins(r1, entries);
    const r2 = generateSingleEliminationNextRound(1, numRounds, r1r);
    const r2r = topSeedWins(r2, entries);
    const r3 = generateSingleEliminationNextRound(2, numRounds, r2r);
    const r3r = topSeedWins(r3, entries);
    const r4 = generateSingleEliminationNextRound(3, numRounds, r3r);

    expect(r3).toHaveLength(2);
    expect(r3.every(m => /^SE-SF-M\d+$/.test(m.bracketPosition))).toBe(true);

    expect(r4).toHaveLength(1);
    expect(r4[0].bracketPosition).toBe('SE-FINAL');
  });

  it('past final returns []', () => {
    expect(generateSingleEliminationNextRound(4, 4, [])).toEqual([]);
    expect(generateSingleEliminationNextRound(5, 4, [])).toEqual([]);
  });
});
