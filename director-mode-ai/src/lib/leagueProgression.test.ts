import { describe, it, expect } from 'vitest';
import {
  computeAdvancementTargets,
  type AdvanceTarget,
} from './leagueProgression';
import {
  generateRound1,
  generateNextRound,
  type CompassEntry,
  type CompassMatch,
  type MatchResult,
} from './compassBracket';
import {
  generateSingleEliminationRound1,
  generateSingleEliminationNextRound,
} from './singleEliminationBracket';

// ----- test helpers -----

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

/**
 * Simulate per-match advancement for a completed round: for each match, run
 * computeAdvancementTargets and "place" the winner (and, for compass, loser)
 * into the target (round, matchIndex, slot). Return the synthesized
 * next-round matches in the same shape CompassMatch uses, so we can diff
 * them against what bulk generateNextRound would have produced given the
 * same results.
 *
 * This is the round-trip proof that the per-match system produces the same
 * bracket structure as the bulk system. If they diverge, we have a bug.
 */
function buildNextRoundViaPerMatch(params: {
  leagueType: 'compass' | 'single_elimination';
  flightSize: number;
  numRounds: number;
  completedRound: number;
  completed: CompassMatch[];
  results: MatchResult[];
}): CompassMatch[] {
  const { leagueType, flightSize, numRounds, completedRound, completed, results } = params;
  const byKey = new Map<string, CompassMatch>();
  const resultByIndex = new Map(results.map(r => [r.matchIndex, r]));

  const place = (target: AdvanceTarget | null, id: string) => {
    if (!target) return;
    const key = `${target.round}-${target.matchIndex}`;
    let row = byKey.get(key);
    if (!row) {
      row = {
        round: target.round,
        matchIndex: target.matchIndex,
        bracketPosition: target.bracketPosition,
        entryAId: null,
        entryBId: null,
      };
      byKey.set(key, row);
    }
    if (target.slot === 'a') row.entryAId = id;
    else row.entryBId = id;
  };

  for (const m of completed) {
    const result = resultByIndex.get(m.matchIndex);
    if (!result) continue;
    const targets = computeAdvancementTargets({
      leagueType,
      flightSize,
      numRounds,
      round: completedRound,
      matchIndex: m.matchIndex,
      bracketPosition: m.bracketPosition,
    });
    place(targets.winner, result.winnerId);
    place(targets.loser, result.loserId);
  }

  return Array.from(byKey.values()).sort((a, b) => a.matchIndex - b.matchIndex);
}

function normalize(matches: CompassMatch[]) {
  return matches
    .slice()
    .sort((a, b) => a.matchIndex - b.matchIndex)
    .map(m => ({
      round: m.round,
      matchIndex: m.matchIndex,
      bracketPosition: m.bracketPosition,
      entryAId: m.entryAId,
      entryBId: m.entryBId,
    }));
}

// ----- ROUND-TRIP: per-match === bulk for every transition -----

