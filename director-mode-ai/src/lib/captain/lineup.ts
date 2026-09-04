/**
 * CaptainMode lineup generator.
 *
 * Deliberately deterministic — no LLM. Hard rules (never-pair, rating caps,
 * mixed gender pairing, court limits) must never be violated, and an LLM will
 * eventually violate them. Same inputs always produce the same lineup, which
 * also makes it testable and explainable to a captain who asks "why is Sally
 * on court 3?".
 *
 * Priority order (settled in CAPTAINMODE_SPEC.md §4.2):
 *   1. availability          — hard filter, handled by the caller
 *   2. hard constraints      — never-pair, court limits, league rating caps
 *   3. court strength order  — stronger players on lower court numbers
 *   4. partner rank prefs    — mutual preferences weigh more
 *   5. return-side complement — deuce pairs with ad
 *   6. fairness + playoff eligibility
 *   7. day/time preference   — soft tiebreaker (caller-supplied nudge)
 */

/**
 * The league list lives in ./leagues.ts, which the new-team form and the match
 * defaults also read. Re-exported here so every existing `import { LeagueType }
 * from './lineup'` keeps working against the one definition.
 */
export type { LeagueType } from './leagues';
import type { LeagueType } from './leagues';

export type CourtLimit = 'singles_only' | 'doubles_only' | 'no_court_1';

export type Player = {
  id: string;
  name: string;
  rating: number | null;
  gender?: 'M' | 'F' | null;
  returnSide?: 'deuce' | 'ad' | null;
  courtLimit?: CourtLimit | null;
  /** matches already played this season — drives fairness */
  matchesPlayed: number;
  /** true when the player still needs matches to qualify for playoffs */
  needsEligibility: boolean;
  /** soft nudge from day/time preferences: positive = prefers this slot */
  preferenceNudge?: number;
  /**
   * Captain's own strength ranking, 1 = strongest. When set it OVERRIDES
   * rating — a captain who has watched these people play all season knows
   * things a number doesn't, and NTRP ratings are coarse (half the roster
   * shares a 3.5). Null falls back to rating.
   */
  sortOrder?: number | null;
  /**
   * World Tennis Number. Runs the OPPOSITE way to NTRP — 40 is a beginner and
   * 1 is a pro — so LOWER is stronger everywhere it is read. Kept apart from
   * `rating` for exactly that reason: one sign flip would seat the weakest pair
   * on court 1 and look perfectly reasonable.
   */
  wtn?: number | null;
  /** doubles WTN, when the player has a separate one */
  wtnDoubles?: number | null;
  /**
   * Set internally by equalPlayPool — this player is behind the rest of the
   * pool on matches played and must be seated. Not something a caller sets.
   */
  mustPlay?: boolean;
};

export type PartnerPref = {
  playerId: string;
  preferredPlayerId: string;
  rank: number; // 1..5
};

export type NeverPair = { playerAId: string; playerBId: string };

/** Head-to-head record of a specific partnership, from entered scores. */
export type PairRecord = {
  playerAId: string;
  playerBId: string;
  wins: number;
  losses: number;
};

/**
 * How the captain wants the season distributed.
 *   play_to_win — strongest available side every week; fairness stays a mild
 *                 tiebreaker only (this is the historical behaviour).
 *   equal_play  — everyone gets as close to the same number of matches as the
 *                 schedule allows, even when that benches a stronger player.
 */
export type CaptainingStyle = 'play_to_win' | 'equal_play';

export type LineupInput = {
  available: Player[];
  partnerPrefs?: PartnerPref[];
  neverPairs?: NeverPair[];
  /** what actually happened when these two played together */
  pairHistory?: PairRecord[];
  singlesCourts: number;
  doublesCourts: number;
  leagueType: LeagueType;
  /** combined-rating cap per doubles court (combo/mixed). e.g. 7.5, 8.5 */
  combinedRatingCap?: number | null;
  /** defaults to play_to_win so existing callers are unchanged */
  captainingStyle?: CaptainingStyle;
};

export type CourtAssignment = {
  courtNumber: number;
  courtType: 'singles' | 'doubles';
  player1Id: string | null;
  player2Id: string | null;
  /** human-readable reasons, surfaced in the UI so the captain can trust it */
  notes: string[];
};

export type LineupResult = {
  courts: CourtAssignment[];
  unassigned: string[];
  warnings: string[];
};

