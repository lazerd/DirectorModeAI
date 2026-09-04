/**
 * The leagues CaptainMode knows about, in one place.
 *
 * The new-team form, the teams list and the default court count for a new
 * match all used to carry their own copy of this list, so adding a league meant
 * finding three files and a hardcoded `?? 2` / `?? 3`. Everything reads from
 * here now.
 *
 * Safe on the client — no server imports.
 */

export type LeagueType =
  | 'usta_adult'
  | 'usta_combo'
  | 'usta_mixed'
  | 'usta_trilevel'
  | 'jtt'
  | 'flex';

/**
 * How many lines one player may take in a SINGLE team match.
 *
 * Null for every adult league, where a player plays one line and the whole
 * lineup is a set of distinct people. Junior Team Tennis is the exception that
 * forces this to exist: a JTT team match is 4 singles and 4 doubles played over
 * three rounds, and a child may play one singles and two doubles — so the same
 * name legitimately appears on the sheet three times.
 */
export type MultiLineRules = {
  /** All the singles run at once, so nobody plays two of them. */
  maxSingles: number;
  /** The doubles run over this many rounds, one line per player per round. */
  maxDoubles: number;
  /** maxSingles + maxDoubles, stated rather than derived so it reads plainly. */
  maxTotal: number;
  /**
   * Fewest players who can take the court at all. A LEAGUE RULE, not
   * arithmetic — three children can play a JTT match and default the lines
   * they cannot cover, two children cannot play it at all. Deriving this from
   * the slot count would get it wrong in both directions.
   */
  minToPlay: number;
};

export type LeagueSpec = {
  value: LeagueType;
  /** Full label, for the picker. */
  label: string;
  /** Short label, for the team card. */
  short: string;
  /** What the "Level" field means in this league. */
  levelLabel: string;
  levelPlaceholder: string;
  /** Lines a team match is played over. Every match can override them. */
  singlesCourts: number;
  doublesCourts: number;
  /** Juniors are rated by ball colour and WTN, not NTRP. */
  usesNtrp: boolean;
  /** Null = one line per player, the normal case. */
  multiLine: MultiLineRules | null;
};

export const LEAGUES: LeagueSpec[] = [
  {
    value: 'usta_adult',
    label: 'USTA Adult (18+ / 40+ / 55+)',
    short: 'USTA Adult',
    levelLabel: 'Level',
    levelPlaceholder: '3.5',
    singlesCourts: 2,
    doublesCourts: 3,
    usesNtrp: true,
    multiLine: null,
  },
  {
    value: 'usta_combo',
    label: 'USTA Combo',
    short: 'USTA Combo',
    levelLabel: 'Level',
    levelPlaceholder: '7.5',
    singlesCourts: 0,
    doublesCourts: 3,
    usesNtrp: true,
    multiLine: null,
  },
  {
    value: 'usta_mixed',
    label: 'USTA Mixed',
    short: 'USTA Mixed',
    levelLabel: 'Level',
    levelPlaceholder: '8.5',
    singlesCourts: 0,
    doublesCourts: 3,
    usesNtrp: true,
    multiLine: null,
  },
  {
    value: 'usta_trilevel',
    label: 'Tri-Level',
    short: 'Tri-Level',
    levelLabel: 'Level',
    levelPlaceholder: '3.5',
    singlesCourts: 0,
    doublesCourts: 3,
    usesNtrp: true,
    multiLine: null,
  },
  {
    /*
     * USTA Junior Team Tennis. The division IS the level — a 12U Yellow Ball
     * player has no NTRP rating, so the roster leans on WTN and the captain's
     * own strength order instead.
     *
     * The scorecard is 4 singles and 4 doubles, each a short set to 4 games,
     * won on total games — 8 lines and TWELVE player slots, which is why JTT
     * cannot be a lineup of twelve distinct children. It runs as three rounds:
     * all four singles at once, then two doubles, then two more. A child may
     * take one singles and two doubles.
     *
     * That arithmetic sets the roster window: four children can fill the sheet
     * (three lines each) and six is the most that still gives everybody two.
     * Past six, somebody drives to the match to play a single short set.
     */
    value: 'jtt',
    label: 'Junior Team Tennis (USTA JTT)',
    short: 'Junior Team Tennis',
    levelLabel: 'Division',
    levelPlaceholder: '12U Yellow Ball',
    singlesCourts: 4,
    doublesCourts: 4,
    usesNtrp: false,
    multiLine: { maxSingles: 1, maxDoubles: 2, maxTotal: 3, minToPlay: 3 },
  },
  {
    value: 'flex',
    label: 'Flex / local league',
    short: 'Flex / local',
    levelLabel: 'Level',
    levelPlaceholder: '3.5',
    singlesCourts: 2,
    doublesCourts: 3,
    usesNtrp: true,
    multiLine: null,
  },
];

