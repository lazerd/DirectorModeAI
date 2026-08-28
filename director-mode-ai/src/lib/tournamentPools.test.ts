import { describe, it, expect } from 'vitest';
import { detectPools, poolStandings, isPoolComplete, readyForPlayoffs, planPlacementPlayoffs, type PoolMatch } from './tournamentPools';

// Build a 2-pool RR like the 10U draw: Pool A = a1..a5 (slots 1-2), Pool B = b1..b5 (slots 101-102).
function rr(players: string[], slotBase: number, winnersInOrder: string[]): PoolMatch[] {
  const ms: PoolMatch[] = [];
  let round = 1, slot = slotBase;
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      const a = players[i], b = players[j];
      // Winner = whichever appears earlier in winnersInOrder (so ranking is deterministic).
      const aWins = winnersInOrder.indexOf(a) < winnersInOrder.indexOf(b);
      ms.push({
        player1_id: a, player3_id: b, score: aWins ? '4-2' : '2-4',
        winner_side: aWins ? 'a' : 'b', status: 'completed',
        bracket: 'main', round, slot,
      });
      slot++;
      if (slot >= slotBase + 2) { slot = slotBase; round++; }
    }
  }
  return ms;
}

describe('tournamentPools', () => {
  const A = ['a1', 'a2', 'a3', 'a4', 'a5'];
  const B = ['b1', 'b2', 'b3', 'b4', 'b5'];
  const entries = [...A, ...B];
  const matches = [...rr(A, 1, A), ...rr(B, 101, B)];

  it('detects two pools of five by who-played-whom', () => {
    const pools = detectPools(entries, matches);
    expect(pools.length).toBe(2);
    expect(pools[0].sort()).toEqual([...A].sort());
    expect(pools[1].sort()).toEqual([...B].sort());
  });

  it('pool standings only count within-pool matches and rank correctly', () => {
    const pools = detectPools(entries, matches);
    const sa = poolStandings(pools[0], matches);
    expect(sa.map((s) => s.entry_id)).toEqual(A); // a1 best … a5 worst
    expect(sa[0].match_wins).toBe(4);
  });

  it('is complete and ready for playoffs when all pool matches done', () => {
    const pools = detectPools(entries, matches);
    expect(pools.every((p) => isPoolComplete(p, matches))).toBe(true);
    expect(readyForPlayoffs(pools, matches)).toBe(true);
  });

  it('plans 5 cross-pool placement matches with correct placements', () => {
    const pools = detectPools(entries, matches);
    const standings = pools.map((p) => poolStandings(p, matches));
    const { pairs, unpaired } = planPlacementPlayoffs(pools, standings);
    expect(pairs.length).toBe(5);
    expect(unpaired.length).toBe(0);
    expect(pairs[0]).toMatchObject({ sideA: 'a1', sideB: 'b1', placeHigh: 1, placeLow: 2 });
    expect(pairs[4]).toMatchObject({ sideA: 'a5', sideB: 'b5', placeHigh: 9, placeLow: 10 });
  });

  it('handles uneven pools (13U: 6 vs 5) by pairing down and flagging the extra', () => {
    const A6 = ['x1', 'x2', 'x3', 'x4', 'x5', 'x6'];
    const B5 = ['y1', 'y2', 'y3', 'y4', 'y5'];
    const m = [...rr(A6, 1, A6), ...rr(B5, 101, B5)];
    const pools = detectPools([...A6, ...B5], m);
    const standings = pools.map((p) => poolStandings(p, m));
    const { pairs, unpaired } = planPlacementPlayoffs(pools, standings);
    expect(pairs.length).toBe(5);
    expect(unpaired.length).toBe(1);
    expect(unpaired[0].entry).toBe('x6');
  });

  it('not ready until every pool match is completed', () => {
    const partial = matches.map((m, i) => (i === 0 ? { ...m, status: 'pending' } : m));
    const pools = detectPools(entries, partial);
    expect(readyForPlayoffs(pools, partial)).toBe(false);
  });

  // Regression: once cross-pool placement matches are seated/scored they used to
  // fuse Pool A and Pool B into one (a1 joined to b1), so re-seeding could no
  // longer tell the pools apart and scrambled a live playoff. Pool detection must
  // ignore the placement round (it always sits above the round robin).
  it('does NOT fuse the pools when cross-pool placement matches exist', () => {
    const placement: PoolMatch[] = A.map((a, i) => ({
      player1_id: a, player3_id: B[i], score: '4-2', winner_side: 'a',
      status: 'completed', bracket: 'main', round: 99, slot: i + 1,
    }));
    const withPlacement = [...matches, ...placement];
    const pools = detectPools(entries, withPlacement);
    expect(pools.length).toBe(2);
    expect(pools[0].sort()).toEqual([...A].sort());
    expect(pools[1].sort()).toEqual([...B].sort());
  });

  // Regression: a phantom "self" match (a player vs itself) can't be scored, so it
  // must never count toward — or block — a pool's completion.
  it('ignores a phantom self-match when judging pool completion', () => {
    const selfMatch: PoolMatch = {
      player1_id: 'a1', player3_id: 'a1', score: null, winner_side: null,
      status: 'pending', bracket: 'main', round: 3, slot: 1,
    };
    const withSelf = [...matches, selfMatch];
    const pools = detectPools(entries, withSelf);
    expect(pools.length).toBe(2);
    expect(isPoolComplete(pools[0], withSelf)).toBe(true);
  });
});

