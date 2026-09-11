/**
 * Junior Team Tennis lineups.
 *
 * Every other league CaptainMode handles is a set of DISTINCT people: eight
 * players, eight slots, nobody twice. JTT is not that shape, and the difference
 * is not a tweak to the adult generator — it is a different problem.
 *
 * A JTT team match is 4 singles and 4 doubles, each a short set to 4 games,
 * decided on total games won. That is 8 lines and TWELVE player slots, played
 * in rounds whose shape depends on how many courts the host has:
 *
 *     2 courts   S1+D1 | S2+D2 | S3+D3 | S4+D4
 *     3 courts   S1+S2+D1 | S3+S4+D2 | D3+D4
 *
 * (see jttRoundPlan in leagues.ts). A child may take one singles and two
 * doubles, so a name legitimately appears on the sheet three times — and with
 * four children present it MUST, because four is exactly enough to cover
 * twelve slots at three each.
 *
 * The roster window that falls out of the arithmetic:
 *   3   the fewest who may take the court (a league rule, not arithmetic); the
 *       lines they cannot cover are conceded on the scorecard
 *   4   covers all eight lines, three each
 *   6   the most that still gives everybody two lines
 *   7+  somebody drives to the match to play one short set
 *
 * The round structure is a hard constraint, not a preference: lines in the
 * same round are played at the same time, so a child cannot be on two of them.
 * A kid on Singles 1 in a 2-court match cannot also be on the doubles line
 * beside it. A sheet that ignores that is unplayable, which is worse than none.
 */

import {
  byStrength,
  pairIsLegal,
  pairScore,
  wtnOf,
  ratingOf,
  type CourtAssignment,
  type LineupInput,
  type LineupResult,
  type NeverPair,
  type PairRecord,
  type PartnerPref,
  type Player,
} from './lineup';
import {
  DEFAULT_JTT_COURT_FORMAT,
  jttRoundPlan,
  linesPerPlayer,
  type MultiLineRules,
} from './leagues';

export type JttLineupInput = {
  available: Player[];
  singlesCourts: number;
  doublesCourts: number;
  rules: MultiLineRules;
  /** Courts played at once — 2 or 3. Decides which lines share a round. */
  courtFormat?: number | null;
  partnerPrefs?: PartnerPref[];
  neverPairs?: NeverPair[];
  pairHistory?: PairRecord[];
  /**
   * equal_play hands the spare line to whoever has had least of the season;
   * play_to_win hands it to the strongest. Either way the spread WITHIN one
   * match is capped at a single line, because that part is not a preference —
   * a child who travelled to the match plays.
   */
  captainingStyle?: 'play_to_win' | 'equal_play';
  /**
   * The most children the team brings. When more say yes, the generator picks
   * who sits instead of seating seven on a twelve-slot sheet and sending two
   * families to Dublin for a single short set (12U, 2026-09-13).
   *
   * Who PLAYS, in order: fewest matches so far this season (equal_play; the
   * strongest under play_to_win), then fewest other dates they can make — a
   * child who can come to everything loses least by sitting — then whoever
   * signed up first.
   */
  squad?: {
    max: number;
    /** Other upcoming dates each child has said yes to. */
    otherYes?: Record<string, number>;
    /** When each child joined the roster (ISO) — the last tiebreak. */
    joinedAt?: Record<string, string>;
  } | null;
};

const key = (a: string, b: string) => (a < b ? a + '|' + b : b + '|' + a);

/** A repeated doubles partnership: heavily penalised, not banned — beats conceding a line. */
const REPEAT_PENALTY = 5_000;

/**
 * Upper bound on doubles arrangements tried. A real sheet is 4 doubles lines
 * and a handful of children, so the search finishes in a few thousand steps;
 * the cap only guards against a pathological roster ever hanging a request.
 */
const SEARCH_LIMIT = 250_000;

/**
 * How many lines each child gets, decided before anybody is seated.
 *
 * Handing out quotas first is what keeps the sheet fair. Seating greedily line
 * by line and hoping it evens out is how the strongest four end up playing
 * three each while two children who came to play get one — the exact failure
 * this exists to prevent.
 */
function quotas(
  players: Player[],
  slots: number,
  rules: MultiLineRules,
  style: 'play_to_win' | 'equal_play',
): Map<string, number> {
  const n = players.length;
  const base = Math.min(rules.maxTotal, Math.floor(slots / n));
  let extra = base < rules.maxTotal ? Math.min(slots - base * n, n) : 0;

  // Ties break on name so the same roster always produces the same sheet.
  const order = [...players].sort((a, b) =>
    style === 'equal_play'
      ? a.matchesPlayed - b.matchesPlayed || byStrength(a, b) || a.name.localeCompare(b.name)
      : byStrength(a, b) || a.name.localeCompare(b.name),
  );

  const out = new Map<string, number>();
  for (const p of order) {
    const take = extra > 0 ? 1 : 0;
    extra -= take;
    out.set(p.id, base + take);
  }
  return out;
}