// ---------------------------------------------------------------------------
// Scoring weights. Ordered so a higher-priority signal always outranks the sum
// of everything below it — that is what makes the priority order real rather
// than aspirational.
// ---------------------------------------------------------------------------
const W_PREF_MUTUAL = 100;
const W_PREF_ONE_WAY = 40;
const W_CHEMISTRY = 70;
const W_RETURN_SIDE = 25;
const W_ELIGIBILITY = 60;
const W_FAIRNESS = 8;
const W_NUDGE = 5;
/**
 * Deliberately larger than every other signal combined. equal_play admits a
 * whole boundary tier so partner preference still has room to work, but a
 * player from a LOWER tier is behind the field and has to be seated — and
 * W_PREF_MUTUAL (100) would otherwise outbid W_FAIRNESS (8/match) and let a
 * favoured pair take their slot. Season simulation showed that drifting to a
 * 2-match spread; see season.test.ts.
 */
const W_MUST_PLAY = 10_000;

/**
 * How many matches together before a partnership's record is taken at face
 * value. Below this the signal is scaled down, so one lucky win doesn't
 * outrank a stated preference.
 */
const CHEMISTRY_CONFIDENCE_AT = 4;

const key = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

function ratingOf(p: Player): number {
  return typeof p.rating === 'number' && !Number.isNaN(p.rating) ? p.rating : 0;
}

/** The WTN a doubles court should be ordered on: doubles number, else singles. */
function wtnOf(p: Player): number | null {
  const d = p.wtnDoubles;
  if (typeof d === 'number' && !Number.isNaN(d)) return d;
  const s = p.wtn;
  return typeof s === 'number' && !Number.isNaN(s) ? s : null;
}

/**
 * Strength ordering: the captain's manual rank wins when they've set one,
 * otherwise rating, then name so ties are stable. A manually ranked player
 * always sorts above an unranked one — a captain who bothered to order the
 * roster meant it.
 */
function byStrength(a: Player, b: Player): number {
  const ra = typeof a.sortOrder === 'number' ? a.sortOrder : null;
  const rb = typeof b.sortOrder === 'number' ? b.sortOrder : null;
  if (ra !== null || rb !== null) {
    if (ra === null) return 1;
    if (rb === null) return -1;
    if (ra !== rb) return ra - rb; // 1 = strongest
    return a.name.localeCompare(b.name);
  }
  const d = ratingOf(b) - ratingOf(a);
  return d !== 0 ? d : a.name.localeCompare(b.name);
}

/**
 * Players who most need to be on court: eligibility need first, then fewest
 * matches played. Used to decide who sits when there are more bodies than
 * slots.
 */
function byNeed(a: Player, b: Player): number {
  if (a.needsEligibility !== b.needsEligibility) return a.needsEligibility ? -1 : 1;
  const d = a.matchesPlayed - b.matchesPlayed;
  return d !== 0 ? d : a.name.localeCompare(b.name);
}

function prefScore(prefs: PartnerPref[], a: string, b: string): number {
  const ab = prefs.find((p) => p.playerId === a && p.preferredPlayerId === b);
  const ba = prefs.find((p) => p.playerId === b && p.preferredPlayerId === a);
  if (!ab && !ba) return 0;
  // rank 1 is worth more than rank 5
  const weight = (r?: number) => (r ? (6 - r) / 5 : 0);
  if (ab && ba) return W_PREF_MUTUAL * ((weight(ab.rank) + weight(ba.rank)) / 2);
  return W_PREF_ONE_WAY * weight((ab || ba)!.rank);
}

/** Individual desirability — fairness, eligibility, and the soft nudge. */
function playerBonus(p: Player): number {
  return (
    (p.mustPlay ? W_MUST_PLAY : 0) +
    (p.needsEligibility ? W_ELIGIBILITY : 0) +
    W_FAIRNESS * -p.matchesPlayed +
    W_NUDGE * (p.preferenceNudge ?? 0)
  );
}

/**
 * Partnership chemistry from entered scores: pairs that win together get
 * pulled back together, pairs that lose get nudged apart. Scaled by how many
 * matches they've actually played, so a 1-0 record barely registers while a
 * 5-1 record carries real weight.
 */
