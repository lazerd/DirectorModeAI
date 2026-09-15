/**
 * Is this path one of a CLUB's public pages rather than ClubMode's own?
 *
 * `/c/[slug]` was hidden from the director rail, Happening now and Ask ClubMode,
 * but the club site links straight out to `/courtsheet/[slug]` and
 * `/calendar/[slug]` — and those were not. A signed-in director clicking
 * "Court sheet" on Lafayette's site got Lafayette's page wrapped in Sleepy
 * Hollow's rail, Sleepy Hollow's events and our assistant, which reads as the
 * app showing the wrong club.
 *
 * The same two prefixes also hold the director's own tools (`/courtsheet/staff`,
 * `/calendar/board`...), so a bare prefix match would strip their nav. Those
 * static segments are named here; anything else under the prefix is a slug.
 */
const CLUB_SLUG_ROUTES: Record<string, string[]> = {
  '/courtsheet': ['staff'],
  '/calendar': ['board', 'ideas', 'import'],
};

export function isClubPublicPath(pathname: string): boolean {
  if (pathname === '/c' || pathname.startsWith('/c/')) return true;
  for (const [prefix, ownRoutes] of Object.entries(CLUB_SLUG_ROUTES)) {
    if (!pathname.startsWith(prefix + '/')) continue;
    const segment = pathname.slice(prefix.length + 1).split('/')[0];
    return segment !== '' && !ownRoutes.includes(segment);
  }
  return false;
}
