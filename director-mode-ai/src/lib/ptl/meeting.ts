/**
 * PTL meeting resolution.
 *
 * A meeting is one team against another inside a session. PTL runs it in two
 * shapes, and this file decides both:
 *
 *   OPEN TWO       1 singles + 1 doubles, 4 courts for a four-team night.
 *                  Two lines means a 1-1 split is the commonest result there
 *                  is, so it falls into a five-rung cascade: total games, then
 *                  a pair of 7-point tiebreaks, then combined points, then a
 *                  2-of-3 decider between the singles players.
 *
 *   GENDERED FOUR  Men's and women's singles, men's and women's doubles, all
 *                  four at once across 4 courts — so a four-team night needs
 *                  8. Men never play women. At 2-2 a MIXED DOUBLES decides it,
 *                  which is the moment the league gets remembered for.
 *
 * The decider is a LINE, not a tiebreak: it has a score, a court, four players
 * and a winner like any other match. It carries `isDecider` so it is excluded
 * from the count that produces the 2-2 in the first place.
 *
 * What both shapes share, and the reason this file is pure: a meeting is never
 * resolved by whoever happens to be typing. Nothing here invents a winner. When
 * the result depends on tennis nobody has played yet, it says exactly which
 * tennis, and waits.
 */

export type Side = 'home' | 'away';
export type LineType = 'singles' | 'doubles';

export type LineKind =
  | 'open'
  | 'mens_singles'
  | 'womens_singles'
  | 'mens_doubles'
  | 'womens_doubles'
  | 'mixed_doubles';

/** How a meeting that finishes level on lines gets settled. */
export type TiebreakMode = 'cascade' | 'mixed';

/** Which set of lines a division plays. */
export type LineFormat = 'open_two' | 'gendered_four';

/** A played line. `winner` null means it has not been reported yet. */
export type LineInput = {
  lineType: LineType;
  /** Defaults to 'open' — the original ungendered two-line format. */
  lineKind?: LineKind;
  /** The mixed doubles that only happens if the counted lines finish level. */
  isDecider?: boolean;
  winner: Side | null;
  homeGames: number | null;
  awayGames: number | null;
};

/**
 * Extra POINTS played to break a tie, in the cascade format only.
 *   tb7_singles / tb7_doubles — first to 7
 *   points23                  — the singles pair, 2 of 3 points
 * There is deliberately no 'race14': combined points is arithmetic on the two
 * 7-point tiebreaks, not another thing to play.
 */
export type ShootoutKind = 'tb7_singles' | 'tb7_doubles' | 'points23';

export type ShootoutInput = {
  kind: ShootoutKind;
  homePts: number;
  awayPts: number;
};

export type MeetingOutcome =
  /** Lines still to be reported. `missing` names them. */
  | { state: 'awaiting_lines'; missing: string[] }
  /** Points have to be played before this can be decided. */
  | { state: 'awaiting_shootout'; needs: ShootoutKind[]; level: 3 | 5; because: string }
  /** A mixed doubles has to be played before this can be decided. */
  | { state: 'awaiting_decider'; because: string }
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

const LABEL: Record<LineKind, string> = {
  open: 'line',
  mens_singles: "men's singles",
  womens_singles: "women's singles",
  mens_doubles: "men's doubles",
  womens_doubles: "women's doubles",
  mixed_doubles: 'mixed doubles',
};

/** What to call a line that hasn't been reported. */
function nameOf(line: LineInput): string {
  const kind = line.lineKind ?? 'open';
  return kind === 'open' ? line.lineType : LABEL[kind];
}

/**
 * Total games from a written score.
 *
 * Accepts the shapes people type courtside — "4-2 4-1", "4-2,4-1",
 * "4-2 3-5 7-3" — splitting on spaces, commas and semicolons alike. A trailing
 * bracketed tiebreak ("4-2 3-5 [10-7]") is ignored for games: a match tiebreak
 * is not games, and counting it would distort the comparison it feeds.
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
 * the standings both depend on lives here, so the two can never disagree.
 */
