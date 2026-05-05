/**
 * Tournament format bracket generators — pure functions, no I/O.
 *
 * Covers the formats listed under /mixer/select-format Tournament Formats
 * that aren't Quads or Compass:
 *
 *   - Round Robin Tournament (singles or doubles)
 *   - Single Elimination (covered by existing singleEliminationBracket.ts)
 *   - First-Match Loser Consolation (FMLC)  — single-elim + consolation
 *     bracket made up of just first-round losers
 *   - Full Feed-In Consolation (FFIC)        — single-elim where EVERY
 *     loser drops into a consolation tree, so every player gets at
 *     least 2 matches and all bracket positions are filled out
 *
 * The output of every generator is a flat list of `GeneratedMatch` rows
 * ready to insert into `quad_matches` (or `tournament_matches` once we
 * generalize that table). Each match is identified by its
 * (bracket, round, slot) tuple. `feeds_to` lets us thread the
 * winner/loser advancement from one match into the next without doing
 * graph queries — the inserter wires up the references at insert time.
 *
 * Players are referenced by external `entry_id` strings; this file knows
 * nothing about Supabase or any specific schema.
 */

export type TournamentFormat =
  | 'rr-singles'
  | 'rr-doubles'
  | 'single-elim-singles'
  | 'single-elim-doubles'
  | 'fmlc-singles'
  | 'fmlc-doubles'
  | 'ffic-singles'
  | 'ffic-doubles';

export type Bracket = 'main' | 'consolation';

/** A match in the tournament, identified by bracket+round+slot. */
export type GeneratedMatch = {
  /** 'main' or 'consolation'. Round Robin only uses 'main'. */
  bracket: Bracket;
  /**
   * 1-indexed round within this bracket.
   *   Single Elim 8-player: round 1=quarters, 2=semis, 3=final.
   *   FMLC consolation 8-player: round 1=R1-loser semis, 2=consolation final.
   *   RR: round 1..(N-1) where players play one match per round.
   */
  round: number;
  /** 1-indexed slot within the round. */
  slot: number;
  match_type: 'singles' | 'doubles';
  /** Side A player(s). null = TBD (winner/loser of an earlier match). */
  player1_id: string | null;
  player2_id: string | null;
  /** Side B player(s). null = TBD. */
  player3_id: string | null;
  player4_id: string | null;
  /**
   * For bracket formats: which match this match's WINNER feeds into.
   * Encoded as `${bracket}:${round}:${slot}:${side}` where side is 'a' or 'b'.
   * null if this is a final.
   */
  winner_feeds_to: string | null;
  /**
   * Same shape, for the LOSER. Used by FMLC (loser of R1 → consolation) and
   * FFIC (loser of any round → consolation). null if loser is eliminated.
   */
  loser_feeds_to: string | null;
};

// =============================================================================
// Round Robin
// =============================================================================

/**
 * Generate a round-robin schedule using the standard "circle method":
 *   - With N players (N even), there are N-1 rounds, N/2 matches per round.
 *   - With N odd, treat one player as a bye and rotate; (N-1)/2 + 1 rounds...
 *     Actually simplest: if N is odd, add a phantom "bye" player and run as
 *     N+1, then drop matches that include the bye player.
 *
 * Returns rounds in chronological order; within each round the matches are
 * ordered by slot. Both players appear in `player1_id`/`player3_id`; for
 * doubles, the caller pairs entries into "doubles teams" upstream and
 * passes one teamId per slot — RR doesn't know whether teams are pairs.
 */
