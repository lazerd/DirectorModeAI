/**
 * CourtConnect, on the club's own site.
 *
 * Members get the real board. Everyone else sees that games exist and what
 * they are — "Tue 9:00am doubles · needs 1 · 3.0–3.5" — and nothing that
 * identifies a member: no names, no note, no court. Then a sign-in prompt.
 *
 * Membership is read from the session (and checked with the admin client),
 * never taken from the visitor.
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getClubSite } from '@/lib/clubSite/server';
import { readableOn, tint } from '@/lib/clubSite/theme';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { publicOpenGames, resolvePlayingClub } from '@/lib/partnerFinder/server';
import { publicLine } from '@/lib/partnerFinder/format';
import GamesBoard from '@/components/partnerFinder/GamesBoard';

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
    title: `CourtConnect — ${bundle.club.name}`,
    description: `Members of ${bundle.club.name} post games that need players, and join them in one tap.`,
    alternates: { canonical: `/c/${bundle.club.slug}/play` },
  };
}

export default async function ClubPlayPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const bundle = await getClubSite(slug);
  if (!bundle) notFound();
  const { club, theme } = bundle;

  let signedIn = false;
  let isMember = false;
  try {
    const {
      data: { user },
    } = await (await createClient()).auth.getUser();
    if (user) {
      signedIn = true;
      const found = await resolvePlayingClub(getSupabaseAdmin(), user.id, club.id);
      isMember = found?.club.id === club.id;
    }
  } catch {
    // Auth having a bad day shows the public view, the safe direction to be wrong in.
  }

  if (isMember) {
    return (
      <div className="mx-auto max-w-3xl px-5 py-12">
        <h1 className="text-4xl font-bold" style={{ fontFamily: theme.headingFamily }}>
          CourtConnect
        </h1>
        <p className="mt-2 text-xl font-semibold">Find a game with members at your level</p>
        <p className="mb-8 mt-2 text-xl" style={{ color: tint(theme.ink, 0.7) }}>
          Need a player? Post your game and we&rsquo;ll email members at your level. Want a game? Tap &ldquo;I&rsquo;m in.&rdquo;
        </p>
        <GamesBoard clubId={club.id} />
      </div>
    );
  }

  const games = await publicOpenGames(getSupabaseAdmin(), club.id);
  const next = encodeURIComponent(`/c/${club.slug}/play`);

  return (
    <div className="mx-auto max-w-3xl px-5 py-12 text-lg">
      <h1 className="text-4xl font-bold" style={{ fontFamily: theme.headingFamily }}>
        CourtConnect
      </h1>
      <p className="mt-3 text-xl" style={{ color: tint(theme.ink, 0.7) }}>
        Members of {club.name} post games that need players, and members at the right level join in one tap.
      </p>

      <div
        className="mt-8 rounded-3xl border p-6"
        style={{ borderColor: tint(theme.ink, 0.12), background: theme.surface }}
      >
        {signedIn ? (
          <p className="text-xl">
            This board is for members of {club.name}.
            {club.phone ? ` To join the club, call ${club.phone}.` : ''}
          </p>
        ) : (
          <>
            <p className="text-xl font-semibold">Are you a member? Sign in to join a game or post one.</p>
            <Link
              href={`/login?next=${next}`}
              className="mt-4 inline-flex min-h-[56px] items-center justify-center rounded-2xl px-8 text-xl font-bold"
              style={{ background: theme.primary, color: readableOn(theme.primary) }}
            >
              Member sign in
            </Link>
          </>
        )}
      </div>

      <h2 className="mt-10 text-2xl font-bold" style={{ fontFamily: theme.headingFamily }}>
        Games looking for players
      </h2>
      {games.length === 0 ? (
        <p className="mt-3" style={{ color: tint(theme.ink, 0.65) }}>
          No games need players right now.
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {games.map((g) => (
            <li
              key={g.id}
              className="rounded-2xl border px-5 py-4 text-xl font-semibold"
              style={{ borderColor: tint(theme.ink, 0.12), background: theme.surface }}
            >
              {publicLine(g, g.spots_left, club.timezone)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