export function resolveMeeting(
  lines: LineInput[],
  shootouts: ShootoutInput[] = [],
  mode: TiebreakMode = 'cascade',
  format: LineFormat = mode === 'mixed' ? 'gendered_four' : 'open_two',
): MeetingOutcome {
  // The decider is excluded from the count — it exists to break the tie the
  // count produces, so including it would resolve the meeting it was called for.
  const counted = lines.filter((l) => !l.isDecider);
  const decider = lines.find((l) => l.isDecider);

  /*
   * Check against the lines the FORMAT calls for, not just the ones handed in.
   * Counting only what is present looks equivalent and is not: a meeting with
   * one line reported and one still out would read as 1-0 and declare a winner
   * while a match was still on court. An absent line is as unfinished as an
   * unreported one.
   */
  const expected = linesForFormat(format).filter((l) => !l.isDecider);
  const missing: string[] = [];
  for (const want of expected) {
    const got = counted.find(
      (l) => l.lineType === want.lineType && (l.lineKind ?? 'open') === want.lineKind,
    );
    if (!got || !got.winner) missing.push(nameOf(got ?? (want as LineInput)));
  }
  if (missing.length) return { state: 'awaiting_lines', missing };

  const homeLines = counted.filter((l) => l.winner === 'home').length;
  const awayLines = counted.filter((l) => l.winner === 'away').length;
  const homeGames = counted.reduce((n, l) => n + (l.homeGames ?? 0), 0);
  const awayGames = counted.reduce((n, l) => n + (l.awayGames ?? 0), 0);

  const base = { homeLines, awayLines, homeGames, awayGames } as const;

  // ---- Level 1: won more lines ----
  const byLines = winnerOf(homeLines, awayLines);
  if (byLines) {
    const won = Math.max(homeLines, awayLines);
    const lost = Math.min(homeLines, awayLines);
    return {
      state: 'decided',
      winner: byLines,
      level: 1,
      ...base,
      because: lost === 0 ? `Won all ${won} lines` : `Won the lines ${won}-${lost}`,
    };
  }

  // ---- Level on lines. How that gets settled depends on the format. ----

  if (mode === 'mixed') {
    if (!decider || !decider.winner) {
      return {
        state: 'awaiting_decider',
        because:
          `Level at ${homeLines}-${awayLines} — it goes to a mixed doubles`,
      };
    }
    return {
      state: 'decided',
      winner: decider.winner,
      level: 2,
      ...base,
      because: 'Level on lines, won the mixed doubles decider',
    };
  }

  // ---- Cascade, level 2: total games ----
  const byGames = winnerOf(homeGames, awayGames);
  if (byGames) {
    return {
      state: 'decided',
      winner: byGames,
      level: 2,
      ...base,
      because: `Split ${homeLines}-${awayLines}, won on total games ${Math.max(homeGames, awayGames)}-${Math.min(homeGames, awayGames)}`,
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
      because: `Split ${homeLines}-${awayLines} and games are level at ${homeGames}-${awayGames} — both courts play a 7-point tiebreak`,
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
  const dec = shootouts.find((s) => s.kind === 'points23');
  if (!dec) {
    return {
      state: 'awaiting_shootout',
      needs: ['points23'],
      level: 5,
      because: `Combined points level at ${homePts}-${awayPts} — the singles players play a 2-of-3 point tiebreak`,
    };
  }

  const byDec = winnerOf(dec.homePts, dec.awayPts);
  if (!byDec) {
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
    winner: byDec,
    level: 5,
    ...base,
    because: `Decided on the 2-of-3 point tiebreak ${dec.homePts}-${dec.awayPts}`,
  };
}

/** Convenience for the match-night screen: is there anything left to do? */
export function meetingIsComplete(o: MeetingOutcome): o is Extract<MeetingOutcome, { state: 'decided' }> {
  return o.state === 'decided';
}

/** The lines a division's format calls for, in the order they're played. */
export function linesForFormat(format: LineFormat): Array<{
  lineType: LineType;
  lineKind: LineKind;
  isDecider: boolean;
}> {
  if (format === 'gendered_four') {
    return [
      { lineType: 'singles', lineKind: 'mens_singles', isDecider: false },
      { lineType: 'singles', lineKind: 'womens_singles', isDecider: false },
      { lineType: 'doubles', lineKind: 'mens_doubles', isDecider: false },
      { lineType: 'doubles', lineKind: 'womens_doubles', isDecider: false },
      // Created up front but only played, and only counted, on a 2-2.
      { lineType: 'doubles', lineKind: 'mixed_doubles', isDecider: true },
    ];
  }
  return [
    { lineType: 'singles', lineKind: 'open', isDecider: false },
    { lineType: 'doubles', lineKind: 'open', isDecider: false },
  ];
}

/** Courts a division needs for one night, given its format. */
export function courtsForFormat(format: LineFormat): number {
  // Two meetings run at once in a four-team round robin, so it is lines x 2.
  // The decider reuses a court that has just finished.
  return format === 'gendered_four' ? 8 : 4;
}
