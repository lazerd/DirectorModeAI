/**
 * appUrl.ts — the one place that knows what host ClubMode lives on.
 *
 * Before this existed, `process.env.NEXT_PUBLIC_APP_URL || 'https://club.coachmode.ai'`
 * was copy-pasted into ~40 files. Every one of them was a place a domain
 * migration could silently miss: an email that still linked to the old host, a
 * poster QR code baked with the wrong origin, a share string in a canvas render.
 *
 * Import APP_URL instead of re-deriving it. If the host ever changes again, the
 * env var moves it everywhere and this file is the only fallback to edit.
 *
 * NOTE ON THE OLD HOST: club.coachmode.ai is 301-redirected to clubmode.ai
 * permanently (see src/middleware.ts). Links already out in the wild — printed
 * posters, sent emails, saved bookmarks, and above all the tokenized scoring
 * links captains and coaches use — keep working through that redirect. The
 * redirect is load-bearing, not cleanup. Do not remove it.
 */

/** Canonical host, no trailing slash. Server and client both read this. */
export const APP_URL = (
  process.env.NEXT_PUBLIC_APP_URL || 'https://clubmode.ai'
).replace(/\/$/, '');

/** Bare hostname, for display in UI ("clubmode.ai/leagues/…") and share strings. */
export const APP_HOST = APP_URL.replace(/^https?:\/\//, '');

/**
 * The previous production host. Kept as a named constant so the redirect and any
 * future migration audit have something greppable to point at.
 */
export const LEGACY_HOST = 'club.coachmode.ai';

/** Absolute URL for a path, e.g. absoluteUrl('/flex') → https://clubmode.ai/flex */
export function absoluteUrl(path: string): string {
  return `${APP_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

/**
 * Prefer the live request origin when we're in the browser, falling back to the
 * configured host. Use this for anything a user copies out of the UI (invite
 * links, join codes) so local and preview builds produce links that actually
 * work in that environment.
 */
export function originOr(fallback: string = APP_URL): string {
  return typeof window !== 'undefined' ? window.location.origin : fallback;
}
