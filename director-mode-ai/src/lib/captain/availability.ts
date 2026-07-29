/**
 * Who is actually available for a match.
 *
 * Two sources disagree in practice and the precedence between them matters:
 *
 *   1. captain_availability — the player's answer to THIS match's poll.
 *   2. captain_players.unavailable_days — recurring weekday blackouts from the
 *      pre-season intake ("I can never do Mondays").
 *
 * An explicit answer to a specific match WINS over a standing blackout. A
 * player who opens a Monday-match poll and taps Yes has looked at that date
 * and overridden their own standing rule; silently dropping them would shrink
 * the pool and hide a willing body from the captain. We surface it as a
 * warning instead so the captain can sanity-check it.
 *
 * A blackout with no answer, though, is a real exclusion — and one worth
 * explaining. Before this, a non-responder and a player with a standing
 * conflict looked identical: both just missing. Now the captain sees which is
 * which, and the cron stops emailing someone about a weekday they already said
 * they can never play.
 *
 * Blackouts are resolved against the match's America/Los_Angeles weekday, not
 * UTC — a 7pm Monday match is 02:00 Tuesday UTC, and matching on UTC would
 * blackout the wrong day for every evening match.
 */

/** Weekday codes as the intake form writes them. */
export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
export type DayCode = (typeof DAYS)[number];

export function isDayCode(v: unknown): v is DayCode {
  return typeof v === 'string' && (DAYS as readonly string[]).includes(v);
}

/**
 * The weekday a match falls on in club-local time. `en-US` + `weekday:'short'`
 * yields exactly the codes the intake stores ('Mon'…'Sun').
 */
export function matchWeekday(matchAt: string | Date, timeZone = 'America/Los_Angeles'): DayCode {
  const d = matchAt instanceof Date ? matchAt : new Date(matchAt);
  const label = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone }).format(d);
  return label as DayCode;
}

export type AvailabilityStatus = 'yes' | 'no' | 'maybe';

export type RosterPlayer = {
  id: string;
  name: string;
  unavailable_days?: string[] | null;
};

export type AvailabilityAnswer = {
  player_id: string;
  status: string;
};

export type ResolvedAvailability<T extends RosterPlayer> = {
  /** said yes — hand these to the generator */
  available: T[];
  /** blacked out on this weekday and never answered: excluded, and why */
  blockedByDay: T[];
  /** blacked out but answered yes anyway: playing, but flagged */
  dayOverrides: T[];
  /** no answer, no blackout — these are the ones worth nudging */
  awaiting: T[];
  /** captain-facing lines explaining every exclusion above */
  warnings: string[];
};

/**
 * Resolve a match's availability. Pure — no DB access — so the precedence
 * rules are unit-testable and the lineup route and the cron can't drift apart.
 */
export function resolveAvailability<T extends RosterPlayer>(opts: {
  roster: T[];
  answers: AvailabilityAnswer[];
  matchAt: string | Date;
  timeZone?: string;
}): ResolvedAvailability<T> {
  const day = matchWeekday(opts.matchAt, opts.timeZone);
  const answerOf = new Map<string, string>();
  for (const a of opts.answers) answerOf.set(a.player_id, a.status);

  const available: T[] = [];
  const blockedByDay: T[] = [];
  const dayOverrides: T[] = [];
  const awaiting: T[] = [];

  for (const p of opts.roster) {
    const blocked = (p.unavailable_days || []).includes(day);
    const answer = answerOf.get(p.id);

    if (answer === 'yes') {
      available.push(p);
      if (blocked) dayOverrides.push(p);
      continue;
    }
    // 'no' and 'maybe' are both "not in the lineup" — a maybe is not something
    // to build a court around. They've answered, so they aren't awaiting.
    if (answer === 'no' || answer === 'maybe') continue;

    if (blocked) blockedByDay.push(p);
    else awaiting.push(p);
  }

  const warnings: string[] = [];
  const names = (list: T[]) =>
    list
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((p) => p.name)
      .join(', ');

  if (blockedByDay.length) {
    warnings.push(
      `Left out — ${day} is a standing blackout for ${names(blockedByDay)} (from the pre-season intake, and they haven't answered this poll).`,
    );
  }
  if (dayOverrides.length) {
    warnings.push(
      `${names(dayOverrides)} normally can't play ${day} but said yes to this match — in the lineup, worth a quick check.`,
    );
  }

  return { available, blockedByDay, dayOverrides, awaiting, warnings };
}