export function generateRRMatches(
  entryIds: string[],
  matchType: 'singles' | 'doubles' = 'singles'
): GeneratedMatch[] {
  if (entryIds.length < 2) return [];

  // Pad to even with a phantom bye id we filter out at the end.
  const PHANTOM = '__phantom__';
  const ids = [...entryIds];
  if (ids.length % 2 === 1) ids.push(PHANTOM);
  const n = ids.length;
  const rounds = n - 1;
  const halfN = n / 2;

  // Circle method: fix ids[0], rotate the rest.
  const rotation = ids.slice(1);
  const matches: GeneratedMatch[] = [];

  for (let r = 0; r < rounds; r++) {
    const roundIds = [ids[0], ...rotation];
    let slot = 1;
    for (let i = 0; i < halfN; i++) {
      const a = roundIds[i];
      const b = roundIds[n - 1 - i];
      if (a === PHANTOM || b === PHANTOM) continue; // bye round for the other player
      matches.push({
        bracket: 'main',
        round: r + 1,
        slot: slot++,
        match_type: matchType,
        player1_id: a,
        player2_id: null,
        player3_id: b,
        player4_id: null,
        winner_feeds_to: null,
        loser_feeds_to: null,
      });
    }
    // Rotate
    rotation.unshift(rotation.pop()!);
  }

  return matches;
}

/** Standings for an RR tournament: sort by match wins desc, then by point diff. */
export type RRStanding = {
  entry_id: string;
  rank: number;
  match_wins: number;
  match_losses: number;
  games_won: number;
  games_lost: number;
};

export function computeRRStandings(
  entries: Array<{ id: string }>,
  matches: Array<{
    player1_id: string | null;
    player3_id: string | null;
    score: string | null;
    winner_side: 'a' | 'b' | null;
    status: string;
  }>
): RRStanding[] {
  const stats = new Map<string, RRStanding>();
  for (const e of entries) {
    stats.set(e.id, {
      entry_id: e.id,
      rank: 0,
      match_wins: 0,
      match_losses: 0,
      games_won: 0,
      games_lost: 0,
    });
  }

  for (const m of matches) {
    if (m.status !== 'completed' || !m.player1_id || !m.player3_id) continue;
    const sa = stats.get(m.player1_id);
    const sb = stats.get(m.player3_id);
    if (!sa || !sb) continue;
    let ga = 0;
    let gb = 0;
    for (const set of (m.score ?? '').split(/[,;]/)) {
      const match = set.trim().match(/^(\d+)\s*-\s*(\d+)/);
      if (!match) continue;
      ga += parseInt(match[1], 10);
      gb += parseInt(match[2], 10);
    }
    sa.games_won += ga;
    sa.games_lost += gb;
    sb.games_won += gb;
    sb.games_lost += ga;
    if (m.winner_side === 'a') {
      sa.match_wins++;
      sb.match_losses++;
    } else if (m.winner_side === 'b') {
      sb.match_wins++;
      sa.match_losses++;
    }
  }

  const sorted = [...stats.values()].sort((a, b) => {
    if (a.match_wins !== b.match_wins) return b.match_wins - a.match_wins;
    const aDiff = a.games_won - a.games_lost;
    const bDiff = b.games_won - b.games_lost;
    if (aDiff !== bDiff) return bDiff - aDiff;
    return b.games_won - a.games_won;
  });

  sorted.forEach((s, i) => {
    s.rank = i + 1;
  });
  return sorted;
}

// =============================================================================
// Single Elimination + Consolation Variants
// =============================================================================

/**
 * Round up to the next power of 2. 5 → 8, 9 → 16, 16 → 16. Used to size
 * the bracket; smaller fields get byes.
 */
function nextPow2(n: number): number {
  if (n < 2) return 2;
  let p = 2;
  while (p < n) p *= 2;
  return p;
}

/**
 * Standard single-elimination seed pairing. For an N-slot bracket, returns
 * a permutation of seeds 1..N such that high seeds meet low seeds and the
 * bracket is balanced (1 vs 16, 8 vs 9, etc.).
 *
 * Algorithm: recursively interleave 1..N/2 with their complements.
 *   pairings(2)  = [1, 2]
 *   pairings(4)  = [1, 4, 2, 3]
 *   pairings(8)  = [1, 8, 4, 5, 2, 7, 3, 6]
 *   pairings(16) = [1, 16, 8, 9, 4, 13, 5, 12, 2, 15, 7, 10, 3, 14, 6, 11]
 */
