/**
 * Quads tournament logic — pure functions only.
 *
 * A Quads tournament is N flights of exactly 4 players. Each flight plays a
 * 3-round singles round-robin and then a 4th-round doubles match where the
 * 1st-place finisher partners with 4th place against 2nd + 3rd.
 *
 * Tiebreaker for the singles ladder: match wins → head-to-head → sets won →
 * games won → games lost → original flight seed.
 */

export const QUAD_SCORING_FORMATS = [
  { id: 'pro8', label: '8-game pro set (TB at 8-8)' },
  { id: 'set6', label: '1 set to 6 (TB at 6-6)' },
  { id: 'best3', label: 'Best of 3 sets' },
  { id: 'timed30', label: 'Timed — 30 min, most games wins' },
  { id: 'timed45', label: 'Timed — 45 min, most games wins' },
  { id: 'timed60', label: 'Timed — 60 min, most games wins' },
] as const;

export type QuadScoringFormatId = (typeof QUAD_SCORING_FORMATS)[number]['id'];

export const GENDER_RESTRICTIONS = [
  { id: 'coed', label: 'Coed (any gender)' },
  { id: 'boys', label: 'Boys only' },
  { id: 'girls', label: 'Girls only' },
] as const;

export type GenderRestriction = (typeof GENDER_RESTRICTIONS)[number]['id'];

/**
 * Composite rating used for tier-based flight seeding. UTR has priority; NTRP
 * is mapped to a UTR-comparable scale (NTRP × 2) when no UTR is present.
 * Returns 0 if neither rating is available — those entries sort to the bottom.
 */
export function computeQuadComposite(input: {
  utr: number | null | undefined;
  ntrp: number | null | undefined;
}): number {
  const utr = typeof input.utr === 'number' && input.utr > 0 ? input.utr : null;
  if (utr !== null) return utr;
  const ntrp = typeof input.ntrp === 'number' && input.ntrp > 0 ? input.ntrp : null;
  if (ntrp !== null) return ntrp * 2;
  return 0;
}

/**
 * Parse a tennis score string into a list of per-set [gamesA, gamesB] pairs.
 * Accepts comma- or semicolon-separated sets. Tiebreak parens are stripped.
 *   "6-3, 6-4"           → [[6,3],[6,4]]
 *   "8-5"                → [[8,5]]
 *   "27-22"              → [[27,22]]   (timed match: total games)
 *   "7-6 (7-3), 4-6, 10-7" → [[7,6],[4,6],[10,7]]
 */
export function parseScoreSets(score: string | null | undefined): Array<[number, number]> {
  if (!score) return [];
  return score
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((set) => {
      const m = set.match(/^(\d+)\s*-\s*(\d+)/);
      if (!m) return null;
      return [parseInt(m[1], 10), parseInt(m[2], 10)] as [number, number];
    })
    .filter((x): x is [number, number] => x !== null);
}

/**
 * Match shape used by the standings calculator. Side A = player1 (+ player2
 * for doubles); Side B = player3 (+ player4 for doubles).
 */
export type QuadMatchView = {
  player1_id: string | null;
  player2_id?: string | null;
  player3_id: string | null;
  player4_id?: string | null;
  score: string | null;
  winner_side: 'a' | 'b' | null;
  status: string;
  match_type: 'singles' | 'doubles';
  round: number;
};

export type QuadStanding = {
  entry_id: string;
  rank: number;
  match_wins: number;
  match_losses: number;
  sets_won: number;
  sets_lost: number;
  games_won: number;
  games_lost: number;
};

/**
 * Compute 1st/2nd/3rd/4th rankings for a flight from its completed singles
 * matches. Doubles (round 4) is ignored — the standings DRIVE the doubles
 * pairing, they aren't affected by it.
 *
 * Tiebreakers, in order:
 *   1. match wins (desc)
 *   2. head-to-head (when exactly two are tied at this match-win count)
 *   3. sets won (desc)
 *   4. games won (desc)
 *   5. games lost (asc)
 *   6. original flight seed (asc, lower seed = higher rank)
 */
