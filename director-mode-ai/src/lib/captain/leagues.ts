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

/**
 * How many courts a JTT match is played on at once — and so how its lines fall
 * into rounds. The HOST decides (it is how many courts they have), so it is set
 * per match and seeded from the team.
 */
export const JTT_COURT_FORMATS = [2, 3] as const;
export const DEFAULT_JTT_COURT_FORMAT = 3;

/** One round: the lines played at the same time, numbered within their type (1-based). */
export type JttRound = { singles: number[]; doubles: number[] };

/**
 * Which lines are played at the same time.
 *
 * Each round fills the courts with one doubles line and singles on the rest,
 * while singles remain; the leftover doubles then go out a court-load at a time:
 *
 *   2 courts   S1+D1 | S2+D2 | S3+D3 | S4+D4
 *   3 courts   S1+S2+D1 | S3+S4+D2 | D3+D4
 *
 * A child can never be on two lines of the same round — they are on court at
 * the same moment. That is a hard constraint, not a preference.
 */
export function jttRoundPlan(
  courtFormat: number | null | undefined,
  singles: number,
  doubles: number,
): JttRound[] {
  // One court cannot hold a singles AND a doubles at once; two is the floor.
  const courts = Math.max(2, Math.floor(Number(courtFormat)) || DEFAULT_JTT_COURT_FORMAT);
  const plan: JttRound[] = [];
  let s = 1;
  let d = 1;
  while (s <= singles || d <= doubles) {
    const round: JttRound = { singles: [], doubles: [] };
    if (s <= singles) {
      const takeD = d <= doubles ? 1 : 0;
      const takeS = Math.min(courts - takeD, singles - s + 1);
      for (let i = 0; i < takeS; i++) round.singles.push(s++);
      if (takeD) round.doubles.push(d++);
    } else {
      const takeD = Math.min(courts, doubles - d + 1);
      for (let i = 0; i < takeD; i++) round.doubles.push(d++);
    }
    plan.push(round);
  }
  return plan;
}

type SheetLine = { courtNumber: number; courtType: 'singles' | 'doubles' };

/**
 * The round (1-based) of every line on a sheet, keyed by court number.
 *
 * Lines are ranked within their type by court number, so the ↑↓ flips on the
 * match page — which move people, never court numbers — can't change a line's
 * round, and a saved sheet reads back with the same rounds it was built with.
 */
export function roundsByCourt(
  courts: SheetLine[],
  courtFormat: number | null | undefined,
): Map<number, number> {
  const byNum = (a: SheetLine, b: SheetLine) => a.courtNumber - b.courtNumber;
  const s = courts.filter((c) => c.courtType === 'singles').sort(byNum);
  const d = courts.filter((c) => c.courtType === 'doubles').sort(byNum);
  const out = new Map<number, number>();
  jttRoundPlan(courtFormat, s.length, d.length).forEach((r, i) => {
    for (const n of r.singles) if (s[n - 1]) out.set(s[n - 1].courtNumber, i + 1);
    for (const n of r.doubles) if (d[n - 1]) out.set(d[n - 1].courtNumber, i + 1);
  });
  return out;
}

/** Everyone booked onto two lines that are played at the same time. */
export function roundClashes(
  courts: (SheetLine & { player1Id: string | null; player2Id: string | null })[],
  courtFormat: number | null | undefined,
): { round: number; playerId: string; courtNumbers: number[] }[] {
  const rounds = roundsByCourt(courts, courtFormat);
  const seen = new Map<string, { round: number; playerId: string; courtNumbers: number[] }>();
  for (const c of courts) {
    const round = rounds.get(c.courtNumber);
    if (!round) continue;
    for (const pid of [c.player1Id, c.player2Id]) {
      if (!pid) continue;
      const k = `${round}|${pid}`;
      const hit = seen.get(k) ?? { round, playerId: pid, courtNumbers: [] };
      hit.courtNumbers.push(c.courtNumber);
      seen.set(k, hit);
    }
  }
  return [...seen.values()].filter((h) => h.courtNumbers.length > 1);
}

/**
 * JTT at HOME: one extra court beside the match courts for an exhibition, so
 * nobody who came stands and watches (Darrin, 12U, 2026-09-20).
 *
 * An away match brings at most 6 — past that somebody drives there for a
 * single short set. At home the drive is not the problem, waiting is, and the
 * 4th court solves it: every round, whoever is not on a scored line plays an
 * exhibition on it. It holds a doubles, so home brings as many as fill the
 * match courts in the quietest round plus four — 8 in the 3-court format
 * (every round seats 4 on the match courts), 7 in the 2-court (3 per round).
 */
export const EXHIBITION_SEATS = 4;

export function homeSquadMax(
  courtFormat: number | null | undefined,
  singles: number,
  doubles: number,
): number {
  const plan = jttRoundPlan(courtFormat, singles, doubles);
  if (!plan.length) return EXHIBITION_SEATS;
  const perRound = Math.min(...plan.map((r) => r.singles.length + r.doubles.length * 2));
  return perRound + EXHIBITION_SEATS;
}

/**
 * Who is on the exhibition court in each round: every child on the sheet who
 * is not on a scored line that round. Worked out from the sheet, never stored,
 * so a swap on the match page moves the exhibition with it and a saved sheet
 * reads back the same. Names in sheet order (lowest court first).
 */
