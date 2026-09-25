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

/**
 * QR check-in: the phone pages behind a printed court sign (/q/...) and the
 * kiosk board (/checkin/[slug]/board). A player at the fence, or a TV in the
 * clubhouse, has no use for the director rail or our assistant.
 */
const CHECKIN_PREFIXES = ['/q/', '/checkin/'];

/**
 * A prospect's demo tour (/demo/<token>) is dressed in the club's colors and
 * read by someone who has never used ClubMode: no director rail, no
 * "Happening now", no assistant.
 */
const DEMO_PREFIXES = ['/demo/'];

export function isClubPublicPath(pathname: string): boolean {
  if (pathname === '/c' || pathname.startsWith('/c/')) return true;
  if (CHECKIN_PREFIXES.some((p) => pathname.startsWith(p))) return true;
  if (DEMO_PREFIXES.some((p) => pathname.startsWith(p))) return true;
  for (const [prefix, ownRoutes] of Object.entries(CLUB_SLUG_ROUTES)) {
    if (!pathname.startsWith(prefix + '/')) continue;
    const segment = pathname.slice(prefix.length + 1).split('/')[0];
    return segment !== '' && !ownRoutes.includes(segment);
  }
  return false;
}

/**
 * The club slug a `/courtsheet/<slug>` or `/calendar/<slug>` page belongs to,
 * or null. `/c/<slug>` is left out on purpose: the club's website stays bare
 * even for its own members, while the court sheet and calendar are app pages a
 * member reaches from their own nav and needs a way back from.
 */
export function clubSlugFromAppPath(pathname: string): string | null {
  for (const [prefix, ownRoutes] of Object.entries(CLUB_SLUG_ROUTES)) {
    if (!pathname.startsWith(prefix + '/')) continue;
    const segment = pathname.slice(prefix.length + 1).split('/')[0];
    return segment !== '' && !ownRoutes.includes(segment) ? segment : null;
  }
  return null;
}