const BY_VALUE = new Map(LEAGUES.map((l) => [l.value, l]));

/** Falls back to flex so an unknown value in the column can never throw. */
export function leagueSpec(leagueType: string | null | undefined): LeagueSpec {
  return BY_VALUE.get((leagueType || '') as LeagueType) ?? BY_VALUE.get('flex')!;
}

export function leagueLabel(leagueType: string | null | undefined): string {
  return BY_VALUE.get((leagueType || '') as LeagueType)?.short || leagueType || '—';
}

/**
 * Court counts a new match starts with, before the captain edits them.
 *
 * The team's own numbers win when it has them — a captain who plays a
 * non-standard format sets it once in team settings. The league spec is only
 * the seed, for a team that has never said.
 */
export function defaultCourts(team: {
  league_type?: string | null;
  default_singles_courts?: number | null;
  default_doubles_courts?: number | null;
}): { singles: number; doubles: number } {
  const spec = leagueSpec(team.league_type);
  return {
    singles: team.default_singles_courts ?? spec.singlesCourts,
    doubles: team.default_doubles_courts ?? spec.doublesCourts,
  };
}

/** Juniors are not NTRP-rated; combo/mixed caps are meaningless for them. */
export function usesNtrp(leagueType: string | null | undefined): boolean {
  return leagueSpec(leagueType).usesNtrp;
}


/**
 * The roster-size window a sheet of this shape implies.
 *
 * Three numbers a captain cares about and one they don't:
 *   minToPlay  — below this the match cannot be played at all (league rule).
 *   fillsSheet — below this it IS played, with the uncoverable lines defaulted.
 *   idealMax   — above this somebody drives to the match for one short set.
 *
 * Functions rather than constants because the captain can change the lines per
 * match, and the window has to move with them.
 */
export function rosterWindow(
  courts: { singles: number; doubles: number },
  rules: MultiLineRules | null,
) {
  const slots = courts.singles + courts.doubles * 2;
  const maxTotal = rules?.maxTotal ?? 1;
  return {
    slots,
    maxTotal,
    minToPlay: rules?.minToPlay ?? 1,
    /** Fewest who can cover every line. */
    fillsSheet: Math.max(1, Math.ceil(slots / maxTotal)),
    /** Most who can all still play at least twice. */
    idealMax: maxTotal > 1 ? Math.floor(slots / 2) : slots,
  };
}

/**
 * How the lines fall out for a given turnout — the sentence a captain actually
 * wants: "6 available, everyone plays 2" or "3 available, 3 lines defaulted".
 */
export function linesPerPlayer(
  available: number,
  courts: { singles: number; doubles: number },
  rules: MultiLineRules | null,
) {
  const w = rosterWindow(courts, rules);
  const lines = courts.singles + courts.doubles;
  if (available <= 0) {
    return { ...w, each: 0, some: 0, defaulted: lines, lines, canPlay: false };
  }

  // Every singles line runs at once and nobody plays two, so one player covers
  // exactly one of them.
  const singlesLines = Math.min(courts.singles, available);
  // A doubles line needs two of ours. The doubles run in rounds, and within a
  // round a player is on one line only — so a round can seat floor(n/2) lines,
  // and there are maxDoubles rounds.
  const doublesLines = Math.min(
    courts.doubles,
    Math.floor(available / 2) * (rules?.maxDoubles ?? 1),
  );
  const coverable = singlesLines + doublesLines * 2;

  const each = Math.min(w.maxTotal, Math.floor(coverable / available));
  return {
    ...w,
    lines,
    /** Everybody plays at least this many lines. */
    each,
    /** …and, when it does not divide evenly, some play one more. */
    some: coverable % available === 0 ? each : Math.min(w.maxTotal, each + 1),
    /**
     * LINES nobody can cover, not slots — this is the number the captain
     * concedes on the scorecard, so it has to count the way the scorecard does.
     */
    defaulted: Math.max(0, lines - singlesLines - doublesLines),
    canPlay: available >= w.minToPlay,
  };
}