export function computeFlightStandings(
  entries: Array<{ id: string; flight_seed: number | null }>,
  matches: QuadMatchView[]
): QuadStanding[] {
  const stats = new Map<string, QuadStanding>();
  for (const e of entries) {
    stats.set(e.id, {
      entry_id: e.id,
      rank: 0,
      match_wins: 0,
      match_losses: 0,
      sets_won: 0,
      sets_lost: 0,
      games_won: 0,
      games_lost: 0,
    });
  }

  // Head-to-head: winnerId → set of loserIds
  const h2h = new Map<string, Set<string>>();

  for (const m of matches) {
    if (m.match_type !== 'singles') continue;
    if (m.status !== 'completed') continue;
    if (!m.player1_id || !m.player3_id) continue;
    const sa = stats.get(m.player1_id);
    const sb = stats.get(m.player3_id);
    if (!sa || !sb) continue;

    let setsA = 0;
    let setsB = 0;
    let gamesA = 0;
    let gamesB = 0;
    for (const [a, b] of parseScoreSets(m.score)) {
      gamesA += a;
      gamesB += b;
      if (a > b) setsA++;
      else if (b > a) setsB++;
    }

    sa.sets_won += setsA;
    sa.sets_lost += setsB;
    sa.games_won += gamesA;
    sa.games_lost += gamesB;
    sb.sets_won += setsB;
    sb.sets_lost += setsA;
    sb.games_won += gamesB;
    sb.games_lost += gamesA;

    if (m.winner_side === 'a') {
      sa.match_wins++;
      sb.match_losses++;
      if (!h2h.has(m.player1_id)) h2h.set(m.player1_id, new Set());
      h2h.get(m.player1_id)!.add(m.player3_id);
    } else if (m.winner_side === 'b') {
      sb.match_wins++;
      sa.match_losses++;
      if (!h2h.has(m.player3_id)) h2h.set(m.player3_id, new Set());
      h2h.get(m.player3_id)!.add(m.player1_id);
    }
  }

  const seedById = new Map(entries.map((e) => [e.id, e.flight_seed ?? 999]));

  const sorted = [...stats.values()].sort((a, b) => {
    if (a.match_wins !== b.match_wins) return b.match_wins - a.match_wins;
    const aBeatB = h2h.get(a.entry_id)?.has(b.entry_id);
    const bBeatA = h2h.get(b.entry_id)?.has(a.entry_id);
    if (aBeatB && !bBeatA) return -1;
    if (bBeatA && !aBeatB) return 1;
    if (a.sets_won !== b.sets_won) return b.sets_won - a.sets_won;
    if (a.games_won !== b.games_won) return b.games_won - a.games_won;
    if (a.games_lost !== b.games_lost) return a.games_lost - b.games_lost;
    return (seedById.get(a.entry_id) ?? 999) - (seedById.get(b.entry_id) ?? 999);
  });

  sorted.forEach((s, i) => {
    s.rank = i + 1;
  });
  return sorted;
}

/**
 * Generate the 6 singles matches across 3 rounds for a flight of 4.
 * Schedule is by flight seed (1-4):
 *   R1: 1v4, 2v3
 *   R2: 1v3, 2v4
 *   R3: 1v2, 3v4
 * Side A (player1_id) = lower seed, Side B (player3_id) = higher seed.
 */
export function generateQuadSingles(
  entryIdsBySeed: [string, string, string, string]
): Array<{ round: number; match_type: 'singles'; player1_id: string; player3_id: string }> {
  const [p1, p2, p3, p4] = entryIdsBySeed;
  return [
    { round: 1, match_type: 'singles', player1_id: p1, player3_id: p4 },
    { round: 1, match_type: 'singles', player1_id: p2, player3_id: p3 },
    { round: 2, match_type: 'singles', player1_id: p1, player3_id: p3 },
    { round: 2, match_type: 'singles', player1_id: p2, player3_id: p4 },
    { round: 3, match_type: 'singles', player1_id: p1, player3_id: p2 },
    { round: 3, match_type: 'singles', player1_id: p3, player3_id: p4 },
  ];
}

/**
 * Build the round-4 doubles match from completed singles standings.
 * Pairing rule: 1st place + 4th place (Side A) vs 2nd place + 3rd place (Side B).
 * Returns null unless we have a clean 1/2/3/4 ranking of 4 entries.
 */
export function buildQuadDoublesRound(standings: QuadStanding[]): {
  round: 4;
  match_type: 'doubles';
  player1_id: string;
  player2_id: string;
  player3_id: string;
  player4_id: string;
} | null {
  if (standings.length !== 4) return null;
  const ranks = new Map(standings.map((s) => [s.rank, s.entry_id]));
  const r1 = ranks.get(1);
  const r2 = ranks.get(2);
  const r3 = ranks.get(3);
  const r4 = ranks.get(4);
  if (!r1 || !r2 || !r3 || !r4) return null;
  return {
    round: 4,
    match_type: 'doubles',
    player1_id: r1,
    player2_id: r4,
    player3_id: r2,
    player4_id: r3,
  };
}

/**
 * Tier-based flight assignment. Sort entries by composite_rating desc and
 * slice into chunks of 4. Leftovers (< 4) become the waitlist.
 *   Top 4 by rating  → Flight A ("Top tier")
 *   Next 4 by rating → Flight B ("Mid tier")
 *   ...
 *
 * Examples:
 *   7 entries  → 1 flight + 3 waitlisted
 *   8 entries  → 2 flights + 0 waitlisted
 *   9 entries  → 2 flights + 1 waitlisted
 *   12 entries → 3 flights + 0 waitlisted
 *
 * `maxFlights` caps the number of flights (extras go to the waitlist).
 */
export function assignToFlights<
  T extends { id: string; composite_rating: number | null },
>(
  entries: T[],
  options: { maxFlights?: number } = {}
): {
  flights: Array<{ name: string; tier_label: string; sort_order: number; entryIds: string[] }>;
  waitlistIds: string[];
} {
  const sorted = [...entries].sort(
    (a, b) => (b.composite_rating ?? 0) - (a.composite_rating ?? 0)
  );

  const FLIGHT_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const flights: Array<{
    name: string;
    tier_label: string;
    sort_order: number;
    entryIds: string[];
  }> = [];

  let cursor = 0;
  while (cursor + 4 <= sorted.length) {
    const idx = flights.length;
    if (options.maxFlights !== undefined && idx >= options.maxFlights) break;
    flights.push({
      name: `Flight ${FLIGHT_LETTERS[idx] ?? String(idx + 1)}`,
      tier_label:
        flights.length === 0 && cursor + 4 <= sorted.length
          ? 'Top tier'
          : `Tier ${idx + 1}`,
      sort_order: idx,
      entryIds: sorted.slice(cursor, cursor + 4).map((e) => e.id),
    });
    cursor += 4;
  }

  return { flights, waitlistIds: sorted.slice(cursor).map((e) => e.id) };
}
