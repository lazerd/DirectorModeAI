/**
 * Match recap — the one CaptainMode email that goes out AFTER a match.
 *
 * Everything in this file is pure so the tone, the scoreline and the season
 * record can be tested without a database or a mail transport. The HTML lives
 * in ./emails next to every other builder.
 *
 * Two default voices, because a single tone cannot carry both results. The win
 * template celebrates; the loss template picks the team back up. Captains edit
 * either one and it sticks for the rest of the season — the whole point is that
 * a recap costs one tap in the twenty minutes after a match, which is the only
 * window in which anyone actually sends one.
 */

export type RecapOutcome = 'win' | 'loss' | 'tie';

export const RECAP_OUTCOMES: RecapOutcome[] = ['win', 'loss', 'tie'];

export type RecapCourt = {
  courtNumber: number;
  courtType: 'singles' | 'doubles';
  names: string[];
  /** Player ids on the court, so the reader's own line can be highlighted. */
  playerIds: string[];
  score: string | null;
  won: boolean | null;
  defaulted: boolean;
};

/**
 * How a team match is decided — a TEAM setting (captain_teams.match_scoring).
 *
 *   courts  most courts won takes the match (USTA).
 *   topdog  points per court, the way TopDog / EBWT score it: straight-set win
 *           3, 3-set win 2, 3-set loss 1, straight-set loss 0; a default 3-0.
 *
 * Fall B2/B3 split Orinda 2-2 on courts on 2026-09-10 and won 8-4 on points —
 * the recap called it a tie, and there was no way to send the win.
 */
export type MatchScoring = 'courts' | 'topdog';

type ScoredCourt = { won: boolean | null; score?: string | null; defaulted?: boolean | null };

/**
 * Sets each side won, read off a score written from OUR side — "6-4, 4-6, 0-1",
 * "6-4, 5-6 RET", "7-6(5), 6-3". A match tiebreak counts as a set; an
 * unfinished set at a retirement goes to whoever was ahead in it.
 */
export function setsFromScore(score: string | null | undefined): { ours: number; theirs: number } {
  let ours = 0;
  let theirs = 0;
  for (const m of (score || '').matchAll(/(\d+)\s*-\s*(\d+)/g)) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a > b) ours++;
    else if (b > a) theirs++;
  }
  return { ours, theirs };
}

/** TopDog points for one court, or null while it has no result. */
export function topdogPoints(c: ScoredCourt): { ours: number; theirs: number } | null {
  if (c.won == null) return null;
  if (c.defaulted) return c.won ? { ours: 3, theirs: 0 } : { ours: 0, theirs: 3 };
  const sets = setsFromScore(c.score);
  // The loser taking a set is what costs the winner a point and earns the loser one.
  const loserTookASet = (c.won ? sets.theirs : sets.ours) > 0;
  const winner = loserTookASet ? 2 : 3;
  const loser = loserTookASet ? 1 : 0;
  return c.won ? { ours: winner, theirs: loser } : { ours: loser, theirs: winner };
}

/**
 * The team result from the courts.
 *
 * Defaulted courts count — they carry a point for the team even though nobody
 * played them, which is exactly how the league scores them. Courts with no
 * win/loss recorded yet are ignored rather than counted as losses.
 *
 * Under `topdog` the outcome and scoreline come from points; `won`/`lost`
 * still report courts, so the captain can see both.
 */
export function tallyCourts(
  courts: ScoredCourt[],
  scoring: MatchScoring = 'courts',
): {
  won: number;
  lost: number;
  /** TopDog points for / against; null when the team scores by courts. */
  points: { ours: number; theirs: number } | null;
  outcome: RecapOutcome;
  scoreline: string;
} {
  const won = courts.filter((c) => c.won === true).length;
  const lost = courts.filter((c) => c.won === false).length;
  if (scoring === 'topdog') {
    let ours = 0;
    let theirs = 0;
    for (const c of courts) {
      const p = topdogPoints(c);
      if (p) {
        ours += p.ours;
        theirs += p.theirs;
      }
    }
    return {
      won,
      lost,
      points: { ours, theirs },
      outcome: ours > theirs ? 'win' : ours < theirs ? 'loss' : 'tie',
      scoreline: `${ours}-${theirs}`,
    };
  }
  return {
    won,
    lost,
    points: null,
    outcome: won > lost ? 'win' : won < lost ? 'loss' : 'tie',
    scoreline: `${won}-${lost}`,
  };
}

