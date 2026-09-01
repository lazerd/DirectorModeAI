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
 * The team result from the courts.
 *
 * Defaulted courts count — they carry a point for the team even though nobody
 * played them, which is exactly how the league scores them. Courts with no
 * win/loss recorded yet are ignored rather than counted as losses.
 */
export function tallyCourts(courts: RecapCourt[]): {
  won: number;
  lost: number;
  outcome: RecapOutcome;
  scoreline: string;
} {
  const won = courts.filter((c) => c.won === true).length;
  const lost = courts.filter((c) => c.won === false).length;
  return {
    won,
    lost,
    outcome: won > lost ? 'win' : won < lost ? 'loss' : 'tie',
    scoreline: `${won}-${lost}`,
  };
}

export type RecapVars = {
  team: string;
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
      'Everyone who stepped on court did their part today — the ones who closed it out and the ones who made {opponent} earn every point.',
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
  matches: { matchId: string; courts: { won: boolean | null }[] }[],
): { wins: number; losses: number; ties: number; label: string } {
  let wins = 0;
  let losses = 0;
  let ties = 0;
  for (const m of matches) {
    const won = m.courts.filter((c) => c.won === true).length;
    const lost = m.courts.filter((c) => c.won === false).length;
    // A played match with nothing recorded is not a tie — it is unscored.
    if (!won && !lost) continue;
    if (won > lost) wins++;
    else if (won < lost) losses++;
    else ties++;
  }
  return {
    wins,
    losses,
    ties,
    label: ties ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`,
  };
}
