/**
 * eventCategory — the single source of truth that sorts an `events` row into one
 * of the three top-level pathways the app is organized around:
 *
 *   • MixerMode      — casual socials the director sets up day-of (no bracket)
 *   • TournamentMode — public-signup bracket/draw events with a declared winner
 *   • LeagueMode     — multi-week leagues (the `leagues` table) + the adult Flex
 *                      league, whose divisions live in `events` but are surfaced
 *                      through /flex, NOT the mixer/tournament lists.
 *
 * Mixers, tournaments, and quads all INSERT into the same `events` table
 * (see mixer/events/new, mixer/tournaments/new, mixer/quads/new). They are told
 * apart purely by `match_format`:
 *   - mixers use bare values      → 'singles', 'doubles', 'team-battle', …
 *   - tournaments use hyphenated  → 'single-elim-singles', 'compass-doubles', …
 *   - quads use                   → 'quads' (a 4-player draw)
 * There is no string collision between the two families, so `match_format` is a
 * reliable discriminator. Keep these sets in sync with the picker arrays in
 * src/app/mixer/select-format/page.tsx.
 */

export const TOURNAMENT_FORMATS = new Set<string>([
  'single-elim-singles', 'single-elim-doubles',
  'fmlc-singles', 'fmlc-doubles',
  'ffic-singles', 'ffic-doubles',
  'rr-singles', 'rr-doubles',
  'compass-singles', 'compass-doubles',
  'quads',
  'single-elimination', // legacy value from early tournament events
]);

export const MIXER_FORMATS = new Set<string>([
  'singles', 'doubles', 'mixed-doubles',
  'king-of-court', 'round-robin', 'maximize-courts', 'team-battle',
]);

export type EventLite = {
  match_format?: string | null;
  slug?: string | null;
};

/**
 * Flex-league division events (e.g. slug `mens-singles-flex-2026`) are stored as
 * tournament-format `events` rows but belong to the adult Flex LEAGUE — they are
 * shown in LeagueMode via /flex, never in the MixerMode or TournamentMode lists.
 */
export function isFlexEvent(e: EventLite): boolean {
  return !!e.slug && /-flex-\d{4}$/.test(e.slug);
}

/** A public-signup bracket/draw event → TournamentMode (Flex divisions excluded). */
export function isTournamentEvent(e: EventLite): boolean {
  if (isFlexEvent(e)) return false;
  return !!e.match_format && TOURNAMENT_FORMATS.has(e.match_format);
}

/** A casual social/mixer → MixerMode. The catch-all for non-tournament, non-Flex events. */
export function isMixerEvent(e: EventLite): boolean {
  return !isFlexEvent(e) && !isTournamentEvent(e);
}
