/**
 * A club's own website shell.
 *
 * Three things make this a club's site rather than a ClubMode page:
 *
 *  1. No ClubMode rail. '/c' is registered in ClubSidebar's PUBLIC_PREFIXES,
 *     which also releases the 248px body gutter the rail reserves.
 *  2. Its own background. globals.css paints the body ClubMode's dark teal, so
 *     a light club page that does not set its own background inherits ours.
 *     The shell sets it from the club's palette.
 *  3. Its own metadata and canonical. The root layout's comment is explicit:
 *     canonicals belong to the route, never the root, or every page on the
 *     site claims the homepage as its canonical.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getClubSite } from '@/lib/clubSite/server';
import { readableOn } from '@/lib/clubSite/theme';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const bundle = await getClubSite(slug);
  if (!bundle) return { title: 'Club not found' };

  const { club, site } = bundle;
  const where = [club.city, club.state].filter(Boolean).join(', ');
  const title = site.seo_title || `${club.name}${where ? ` — ${where}` : ''}`;
  const description =
    site.seo_description ||
    site.hero_subhead ||
    club.description ||
    `Programs, court time and membership at ${club.name}.`;

  return {
    title,
    description,
    alternates: { canonical: `/c/${club.slug}` },
    // A draft site must not be indexed while a club is still writing it.
    robots: bundle.isDraft ? { index: false, follow: false } : undefined,
    openGraph: { title, description, type: 'website', siteName: club.name },
  };
}

export default async function ClubSiteLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const bundle = await getClubSite(slug);
  if (!bundle) notFound();

  const { club, site, theme } = bundle;
  const onPrimary = readableOn(theme.primary);
  const nav = [
    { label: 'Programs', href: `/c/${club.slug}/programs` },
    { label: 'Courts', href: `/c/${club.slug}/courts` },
    ...site.nav_links.map((l) => ({ label: l.label, href: l.href })),
  ];

  return (
    <div
      style={{
        background: theme.cream,
        color: theme.ink,
        fontFamily: theme.fontFamily,
        minHeight: '100vh',
      }}
    >
      {bundle.isDraft && (
        // Staff previewing their own unpublished site. Says so plainly, because
        // the URL is the real one and is otherwise indistinguishable from live.
        <div
          style={{ background: '#92400e', color: '#fff' }}
          className="px-4 py-2 text-center text-sm font-medium"
        >
          Draft — only you can see this. Publish it from Club site settings.
        </div>
      )}

      <header style={{ background: theme.primary, color: onPrimary }}>
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-5 py-4">
          <Link href={`/c/${club.slug}`} className="flex items-center gap-3 min-w-0">
            {club.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={club.logo_url} alt="" className="h-10 w-auto object-contain" />
            ) : null}
            <span
              className="truncate text-lg font-bold leading-tight sm:text-xl"
              style={{ fontFamily: theme.headingFamily }}
            >
              {club.name}
            </span>
          </Link>
          <nav className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm font-medium">
            {nav.map((l) => (
              <Link key={`${l.label}-${l.href}`} href={l.href} className="hover:underline">
                {l.label}
              </Link>
            ))}
            {club.phone && (
              <a href={`tel:${club.phone.replace(/[^0-9+]/g, '')}`} className="hover:underline">
                {club.phone}
              </a>
            )}
          </nav>
        </div>
      </header>

      <main>{children}</main>

      <footer style={{ background: theme.ink, color: '#fff' }} className="mt-16">
        <div className="mx-auto max-w-5xl px-5 py-10 text-sm">
          <div className="grid gap-8 sm:grid-cols-2">
            <div>
              <div className="text-base font-bold" style={{ fontFamily: theme.headingFamily }}>
                {club.name}
              </div>
              {club.address && <div className="mt-2 opacity-70">{club.address}</div>}
              {(club.city || club.state) && (
                <div className="opacity-70">
                  {[club.city, club.state].filter(Boolean).join(', ')} {club.zip || ''}
                </div>
              )}
            </div>
            <div className="sm:text-right">
              {club.phone && (
                <div>
                  <a
                    href={`tel:${club.phone.replace(/[^0-9+]/g, '')}`}
                    className="hover:underline"
                  >
                    {club.phone}
                  </a>
                </div>
              )}
              {club.email && (
                <div>
                  <a href={`mailto:${club.email}`} className="hover:underline">
                    {club.email}
                  </a>
                </div>
              )}
            </div>
          </div>
          <div className="mt-8 flex flex-wrap items-center justify-between gap-2 border-t border-white/15 pt-5 text-xs opacity-50">
            <span>
              © {new Date().getFullYear()} {club.name}
            </span>
            <a href="https://clubmode.ai" className="hover:underline">
              Powered by ClubMode
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