describe('computeAdvancementTargets round-trip vs bulk generateNextRound', () => {
  describe('compass 16p', () => {
    it('R1 → R2 matches bulk exactly', () => {
      const entries = makeEntries(16);
      const r1 = generateRound1(entries, 16);
      const results = topSeedWins(r1, entries);
      const bulk = generateNextRound(16, 1, results);
      const perMatch = buildNextRoundViaPerMatch({
        leagueType: 'compass',
        flightSize: 16,
        numRounds: 4,
        completedRound: 1,
        completed: r1,
        results,
      });
      expect(normalize(perMatch)).toEqual(normalize(bulk));
    });

    it('R2 → R3 matches bulk exactly', () => {
      const entries = makeEntries(16);
      const r1 = generateRound1(entries, 16);
      const r1r = topSeedWins(r1, entries);
      const r2 = generateNextRound(16, 1, r1r);
      const r2r = topSeedWins(r2, entries);
      const bulk = generateNextRound(16, 2, r2r);
      const perMatch = buildNextRoundViaPerMatch({
        leagueType: 'compass',
        flightSize: 16,
        numRounds: 4,
        completedRound: 2,
        completed: r2,
        results: r2r,
      });
      expect(normalize(perMatch)).toEqual(normalize(bulk));
    });

    it('R3 → R4 matches bulk exactly', () => {
      const entries = makeEntries(16);
      const r1 = generateRound1(entries, 16);
      const r1r = topSeedWins(r1, entries);
      const r2 = generateNextRound(16, 1, r1r);
      const r2r = topSeedWins(r2, entries);
      const r3 = generateNextRound(16, 2, r2r);
      const r3r = topSeedWins(r3, entries);
      const bulk = generateNextRound(16, 3, r3r);
      const perMatch = buildNextRoundViaPerMatch({
        leagueType: 'compass',
        flightSize: 16,
        numRounds: 4,
        completedRound: 3,
        completed: r3,
        results: r3r,
      });
      expect(normalize(perMatch)).toEqual(normalize(bulk));
    });

    it('walks the full bracket R1→R4 with per-match matching bulk at every step', () => {
      const entries = makeEntries(16);
      let current = generateRound1(entries, 16);
      let completedRound = 1;
      while (completedRound < 4) {
        const results = topSeedWins(current, entries);
        const bulk = generateNextRound(16, completedRound, results);
        const perMatch = buildNextRoundViaPerMatch({
          leagueType: 'compass',
          flightSize: 16,
          numRounds: 4,
          completedRound,
          completed: current,
          results,
        });
        expect(normalize(perMatch)).toEqual(normalize(bulk));
        current = bulk;
        completedRound += 1;
      }
      // Final round for 16p has 8 matches (4 finals + 4 third-place)
      expect(current).toHaveLength(8);
    });
  });

  describe('compass 8p', () => {
    it('R1 → R2 matches bulk', () => {
      const entries = makeEntries(8);
      const r1 = generateRound1(entries, 8);
      const results = topSeedWins(r1, entries);
      const bulk = generateNextRound(8, 1, results);
      const perMatch = buildNextRoundViaPerMatch({
        leagueType: 'compass',
        flightSize: 8,
        numRounds: 3,
        completedRound: 1,
        completed: r1,
        results,
      });
      expect(normalize(perMatch)).toEqual(normalize(bulk));
    });

    it('R2 → R3 (finals) matches bulk', () => {
      const entries = makeEntries(8);
      const r1 = generateRound1(entries, 8);
      const r1r = topSeedWins(r1, entries);
      const r2 = generateNextRound(8, 1, r1r);
      const r2r = topSeedWins(r2, entries);
      const bulk = generateNextRound(8, 2, r2r);
      const perMatch = buildNextRoundViaPerMatch({
        leagueType: 'compass',
        flightSize: 8,
        numRounds: 3,
        completedRound: 2,
        completed: r2,
        results: r2r,
      });
      expect(normalize(perMatch)).toEqual(normalize(bulk));
    });
  });

  describe('single elimination 16p', () => {
    it('R1 → R2 matches bulk', () => {
      const entries = makeEntries(16);
      const { matches: r1, numRounds } = generateSingleEliminationRound1(entries);
      const results = topSeedWins(r1, entries);
      const bulk = generateSingleEliminationNextRound(1, numRounds, results);
      const perMatch = buildNextRoundViaPerMatch({
        leagueType: 'single_elimination',
        flightSize: 16,
        numRounds,
        completedRound: 1,
        completed: r1,
        results,
      });
      expect(normalize(perMatch)).toEqual(normalize(bulk));
    });

    it('walks all 4 rounds to SE-FINAL with per-match matching bulk at every step', () => {
      const entries = makeEntries(16);
      const { matches: r1, numRounds } = generateSingleEliminationRound1(entries);
      let current = r1;
      let completedRound = 1;
      while (completedRound < numRounds) {
        const results = topSeedWins(current, entries);
        const bulk = generateSingleEliminationNextRound(completedRound, numRounds, results);
        const perMatch = buildNextRoundViaPerMatch({
          leagueType: 'single_elimination',
          flightSize: 16,
          numRounds,
          completedRound,
          completed: current,
          results,
        });
        expect(normalize(perMatch)).toEqual(normalize(bulk));
        current = bulk;
        completedRound += 1;
      }
      expect(current).toHaveLength(1);
      expect(current[0].bracketPosition).toBe('SE-FINAL');
    });
  });

  describe('single elimination 8p', () => {
    it('walks all 3 rounds to SE-FINAL with per-match === bulk', () => {
      const entries = makeEntries(8);
      const { matches: r1, numRounds } = generateSingleEliminationRound1(entries);
      let current = r1;
      let completedRound = 1;
      while (completedRound < numRounds) {
        const results = topSeedWins(current, entries);
        const bulk = generateSingleEliminationNextRound(completedRound, numRounds, results);
        const perMatch = buildNextRoundViaPerMatch({
          leagueType: 'single_elimination',
          flightSize: 8,
          numRounds,
          completedRound,
          completed: current,
          results,
        });
        expect(normalize(perMatch)).toEqual(normalize(bulk));
        current = bulk;
        completedRound += 1;
      }
      expect(current).toHaveLength(1);
      expect(current[0].bracketPosition).toBe('SE-FINAL');
    });
  });
});