export function exhibitionByRound(
  courts: (SheetLine & { player1Id: string | null; player2Id: string | null })[],
  courtFormat: number | null | undefined,
): { round: number; playerIds: string[] }[] {
  const rounds = roundsByCourt(courts, courtFormat);
  const sorted = [...courts].sort((a, b) => a.courtNumber - b.courtNumber);
  const squad: string[] = [];
  for (const c of sorted) {
    for (const id of [c.player1Id, c.player2Id]) if (id && !squad.includes(id)) squad.push(id);
  }
  const roundNums = [...new Set(rounds.values())].sort((a, b) => a - b);
  return roundNums
    .map((round) => {
      const on = new Set<string>();
      for (const c of courts) {
        if (rounds.get(c.courtNumber) !== round) continue;
        if (c.player1Id) on.add(c.player1Id);
        if (c.player2Id) on.add(c.player2Id);
      }
      return { round, playerIds: squad.filter((id) => !on.has(id)) };
    })
    .filter((r) => r.playerIds.length > 0);
}

/** An exhibition-court row, in the shape the email, printout and group text all take. */
export type ExhibitionRow = {
  courtNumber: number;
  courtType: 'exhibition';
  names: string[];
  round: number;
};

export const EXHIBITION_LABEL = 'Exhibition court';

/** One row per round for whoever is on the exhibition court. Callers gate on home. */
export function exhibitionRows(
  courts: (SheetLine & { player1Id: string | null; player2Id: string | null })[],
  courtFormat: number | null | undefined,
  nameOf: (id: string) => string,
): ExhibitionRow[] {
  return exhibitionByRound(courts, courtFormat).map((r) => ({
    courtNumber: 0,
    courtType: 'exhibition',
    names: r.playerIds.map(nameOf),
    round: r.round,
  }));
}

/** "Round 1: Singles 1, Singles 2, Doubles 5 · Round 2: …" — numbered the way the sheet shows them. */
export function roundPlanText(plan: JttRound[], singlesCount: number): string {
  return plan
    .map(
      (r, i) =>
        `Round ${i + 1}: ${[
          ...r.singles.map((n) => `Singles ${n}`),
          ...r.doubles.map((n) => `Doubles ${n}`),
        ].join(', ')}`,
    )
    .join(' · ');
}

/** Most lines of one type a match can be played over. */
export const MAX_COURTS_PER_TYPE = 8;

export const COURT_COUNT_ERROR = `Lines per match must be a whole number between 0 and ${MAX_COURTS_PER_TYPE}.`;

/**
 * Is this a line count the DB will accept?
 *
 * 0 is legitimate on either side — a combo or mixed team plays no singles at
 * all — so this is a range check, never a truthiness check. Shared by the
 * create and the settings routes so the team-creation form cannot write a
 * number the settings page would refuse.
 */
export function isValidCourtCount(v: unknown): boolean {
  // Number(null) and Number('') are both 0, so a bare Number() check would
  // wave a missing value through as "no lines of this type" — the one wrong
  // answer that looks exactly like the right one here.
  if (typeof v !== 'number' && typeof v !== 'string') return false;
  if (typeof v === 'string' && v.trim() === '') return false;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= MAX_COURTS_PER_TYPE;
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

/**
 * JTT: who is first in line for singles at the NEXT match — the children with
 * the fewest singles once this sheet is counted. Printed in the lineup email so
 * a family whose child plays doubles only this week sees they are up next.
 *
 * Empty when everyone is level (nobody is "owed" anything) or nobody has had
 * singles yet. `before` is singles on earlier matches (singlesCounts).
 */
export function singlesFirstInLine(
  roster: { id: string; name: string }[],
  before: Record<string, number>,
  sheet: { courtType: string; player1Id: string | null }[],
): string[] {
  if (!roster.length) return [];
  const now = new Set(sheet.filter((c) => c.courtType === 'singles').map((c) => c.player1Id).filter(Boolean));
  const total = roster.map((p) => ({ name: p.name, n: (before[p.id] ?? 0) + (now.has(p.id) ? 1 : 0) }));
  const min = Math.min(...total.map((t) => t.n));
  const max = Math.max(...total.map((t) => t.n));
  if (max === min) return [];
  return total.filter((t) => t.n === min).map((t) => t.name);
}

/**
 * What a line is CALLED: Singles 1–4 and Doubles 1–4, never "Doubles 5".
 *
 * Court numbers are one sequence across the sheet (singles first, then
 * doubles), which is fine as a key but wrong as a name: Darrin, 2026-09-18,
 * "singles 1-4 and doubles 1-4 NOT doubles 5-8". Every place that prints a
 * line goes through one of these two.
 *
 * lineNames — when the whole sheet is at hand: numbered by place within type.
 * lineName  — when only one row is (a player's own line): its court number
 *             minus the singles lines ahead of it.
 */
export function lineNames(courts: { courtNumber: number; courtType: string }[]): Map<number, string> {
  const out = new Map<number, string>();
  for (const type of ['singles', 'doubles'] as const) {
    courts
      .filter((c) => c.courtType === type)
      .sort((a, b) => a.courtNumber - b.courtNumber)
      .forEach((c, i) => out.set(c.courtNumber, `${type === 'singles' ? 'Singles' : 'Doubles'} ${i + 1}`));
  }
  return out;
}

export function lineName(courtType: string, courtNumber: number, singlesCount: number | null | undefined): string {
  if (courtType === 'singles') return `Singles ${courtNumber}`;
  const s = singlesCount ?? 0;
  return `Doubles ${courtNumber > s ? courtNumber - s : courtNumber}`;
}

/**
 * Where a league's scores are actually posted.
 *
 * USTA leagues — including Junior Team Tennis — are scored on TennisLink. The
 * flex leagues we play (Fall League, EBWT) are on TopDog. The match page used
 * to offer "Post the scores to TopDog" to everyone, which is simply the wrong
 * site for a JTT coach.
 */
export function scoreSiteFor(leagueType: string | null | undefined): 'topdog' | 'usta' {
  return (leagueType || '').startsWith('usta') || leagueType === 'jtt' ? 'usta' : 'topdog';
}

