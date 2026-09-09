/**
 * Carrying a change of "lines per match" onto matches already scheduled.
 *
 * A match stores its own singles/doubles counts, copied from the team default
 * at the moment it was created. The lineup generator reads only that copy. So
 * a captain who imports the schedule first and fixes the lines afterwards —
 * the ordinary way a season gets set up — keeps generating lineups in the old
 * shape, with nothing on screen to say why. A 4-doubles team asks for four
 * doubles and gets three doubles and two singles, because that is what its
 * matches were stamped with.
 *
 * Rewriting the stamp is the fix, but it cannot be silent and it cannot be
 * total: a match whose lineup is already out to the players is a commitment,
 * not a default. Hence this split — work out what WOULD change, show the
 * captain the number, and only write when they say so.
 */

export type MatchCourts = {
  id: string;
  singles_courts: number;
  doubles_courts: number;
};

/**
 * Which matches a new default would actually reshape.
 *
 * Excludes two kinds that look eligible but are not:
 *   - matches already at the new counts, which would be a no-op write
 *   - matches with a lineup saved against them, whose courts are spoken for
 *
 * `lockedMatchIds` is the second of those, passed in rather than looked up so
 * this stays a pure function over rows the caller already has.
 */
export function matchesNeedingCourtUpdate(
  matches: MatchCourts[],
  lockedMatchIds: Iterable<string>,
  courts: { singles: number; doubles: number },
): string[] {
  const locked = new Set(lockedMatchIds);
  return (matches || [])
    .filter((m) => !locked.has(m.id))
    .filter(
      (m) => m.singles_courts !== courts.singles || m.doubles_courts !== courts.doubles,
    )
    .map((m) => m.id);
}
