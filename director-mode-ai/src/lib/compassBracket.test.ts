import { describe, it, expect } from 'vitest';
import {
  generateRound1,
  generateNextRound,
  totalRounds,
  roundDeadline,
  type CompassEntry,
  type CompassMatch,
  type MatchResult,
} from './compassBracket';

// ----- test helpers -----

function makeEntries(count: number): CompassEntry[] {
  return Array.from({ length: count }, (_, i) => ({ id: `e${i + 1}`, seed: i + 1 }));
}

/**
 * Simulate results where the better-seeded (lower seed number) player always
 * wins. Works on any list of compass matches; matches with a missing entry
 * are skipped (they're byes).
 */
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

// ----- R1 seeding -----

describe('generateRound1', () => {
  it('16-player produces 8 matches with standard seed pairs (1v16, 8v9, 5v12, 4v13, 3v14, 6v11, 7v10, 2v15)', () => {
    const entries = makeEntries(16);
    const r1 = generateRound1(entries, 16);
    expect(r1).toHaveLength(8);

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
      const m = r1[i];
      expect(m.round).toBe(1);
      expect(m.matchIndex).toBe(i);
      expect(m.bracketPosition).toBe(`R1-M${i + 1}`);
      expect(m.entryAId).toBe(`e${expected[i][0]}`);
      expect(m.entryBId).toBe(`e${expected[i][1]}`);
    }
  });

  it('8-player produces 4 matches with 1v8, 4v5, 3v6, 2v7', () => {
    const entries = makeEntries(8);
    const r1 = generateRound1(entries, 8);
    expect(r1).toHaveLength(4);
    const expected: Array<[number, number]> = [
      [1, 8],
      [4, 5],
      [3, 6],
      [2, 7],
    ];
    for (let i = 0; i < 4; i++) {
      expect(r1[i].matchIndex).toBe(i);
      expect(r1[i].entryAId).toBe(`e${expected[i][0]}`);
      expect(r1[i].entryBId).toBe(`e${expected[i][1]}`);
    }
  });

  it('throws when entry count does not match bracket size', () => {
    expect(() => generateRound1(makeEntries(15), 16)).toThrow();
    expect(() => generateRound1(makeEntries(8), 16)).toThrow();
    expect(() => generateRound1(makeEntries(7), 8)).toThrow();
  });
});

describe('totalRounds', () => {
  it('returns 4 for 16-player and 3 for 8-player', () => {
    expect(totalRounds(16)).toBe(4);
    expect(totalRounds(8)).toBe(3);
  });
});

describe('roundDeadline', () => {
  it('adds 14 * round days to the league start', () => {
    const start = new Date('2026-01-01T00:00:00Z');
    const r1 = roundDeadline(start, 1);
    const r4 = roundDeadline(start, 4);
    // R1 = start + 14 days
    expect(r1.toISOString().slice(0, 10)).toBe('2026-01-15');
    // R4 = start + 56 days
    expect(r4.toISOString().slice(0, 10)).toBe('2026-02-26');
  });
});

// ----- Compass 16p round transitions -----

