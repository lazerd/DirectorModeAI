/**
 * Embed mode — a club's ClubMode pages shown inside the website it already has.
 *
 * The sale this exists for: a club that keeps Wild Apricot (or Squarespace, or
 * a volunteer's WordPress) for dues and its homepage, and wants its programs,
 * calendar and court sheet to live ON that site rather than behind a link to
 * ours. So `?embed=1` on a club's public page strips our chrome and the club's
 * header — their own site already has a header — and everything else here is
 * what it takes for a page to behave inside somebody else's <iframe>.
 *
 * Pure, shared by middleware (the framing header), the pages, the in-frame
 * runtime and the tests.
 *
 * FRAMING POLICY, and the tradeoff behind the default:
 *
 *   - Every ClubMode page that is NOT an embed request gets
 *     `frame-ancestors 'self'`. The director tools, /run, /admin and /login
 *     all act on a signed-in session, and a page that can be framed by anyone
 *     can be clickjacked by anyone.
 *   - An embed request for a club that has listed its sites gets
 *     `frame-ancestors 'self' <those sites>`.
 *   - An embed request for a club that has listed NOTHING may be framed by
 *     any site. That is a deliberate choice, not an oversight. Embed pages are
 *     public, read-only, and show nothing a stranger could not read by opening
 *     the same URL; the only actions on them (sign up for a class, book a
 *     court as a guest) are ones anonymous visitors are already allowed to
 *     take, and sign-in never happens inside the frame (see
 *     `embedLinkAction`). The worst a hostile framer can do is show a club's
 *     real class list on their own page. Against that, requiring the list
 *     up front means the snippet a director pastes into Wild Apricot shows a
 *     blank box until they discover a second setting — which is how an
 *     integration gets abandoned in its first five minutes. Listing sites is
 *     how a club tightens it, and the editor says so.
 */

/** The sections a club can embed on its own, one per snippet. */
export const EMBED_SECTIONS = ['programs', 'calendar', 'courts', 'about', 'team'] as const;
export type EmbedSection = (typeof EMBED_SECTIONS)[number];

/** Request header middleware sets, so a layout (which has no searchParams) knows. */
export const EMBED_HEADER = 'x-clubmode-embed';

export function isEmbedParam(value: string | string[] | null | undefined): boolean {
  const v = Array.isArray(value) ? value[0] : value;
  return v === '1' || v === 'true';
}

export function parseEmbedSection(value: string | string[] | null | undefined): EmbedSection | null {
  const v = (Array.isArray(value) ? value[0] : value || '').trim().toLowerCase();
  return (EMBED_SECTIONS as readonly string[]).includes(v) ? (v as EmbedSection) : null;
}

/* --------------------------------------------------------------- club paths */

/**
 * The club slug a public club path belongs to, or null.
 *
 * Mirrors isClubPublicPath: `/c/<slug>/…`, `/calendar/<slug>` and
 * `/courtsheet/<slug>`, but not the director tools that share those prefixes.
 */
const DIRECTOR_CHILDREN: Record<string, string[]> = {
  '/courtsheet': ['staff'],
  '/calendar': ['board', 'ideas', 'import'],
};

