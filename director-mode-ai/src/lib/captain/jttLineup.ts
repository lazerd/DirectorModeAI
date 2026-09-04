/**
 * Junior Team Tennis lineups.
 *
 * Every other league CaptainMode handles is a set of DISTINCT people: eight
 * players, eight slots, nobody twice. JTT is not that shape, and the difference
 * is not a tweak to the adult generator — it is a different problem.
 *
 * A JTT team match is 4 singles and 4 doubles, each a short set to 4 games,
 * decided on total games won. That is 8 lines and TWELVE player slots, played
 * as three rounds:
 *
 *     round 1  singles 1-4        all four at once
 *     round 2  doubles 1-2
 *     round 3  doubles 3-4
 *
 * A child may take one singles and two doubles, so a name legitimately appears
 * on the sheet three times — and with four children present it MUST, because
 * four is exactly enough to cover twelve slots at three each.
 *
 * The roster window that falls out of the arithmetic:
 *   3   the fewest who may take the court (a league rule, not arithmetic); the
 *       lines they cannot cover are conceded on the scorecard
 *   4   covers all eight lines, three each
 *   6   the most that still gives everybody two lines
 *   7+  somebody drives to the match to play one short set
 *
 * The round structure is a hard constraint, not a preference: two lines in the
 * same round are played at the same time on adjacent courts, so a child cannot
 * be on both. A sheet that ignores it is unplayable, which is worse than none.
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
import { linesPerPlayer, type MultiLineRules } from './leagues';

export type JttLineupInput = {
  available: Player[];
  singlesCourts: number;
  doublesCourts: number;
  rules: MultiLineRules;
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
};

const key = (a: string, b: string) => (a < b ? a + '|' + b : b + '|' + a);

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
  const available = [...input.available];
  const shape = linesPerPlayer(available.length, courtsShape, rules);

  if (!shape.canPlay) {
    return {
      courts: [],
      unassigned: available.map((p) => p.id),
      warnings: [
        `${available.length} available. A match needs at least ${rules.minToPlay} — below that it cannot be played at all, so this one has to be conceded or rescheduled.`,
      ],
    };
  }

  if (shape.defaulted > 0) {
    warnings.push(
      `${available.length} available: ${shape.defaulted} of the ${shape.lines} lines can't be covered and will be defaulted. ${shape.fillsSheet} players covers the whole sheet.`,
    );
  }
  if (available.length > shape.idealMax) {
    warnings.push(
      `${available.length} available for ${shape.slots} slots — past ${shape.idealMax}, some players only get one line.`,
    );
  }

  const quota = quotas(available, shape.slots, rules, style);
  /** Lines still owed to each child. */
  const left = new Map(available.map((p) => [p.id, quota.get(p.id) ?? 0]));
  const doublesTaken = new Map<string, number>(available.map((p) => [p.id, 0]));

  const courts: CourtAssignment[] = [];

  // ---------------------------------------------------------------- round 1
  // Singles. Strongest first, because that is how a JTT coach orders a sheet,
  // and one each: all the singles are played at the same time.
  const singlesPool = available
    .filter((p) => p.courtLimit !== 'doubles_only' && (left.get(p.id) ?? 0) > 0)
    .sort((a, b) => {
      // A child owed more lines than the doubles rounds can absorb MUST take a
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

  singlesSorted.forEach((p, i) => {
    left.set(p.id, (left.get(p.id) ?? 1) - 1);
    courts.push({
      courtNumber: i + 1,
      courtType: 'singles',
      player1Id: p.id,
      player2Id: null,
      notes: wtnComplete ? ['round 1', `WTN ${wtnOf(p)!.toFixed(1)}`] : ['round 1'],
    });
  });

  for (let i = singlesSorted.length; i < input.singlesCourts; i++) {
    courts.push({
      courtNumber: i + 1,
      courtType: 'singles',
      player1Id: null,
      player2Id: null,
      notes: ['round 1 — nobody left to cover this line, default'],
    });
  }

  // --------------------------------------------------------- rounds 2 and 3
  // The doubles, one round at a time. Within a round a child plays once; across
  // rounds they may play twice, but never with the same partner — two short
  // sets alongside the same teammate wastes half the doubles a child gets.
  const rounds = Math.max(1, rules.maxDoubles);
  const perRound = Math.ceil(input.doublesCourts / rounds);
  const pairedBefore = new Set<string>();
  let courtNumber = input.singlesCourts;

  const legalityInput = {
    available,
    singlesCourts: input.singlesCourts,
    doublesCourts: input.doublesCourts,
    leagueType: 'jtt',
  } as LineupInput;

  for (let round = 0; round < rounds; round++) {
    const linesThisRound = Math.min(perRound, input.doublesCourts - round * perRound);
    if (linesThisRound <= 0) break;
    const roundsLeft = rounds - round;

    /** Doubles lines this child still has coming. */
    const needOf = (p: Player) =>
      Math.min(left.get(p.id) ?? 0, rules.maxDoubles - (doublesTaken.get(p.id) ?? 0));

    const pool = available.filter(
      (p) => p.courtLimit !== 'singles_only' && needOf(p) > 0,
    );

    /**
     * A child owed as many doubles as there are rounds remaining has to be in
     * THIS one — there is nowhere else left to put them. Everyone else is
     * filler, taken by need and then by strength.
     */
    const isForced = (p: Player) => needOf(p) >= roundsLeft;
    const roundPlayers = [...pool]
      .sort(
        (a, b) =>
          Number(isForced(b)) - Number(isForced(a)) ||
          needOf(b) - needOf(a) ||
          byStrength(a, b) ||
          a.name.localeCompare(b.name),
      )
      .slice(0, linesThisRound * 2);

    const candidates: { a: Player; b: Player; score: number }[] = [];
    for (let i = 0; i < roundPlayers.length; i++) {
      for (let j = i + 1; j < roundPlayers.length; j++) {
        const a = roundPlayers[i];
        const b = roundPlayers[j];
        if (!pairIsLegal(a, b, legalityInput, neverSet).ok) continue;
        let score = pairScore(a, b, prefs, history);
        /*
         * Two short sets alongside the same teammate wastes half the doubles a
         * child gets, so a repeat is heavily penalised — but NOT banned. When
         * the only alternative is conceding a line, playing it with a repeated
         * partnership is plainly the better sheet.
         */
        if (pairedBefore.has(key(a.id, b.id))) score -= 5_000;
        /*
         * Pairing two children who BOTH have to appear in every remaining round
         * spends the one partner each of them had available. With six players
         * that is exactly how the last round ends up with two kids who may not
         * play together and a line nobody can fill — the sweet-spot turnout
         * silently losing a line. Penalised harder than a repeat, because it
         * causes one.
         */
        if (roundsLeft > 1 && isForced(a) && isForced(b)) score -= 20_000;
        candidates.push({ a, b, score });
      }
    }
    candidates.sort(
      (x, y) =>
        y.score - x.score ||
        needOf(y.a) + needOf(y.b) - (needOf(x.a) + needOf(x.b)) ||
        key(x.a.id, x.b.id).localeCompare(key(y.a.id, y.b.id)),
    );

    const usedThisRound = new Set<string>();
    const picked: [Player, Player][] = [];
    for (const c of candidates) {
      if (picked.length >= linesThisRound) break;
      if (usedThisRound.has(c.a.id) || usedThisRound.has(c.b.id)) continue;
      usedThisRound.add(c.a.id);
      usedThisRound.add(c.b.id);
      picked.push([c.a, c.b]);
    }

    // Stronger pair on the lower court, same all-or-nothing WTN rule.
    const pairWtnComplete =
      picked.length > 0 && picked.every((pr) => pr.every((p) => wtnOf(p) !== null));
    const sorted = pairWtnComplete
      ? [...picked].sort(
          (x, y) =>
            (wtnOf(x[0])! + wtnOf(x[1])!) / 2 - (wtnOf(y[0])! + wtnOf(y[1])!) / 2 ||
            x[0].name.localeCompare(y[0].name),
        )
      : [...picked].sort(
          (x, y) =>
            ratingOf(y[0]) + ratingOf(y[1]) - (ratingOf(x[0]) + ratingOf(x[1])) ||
            x[0].name.localeCompare(y[0].name),
        );

    for (let i = 0; i < linesThisRound; i++) {
      courtNumber += 1;
      const pr = sorted[i];
      if (!pr) {
        courts.push({
          courtNumber,
          courtType: 'doubles',
          player1Id: null,
          player2Id: null,
          notes: [`round ${round + 2} — nobody left to cover this line, default`],
        });
        continue;
      }
      const [a, b] = pr;
      left.set(a.id, (left.get(a.id) ?? 1) - 1);
      left.set(b.id, (left.get(b.id) ?? 1) - 1);
      doublesTaken.set(a.id, (doublesTaken.get(a.id) ?? 0) + 1);
      doublesTaken.set(b.id, (doublesTaken.get(b.id) ?? 0) + 1);

      const notes = [`round ${round + 2}`];
      if (pairedBefore.has(key(a.id, b.id))) {
        notes.push('same partners again — too few players to avoid it');
      }
      pairedBefore.add(key(a.id, b.id));
      if (pairWtnComplete) notes.push(`avg WTN ${((wtnOf(a)! + wtnOf(b)!) / 2).toFixed(1)}`);
      courts.push({
        courtNumber,
        courtType: 'doubles',
        player1Id: a.id,
        player2Id: b.id,
        notes,
      });
    }
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

  return { courts, unassigned: unassigned.map((p) => p.id), warnings };
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
