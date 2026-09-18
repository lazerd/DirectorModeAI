/**
 * The enrolment page.
 *
 * Renders the form when a season is taking entries, and says something useful
 * when one isn't — a page that just shows a dead form to someone who arrived a
 * week late is worse than no page.
 *
 * The season here is resolved by slug, or falls back to whichever season is
 * currently enrolling rather than to "the newest season", because the nav link
 * is a bare /ptl/enroll and it has to find the right one on its own.
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import EnrollForm from '@/components/ptl/EnrollForm';
import { DemoRibbon } from '@/components/ptl/DemoRibbon';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { getSeason, type PtlSeason } from '@/lib/ptl/server';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Enroll — Premier Tennis League',
  description:
    'Enroll as an individual in the Premier Tennis League. Captains draft the rosters, so every team starts balanced.',
};

/** Whichever season is actually open, regardless of which is newest. */
async function findEnrollingSeason(): Promise<PtlSeason | null> {
  const db = getSupabaseAdmin();
  const { data } = await db
    .from('ptl_seasons')
    .select(
      'id, name, slug, status, entry_cents, roster_size, pick_seconds, courts_per_division, tagline, blurb, enroll_opens_at, enroll_closes_at, is_demo, demo_note',
    )
    .eq('status', 'enrolling')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as PtlSeason) || null;
}

export default async function EnrollPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string }>;
}) {
  const { season: slug } = await searchParams;
  const season = slug ? await getSeason(slug) : (await findEnrollingSeason()) || (await getSeason());
  if (!season) notFound();

  const now = new Date();
  const opensAt = season.enroll_opens_at ? new Date(season.enroll_opens_at) : null;
  const closesAt = season.enroll_closes_at ? new Date(season.enroll_closes_at) : null;

  const closedReason =
    season.status !== 'enrolling'
      ? season.status === 'drafting'
        ? 'The field is set and the draft is under way.'
        : season.status === 'running' || season.status === 'complete'
          ? 'This season is already playing.'
          : 'Enrolment hasn’t opened yet.'
      : opensAt && now < opensAt
        ? 'Enrolment hasn’t opened yet.'
        : closesAt && now > closesAt
          ? 'Enrolment has closed for this season.'
          : null;

  if (closedReason) {
    return (
      <>
        {season.is_demo && <DemoRibbon note={season.demo_note} />}
        <div className="mx-auto max-w-xl px-5 py-24 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-teal-400">
            {season.name}
          </p>
          <h1 className="mt-4 text-4xl font-black tracking-tight">Enrolment is closed</h1>
          <p className="mt-4 text-white/60">{closedReason}</p>
          <p className="mt-2 text-white/45">
            Follow this season and you&rsquo;ll see the next one open here.
          </p>
          <div className="mt-10 flex flex-wrap justify-center gap-4">
            <Link
              href={`/ptl/standings?season=${season.slug}`}
              className="rounded-sm bg-teal-400 px-6 py-3 font-bold text-[#06231F] transition-colors hover:bg-teal-300"
            >
              See the standings
            </Link>
            <Link
              href={`/ptl?season=${season.slug}`}
              className="rounded-sm border border-white/25 px-6 py-3 font-semibold text-white/85 transition-colors hover:border-white/50 hover:text-white"
            >
              About the league
            </Link>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      {season.is_demo && <DemoRibbon note={season.demo_note} />}
      <EnrollForm
        seasonSlug={season.slug}
        seasonName={season.name}
        entryCents={season.entry_cents}
        isDemo={season.is_demo}
      />
    </>
  );
}