export function seedPairings(size: number): number[] {
  if (size === 2) return [1, 2];
  const half = seedPairings(size / 2);
  const out: number[] = [];
  for (const s of half) {
    out.push(s);
    out.push(size + 1 - s);
  }
  return out;
}

/**
 * Generate a single-elimination bracket. Pads with byes (null player) when
 * entries.length isn't a power of 2.
 *
 *   8 players: 4 R1 matches → 2 R2 → 1 final
 *   12 players: 4 byes in R1 (top 4 seeds skip), 4 R1 matches → 4 R2 → 2 SF → 1 F
 *
 * Entries are passed in seed order (entry[0] = top seed).
 */
export function generateSingleElimBracket(entryIds: string[]): GeneratedMatch[] {
  if (entryIds.length < 2) return [];
  const size = nextPow2(entryIds.length);
  const seeds = seedPairings(size);
  // Map seed (1-indexed) → entry id (or null for bye).
  const idForSeed = (seed: number) => entryIds[seed - 1] ?? null;

  const matches: GeneratedMatch[] = [];
  const totalRounds = Math.log2(size);

  // Build a cursor of "match references" for the next round to consume.
  // Each cursor item = `${bracket}:${round}:${slot}:${side}` of where the
  // winner of an earlier match feeds in.
  let cursor: Array<string | null> = []; // pairs: [a, b, a, b, ...]

  // R1: pair seeds 2-by-2 from the seedPairings array
  let slot = 1;
  for (let i = 0; i < seeds.length; i += 2) {
    const a = idForSeed(seeds[i]);
    const b = idForSeed(seeds[i + 1]);

    // If both are byes, skip entirely (shouldn't happen with reasonable padding)
    if (a === null && b === null) {
      cursor.push(null, null);
      continue;
    }

    // If one is a bye, auto-advance the other player to round 2.
    if (a === null || b === null) {
      // No match created in R1 for this pair; advancing player goes
      // straight into the corresponding R2 slot.
      cursor.push(a ?? b);
      continue;
    }

    matches.push({
      bracket: 'main',
      round: 1,
      slot,
      match_type: 'singles', // caller can override
      player1_id: a,
      player2_id: null,
      player3_id: b,
      player4_id: null,
      winner_feeds_to: null, // filled in below
      loser_feeds_to: null,
    });
    cursor.push(`main:1:${slot}:winner`);
    slot++;
  }

  // Now build later rounds. For round r, we consume pairs of cursor items
  // and produce one match per pair. After R1, every pair becomes a match.
  for (let r = 2; r <= totalRounds; r++) {
    const nextCursor: Array<string | null> = [];
    let s = 1;
    for (let i = 0; i < cursor.length; i += 2) {
      const aRef = cursor[i];
      const bRef = cursor[i + 1];

      // Both null → bye on bye, skip slot.
      if (aRef === null && bRef === null) {
        nextCursor.push(null);
        continue;
      }
      // One null → other auto-advances.
      if (aRef === null || bRef === null) {
        nextCursor.push(aRef ?? bRef);
        continue;
      }

      // Resolve refs: if it's a literal player id, use as player1/3; if it's
      // a "winner-of-X" ref, leave as null and wire feeds_to on the source.
      const aIsRef = aRef.startsWith('main:');
      const bIsRef = bRef.startsWith('main:');

      const player1_id = aIsRef ? null : aRef;
      const player3_id = bIsRef ? null : bRef;

      matches.push({
        bracket: 'main',
        round: r,
        slot: s,
        match_type: 'singles',
        player1_id,
        player2_id: null,
        player3_id,
        player4_id: null,
        winner_feeds_to: null,
        loser_feeds_to: null,
      });

      // Wire previous round winners → THIS slot's side a or b.
      if (aIsRef) wireWinnerFeed(matches, aRef, 'main', r, s, 'a');
      if (bIsRef) wireWinnerFeed(matches, bRef, 'main', r, s, 'b');

      nextCursor.push(`main:${r}:${s}:winner`);
      s++;
    }
    cursor = nextCursor;
  }

  // Set match_type to doubles for the doubles caller via post-processing
  return matches;
}

