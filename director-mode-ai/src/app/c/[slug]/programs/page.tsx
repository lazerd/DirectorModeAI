/**
 * Every class the club is selling, grouped the way a parent shops: who it is
 * for, not what sport it is. A junior parent scanning for their kid does not
 * want to read past the 4.0 adult clinic.
 */

import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getClubSite } from '@/lib/clubSite/server';
import { tint } from '@/lib/clubSite/theme';
import ProgramCard from '@/components/clubSite/ProgramCard';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const bundle = await getClubSite(slug);
  if (!bundle) return { title: 'Not found' };
  return {
    title: `Programs & classes — ${bundle.club.name}`,
    description: `Junior and adult classes at ${bundle.club.name}, with dates and online registration.`,
    alternates: { canonical: `/c/${bundle.club.slug}/programs` },
  };
}

const GROUPS: { key: string; label: string }[] = [
  { key: 'junior', label: 'Juniors' },
  { key: 'adult', label: 'Adults' },
  { key: 'family', label: 'Family' },
  { key: 'all', label: 'Everyone' },
];

export default async function ClubProgramsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const bundle = await getClubSite(slug);
  if (!bundle) notFound();

  const { club, site, theme, programs } = bundle;
  const groups = GROUPS.map((g) => ({
    ...g,
    items: programs.filter((p) => p.audience === g.key),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="mx-auto max-w-5xl px-5 py-12">
      <h1 className="text-3xl font-bold sm:text-4xl" style={{ fontFamily: theme.headingFamily }}>
        Programs &amp; classes
      </h1>
      <p className="mt-3 max-w-2xl text-base" style={{ color: tint(theme.ink, 0.65) }}>
        Every class with its real dates — including the weeks we skip — and sign-up in a couple of
        taps.
      </p>

      {programs.length === 0 && (
        <div
          className="mt-8 rounded-2xl border p-8 text-center"
          style={{ borderColor: tint(theme.ink, 0.12), background: theme.surface }}
        >
          <p className="font-medium">Nothing is open for registration right now.</p>
          <p className="mt-2 text-sm" style={{ color: tint(theme.ink, 0.6) }}>
            New sessions go up here as they are scheduled.
            {club.phone ? ` In the meantime, call ${club.phone}.` : ''}
          </p>
        </div>
      )}

      {groups.map((g) => (
        <section key={g.key} className="mt-10">
          <h2
            className="text-xs font-bold uppercase tracking-[0.16em]"
            style={{ color: tint(theme.ink, 0.5) }}
          >
            {g.label}
          </h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {g.items.map((p) => (
              <ProgramCard
                key={p.id}
                program={p}
                clubSlug={club.slug}
                theme={theme}
                timeZone={club.timezone}
              />
            ))}
          </div>
        </section>
      ))}

      {site.partner_links.length > 0 && (
        <section className="mt-14">
          <h2
            className="text-xs font-bold uppercase tracking-[0.16em]"
            style={{ color: tint(theme.ink, 0.5) }}
          >
            Run by our other pros
          </h2>
          <div className="mt-4 flex flex-wrap gap-3">
            {site.partner_links.map((p, i) => (
              <a
                key={i}
                href={p.href || '#'}
                className="rounded-xl border px-4 py-3 text-sm font-semibold"
                style={{ borderColor: tint(theme.ink, 0.15), background: theme.surface }}
              >
                {p.name}
                {p.sport ? ` · ${p.sport}` : ''} →
              </a>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
