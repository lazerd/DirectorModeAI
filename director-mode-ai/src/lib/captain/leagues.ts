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
  },
  {
    // USTA Junior Team Tennis. The division IS the level — a 12U Yellow Ball
    // player has no NTRP rating, so the roster leans on WTN and the captain's
    // own strength order instead. Two singles and two doubles is the standard
    // JTT team match; local sections vary, so it is only a default.
    value: 'jtt',
    label: 'Junior Team Tennis (USTA JTT)',
    short: 'Junior Team Tennis',
    levelLabel: 'Division',
    levelPlaceholder: '12U Yellow Ball',
    singlesCourts: 2,
    doublesCourts: 2,
    usesNtrp: false,
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
