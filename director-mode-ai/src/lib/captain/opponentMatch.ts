/**
 * Finding the saved contact for the club a fixture names.
 *
 * The two sides spell the same club differently, and always have:
 *
 *   captain_matches.opponent      "Orinda Country Club - 10U Green"
 *   captain_opponents.opponent    "Orinda Country Club"   (+ division: "10U Green Ball")
 *
 * The fixture carries the division inside the string; the directory keeps it in
 * its own column. An exact-match lookup therefore finds nothing for any JTT
 * team, and the captain is asked to retype a contact that is already saved.
 * Adult leagues never showed this because their fixture strings and directory
 * rows happen to be written the same way.
 *
 * Matching is deliberately conservative — the result addresses an email to
 * another club, so a wrong guess is worse than no guess. Only three things
 * count as a match, in order, and anything ambiguous is refused.
 */

/** Everything before the final " - …" — the club, without the division. */
export function clubPartOf(fixtureOpponent: string): string {
  return fixtureOpponent.replace(/\s+-\s+[^-]*$/, '').trim();
}

/**
 * Case, punctuation and spacing all vary between the league site and whatever
 * was typed by hand. "&" and "and" are the same word to a human, so they are
 * here too. What survives is letters and digits.
 */
export function normalizeClub(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '');
}

/**
 * The directory row for a fixture, or null.
 *
 * 1. The whole fixture string, exactly — how adult leagues are stored, and the
 *    behaviour that existed before this file.
 * 2. The club part, exactly.
 * 3. The club part, normalized — but only when exactly one row matches. Two
 *    rows that both normalize the same way is a directory that needs fixing by
 *    hand, not a coin toss over who gets emailed.
 */
export function pickOpponentRow<T extends { opponent: string | null }>(
  fixtureOpponent: string | null | undefined,
  rows: T[],
): T | null {
  const fixture = (fixtureOpponent || '').trim();
  if (!fixture || rows.length === 0) return null;

  const exact = rows.find((r) => (r.opponent || '').trim() === fixture);
  if (exact) return exact;

  const club = clubPartOf(fixture);
  if (!club) return null;

  const byClub = rows.find((r) => (r.opponent || '').trim() === club);
  if (byClub) return byClub;

  const target = normalizeClub(club);
  if (!target) return null;
  const loose = rows.filter((r) => normalizeClub((r.opponent || '').trim()) === target);
  return loose.length === 1 ? loose[0] : null;
}