describe('generateNextRound — compass 16p', () => {
  it('R1 → R2 splits winners east and losers west with match_index 0..7', () => {
    const entries = makeEntries(16);
    const r1 = generateRound1(entries, 16);
    const results = topSeedWins(r1, entries);
    const r2 = generateNextRound(16, 1, results);

    expect(r2).toHaveLength(8);
    expect(r2.every(m => m.round === 2)).toBe(true);

    const eastMatches = r2.filter(m => m.bracketPosition.startsWith('E'));
    const westMatches = r2.filter(m => m.bracketPosition.startsWith('W'));
    expect(eastMatches).toHaveLength(4);
    expect(westMatches).toHaveLength(4);

    // match_index 0..7 contiguous
    const indices = r2.map(m => m.matchIndex).sort((a, b) => a - b);
    expect(indices).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);

    // E-R2-M1 gets R1-M1 + R1-M2 winners
    const eastM1 = r2.find(m => m.bracketPosition === 'E-R2-M1')!;
    expect(eastM1.entryAId).toBe(results[0].winnerId);
    expect(eastM1.entryBId).toBe(results[1].winnerId);

    // W-R2-M1 gets R1-M1 + R1-M2 losers
    const westM1 = r2.find(m => m.bracketPosition === 'W-R2-M1')!;
    expect(westM1.entryAId).toBe(results[0].loserId);
    expect(westM1.entryBId).toBe(results[1].loserId);
  });

  it('R2 → R3 produces 2 matches each for NE/SE/NW/SW with match_index 0..7', () => {
    const entries = makeEntries(16);
    const r1 = generateRound1(entries, 16);
    const r1r = topSeedWins(r1, entries);
    const r2 = generateNextRound(16, 1, r1r);
    const r2r = topSeedWins(r2, entries);
    const r3 = generateNextRound(16, 2, r2r);

    expect(r3).toHaveLength(8);
    const byPrefix = (prefix: string) =>
      r3.filter(m => m.bracketPosition.startsWith(prefix)).length;
    expect(byPrefix('NE')).toBe(2);
    expect(byPrefix('SE')).toBe(2);
    expect(byPrefix('NW')).toBe(2);
    expect(byPrefix('SW')).toBe(2);

    const indices = r3.map(m => m.matchIndex).sort((a, b) => a - b);
    expect(indices).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('R3 → R4 produces FINAL + 3RD for each of NE/SE/NW/SW', () => {
    const entries = makeEntries(16);
    const r1 = generateRound1(entries, 16);
    const r1r = topSeedWins(r1, entries);
    const r2 = generateNextRound(16, 1, r1r);
    const r2r = topSeedWins(r2, entries);
    const r3 = generateNextRound(16, 2, r2r);
    const r3r = topSeedWins(r3, entries);
    const r4 = generateNextRound(16, 3, r3r);

    expect(r4).toHaveLength(8);
    for (const prefix of ['NE', 'SE', 'NW', 'SW']) {
      expect(r4.find(m => m.bracketPosition === `${prefix}-FINAL`)).toBeDefined();
      expect(r4.find(m => m.bracketPosition === `${prefix}-3RD`)).toBeDefined();
    }
  });

  it('returns empty array when asked to advance past the final round', () => {
    expect(generateNextRound(16, 4, [])).toEqual([]);
    expect(generateNextRound(16, 5, [])).toEqual([]);
  });
});

// ----- Compass 8p round transitions -----

describe('generateNextRound — compass 8p', () => {
  it('R1 → R2 produces 4 matches split east/west', () => {
    const entries = makeEntries(8);
    const r1 = generateRound1(entries, 8);
    const results = topSeedWins(r1, entries);
    const r2 = generateNextRound(8, 1, results);

    expect(r2).toHaveLength(4);
    expect(r2.filter(m => m.bracketPosition.startsWith('E')).length).toBe(2);
    expect(r2.filter(m => m.bracketPosition.startsWith('W')).length).toBe(2);
    expect(r2.map(m => m.matchIndex).sort()).toEqual([0, 1, 2, 3]);
  });

  it('R2 → R3 produces 4 finals — NE/SE/NW/SW', () => {
    const entries = makeEntries(8);
    const r1 = generateRound1(entries, 8);
    const r1r = topSeedWins(r1, entries);
    const r2 = generateNextRound(8, 1, r1r);
    const r2r = topSeedWins(r2, entries);
    const r3 = generateNextRound(8, 2, r2r);

    expect(r3).toHaveLength(4);
    const positions = r3.map(m => m.bracketPosition).sort();
    expect(positions).toEqual(['NE-FINAL', 'NW-FINAL', 'SE-FINAL', 'SW-FINAL']);
  });

  it('returns empty array past round 3 (final)', () => {
    expect(generateNextRound(8, 3, [])).toEqual([]);
  });
});