export function clubSlugFromPath(pathname: string): string | null {
  const c = /^\/c\/([^/?#]+)/.exec(pathname);
  if (c) return decodeURIComponent(c[1]).toLowerCase();
  for (const [prefix, own] of Object.entries(DIRECTOR_CHILDREN)) {
    const m = new RegExp(`^${prefix}/([^/?#]+)/?$`).exec(pathname);
    if (m && !own.includes(m[1])) return decodeURIComponent(m[1]).toLowerCase();
  }
  return null;
}

/* ------------------------------------------------------------------ origins */

/**
 * A site a club typed, as a CSP source — or null if it cannot be one.
 *
 * Directors paste whatever is in their address bar: "rossmoortennis.com",
 * "https://www.rossmoortennis.com/Programs", "rtc.wildapricot.org/". All of
 * those have to work. The output goes verbatim into a response header, so it
 * is rebuilt from parsed parts rather than trimmed — nothing a director types
 * can smuggle a `;` or a second directive into the policy.
 *
 * A leading `*.` is kept (CSP supports it), so a club can allow every
 * subdomain of its own domain. A bare `*` is refused: "anyone" is what an
 * EMPTY list already means, and it should not be reachable by typo.
 */
export function normalizeEmbedOrigin(input: string): string | null {
  let raw = (input || '').trim();
  if (!raw) return null;
  let wildcard = false;
  const schemeMatch = /^(https?):\/\//i.exec(raw);
  const scheme = schemeMatch ? schemeMatch[1].toLowerCase() : 'https';
  if (schemeMatch) raw = raw.slice(schemeMatch[0].length);
  if (raw.startsWith('*.')) {
    wildcard = true;
    raw = raw.slice(2);
  }
  let url: URL;
  try {
    url = new URL(`${scheme}://${raw}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  // A real host: labels of letters, digits and hyphens, and either a dot or
  // localhost (which a developer testing the snippet needs).
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*$/.test(host)) return null;
  if (!host.includes('.') && host !== 'localhost') return null;
  if (url.username || url.password) return null;
  const port = url.port ? `:${url.port}` : '';
  return `${scheme}://${wildcard ? '*.' : ''}${host}${port}`;
}

/** Normalise a list, dropping junk and duplicates. */
export function normalizeEmbedOrigins(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const item of list) {
    if (typeof item !== 'string') continue;
    const o = normalizeEmbedOrigin(item);
    if (o && !out.includes(o)) out.push(o);
  }
  return out;
}

/**
 * The `frame-ancestors` value for a request.
 *
 * `embed` false → same-origin only. `embed` true with no listed sites → any
 * site (see the tradeoff at the top of this file). Listed sites are
 * re-normalised here even though the editor stored them normalised, because a
 * row edited by hand in SQL must not be able to break the header.
 */
export function frameAncestors(embed: boolean, origins: string[] | null | undefined): string {
  if (!embed) return "'self'";
  const clean = normalizeEmbedOrigins(origins ?? []);
  if (clean.length === 0) return '*';
  return ["'self'", ...clean].join(' ');
}

/* -------------------------------------------------------------------- links */

export type EmbedLinkAction =
  /** Stays in the frame, rewritten to carry embed=1. */
  | { kind: 'frame'; href: string }
  /** Opens outside the frame — sign-in, checkout, other sites. */
  | { kind: 'new-window' }
  /** mailto:, tel:, #anchors, downloads — the browser's default is right. */
  | { kind: 'leave' };

/**
 * Pages under a club path that still need a session, so cannot work in a
 * frame whose cookies the browser blocks. None today; the list is here so the
 * next one is added deliberately rather than discovered by a member.
 */
const CLUB_PATHS_NEEDING_SIGN_IN: RegExp[] = [];

/**
 * What a click on `href` should do inside an embedded page.
 *
 * The one hard rule is about cookies: browsers block third-party cookies, so
 * inside a frame on rossmoortennis.com a ClubMode session cookie is never
 * sent. Anything that needs a sign-in therefore has to leave the frame, or
 * the member signs in, is sent back, and is signed out again — a loop that
 * reads as "the website is broken". Anonymous actions (register a child, book
 * a court as a guest) stay in the frame.
 */
export function embedLinkAction(href: string, pageUrl: string): EmbedLinkAction {
  const raw = (href || '').trim();
  if (!raw || raw.startsWith('#')) return { kind: 'leave' };
  if (/^(mailto|tel|sms):/i.test(raw)) return { kind: 'leave' };
  if (/^javascript:/i.test(raw)) return { kind: 'leave' };

  let target: URL;
  let page: URL;
  try {
    page = new URL(pageUrl);
    target = new URL(raw, page);
  } catch {
    return { kind: 'leave' };
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') return { kind: 'leave' };
  if (target.origin !== page.origin) return { kind: 'new-window' };
  // Our API routes serve files (a calendar .ics) — leave them to the browser.
  if (target.pathname.startsWith('/api/')) return { kind: 'leave' };

  const slug = clubSlugFromPath(target.pathname);
  if (!slug || CLUB_PATHS_NEEDING_SIGN_IN.some((r) => r.test(target.pathname))) {
    return { kind: 'new-window' };
  }
  target.searchParams.set('embed', '1');
  return { kind: 'frame', href: target.pathname + target.search + target.hash };
}

/**
 * A same-site path with embed=1 added when the CURRENT page is embedded.
 *
 * For the handful of places that navigate from code (`location.href = …`)
 * rather than through a link the runtime can see.
 */
export function keepEmbed(path: string, embedded: boolean): string {
  if (!embedded) return path;
  const [beforeHash, hash = ''] = path.split('#');
  const sep = beforeHash.includes('?') ? '&' : '?';
  return `${beforeHash}${sep}embed=1${hash ? `#${hash}` : ''}`;
}

/* ----------------------------------------------------------------- snippets */

/** Where each section lives, and a title for the frame (screen readers read it). */
export function embedSrc(appUrl: string, slug: string, section: EmbedSection | 'all'): string {
  const base = appUrl.replace(/\/$/, '');
  const s = encodeURIComponent(slug);
  switch (section) {
    case 'programs':
      return `${base}/c/${s}/programs?embed=1`;
    case 'calendar':
      return `${base}/calendar/${s}?embed=1`;
    case 'courts':
      return `${base}/c/${s}/courts?embed=1`;
    case 'about':
    case 'team':
      return `${base}/c/${s}?embed=1&section=${section}`;
    default:
      return `${base}/c/${s}?embed=1`;
  }
}

const escAttr = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * The copy-paste block: one iframe plus the resize script.
 *
 * The script tag is safe to paste more than once on a page — embed.js guards
 * against running twice — so a club can drop the calendar and the programs
 * into the same Wild Apricot page without being told to delete a line.
 */
export function embedSnippet(opts: {
  appUrl: string;
  slug: string;
  section: EmbedSection | 'all';
  title: string;
}): string {
  const src = embedSrc(opts.appUrl, opts.slug, opts.section);
  const script = `${opts.appUrl.replace(/\/$/, '')}/embed.js`;
  return [
    `<iframe src="${escAttr(src)}" title="${escAttr(opts.title)}" data-clubmode-embed`,
    `  style="width:100%;min-height:600px;border:0;" loading="lazy"></iframe>`,
    `<script src="${escAttr(script)}" async></script>`,
  ].join('\n');
}