// ----- Edge cases -----

describe('computeAdvancementTargets edge cases', () => {
  it('round_robin always returns null targets (all matches generated up front)', () => {
    const result = computeAdvancementTargets({
      leagueType: 'round_robin',
      flightSize: 8,
      numRounds: 7,
      round: 1,
      matchIndex: 0,
      bracketPosition: 'RR-R1-M1',
    });
    expect(result.winner).toBeNull();
    expect(result.loser).toBeNull();
  });

  it('single_elimination past final returns null', () => {
    const result = computeAdvancementTargets({
      leagueType: 'single_elimination',
      flightSize: 16,
      numRounds: 4,
      round: 4,
      matchIndex: 0,
      bracketPosition: 'SE-FINAL',
    });
    expect(result.winner).toBeNull();
    expect(result.loser).toBeNull();
  });

  it('compass 16p R4 (final round) returns null', () => {
    const result = computeAdvancementTargets({
      leagueType: 'compass',
      flightSize: 16,
      numRounds: 4,
      round: 4,
      matchIndex: 0,
      bracketPosition: 'NE-FINAL',
    });
    expect(result.winner).toBeNull();
    expect(result.loser).toBeNull();
  });

  it('compass 8p R3 (final round) returns null', () => {
    const result = computeAdvancementTargets({
      leagueType: 'compass',
      flightSize: 8,
      numRounds: 3,
      round: 3,
      matchIndex: 0,
      bracketPosition: 'NE-FINAL',
    });
    expect(result.winner).toBeNull();
    expect(result.loser).toBeNull();
  });

  it('compass without bracket_position returns null', () => {
    const result = computeAdvancementTargets({
      leagueType: 'compass',
      flightSize: 16,
      numRounds: 4,
      round: 1,
      matchIndex: 0,
      bracketPosition: null,
    });
    expect(result.winner).toBeNull();
    expect(result.loser).toBeNull();
  });

  it('compass 16p R1-M1 winner → E-R2-M1 slot a, loser → W-R2-M1 slot a', () => {
    const result = computeAdvancementTargets({
      leagueType: 'compass',
      flightSize: 16,
      numRounds: 4,
      round: 1,
      matchIndex: 0,
      bracketPosition: 'R1-M1',
    });
    expect(result.winner).toEqual({
      round: 2,
      matchIndex: 0,
      bracketPosition: 'E-R2-M1',
      slot: 'a',
    });
    expect(result.loser).toEqual({
      round: 2,
      matchIndex: 4,
      bracketPosition: 'W-R2-M1',
      slot: 'a',
    });
  });

  it('compass 16p R1-M2 winner → E-R2-M1 slot b, loser → W-R2-M1 slot b', () => {
    const result = computeAdvancementTargets({
      leagueType: 'compass',
      flightSize: 16,
      numRounds: 4,
      round: 1,
      matchIndex: 1,
      bracketPosition: 'R1-M2',
    });
    expect(result.winner?.bracketPosition).toBe('E-R2-M1');
    expect(result.winner?.slot).toBe('b');
    expect(result.loser?.bracketPosition).toBe('W-R2-M1');
    expect(result.loser?.slot).toBe('b');
  });

  it('single_elimination 16p R1-M0 winner → SE-R2-M1 slot a', () => {
    const result = computeAdvancementTargets({
      leagueType: 'single_elimination',
      flightSize: 16,
      numRounds: 4,
      round: 1,
      matchIndex: 0,
      bracketPosition: 'SE-R1-M1',
    });
    expect(result.winner).toEqual({
      round: 2,
      matchIndex: 0,
      bracketPosition: 'SE-R2-M1',
      slot: 'a',
    });
    expect(result.loser).toBeNull();
  });

  it('single_elimination 16p R3 (semi) winner → SE-FINAL slot a/b', () => {
    const sf1 = computeAdvancementTargets({
      leagueType: 'single_elimination',
      flightSize: 16,
      numRounds: 4,
      round: 3,
      matchIndex: 0,
      bracketPosition: 'SE-SF-M1',
    });
    expect(sf1.winner?.bracketPosition).toBe('SE-FINAL');
    expect(sf1.winner?.slot).toBe('a');

    const sf2 = computeAdvancementTargets({
      leagueType: 'single_elimination',
      flightSize: 16,
      numRounds: 4,
      round: 3,
      matchIndex: 1,
      bracketPosition: 'SE-SF-M2',
    });
    expect(sf2.winner?.bracketPosition).toBe('SE-FINAL');
    expect(sf2.winner?.slot).toBe('b');
  });
});
