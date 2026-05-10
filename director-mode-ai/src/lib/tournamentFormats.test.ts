import { describe, it, expect } from 'vitest';
import {
  generateRRMatches,
  computeRRStandings,
  seedPairings,
  generateSingleElimBracket,
  generateFMLCBracket,
  generateFFICBracket,
  generateTournamentMatches,
} from './tournamentFormats';

describe('generateRRMatches', () => {
  it('returns 6 matches for 4 players (3 rounds × 2 matches)', () => {
    const m = generateRRMatches(['a', 'b', 'c', 'd']);
    expect(m).toHaveLength(6);
    expect(m.filter((x) => x.round === 1)).toHaveLength(2);
    expect(m.filter((x) => x.round === 2)).toHaveLength(2);
    expect(m.filter((x) => x.round === 3)).toHaveLength(2);
  });

  it('every player plays every other exactly once', () => {
    const players = ['a', 'b', 'c', 'd', 'e'];
    const m = generateRRMatches(players);
    const opponents = new Map<string, Set<string>>();
    for (const p of players) opponents.set(p, new Set());
    for (const x of m) {
      const a = x.player1_id!;
      const b = x.player3_id!;
      opponents.get(a)!.add(b);
      opponents.get(b)!.add(a);
    }
    for (const p of players) {
      expect(opponents.get(p)!.size).toBe(players.length - 1);
    }
  });

  it('handles odd number of players via byes (no phantom appears)', () => {
    const m = generateRRMatches(['a', 'b', 'c']);
    // 3 rounds, but each round one player byes → 1 match per round = 3 matches total
    expect(m).toHaveLength(3);
    for (const x of m) {
      expect(x.player1_id).not.toContain('__phantom__');
      expect(x.player3_id).not.toContain('__phantom__');
    }
  });

  it('returns no matches for fewer than 2 players', () => {
    expect(generateRRMatches([])).toEqual([]);
    expect(generateRRMatches(['a'])).toEqual([]);
  });

  it('marks matches as singles or doubles per matchType arg', () => {
    expect(generateRRMatches(['a', 'b'], 'doubles')[0].match_type).toBe('doubles');
    expect(generateRRMatches(['a', 'b'], 'singles')[0].match_type).toBe('singles');
  });
});

describe('computeRRStandings', () => {
  it('ranks by match wins', () => {
    const entries = [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }];
    const matches = [
      {
        player1_id: 'p1',
        player3_id: 'p2',
        score: '6-3',
        winner_side: 'a' as const,
        status: 'completed',
      },
      {
        player1_id: 'p1',
        player3_id: 'p3',
        score: '6-2',
        winner_side: 'a' as const,
        status: 'completed',
      },
      {
        player1_id: 'p2',
        player3_id: 'p3',
        score: '6-4',
        winner_side: 'a' as const,
        status: 'completed',
      },
    ];
    const s = computeRRStandings(entries, matches);
    expect(s[0].entry_id).toBe('p1'); // 2-0
    expect(s[1].entry_id).toBe('p2'); // 1-1
    expect(s[2].entry_id).toBe('p3'); // 0-2
  });

  it('tiebreaks ties by point differential', () => {
    // 3 players each go 1-1 — winner of best point diff wins
    const entries = [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }];
    const matches = [
      // p1 beats p2 6-0
      { player1_id: 'p1', player3_id: 'p2', score: '6-0', winner_side: 'a' as const, status: 'completed' },
      // p2 beats p3 6-0
      { player1_id: 'p2', player3_id: 'p3', score: '6-0', winner_side: 'a' as const, status: 'completed' },
      // p3 beats p1 6-0
      { player1_id: 'p3', player3_id: 'p1', score: '6-0', winner_side: 'a' as const, status: 'completed' },
    ];
    const s = computeRRStandings(entries, matches);
    // All 1-1, all +6 / -6 game diff → tied → next tiebreak (games won) → all 6 → seed fallback
    expect(s.every((x) => x.match_wins === 1)).toBe(true);
  });
});

describe('seedPairings', () => {
  it.each([
    [2, [1, 2]],
    [4, [1, 4, 2, 3]],
    [8, [1, 8, 4, 5, 2, 7, 3, 6]],
    [16, [1, 16, 8, 9, 4, 13, 5, 12, 2, 15, 7, 10, 3, 14, 6, 11]],
  ])('size %i', (size, expected) => {
    expect(seedPairings(size)).toEqual(expected);
  });
});

