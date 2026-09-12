/**
 * "Play your home matches here."
 *
 * A club with courts and quiet weekend daytime can sell a whole USTA season to
 * a team that has nowhere to host. This is the page that sells it: the packages,
 * the money spelled out per match so a captain can compare it to what they pay
 * now, and a request form.
 *
 * Every number comes from club_host_packages. A second club selling its own
 * packages needs rows, not code.
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getClubSite } from '@/lib/clubSite/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { readableOn, tint } from '@/lib/clubSite/theme';
import { formatPrice } from '@/lib/programs/sessions';
import HostRequestForm, { type HostPackage } from './HostRequestForm';

export const dynamic = 'force-dynamic';

async function getPackages(clubId: string): Promise<HostPackage[]> {
  const { data } = await getSupabaseAdmin()
    .from('club_host_packages')
    .select('id, label, courts, matches_included, price_cents, playoff_price_cents, blurb, includes')
    .eq('club_id', clubId)
    .eq('active', true)
    .order('display_order');
  return (data as (HostPackage & { blurb: string | null; includes: unknown })[] | null) ?? [];
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const bundle = await getClubSite(slug);
  if (!bundle) return { title: 'Not found' };
  return {
    title: `Host your home matches — ${bundle.club.name}`,
    description: `Play your USTA league season at ${bundle.club.name}. Court packages for visiting teams.`,
    alternates: { canonical: `/c/${bundle.club.slug}/host` },
  };
}

export default async function HostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const bundle = await getClubSite(slug);
  if (!bundle) notFound();

  const { club, theme } = bundle;
  const onPrimary = readableOn(theme.primary);
  const packages = (await getPackages(club.id)) as (HostPackage & {
    blurb: string | null;
    includes: unknown;
  })[];

  return (
    <div className="mx-auto max-w-4xl px-5 py-12">
      <h1 className="text-3xl font-bold sm:text-4xl" style={{ fontFamily: theme.headingFamily }}>
        Play your home matches here
      </h1>
      <p className="mt-3 max-w-2xl text-base leading-relaxed" style={{ color: tint(theme.ink, 0.7) }}>
        No home courts for your league season? Bring your team to {club.name}. You get the courts
        for every home match, and your players get a real club to play at.
      </p>

      {packages.length === 0 ? (
        <div
          className="mt-8 rounded-2xl border p-8 text-center"
          style={{ borderColor: tint(theme.ink, 0.12), background: theme.surface }}
        >
          <p className="font-medium">Hosting packages aren&apos;t published yet.</p>
          <p className="mt-2 text-sm" style={{ color: tint(theme.ink, 0.6) }}>
            {club.phone ? `Call ${club.phone} and we'll talk it through.` : 'Get in touch and we can talk it through.'}
          </p>
        </div>
      ) : (
        <>
          {/* ----------------------------------------------------- packages */}
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            {packages.map((p) => {
              // Per match, because that is the number a captain compares
              // against what they are paying now.
              const perMatch = p.matches_included > 0 ? p.price_cents / p.matches_included : 0;
              const includes = Array.isArray(p.includes) ? (p.includes as string[]) : [];
              return (
                <div
                  key={p.id}
                  className="rounded-2xl border p-5"
                  style={{ borderColor: tint(theme.ink, 0.14), background: theme.surface }}
                >
                  <div className="text-lg font-bold" style={{ fontFamily: theme.headingFamily }}>
                    {p.label}
                  </div>
                  <div className="mt-1 flex items-baseline gap-2">
                    <span className="text-3xl font-bold" style={{ color: theme.primary }}>
                      {formatPrice(p.price_cents)}
                    </span>
                    <span className="text-sm" style={{ color: tint(theme.ink, 0.55) }}>
                      for the season
                    </span>
                  </div>
                  <div className="mt-1 text-sm" style={{ color: tint(theme.ink, 0.65) }}>
                    {p.courts} courts · {p.matches_included} home matches ·{' '}
                    <strong>{formatPrice(Math.round(perMatch))} a match</strong>
                  </div>

                  {p.blurb && (
                    <p className="mt-3 text-sm" style={{ color: tint(theme.ink, 0.7) }}>
                      {p.blurb}
                    </p>
                  )}

                  {includes.length > 0 && (
                    <ul className="mt-3 space-y-1.5 text-sm">
                      {includes.map((line, i) => (
                        <li key={i} className="flex gap-2">
                          <span style={{ color: theme.secondary }}>✓</span>
                          <span style={{ color: tint(theme.ink, 0.75) }}>{line}</span>
                        </li>
                      ))}
                    </ul>
                  )}

                  {p.playoff_price_cents != null && p.playoff_price_cents > 0 && (
                    <div
                      className="mt-4 rounded-lg px-3 py-2 text-sm"
                      style={{ background: tint(theme.primary, 0.08) }}
                    >
                      Playoffs <strong>{formatPrice(p.playoff_price_cents)} per match</strong>, on
                      top
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* ------------------------------------------------------- form */}
          <div className="mt-10">
            <HostRequestForm
              clubSlug={club.slug}
              clubName={club.name}
              packages={packages.map((p) => ({
                id: p.id,
                label: p.label,
                courts: p.courts,
                matches_included: p.matches_included,
                price_cents: p.price_cents,
                playoff_price_cents: p.playoff_price_cents,
              }))}
              theme={{
                primary: theme.primary,
                onPrimary,
                ink: theme.ink,
                surface: theme.surface,
                border: tint(theme.ink, 0.16),
                muted: tint(theme.ink, 0.6),
              }}
            />
          </div>
        </>
      )}

      <div className="mt-10 flex flex-wrap gap-4 text-sm font-semibold">
        <Link href={`/c/${club.slug}/courts`} style={{ color: theme.primary }}>
          Court time &amp; rates
        </Link>
        {club.phone && (
          <a href={`tel:${club.phone.replace(/[^0-9+]/g, '')}`} style={{ color: theme.primary }}>
            Call {club.phone}
          </a>
        )}
      </div>
    </div>
  );
}