function chemistryScore(history: PairRecord[], a: string, b: string): number {
  const rec = history.find(
    (h) =>
      (h.playerAId === a && h.playerBId === b) || (h.playerAId === b && h.playerBId === a),
  );
  if (!rec) return 0;
  const played = rec.wins + rec.losses;
  if (played === 0) return 0;
  const winRate = rec.wins / played;
  const confidence = Math.min(1, played / CHEMISTRY_CONFIDENCE_AT);
  // centred on .500 so an even record is neutral, not a bonus
  return W_CHEMISTRY * (winRate - 0.5) * 2 * confidence;
}

export function pairIsLegal(
  a: Player,
  b: Player,
  input: LineupInput,
  neverSet: Set<string>,
): { ok: true } | { ok: false; reason: string } {
  if (a.id === b.id) return { ok: false, reason: 'same player' };
  if (neverSet.has(key(a.id, b.id))) {
    return { ok: false, reason: `${a.name} and ${b.name} are on the never-pair list` };
  }
  if (a.courtLimit === 'singles_only' || b.courtLimit === 'singles_only') {
    const who = a.courtLimit === 'singles_only' ? a.name : b.name;
    return { ok: false, reason: `${who} plays singles only` };
  }
  if (input.leagueType === 'usta_mixed') {
    if (!a.gender || !b.gender) {
      return { ok: false, reason: `mixed doubles needs a gender on ${!a.gender ? a.name : b.name}` };
    }
    if (a.gender === b.gender) {
      return { ok: false, reason: 'mixed doubles needs one man and one woman' };
    }
  }
  const cap = input.combinedRatingCap;
  if (cap != null) {
    const combined = ratingOf(a) + ratingOf(b);
    if (combined > cap + 1e-9) {
      return {
        ok: false,
        reason: `${a.name} + ${b.name} = ${combined.toFixed(1)}, over the ${cap.toFixed(1)} cap`,
      };
    }
  }
  return { ok: true };
}

function pairScore(
  a: Player,
  b: Player,
  prefs: PartnerPref[],
  history: PairRecord[] = [],
): number {
  let s = prefScore(prefs, a.id, b.id);
  s += chemistryScore(history, a.id, b.id);
  if (a.returnSide && b.returnSide && a.returnSide !== b.returnSide) s += W_RETURN_SIDE;
  s += playerBonus(a) + playerBonus(b);
  return s;
}

/**
 * Greedy maximum-weight pairing, then 2-opt improvement. Exact matching is
 * overkill for a 16-person roster and much harder to explain; this reliably
 * lands on the same answer a captain would defend.
 */
function buildPairs(
  pool: Player[],
  input: LineupInput,
  neverSet: Set<string>,
  prefs: PartnerPref[],
  history: PairRecord[],
  maxPairs: number,
): { pairs: [Player, Player][]; leftovers: Player[]; blocked: string[] } {
  const candidates: { a: Player; b: Player; score: number }[] = [];
  const blocked: string[] = [];

  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      const legal = pairIsLegal(pool[i], pool[j], input, neverSet);
      if (!legal.ok) continue;
      candidates.push({ a: pool[i], b: pool[j], score: pairScore(pool[i], pool[j], prefs, history) });
    }
  }
  candidates.sort(
    (x, y) => y.score - x.score || key(x.a.id, x.b.id).localeCompare(key(y.a.id, y.b.id)),
  );

  const used = new Set<string>();
  const pairs: [Player, Player][] = [];
  for (const c of candidates) {
    if (pairs.length >= maxPairs) break;
    if (used.has(c.a.id) || used.has(c.b.id)) continue;
    used.add(c.a.id);
    used.add(c.b.id);
    pairs.push([c.a, c.b]);
  }

  // 2-opt: try swapping partners between two courts if it scores better.
  let improved = true;
  let guard = 0;
  while (improved && guard++ < 50) {
    improved = false;
    for (let i = 0; i < pairs.length; i++) {
      for (let j = i + 1; j < pairs.length; j++) {
        const [a1, a2] = pairs[i];
        const [b1, b2] = pairs[j];
        const current = pairScore(a1, a2, prefs, history) + pairScore(b1, b2, prefs, history);
        const optA =
          pairIsLegal(a1, b1, input, neverSet).ok && pairIsLegal(a2, b2, input, neverSet).ok
            ? pairScore(a1, b1, prefs, history) + pairScore(a2, b2, prefs, history)
            : -Infinity;
        const optB =
          pairIsLegal(a1, b2, input, neverSet).ok && pairIsLegal(a2, b1, input, neverSet).ok
            ? pairScore(a1, b2, prefs, history) + pairScore(a2, b1, prefs, history)
            : -Infinity;
        if (optA > current && optA >= optB) {
          pairs[i] = [a1, b1];
          pairs[j] = [a2, b2];
          improved = true;
        } else if (optB > current) {
          pairs[i] = [a1, b2];
          pairs[j] = [a2, b1];
          improved = true;
        }
      }
    }
  }

  const paired = new Set(pairs.flat().map((p) => p.id));
  const leftovers = pool.filter((p) => !paired.has(p.id));

  if (pairs.length < maxPairs && leftovers.length >= 2) {
    // Explain why we could not fill every court from the players who are left.
    const [x, y] = leftovers;
    const why = pairIsLegal(x, y, input, neverSet);
    if (!why.ok) blocked.push(why.reason);
  }

  return { pairs, leftovers, blocked };
}