/** Find the source match in `matches` and set its winner_feeds_to. */
function wireWinnerFeed(
  matches: GeneratedMatch[],
  sourceRef: string,
  destBracket: Bracket,
  destRound: number,
  destSlot: number,
  destSide: 'a' | 'b'
) {
  const [, srcRoundStr, srcSlotStr] = sourceRef.split(':'); // 'main:1:3:winner'
  const srcRound = parseInt(srcRoundStr, 10);
  const srcSlot = parseInt(srcSlotStr, 10);
  const src = matches.find(
    (m) => m.bracket === 'main' && m.round === srcRound && m.slot === srcSlot
  );
  if (!src) return;
  src.winner_feeds_to = `${destBracket}:${destRound}:${destSlot}:${destSide}`;
}

/** Same but for losers (FMLC + FFIC). */
function wireLoserFeed(
  matches: GeneratedMatch[],
  srcBracket: Bracket,
  srcRound: number,
  srcSlot: number,
  destBracket: Bracket,
  destRound: number,
  destSlot: number,
  destSide: 'a' | 'b'
) {
  const src = matches.find(
    (m) => m.bracket === srcBracket && m.round === srcRound && m.slot === srcSlot
  );
  if (!src) return;
  src.loser_feeds_to = `${destBracket}:${destRound}:${destSlot}:${destSide}`;
}

/**
 * First-Match Loser Consolation: single elim main bracket + a second
 * single-elim bracket made up of FIRST-ROUND losers only. R2+ losers
 * are eliminated. The consolation bracket itself runs as single elim
 * to declare a "consolation champion."
 */
export function generateFMLCBracket(entryIds: string[]): GeneratedMatch[] {
  const main = generateSingleElimBracket(entryIds);

  // First-round losers feed into a consolation bracket. With M first-round
  // matches, we have M consolation entries. Bracket size = nextPow2(M).
  const r1Matches = main.filter((m) => m.bracket === 'main' && m.round === 1);
  const numLosers = r1Matches.length;
  if (numLosers < 2) return main;

  const consolationSize = nextPow2(numLosers);
  const consolationRounds = Math.log2(consolationSize);
  const consolationMatches: GeneratedMatch[] = [];

  // Consolation R1: pair losers using same seedPairings — losers from
  // higher-seed-meeting-lower-seed positions get paired predictably.
  // For simplicity and predictability we pair losers in order of their
  // R1 slot: loser of R1 slot 1 vs loser of R1 slot 2, etc. (Real
  // tournaments often use the seedPairings approach; we use sequential
  // for clarity.)
  let cursor: Array<string | null> = [];
  let slot = 1;
  for (let i = 0; i < r1Matches.length; i += 2) {
    const srcA = r1Matches[i];
    const srcB = r1Matches[i + 1];
    if (!srcB) {
      // Odd number of R1 matches — last loser gets a bye in consolation R1.
      cursor.push(`consolation_loser_of:main:1:${srcA.slot}`);
      continue;
    }
    consolationMatches.push({
      bracket: 'consolation',
      round: 1,
      slot,
      match_type: 'singles',
      player1_id: null, // filled by feed
      player2_id: null,
      player3_id: null,
      player4_id: null,
      winner_feeds_to: null,
      loser_feeds_to: null,
    });
    // Wire R1 main losers → consolation R1
    wireLoserFeed(main, 'main', 1, srcA.slot, 'consolation', 1, slot, 'a');
    wireLoserFeed(main, 'main', 1, srcB.slot, 'consolation', 1, slot, 'b');
    cursor.push(`consolation:1:${slot}:winner`);
    slot++;
  }

  // Consolation later rounds — same logic as single-elim
  for (let r = 2; r <= consolationRounds; r++) {
    const nextCursor: Array<string | null> = [];
    let s = 1;
    for (let i = 0; i < cursor.length; i += 2) {
      const aRef = cursor[i];
      const bRef = cursor[i + 1];
      if (aRef === null && bRef === null) {
        nextCursor.push(null);
        continue;
      }
      if (aRef === null || bRef === null) {
        nextCursor.push(aRef ?? bRef);
        continue;
      }
      consolationMatches.push({
        bracket: 'consolation',
        round: r,
        slot: s,
        match_type: 'singles',
        player1_id: null,
        player2_id: null,
        player3_id: null,
        player4_id: null,
        winner_feeds_to: null,
        loser_feeds_to: null,
      });
      // Wire winner refs from previous consolation round
      if (aRef.startsWith('consolation:')) {
        const [, rs, ss] = aRef.split(':');
        const sm = consolationMatches.find(
          (m) =>
            m.bracket === 'consolation' &&
            m.round === parseInt(rs, 10) &&
            m.slot === parseInt(ss, 10)
        );
        if (sm) sm.winner_feeds_to = `consolation:${r}:${s}:a`;
      }
      if (bRef.startsWith('consolation:')) {
        const [, rs, ss] = bRef.split(':');
        const sm = consolationMatches.find(
          (m) =>
            m.bracket === 'consolation' &&
            m.round === parseInt(rs, 10) &&
            m.slot === parseInt(ss, 10)
        );
        if (sm) sm.winner_feeds_to = `consolation:${r}:${s}:b`;
      }
      nextCursor.push(`consolation:${r}:${s}:winner`);
      s++;
    }
    cursor = nextCursor;
  }

  return [...main, ...consolationMatches];
}

