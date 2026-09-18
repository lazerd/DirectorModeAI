/**
 * PTL meeting resolution — the five-level cascade.
 *
 * A meeting is one team against another inside a night: exactly two lines,
 * 1 singles + 1 doubles, played side by side on two courts. Deciding it is not
 * "count the lines won", because with two lines a 1-1 split is the single most
 * common result. The proposal's cascade:
 *
 *   1. Win both lines                 → meeting win
 *   2. Split 1-1                      → total games won decides
 *   3. Games tied                     → singles and doubles each play a 7-point
 *                                       tiebreak; win both, win the meeting
 *   4. Those two tiebreaks split      → combined points across them decides
 *                                       (two races to 7 = a combined race to 14)
 *   5. Combined points also tied      → the singles players play a 2-of-3
 *                                       point tiebreak
 *
 * Level 4 needs no extra tennis — it reads the points already on the board from
 * level 3, which is why it is "(race to 14)" rather than another thing to play.
 * Levels 3 and 5 DO need extra tennis, and that is the part software usually
 * gets wrong: it silently picks a winner while two pairs are standing on court
 * waiting to be told what happens next. So `resolveMeeting` never invents a
 * result. When it needs points that nobody has played yet it says exactly which
 * ones, and the match-night screen asks for them.
 */

export type Side = 'home' | 'away';
export type LineType = 'singles' | 'doubles';

/** A played line. `winner` null means it has not been reported yet. */
export type LineInput = {
  lineType: LineType;
  winner: Side | null;
  homeGames: number | null;
  awayGames: number | null;
};

/**
 * Extra points played to break a tie.
 *   tb7_singles / tb7_doubles — level 3, first to 7
 *   points23                  — level 5, the singles pair, 2 of 3 points
 * There is deliberately no 'race14' kind: level 4 is computed from the two
 * level-3 tiebreaks, not played separately.
 */
export type ShootoutKind = 'tb7_singles' | 'tb7_doubles' | 'points23';

export type ShootoutInput = {
  kind: ShootoutKind;
  homePts: number;
  awayPts: number;
};

export type MeetingOutcome =
  /** Both lines aren't in yet. */
  | { state: 'awaiting_lines'; missing: LineType[] }
  /** Tennis needs to be played before this can be decided. */
  | { state: 'awaiting_shootout'; needs: ShootoutKind[]; level: 3 | 5; because: string }
  /** Settled. */
  | {
      state: 'decided';
      winner: Side;
      level: 1 | 2 | 3 | 4 | 5;
      homeLines: number;
      awayLines: number;
      homeGames: number;
      awayGames: number;
      because: string;
    };

/**
 * Total games from a written score.
 *
 * Accepts the shapes people actually type courtside — "4-2 4-1", "4-2,4-1",
 * "4-2 3-5 7-3" — splitting on spaces, commas and semicolons alike. A trailing
 * bracketed tiebreak ("4-2 3-5 [10-7]") is ignored for games, because a match
 * tiebreak is not games and counting it would distort the level-2 comparison.
 */
export function parseGames(score: string | null | undefined): [number, number] {
  let home = 0;
  let away = 0;
  for (const raw of String(score || '').split(/[\s,;]+/)) {
    const set = raw.trim();
    if (!set || set.startsWith('[') || set.startsWith('(')) continue;
    const m = set.match(/^(\d+)\s*-\s*(\d+)$/);
    if (m) {
      home += Number(m[1]);
      away += Number(m[2]);
    }
  }
  return [home, away];
}

const winnerOf = (h: number, a: number): Side | null => (h > a ? 'home' : a > h ? 'away' : null);

/**
 * Decide a meeting, or say precisely what is still needed to decide it.
 *
 * Pure: no database, no clock, no I/O. Everything the match-night screen and
 * the standings both depend on lives here so they can never disagree.
 */