/**
 * equal_play: restrict the pool to the players who have played least.
 *
 * Implemented as a HARD tier gate, not a scoring weight, and that distinction
 * is the whole point. A weight can always be outvoted by a strong enough pile
 * of partner-preference and chemistry points, which is exactly how a roster
 * ends up with someone on 5 matches while a teammate sits on 2. Walking the
 * tiers guarantees max-minus-min never exceeds 1 over the season.
 *
 * Whole tiers are admitted at once, so within the boundary tier the normal
 * optimiser still gets to honour partner prefs and return sides — fairness
 * decides WHO is in the running, preference decides who pairs with whom.
 *
 * Admission alone is not enough, though. Anyone from a tier BELOW the boundary
 * is behind the field and is marked mustPlay, because otherwise a mutually
 * preferred pair in the boundary tier (worth 100) simply outbids the fairness
 * weight (8 a match) and takes their slot. That is not hypothetical: simulating
 * a 23-player season with a few strong preferences drifted to a 2-match spread
 * before this. Preference now only decides who fills what's left.
 */
function equalPlayPool(available: Player[], needed: number): { pool: Player[]; note: string | null } {
  if (available.length <= needed) return { pool: available, note: null };

  const tiers = new Map<number, Player[]>();
  for (const p of available) {
    const t = tiers.get(p.matchesPlayed) ?? [];
    t.push(p);
    tiers.set(p.matchesPlayed, t);
  }

  const ordered = [...tiers.keys()].sort((a, b) => a - b);
  const admitted: Player[] = [];
  let boundary: number | null = null;
  for (const count of ordered) {
    if (admitted.length >= needed) break;
    admitted.push(...(tiers.get(count) as Player[]));
    boundary = count;
  }

  // Everyone below the boundary tier is guaranteed; the boundary tier competes.
  const pool = admitted.map((p) =>
    p.matchesPlayed < (boundary as number) ? { ...p, mustPlay: true } : p,
  );

  const admittedIds = new Set(admitted.map((p) => p.id));
  const benched = available.filter((p) => !admittedIds.has(p.id));
  const note = benched.length
    ? `Equal-play: sitting ${benched
        .slice()
        .sort((a, b) => a.matchesPlayed - b.matchesPlayed || a.name.localeCompare(b.name))
        .map((p) => `${p.name} (${p.matchesPlayed})`)
        .join(', ')} — already ahead of the ${boundary}-match group.`
    : null;

  return { pool, note };
}