/**
 * Regression cover for the Summer Flex League "8 finals" bug.
 *
 * mens-singles-flex-2026 is a 16-player COMPASS draw, but scripts/build-compass.mjs
 * reshaped its matches without rewriting the event row, so match_format stayed
 * 'rr-singles'. That let syncPlacementPlayoffs past its format guard, and the
 * compass main bracket then read as exactly TWO POOLS OF EIGHT -- so it invented
 * an 8-match placement round on top of the draw's real East Final, and did it
 * again after every single score save.
 *
 * These tests pin the fact that made it possible, so the structural guard in
 * tournamentPlayoffs.ts is never removed as "redundant" with the format check.
 */
describe('detectPools on an elimination-shaped draw', () => {
  const pl = (n: number) => `p${n}`;
  const mk = (
    a: string | null, b: string | null, round: number, slot: number, feeds = true,
  ): PoolMatch => ({
    player1_id: a, player3_id: b, score: a && b ? '6-0' : null,
    winner_side: a && b ? 'a' : null, status: a && b ? 'completed' : 'pending',
    bracket: 'main', round, slot,
    winner_feeds_to: feeds ? `main:${round + 1}:${Math.ceil(slot / 2)}:a` : null,
    loser_feeds_to: null,
  });

  it('reads a 16-player compass main bracket as exactly two pools of eight', () => {
    const entries = Array.from({ length: 16 }, (_, i) => pl(i + 1));
    const main: PoolMatch[] = [];
    for (let i = 0; i < 8; i++) main.push(mk(pl(2 * i + 1), pl(2 * i + 2), 1, i + 1));
    for (let i = 0; i < 4; i++) main.push(mk(pl(4 * i + 1), pl(4 * i + 3), 2, i + 1));
    main.push(mk(pl(1), pl(5), 3, 1));
    main.push(mk(pl(9), pl(13), 3, 2));
    // The real East Final. Load-bearing: detectPools ignores only the TOP round,
    // so this row is what lets R3 into the union-find and fuses the halves.
    main.push(mk(pl(1), null, 4, 1, false));

    const pools = detectPools(entries, main);

    // THE BUG: indistinguishable from a two-pool round robin.
    expect(pools).toHaveLength(2);
    expect(pools.map((x) => x.length)).toEqual([8, 8]);

    // ...which is why the guard must read the feed graph, not the pool count.
    expect(main.some((m) => m.winner_feeds_to || m.loser_feeds_to)).toBe(true);
  });

  it('a genuine two-pool round robin has the same shape but no feed references', () => {
    const entries = [pl(1), pl(2), pl(3), pl(4), pl(5), pl(6)];
    const plain: PoolMatch[] = [
      mk(pl(1), pl(2), 1, 1, false), mk(pl(1), pl(3), 1, 2, false), mk(pl(2), pl(3), 1, 3, false),
      mk(pl(4), pl(5), 1, 4, false), mk(pl(4), pl(6), 1, 5, false), mk(pl(5), pl(6), 1, 6, false),
      mk(null, null, 2, 1, false), // placement skeleton at the top round
    ];

    expect(detectPools(entries, plain)).toHaveLength(2);
    // No feeds — so the guard correctly lets this one through to build playoffs.
    expect(plain.some((m) => m.winner_feeds_to || m.loser_feeds_to)).toBe(false);
  });
});