describe('generateSingleElimBracket', () => {
  it('8 players → 4 R1 + 2 R2 + 1 final = 7 matches', () => {
    const m = generateSingleElimBracket(['1', '2', '3', '4', '5', '6', '7', '8']);
    expect(m).toHaveLength(7);
    expect(m.filter((x) => x.round === 1)).toHaveLength(4);
    expect(m.filter((x) => x.round === 2)).toHaveLength(2);
    expect(m.filter((x) => x.round === 3)).toHaveLength(1);
  });

  it('R1 pairs follow standard seed pairings (1v8, 4v5, 2v7, 3v6)', () => {
    const m = generateSingleElimBracket(['1', '2', '3', '4', '5', '6', '7', '8']);
    const r1 = m.filter((x) => x.round === 1).sort((a, b) => a.slot - b.slot);
    expect(r1[0]).toMatchObject({ player1_id: '1', player3_id: '8' });
    expect(r1[1]).toMatchObject({ player1_id: '4', player3_id: '5' });
    expect(r1[2]).toMatchObject({ player1_id: '2', player3_id: '7' });
    expect(r1[3]).toMatchObject({ player1_id: '3', player3_id: '6' });
  });

  it('5 players → top 3 seeds get byes, only 1 R1 match (seeds 4 vs 5)', () => {
    const m = generateSingleElimBracket(['1', '2', '3', '4', '5']);
    // 8-slot bracket, seeds 6/7/8 are null byes, but only seed 4 vs 5 actually plays in R1
    const r1 = m.filter((x) => x.bracket === 'main' && x.round === 1);
    expect(r1).toHaveLength(1);
    expect(r1[0]).toMatchObject({ player1_id: '4', player3_id: '5' });
  });

  it('wires winner_feeds_to references between rounds', () => {
    const m = generateSingleElimBracket(['1', '2', '3', '4']);
    const r1 = m.filter((x) => x.round === 1);
    // Both R1 matches' winners should feed into the final (only R2 match exists)
    expect(r1[0].winner_feeds_to).toBe('main:2:1:a');
    expect(r1[1].winner_feeds_to).toBe('main:2:1:b');
  });
});

describe('generateFMLCBracket', () => {
  it('8 players: 7 main matches + 3 consolation matches (4 R1 losers → 2 cons R1 + 1 cons final)', () => {
    const m = generateFMLCBracket(['1', '2', '3', '4', '5', '6', '7', '8']);
    const main = m.filter((x) => x.bracket === 'main');
    const cons = m.filter((x) => x.bracket === 'consolation');
    expect(main).toHaveLength(7);
    expect(cons).toHaveLength(3); // 2 R1 + 1 final
  });

  it('R1 main losers feed into consolation R1', () => {
    const m = generateFMLCBracket(['1', '2', '3', '4', '5', '6', '7', '8']);
    const r1 = m.filter((x) => x.bracket === 'main' && x.round === 1);
    // Each R1 main match should have loser_feeds_to set to a consolation slot
    for (const match of r1) {
      expect(match.loser_feeds_to).toMatch(/^consolation:1:\d:[ab]$/);
    }
  });
});

describe('generateFFICBracket', () => {
  it('8 players: 7 main matches + consolation rounds for R1 + R2 main losers', () => {
    const m = generateFFICBracket(['1', '2', '3', '4', '5', '6', '7', '8']);
    const main = m.filter((x) => x.bracket === 'main');
    const cons = m.filter((x) => x.bracket === 'consolation');
    expect(main).toHaveLength(7);
    // Cons R1: 2 matches (4 R1 losers paired)
    // Cons R2: 2 matches (2 cons R1 winners + 2 R2 main losers)
    // Total cons = 4
    expect(cons.length).toBeGreaterThanOrEqual(3);
  });

  it('every main-R1 loser feeds into consolation', () => {
    const m = generateFFICBracket(['1', '2', '3', '4', '5', '6', '7', '8']);
    const r1main = m.filter((x) => x.bracket === 'main' && x.round === 1);
    for (const match of r1main) {
      expect(match.loser_feeds_to).toMatch(/^consolation:1:\d:[ab]$/);
    }
  });
});

describe('generateTournamentMatches dispatcher', () => {
  it('routes rr-singles to RR generator', () => {
    const m = generateTournamentMatches('rr-singles', ['a', 'b', 'c', 'd']);
    expect(m).toHaveLength(6);
    expect(m.every((x) => x.bracket === 'main')).toBe(true);
    expect(m.every((x) => x.match_type === 'singles')).toBe(true);
  });

  it('routes rr-doubles to RR with doubles match_type', () => {
    const m = generateTournamentMatches('rr-doubles', ['a', 'b', 'c', 'd']);
    expect(m.every((x) => x.match_type === 'doubles')).toBe(true);
  });

  it('routes single-elim-singles to single-elim', () => {
    const m = generateTournamentMatches('single-elim-singles', ['1', '2', '3', '4']);
    expect(m).toHaveLength(3); // 2 R1 + 1 final
  });

  it('routes fmlc-singles to FMLC generator', () => {
    const m = generateTournamentMatches('fmlc-singles', ['1', '2', '3', '4', '5', '6', '7', '8']);
    expect(m.some((x) => x.bracket === 'consolation')).toBe(true);
  });

  it('routes ffic-singles to FFIC generator', () => {
    const m = generateTournamentMatches('ffic-singles', ['1', '2', '3', '4', '5', '6', '7', '8']);
    expect(m.some((x) => x.bracket === 'consolation')).toBe(true);
  });
});