export function resolveMeeting(lines: LineInput[], shootouts: ShootoutInput[] = []): MeetingOutcome {
  const singles = lines.find((l) => l.lineType === 'singles');
  const doubles = lines.find((l) => l.lineType === 'doubles');

  const missing: LineType[] = [];
  if (!singles || !singles.winner) missing.push('singles');
  if (!doubles || !doubles.winner) missing.push('doubles');
  if (missing.length) return { state: 'awaiting_lines', missing };

  const both = [singles!, doubles!];
  const homeLines = both.filter((l) => l.winner === 'home').length;
  const awayLines = both.filter((l) => l.winner === 'away').length;
  const homeGames = both.reduce((n, l) => n + (l.homeGames ?? 0), 0);
  const awayGames = both.reduce((n, l) => n + (l.awayGames ?? 0), 0);

  const base = { homeLines, awayLines, homeGames, awayGames } as const;

  // ---- Level 1: won both lines ----
  if (homeLines === 2 || awayLines === 2) {
    const winner: Side = homeLines === 2 ? 'home' : 'away';
    return { state: 'decided', winner, level: 1, ...base, because: 'Won both lines' };
  }

  // ---- Level 2: 1-1, total games ----
  const byGames = winnerOf(homeGames, awayGames);
  if (byGames) {
    return {
      state: 'decided',
      winner: byGames,
      level: 2,
      ...base,
      because: `Split 1-1, won on total games ${Math.max(homeGames, awayGames)}-${Math.min(homeGames, awayGames)}`,
    };
  }

  // ---- Level 3: games tied, both pairs play a 7-point tiebreak ----
  const tbS = shootouts.find((s) => s.kind === 'tb7_singles');
  const tbD = shootouts.find((s) => s.kind === 'tb7_doubles');
  const needTb: ShootoutKind[] = [];
  if (!tbS) needTb.push('tb7_singles');
  if (!tbD) needTb.push('tb7_doubles');
  if (needTb.length) {
    return {
      state: 'awaiting_shootout',
      needs: needTb,
      level: 3,
      because: `Split 1-1 and games are level at ${homeGames}-${awayGames} — both courts play a 7-point tiebreak`,
    };
  }

  const tbWins = [tbS!, tbD!].map((s) => winnerOf(s.homePts, s.awayPts));
  const homeTb = tbWins.filter((w) => w === 'home').length;
  const awayTb = tbWins.filter((w) => w === 'away').length;
  if (homeTb === 2 || awayTb === 2) {
    const winner: Side = homeTb === 2 ? 'home' : 'away';
    return { state: 'decided', winner, level: 3, ...base, because: 'Won both 7-point tiebreaks' };
  }

  // ---- Level 4: tiebreaks split, combined points (the race to 14) ----
  const homePts = tbS!.homePts + tbD!.homePts;
  const awayPts = tbS!.awayPts + tbD!.awayPts;
  const byPoints = winnerOf(homePts, awayPts);
  if (byPoints) {
    return {
      state: 'decided',
      winner: byPoints,
      level: 4,
      ...base,
      because: `Tiebreaks split, won on combined points ${Math.max(homePts, awayPts)}-${Math.min(homePts, awayPts)}`,
    };
  }

  // ---- Level 5: still level, the singles pair plays 2 of 3 points ----
  const decider = shootouts.find((s) => s.kind === 'points23');
  if (!decider) {
    return {
      state: 'awaiting_shootout',
      needs: ['points23'],
      level: 5,
      because: `Combined points level at ${homePts}-${awayPts} — the singles players play a 2-of-3 point tiebreak`,
    };
  }

  const byDecider = winnerOf(decider.homePts, decider.awayPts);
  if (!byDecider) {
    // 2-of-3 points cannot end level. Someone mistyped it; ask again rather
    // than record a tie the format does not have.
    return {
      state: 'awaiting_shootout',
      needs: ['points23'],
      level: 5,
      because: 'The 2-of-3 point tiebreak came back level — it cannot end level, so please re-enter it',
    };
  }

  return {
    state: 'decided',
    winner: byDecider,
    level: 5,
    ...base,
    because: `Decided on the 2-of-3 point tiebreak ${decider.homePts}-${decider.awayPts}`,
  };
}

/** Convenience for the match-night screen: has this meeting anything left to do? */
export function meetingIsComplete(o: MeetingOutcome): o is Extract<MeetingOutcome, { state: 'decided' }> {
  return o.state === 'decided';
}