export function generateLineup(input: LineupInput): LineupResult {
  const warnings: string[] = [];
  const prefs = input.partnerPrefs ?? [];
  const neverSet = new Set((input.neverPairs ?? []).map((n) => key(n.playerAId, n.playerBId)));
  const history = input.pairHistory ?? [];

  const needed = input.singlesCourts + input.doublesCourts * 2;

  let available = [...input.available];
  if ((input.captainingStyle ?? 'play_to_win') === 'equal_play') {
    const { pool, note } = equalPlayPool(available, needed);
    available = pool;
    if (note) warnings.push(note);
  }

  if (available.length < needed) {
    warnings.push(
      `Only ${available.length} available for ${needed} spots — ${needed - available.length} short.`,
    );
  }

  // --- singles first: they take the strongest eligible players -------------
  // mustPlay is only ever set by equalPlayPool, so this is a no-op under
  // play_to_win — but under equal_play a singles court must not be handed to a
  // boundary-tier player while someone who is behind sits out.
  const singlesEligible = available
    .filter((p) => p.courtLimit !== 'doubles_only')
    .sort((a, b) => Number(!!b.mustPlay) - Number(!!a.mustPlay) || byStrength(a, b));

  const singlesPicked: Player[] = [];
  for (const p of singlesEligible) {
    if (singlesPicked.length >= input.singlesCourts) break;
    singlesPicked.push(p);
  }

  const takenIds = new Set(singlesPicked.map((p) => p.id));
  const doublesPool = available.filter(
    (p) => !takenIds.has(p.id) && p.courtLimit !== 'singles_only',
  );

  const { pairs, leftovers, blocked } = buildPairs(
    doublesPool,
    input,
    neverSet,
    prefs,
    history,
    input.doublesCourts,
  );
  warnings.push(...blocked);

  // --- court numbering: strongest on the lowest court number ---------------
  const courts: CourtAssignment[] = [];

  /**
   * Same all-or-nothing rule as the doubles courts below: WTN orders the
   * singles courts only when every player picked has one, and a captain's own
   * strength ranking still wins over both, because it is the one input that
   * knows what a number cannot.
   */
  const singlesWtnComplete =
    singlesPicked.length > 0 &&
    singlesPicked.every((p) => wtnOf(p) !== null) &&
    singlesPicked.every((p) => typeof p.sortOrder !== 'number');
  const singlesSorted = singlesWtnComplete
    ? [...singlesPicked].sort((a, b) => wtnOf(a)! - wtnOf(b)! || a.name.localeCompare(b.name))
    : [...singlesPicked].sort(byStrength);
  singlesSorted.forEach((p, i) => {
    const notes: string[] = [];
    if (p.needsEligibility) notes.push(`${p.name} needs matches for playoff eligibility`);
    courts.push({
      courtNumber: i + 1,
      courtType: 'singles',
      player1Id: p.id,
      player2Id: null,
      notes,
    });
  });

  /**
   * Court order for doubles: average WTN when the sheet supports it, combined
   * NTRP otherwise.
   *
   * WTN is used only when EVERY player on EVERY pair has one. Half a roster's
   * worth would mean comparing an average WTN against a combined NTRP — two
   * numbers that run in opposite directions on different scales — and the
   * ordering that fell out would be meaningless while looking authoritative.
   * All-or-nothing keeps the comparison transitive and the reason explainable.
   */
  const wtnComplete = pairs.length > 0 && pairs.every((pr) => pr.every((p) => wtnOf(p) !== null));
  const sortedPairs = wtnComplete
    ? // Lower average WTN is the stronger pair, so it takes the lower court.
      [...pairs].sort(
        (x, y) =>
          (wtnOf(x[0])! + wtnOf(x[1])!) / 2 - (wtnOf(y[0])! + wtnOf(y[1])!) / 2 ||
          x[0].name.localeCompare(y[0].name),
      )
    : [...pairs].sort(
        (x, y) =>
          ratingOf(y[0]) + ratingOf(y[1]) - (ratingOf(x[0]) + ratingOf(x[1])) ||
          x[0].name.localeCompare(y[0].name),
      );

  // Honour "never court 1": if the strongest pair contains such a player and
  // there is another doubles court to move them to, swap it down.
  if (sortedPairs.length > 1) {
    const firstHasBlock = sortedPairs[0].some((p) => p.courtLimit === 'no_court_1');
    const swapIdx = sortedPairs.findIndex(
      (pr, i) => i > 0 && !pr.some((p) => p.courtLimit === 'no_court_1'),
    );
    if (firstHasBlock && swapIdx > 0) {
      const tmp = sortedPairs[0];
      sortedPairs[0] = sortedPairs[swapIdx];
      sortedPairs[swapIdx] = tmp;
    } else if (firstHasBlock) {
      warnings.push('Could not avoid court 1 for a player marked "never court 1".');
    }
  }

  sortedPairs.forEach((pr, i) => {
    const [a, b] = pr;
    const notes: string[] = [];
    if (wtnComplete) {
      notes.push(`avg WTN ${(((wtnOf(a)! + wtnOf(b)!) / 2)).toFixed(1)}`);
    }
    const ps = prefScore(prefs, a.id, b.id);
    if (ps >= W_PREF_MUTUAL * 0.5) notes.push('mutual partner preference');
    else if (ps > 0) notes.push('partner preference');
    if (a.returnSide && b.returnSide && a.returnSide !== b.returnSide) {
      notes.push(`${a.returnSide}/${b.returnSide} return sides`);
    }
    for (const p of pr) {
      if (p.needsEligibility) notes.push(`${p.name} needs matches for playoff eligibility`);
    }
    courts.push({
      courtNumber: input.singlesCourts + i + 1,
      courtType: 'doubles',
      player1Id: a.id,
      player2Id: b.id,
      notes,
    });
  });

  // --- anything we could not seat -----------------------------------------
  const seated = new Set(
    courts.flatMap((c) => [c.player1Id, c.player2Id]).filter(Boolean) as string[],
  );
  const unassigned = available
    .filter((p) => !seated.has(p.id))
    .sort(byNeed)
    .map((p) => p.id);

  for (const p of available) {
    if (p.needsEligibility && !seated.has(p.id)) {
      warnings.push(
        `${p.name} still needs matches for playoff eligibility but is not in this lineup.`,
      );
    }
  }
  void leftovers;

  return { courts, unassigned, warnings };
}