/**
 * Full Feed-In Consolation: single elim where EVERY losing match drops the
 * loser into a consolation tree, so every player gets at least 2 matches
 * regardless of bracket position. The consolation tree is structured so
 * losers from later main-bracket rounds enter the consolation bracket at
 * proportionally later rounds — that way a QF loser doesn't have to win
 * a consolation R1 match to compete with another QF loser; they enter at
 * the consolation round where their counterpart lands.
 *
 * For a bracket of size 2^N:
 *   - Main bracket: N rounds (R1, R2, ..., final)
 *   - Consolation bracket: N-1 rounds. Loser of main R1 plays in consolation R1.
 *     Winner of consolation R1 plays loser of main R2 in consolation R2. And
 *     so on — each consolation round absorbs the previous main round's losers.
 */
export function generateFFICBracket(entryIds: string[]): GeneratedMatch[] {
  const main = generateSingleElimBracket(entryIds);
  if (main.length < 2) return main;

  const totalMainRounds = Math.max(...main.map((m) => m.round));
  if (totalMainRounds < 2) return main;

  const consolationMatches: GeneratedMatch[] = [];

  // Consolation R1: pair losers of main R1 (sequential slot pairing).
  const r1MainMatches = main
    .filter((m) => m.bracket === 'main' && m.round === 1)
    .sort((a, b) => a.slot - b.slot);
  let prevRoundCursor: Array<string | null> = []; // consolation match refs from previous round, in slot order

  let slot = 1;
  for (let i = 0; i < r1MainMatches.length; i += 2) {
    const srcA = r1MainMatches[i];
    const srcB = r1MainMatches[i + 1];
    if (!srcB) {
      // Odd: last loser carried forward as a "bye" winner of consolation R1
      prevRoundCursor.push(`__bye_of_main_R1_slot_${srcA.slot}__`);
      // We still need to wire that loser to advance into consolation R2 directly.
      // Encode as a "ghost" reference; consolation R2 absorbs it.
      continue;
    }
    consolationMatches.push({
      bracket: 'consolation',
      round: 1,
      slot,
      match_type: 'singles',
      player1_id: null,
      player2_id: null,
      player3_id: null,
      player4_id: null,
      winner_feeds_to: null,
      loser_feeds_to: null,
    });
    wireLoserFeed(main, 'main', 1, srcA.slot, 'consolation', 1, slot, 'a');
    wireLoserFeed(main, 'main', 1, srcB.slot, 'consolation', 1, slot, 'b');
    prevRoundCursor.push(`consolation:1:${slot}:winner`);
    slot++;
  }

  // Subsequent consolation rounds: each round combines the previous-round
  // consolation winners with the current-main-round losers.
  for (let r = 2; r <= totalMainRounds - 1; r++) {
    const mainRoundMatches = main
      .filter((m) => m.bracket === 'main' && m.round === r)
      .sort((a, b) => a.slot - b.slot);

    const nextCursor: Array<string | null> = [];
    let s = 1;
    // Pair consolation winners with main-round losers sequentially.
    const pairCount = Math.max(prevRoundCursor.length, mainRoundMatches.length);
    for (let i = 0; i < pairCount; i++) {
      const consWinnerRef = prevRoundCursor[i] ?? null;
      const mainLoser = mainRoundMatches[i] ?? null;

      if (!consWinnerRef && !mainLoser) {
        nextCursor.push(null);
        continue;
      }
      if (!consWinnerRef && mainLoser) {
        // No consolation feeder; loser of main carries through (rare).
        nextCursor.push(`__main_loser_of:${r}:${mainLoser.slot}__`);
        continue;
      }
      if (consWinnerRef && !mainLoser) {
        // No main loser to pair with; consolation winner advances on bye.
        nextCursor.push(consWinnerRef);
        continue;
      }

      consolationMatches.push({
        bracket: 'consolation',
        round: r,
        slot: s,
        match_type: 'singles',
        player1_id: null,
        player2_id: null,
        player3_id: null,
        player4_id: null,
        winner_feeds_to: null,
        loser_feeds_to: null,
      });
      // Wire previous consolation winner → side a
      if (consWinnerRef && consWinnerRef.startsWith('consolation:')) {
        const [, rs, ss] = consWinnerRef.split(':');
        const sm = consolationMatches.find(
          (m) =>
            m.bracket === 'consolation' &&
            m.round === parseInt(rs, 10) &&
            m.slot === parseInt(ss, 10)
        );
        if (sm) sm.winner_feeds_to = `consolation:${r}:${s}:a`;
      }
      // Wire main loser of this round → side b
      if (mainLoser) {
        wireLoserFeed(main, 'main', r, mainLoser.slot, 'consolation', r, s, 'b');
      }
      nextCursor.push(`consolation:${r}:${s}:winner`);
      s++;
    }
    prevRoundCursor = nextCursor;
  }

  return [...main, ...consolationMatches];
}

// =============================================================================
// Format dispatcher
// =============================================================================

/** Top-level entry point: pick the right generator based on format. */
export function generateTournamentMatches(
  format: TournamentFormat,
  entryIds: string[]
): GeneratedMatch[] {
  const isDoubles = format.endsWith('-doubles');
  const matchType: 'singles' | 'doubles' = isDoubles ? 'doubles' : 'singles';

  let raw: GeneratedMatch[];
  if (format === 'rr-singles' || format === 'rr-doubles') {
    raw = generateRRMatches(entryIds, matchType);
  } else if (format === 'single-elim-singles' || format === 'single-elim-doubles') {
    raw = generateSingleElimBracket(entryIds);
  } else if (format === 'fmlc-singles' || format === 'fmlc-doubles') {
    raw = generateFMLCBracket(entryIds);
  } else if (format === 'ffic-singles' || format === 'ffic-doubles') {
    raw = generateFFICBracket(entryIds);
  } else {
    throw new Error(`Unknown tournament format: ${format}`);
  }

  // Override match_type for doubles formats.
  return raw.map((m) => ({ ...m, match_type: matchType }));
}
