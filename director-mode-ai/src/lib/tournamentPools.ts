import { computeRRStandings, type RRStanding } from './tournamentFormats';

// Pool-aware round-robin logic for the tournament desk.
//
// A single round-robin event can contain MULTIPLE POOLS (e.g. the 10U draw has
// two pools of 5). The pools are part of ONE event, not separate events. We
// detect pools generically — by which players actually played each other
// (connected components of the RR match graph) — so this works no matter how an
// event was built, not just for a specific slot convention.
//
// When every pool's round-robin is complete, a PLACEMENT PLAYOFF is generated:
// Pool A rank i vs Pool B rank i (winner takes the higher placement). Because
// those matches are cross-pool, they never count toward any pool's standings,
// so no special bracket type is needed to keep them separate.

export type PoolMatch = {
  player1_id: string | null;
  player3_id: string | null;
  score: string | null;
  winner_side: 'a' | 'b' | null;
  status: string;
  bracket: string;
  round: number;
  slot: number;
};

/** Union-find grouping of entries into pools via who-played-whom in the main draw. */
export function detectPools(entryIds: string[], mainMatches: PoolMatch[]): string[][] {
  const parent = new Map<string, string>();
  for (const id of entryIds) parent.set(id, id);

  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    let c = x;
    while (parent.get(c) !== r) { const n = parent.get(c)!; parent.set(c, r); c = n; }
    return r;
  };
  const union = (a: string, b: string) => { parent.set(find(a), find(b)); };

  for (const m of mainMatches) {
    if (m.player1_id && m.player3_id && parent.has(m.player1_id) && parent.has(m.player3_id)) {
      union(m.player1_id, m.player3_id);
    }
  }

  const groups = new Map<string, string[]>();
  for (const id of entryIds) {
    const r = find(id);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r)!.push(id);
  }

  // Stable order: pool containing the lowest match slot comes first (Pool A, B, …).
  const minSlot = (pool: string[]): number => {
    const set = new Set(pool);
    let m = Infinity;
    for (const mm of mainMatches) {
      if ((mm.player1_id && set.has(mm.player1_id)) || (mm.player3_id && set.has(mm.player3_id))) {
        if (mm.slot < m) m = mm.slot;
      }
    }
    return m;
  };
  return [...groups.values()].sort((a, b) => minSlot(a) - minSlot(b));
}

/** Matches played entirely within one pool (excludes cross-pool playoff matches). */
function withinPool(pool: string[], mainMatches: PoolMatch[]): PoolMatch[] {
  const set = new Set(pool);
  return mainMatches.filter(
    (m) => m.player1_id && m.player3_id && set.has(m.player1_id) && set.has(m.player3_id)
  );
}

export function poolStandings(pool: string[], mainMatches: PoolMatch[]): RRStanding[] {
  return computeRRStandings(pool.map((id) => ({ id })), withinPool(pool, mainMatches));
}

/** A pool's round-robin is complete when all of its within-pool matches are done. */
export function isPoolComplete(pool: string[], mainMatches: PoolMatch[]): boolean {
  const pm = withinPool(pool, mainMatches);
  return pm.length > 0 && pm.every((m) => m.status === 'completed');
}

export type PlannedPlayoff = {
  slot: number;
  sideA: string;   // entry id, pool A rank (slot)
  sideB: string;   // entry id, pool B rank (slot)
  placeHigh: number; // placement the winner earns (1, 3, 5, …)
  placeLow: number;  // placement the loser earns (2, 4, 6, …)
};

/**
 * Plan the placement playoff for a completed multi-pool RR event. Currently
 * supports the 2-pool case (10U, 13U): rank i of A vs rank i of B. For uneven
 * pools, pairs down to the smaller pool; any extra players place by pool rank
 * (surfaced via `unpaired` so the desk can show/handle them).
 */
export function planPlacementPlayoffs(
  pools: string[][],
  standingsByPool: RRStanding[][]
): { pairs: PlannedPlayoff[]; unpaired: { entry: string; poolIndex: number; poolRank: number }[] } {
  if (pools.length !== 2) return { pairs: [], unpaired: [] };
  const [sa, sb] = standingsByPool;
  const n = Math.min(sa.length, sb.length);
  const pairs: PlannedPlayoff[] = [];
  for (let i = 0; i < n; i++) {
    pairs.push({ slot: i + 1, sideA: sa[i].entry_id, sideB: sb[i].entry_id, placeHigh: 2 * i + 1, placeLow: 2 * i + 2 });
  }
  const unpaired: { entry: string; poolIndex: number; poolRank: number }[] = [];
  for (let i = n; i < sa.length; i++) unpaired.push({ entry: sa[i].entry_id, poolIndex: 0, poolRank: i + 1 });
  for (let i = n; i < sb.length; i++) unpaired.push({ entry: sb[i].entry_id, poolIndex: 1, poolRank: i + 1 });
  return { pairs, unpaired };
}

/** True once the whole event's RR is done and a placement playoff should exist. */
export function readyForPlayoffs(pools: string[][], mainMatches: PoolMatch[]): boolean {
  return pools.length === 2 && pools.every((p) => isPoolComplete(p, mainMatches));
}
