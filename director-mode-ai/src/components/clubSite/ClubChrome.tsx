/**
 * A club's colours, made available to ClubMode's own shared surfaces.
 *
 * The court sheet, the calendar and the open-court board are ClubMode pages
 * that a club's website links out to. Before this, clicking "Court sheet" in
 * Lafayette's navy header dropped you onto ClubMode's teal-and-lime — which
 * tells a visitor, correctly, that the club does not own this software.
 *
 * Delivered as CSS CUSTOM PROPERTIES rather than props, for one reason: these
 * surfaces are large client components with the colours baked into Tailwind
 * arbitrary values, sometimes a dozen levels below the page. Threading a theme
 * object down to every one of them would be a rewrite of each page and would
 * have to be redone for the next surface. A variable with ClubMode's own value
 * as its fallback means an unbranded club renders EXACTLY as it does today —
 * the change is invisible until a club has a palette.
 *
 *     bg-[var(--cm-ground,#001820)]     ← branded, or ClubMode's teal
 *     text-[var(--cm-accent,#D3FB52)]   ← branded, or ClubMode's lime
 *
 * Scoped to a wrapper element, not :root, so one branded page cannot leak its
 * palette into the app shell around it.
 */

import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { resolveChrome, type ClubChrome as Chrome } from '@/lib/clubSite/chrome';
import { resolveTheme } from '@/lib/clubSite/theme';

/**
 * A club's dark-surface chrome, or null when they have no site row.
 *
 * Null is meaningful: it means leave ClubMode's own look alone. A club that
 * has never opened the site editor has not chosen anything, and inventing a
 * palette for them from their logo would be worse than our own.
 */
export async function getClubChrome(clubId: string): Promise<Chrome | null> {
  const { data } = await getSupabaseAdmin()
    .from('club_site')
    .select(
      'color_primary, color_secondary, color_ink, color_cream, color_surface, font_choice',
    )
    .eq('club_id', clubId)
    .maybeSingle();
  if (!data) return null;
  return resolveChrome(resolveTheme(data as Record<string, unknown>));
}

/** The variable block. Render it around a page's own root element. */
export function chromeVars(chrome: Chrome | null): React.CSSProperties {
  if (!chrome) return {};
  return {
    '--cm-ground': chrome.ground,
    '--cm-panel': chrome.panel,
    '--cm-accent': chrome.accent,
    '--cm-on-accent': chrome.onAccent,
    '--cm-text': chrome.text,
    '--cm-muted': chrome.muted,
    '--cm-border': chrome.border,
    '--cm-font': chrome.fontFamily,
    '--cm-heading': chrome.headingFamily,
  } as React.CSSProperties;
}

/**
 * Wraps children in the club's palette.
 *
 * `display: contents` so the wrapper contributes nothing to layout — the
 * pages inside already set their own min-height and background, and an extra
 * block-level div between them and the body is how a full-height page starts
 * scrolling for no reason.
 */
export default function ClubChrome({
  chrome,
  children,
}: {
  chrome: Chrome | null;
  children: React.ReactNode;
}) {
  if (!chrome) return <>{children}</>;
  return (
    <div style={{ ...chromeVars(chrome), display: 'contents' }}>{children}</div>
  );
}