/**
 * A recap is chattier than the scheduled emails, so {name} is the reader's
 * FIRST name — "Rest up, Robyn" is what a captain writes; "Rest up, Robyn
 * Rogin" is what a mail-merge writes.
 */
export function firstName(full: string): string {
  return full.trim().split(/\s+/)[0] || full.trim();
}

export type RecapVars = {
  team: string;
  /** The reader's first name. See firstName(). */
  name: string;
  opponent: string;
  when: string;
  home_away: string;
  /** Court tally for this match, e.g. "4-1". */
  score: string;
  /** "win" | "loss" | "tie" — for captains who want one template to bend. */
  result: RecapOutcome;
  /** Season match record so far, e.g. "3-1". Empty when nothing is played. */
  record: string;
};

const VAR_KEYS = [
  'team',
  'name',
  'opponent',
  'when',
  'home_away',
  'score',
  'result',
  'record',
] as const;

/** The variables a captain may drop into a recap subject or body. */
export const RECAP_VAR_KEYS: readonly string[] = VAR_KEYS;

/** Fills {team}, {name}, {score}, … — anything else is left exactly as typed. */
export function renderRecap(tpl: string, vars: RecapVars): string {
  return tpl.replace(
    /\{(team|name|opponent|when|home_away|score|result|record)\}/g,
    (_, k) => String(vars[k as keyof RecapVars] ?? ''),
  );
}

export type RecapTemplate = { subject: string; body: string };

/**
 * The default wording, per outcome.
 *
 * Written to be sendable as-is on the first match of the season — a captain who
 * never opens the template editor still sends something that sounds like a
 * person wrote it, which is the bar an automated recap has to clear.
 */
export const DEFAULT_RECAP: Record<RecapOutcome, RecapTemplate> = {
  win: {
    subject: '🎾 {team} takes it {score} over {opponent}!',
    body: [
      'What a day, team! 🎉',
      'Some really good tennis out there today, top to bottom of the card.',
      "Full scoreboard below. Enjoy this one, and let's keep it rolling. 💪",
    ].join('\n\n'),
  },
  loss: {
    subject: '{team} vs {opponent} — {score}',
    body: [
      "It's all good, team.",
      '{opponent} got the better of us today, but there was a lot to like out there — some tight courts, and nobody stopped competing.',
      "Scoreboard below. Shake it off, we'll get 'em next time. 🎾",
    ].join('\n\n'),
  },
  tie: {
    subject: '{team} and {opponent} split it {score}',
    body: [
      'Dead even, team.',
      'We split it with {opponent} — nobody gave an inch out there.',
      'Scoreboard below. Plenty to build on for next time. 🎾',
    ].join('\n\n'),
  },
};

export type TemplateRow = {
  outcome: RecapOutcome;
  subject: string | null;
  body: string | null;
};

/** The captain's saved wording for one outcome, falling back to the default. */
export function templateFor(
  outcome: RecapOutcome,
  rows: TemplateRow[] | null | undefined,
): RecapTemplate & { isDefault: boolean } {
  const row = (rows || []).find((r) => r.outcome === outcome) || null;
  const subject = (row?.subject || '').trim();
  const body = (row?.body || '').trim();
  return {
    subject: subject || DEFAULT_RECAP[outcome].subject,
    body: body || DEFAULT_RECAP[outcome].body,
    isDefault: !subject && !body,
  };
}

/**
 * Season record across played matches, counted the way a league table does:
 * one win or loss per MATCH, from that match's court tally, not per court.
 */
export function seasonRecord(
  matches: { matchId: string; courts: ScoredCourt[] }[],
  scoring: MatchScoring = 'courts',
): { wins: number; losses: number; ties: number; label: string } {
  let wins = 0;
  let losses = 0;
  let ties = 0;
  for (const m of matches) {
    // A played match with nothing recorded is not a tie — it is unscored.
    if (!m.courts.some((c) => c.won === true || c.won === false)) continue;
    // Same rule as the match's own recap, so the record never disagrees with it.
    const { outcome } = tallyCourts(m.courts, scoring);
    if (outcome === 'win') wins++;
    else if (outcome === 'loss') losses++;
    else ties++;
  }
  return {
    wins,
    losses,
    ties,
    label: ties ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`,
  };
}