export type RatingType = 'computer' | 'self' | 'appeal';

/**
 * Playoff eligibility rules for a team.
 *
 * `enabled` is false for leagues with no playoffs at all (e.g. East Bay
 * Women's Tennis League) — nothing is then tracked or surfaced.
 *
 * USTA sets a higher bar for self-rated and appeal-rated players than for
 * computer-rated ones, and the bar depends on how many lines the league plays
 * (typically 3 for a 3-line league, 4 for a 4- or 5-line league). Both
 * thresholds are captain-entered rather than assumed.
 */
export type EligibilityRules = {
  enabled: boolean;
  /** matches required for a computer-rated player */
  minMatchesDefault: number;
  /** matches required for a self-rated or appeal-rated player */
  minMatchesSelfRated: number;
};

export function requiredMatches(rules: EligibilityRules, ratingType: RatingType): number {
  if (!rules.enabled) return 0;
  return ratingType === 'computer' ? rules.minMatchesDefault : rules.minMatchesSelfRated;
}

/**
 * Playoff eligibility + fairness, computed from played matches.
 * `playedByPlayer` counts only matches with status 'played'.
 * Returns an empty list when the league has no playoffs.
 */
export function eligibilityReport(opts: {
  players: { id: string; name: string; ratingType?: RatingType }[];
  playedByPlayer: Record<string, number>;
  rules: EligibilityRules;
  matchesRemaining: number;
}): {
  playerId: string;
  name: string;
  ratingType: RatingType;
  played: number;
  required: number;
  short: number;
  eligible: boolean;
  atRisk: boolean;
}[] {
  if (!opts.rules.enabled) return [];

  return opts.players.map((p) => {
    const ratingType = p.ratingType ?? 'computer';
    const required = requiredMatches(opts.rules, ratingType);
    const played = opts.playedByPlayer[p.id] ?? 0;
    const short = Math.max(0, required - played);
    return {
      playerId: p.id,
      name: p.name,
      ratingType,
      played,
      required,
      short,
      eligible: short === 0,
      // can still qualify, but only if they play nearly every remaining match
      atRisk: short > 0 && short >= opts.matchesRemaining,
    };
  });
}

/** Win/loss record for every partnership that has played together. */
export function pairRecordsFrom(
  courts: { player1Id: string | null; player2Id: string | null; won: boolean | null }[],
): PairRecord[] {
  const acc = new Map<string, PairRecord>();
  for (const c of courts) {
    if (!c.player1Id || !c.player2Id || c.won == null) continue;
    const [a, b] =
      c.player1Id < c.player2Id ? [c.player1Id, c.player2Id] : [c.player2Id, c.player1Id];
    const k = key(a, b);
    const rec = acc.get(k) ?? { playerAId: a, playerBId: b, wins: 0, losses: 0 };
    if (c.won) rec.wins += 1;
    else rec.losses += 1;
    acc.set(k, rec);
  }
  return [...acc.values()].sort(
    (x, y) =>
      y.wins + y.losses - (x.wins + x.losses) ||
      y.wins - x.wins ||
      key(x.playerAId, x.playerBId).localeCompare(key(y.playerAId, y.playerBId)),
  );
}