export function generateJttLineup(input: JttLineupInput): LineupResult {
  const warnings: string[] = [];
  const prefs = input.partnerPrefs ?? [];
  const history = input.pairHistory ?? [];
  const neverSet = new Set((input.neverPairs ?? []).map((n) => key(n.playerAId, n.playerBId)));
  const style = input.captainingStyle ?? 'play_to_win';
  const rules = input.rules;

  const courtsShape = { singles: input.singlesCourts, doubles: input.doublesCourts };

  // ------------------------------------------------------------- who comes
  const cap = input.squad?.max ?? 0;
  let available = [...input.available];
  const sitting: { id: string; reason: string }[] = [];
  if (cap > 0 && available.length > cap) {
    const otherYes = input.squad?.otherYes ?? {};
    const joined = input.squad?.joinedAt ?? {};
    const order = [...available].sort(
      (a, b) =>
        (style === 'equal_play' ? a.matchesPlayed - b.matchesPlayed : byStrength(a, b)) ||
        (otherYes[a.id] ?? 0) - (otherYes[b.id] ?? 0) ||
        (joined[a.id] ?? '').localeCompare(joined[b.id] ?? '') ||
        a.name.localeCompare(b.name),
    );
    available = order.slice(0, cap);
    for (const p of order.slice(cap)) {
      const m = p.matchesPlayed;
      const o = otherYes[p.id] ?? 0;
      sitting.push({
        id: p.id,
        reason:
          style === 'equal_play'
            ? `sitting — the team brings ${cap} at most. Already down for ${m} ${m === 1 ? 'match' : 'matches'}, and can make ${o} other ${o === 1 ? 'date' : 'dates'}, so sitting this one costs them least.`
            : `sitting — the team brings ${cap} at most, and this team plays to win, so the strongest ${cap} go.`,
      });
    }
  }

  const shape = linesPerPlayer(available.length, courtsShape, rules);

  if (!shape.canPlay) {
    return {
      courts: [],
      unassigned: available.map((p) => p.id),
      sitting,
      warnings: [
        `${available.length} available. A match needs at least ${rules.minToPlay} — below that it cannot be played at all, so this one has to be conceded or rescheduled.`,
      ],
    };
  }

  const plan = jttRoundPlan(
    input.courtFormat ?? DEFAULT_JTT_COURT_FORMAT,
    input.singlesCourts,
    input.doublesCourts,
  );
  const singlesRound = new Map<number, number>();
  const doublesRound = new Map<number, number>();
  plan.forEach((r, i) => {
    r.singles.forEach((n) => singlesRound.set(n, i + 1));
    r.doubles.forEach((n) => doublesRound.set(n, i + 1));
  });

  /** Children already on a line in each round. */
  const busy = new Map<number, Set<string>>(plan.map((_, i) => [i + 1, new Set<string>()]));

  const quota = quotas(available, shape.slots, rules, style);
  /** Lines still owed to each child. */
  const left = new Map(available.map((p) => [p.id, quota.get(p.id) ?? 0]));
  const doublesTaken = new Map<string, number>(available.map((p) => [p.id, 0]));

  const courts: CourtAssignment[] = [];

  // --------------------------------------------------------------- singles
  // Strongest first, because that is how a JTT coach orders a sheet, and one
  // each — no child plays two singles.
  const singlesPool = available
    .filter((p) => p.courtLimit !== 'doubles_only' && (left.get(p.id) ?? 0) > 0)
    .sort((a, b) => {
      // A child owed more lines than the doubles can absorb MUST take a
      // singles line, or the quota promised to them is undeliverable.
      const forced = (p: Player) => ((left.get(p.id) ?? 0) > rules.maxDoubles ? 0 : 1);
      return forced(a) - forced(b) || byStrength(a, b) || a.name.localeCompare(b.name);
    })
    .slice(0, input.singlesCourts);

  // WTN orders the singles courts only when every child picked has one — the
  // same all-or-nothing rule the adult generator uses, for the same reason.
  const wtnComplete =
    singlesPool.length > 0 &&
    singlesPool.every((p) => wtnOf(p) !== null) &&
    singlesPool.every((p) => typeof p.sortOrder !== 'number');
  const singlesSorted = wtnComplete
    ? [...singlesPool].sort((a, b) => wtnOf(a)! - wtnOf(b)! || a.name.localeCompare(b.name))
    : [...singlesPool].sort(byStrength);

  for (let line = 1; line <= input.singlesCourts; line++) {
    const round = singlesRound.get(line) ?? 1;
    const p = singlesSorted[line - 1];
    if (!p) {
      courts.push({
        courtNumber: line,
        courtType: 'singles',
        player1Id: null,
        player2Id: null,
        notes: [`round ${round}`, 'nobody left to cover this line, default'],
      });
      continue;
    }
    left.set(p.id, (left.get(p.id) ?? 1) - 1);
    busy.get(round)!.add(p.id);
    courts.push({
      courtNumber: line,
      courtType: 'singles',
      player1Id: p.id,
      player2Id: null,
      notes: wtnComplete ? [`round ${round}`, `WTN ${wtnOf(p)!.toFixed(1)}`] : [`round ${round}`],
    });
  }

  // --------------------------------------------------------------- doubles
  /*
   * An exhaustive search, not a greedy pass. Round structure makes greedy
   * unreliable: in a 2-court match each doubles line sits beside a singles
   * line, so the pair picked for Doubles 1 decides who is left to cover
   * Doubles 4 — and four children only fill the sheet in a few specific
   * arrangements. The sheet is tiny (≤ 4 doubles lines, quotas cap who can
   * go where), so trying them all is cheap and never loses a coverable line.
   *
   * Best = most lines covered, then highest pair score (partner preference,
   * complementary sides, past results), with repeated partnerships penalised.
   */
  const legalityInput = {
    available,
    singlesCourts: input.singlesCourts,
    doublesCourts: input.doublesCourts,
    leagueType: 'jtt',
  } as LineupInput;

  const doublesPool = available.filter(
    (p) => p.courtLimit !== 'singles_only' && (left.get(p.id) ?? 0) > 0,
  );
  const pairs: { a: Player; b: Player; k: string; score: number }[] = [];
  for (let i = 0; i < doublesPool.length; i++) {
    for (let j = i + 1; j < doublesPool.length; j++) {
      const a = doublesPool[i];
      const b = doublesPool[j];
      if (!pairIsLegal(a, b, legalityInput, neverSet).ok) continue;
      pairs.push({ a, b, k: key(a.id, b.id), score: pairScore(a, b, prefs, history) });
    }
  }
  // Best pairs first, so the first complete sheet found is already a good one
  // and the bound prunes hard. Ties on key keep the output deterministic.
  pairs.sort((x, y) => y.score - x.score || x.k.localeCompare(y.k));

  const D = input.doublesCourts;
  const assign: ({ a: Player; b: Player; k: string } | null)[] = new Array(D).fill(null);
  const pairedCount = new Map<string, number>();
  let best: { filled: number; score: number; assign: typeof assign } = {
    filled: -1,
    score: -Infinity,
    assign: [],
  };
  let nodes = 0;

  const dfs = (idx: number, filled: number, score: number) => {
    if (++nodes > SEARCH_LIMIT) return;
    if (idx === D) {
      if (filled > best.filled || (filled === best.filled && score > best.score)) {
        best = { filled, score, assign: [...assign] };
      }
      return;
    }
    // Even filling every remaining line can't catch the best — stop.
    if (filled + (D - idx) < best.filled) return;

    const inRound = busy.get(doublesRound.get(idx + 1) ?? 1)!;
    for (const pr of pairs) {
      const { a, b } = pr;
      if (inRound.has(a.id) || inRound.has(b.id)) continue;
      if ((left.get(a.id) ?? 0) <= 0 || (left.get(b.id) ?? 0) <= 0) continue;
      if ((doublesTaken.get(a.id) ?? 0) >= rules.maxDoubles) continue;
      if ((doublesTaken.get(b.id) ?? 0) >= rules.maxDoubles) continue;

      const repeat = (pairedCount.get(pr.k) ?? 0) > 0;
      inRound.add(a.id);
      inRound.add(b.id);
      for (const p of [a, b]) {
        left.set(p.id, (left.get(p.id) ?? 0) - 1);
        doublesTaken.set(p.id, (doublesTaken.get(p.id) ?? 0) + 1);
      }
      pairedCount.set(pr.k, (pairedCount.get(pr.k) ?? 0) + 1);
      assign[idx] = pr;

      dfs(idx + 1, filled + 1, score + pr.score - (repeat ? REPEAT_PENALTY : 0));

      assign[idx] = null;
      pairedCount.set(pr.k, (pairedCount.get(pr.k) ?? 1) - 1);
      for (const p of [a, b]) {
        left.set(p.id, (left.get(p.id) ?? 0) + 1);
        doublesTaken.set(p.id, (doublesTaken.get(p.id) ?? 1) - 1);
      }
      inRound.delete(a.id);
      inRound.delete(b.id);
    }
    // …or concede this line and see whether the rest does better without it.
    dfs(idx + 1, filled, score);
  };
  dfs(0, 0, 0);

  /*
   * Stronger pair on the lower court — but only among lines of the SAME round.
   * Moving a pair to a line in another round would put it beside a singles
   * line one of them may be playing. Same all-or-nothing WTN rule as singles.
   */
  const chosen = best.assign.length ? best.assign : assign;
  const picked = chosen.filter(Boolean) as { a: Player; b: Player; k: string }[];
  const pairWtnComplete =
    picked.length > 0 && picked.every((pr) => wtnOf(pr.a) !== null && wtnOf(pr.b) !== null);
  const strength = (pr: { a: Player; b: Player }) =>
    pairWtnComplete
      ? (wtnOf(pr.a)! + wtnOf(pr.b)!) / 2
      : -(ratingOf(pr.a) + ratingOf(pr.b));

  const ordered = [...chosen];
  for (const r of plan) {
    const idxs = r.doubles.map((n) => n - 1);
    const filledHere = idxs
      .map((i) => ordered[i])
      .filter(Boolean) as { a: Player; b: Player; k: string }[];
    filledHere.sort((x, y) => strength(x) - strength(y) || x.a.name.localeCompare(y.a.name));
    idxs.forEach((i, j) => (ordered[i] = filledHere[j] ?? null));
  }

  const seenPair = new Set<string>();
  for (let line = 1; line <= D; line++) {
    const round = doublesRound.get(line) ?? 1;
    const courtNumber = input.singlesCourts + line;
    const pr = ordered[line - 1];
    if (!pr) {
      courts.push({
        courtNumber,
        courtType: 'doubles',
        player1Id: null,
        player2Id: null,
        notes: [`round ${round}`, 'nobody left to cover this line, default'],
      });
      continue;
    }
    const notes = [`round ${round}`];
    if (seenPair.has(pr.k)) notes.push('same partners again — too few players to avoid it');
    seenPair.add(pr.k);
    if (pairWtnComplete) notes.push(`avg WTN ${((wtnOf(pr.a)! + wtnOf(pr.b)!) / 2).toFixed(1)}`);
    courts.push({
      courtNumber,
      courtType: 'doubles',
      player1Id: pr.a.id,
      player2Id: pr.b.id,
      notes,
    });
  }

  // ------------------------------------------------------------- warnings
  // Counted off the finished sheet, not predicted: which lines can be covered
  // depends on the round structure, and the 2-court format covers more with
  // three children than the 3-court one does.
  if (sitting.length) {
    const names = sitting
      .map((s) => input.available.find((p) => p.id === s.id)?.name ?? 'someone')
      .join(', ');
    warnings.push(
      `${input.available.length} said yes — bringing ${cap} so nobody drives there for one short set. Sitting: ${names}. To sit someone else instead, mark them Out and Regenerate.`,
    );
  }

  const empty = courts.filter((c) => !c.player1Id).length;
  if (empty > 0) {
    warnings.push(
      `${available.length} available: ${empty} of the ${shape.lines} lines can't be covered and will be defaulted. ${shape.fillsSheet} players covers the whole sheet.`,
    );
  }
  if (available.length > shape.idealMax) {
    warnings.push(
      `${available.length} available for ${shape.slots} slots — past ${shape.idealMax}, some players only get one line.`,
    );
  }

  // Anyone who came and never got on. Named, because a number does not.
  const seated = new Set(
    courts.flatMap((c) => [c.player1Id, c.player2Id]).filter(Boolean) as string[],
  );
  const unassigned = available.filter((p) => !seated.has(p.id));
  if (unassigned.length) {
    warnings.push(
      `No line for ${unassigned.map((p) => p.name).join(', ')} — there are only ${shape.slots} slots on the sheet.`,
    );
  }

  return { courts, unassigned: unassigned.map((p) => p.id), warnings, sitting };
}

/** Lines each child is on. Drives the fairness readout on the match sheet. */
export function linesByPlayer(courts: CourtAssignment[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of courts) {
    for (const id of [c.player1Id, c.player2Id]) {
      if (id) out[id] = (out[id] ?? 0) + 1;
    }
  }
  return out;
}
