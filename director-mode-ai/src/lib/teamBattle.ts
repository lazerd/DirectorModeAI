/**
 * Team Battle weekly-series helpers (Summer Slam style).
 *
 * A "series" is just team-battle events cloned week to week: the roster
 * (event_players) carries over with active=false until checked in, and
 * strength_order carries over as a global 1..N ranking used by the snake split.
 */

/**
 * Snake-split an ordered list (strongest first) into two balanced teams.
 * Deal pattern A,B,B,A repeating — so the #1 and #4 seeds pair with #5, #8...
 * while #2, #3 pair with #6, #7. With an odd count the extra (weakest end)
 * lands on team B, opposite the #1 seed.
 */
export function snakeSplit<T>(ordered: T[]): { a: T[]; b: T[] } {
  const a: T[] = [];
  const b: T[] = [];
  ordered.forEach((item, i) => {
    const slot = i % 4;
    if (slot === 0 || slot === 3) a.push(item);
    else b.push(item);
  });
  return { a, b };
}

/**
 * Renumber a roster into a clean global strength order 1..N, preserving the
 * given relative order. Use after merging per-team orderings (post-split
 * drags renumber within a team, so values collide across teams).
 */
export function globalStrengthOrder<T extends { strength_order: number | null }>(
  players: T[]
): Array<{ player: T; order: number }> {
  return [...players]
    .sort((p, q) => (p.strength_order ?? 9999) - (q.strength_order ?? 9999))
    .map((player, i) => ({ player, order: i + 1 }));
}

/** Next week's event code: SLAM + day-of-month (e.g. SLAM18), fits 6 chars. */
export function nextWeekCode(prefix: string, nextDate: Date): string {
  const day = String(nextDate.getDate()).padStart(2, '0');
  return `${prefix}${day}`.slice(0, 6).toUpperCase();
}

/** ISO date string exactly 7 days after the given ISO date. */
export function plusSevenDays(isoDate: string): string {
  const d = new Date(isoDate + 'T12:00:00');
  d.setDate(d.getDate() + 7);
  return d.toISOString().slice(0, 10);
}
