import { notFound } from 'next/navigation';
import { resolvePublicClub } from '@/lib/courtsheet/routeAuth';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import ClubChrome, { getClubChrome } from '@/components/clubSite/ClubChrome';
import PublicClient from './PublicClient';
import EmbedRuntime from '@/components/clubSite/EmbedRuntime';
import { isEmbedParam } from '@/lib/clubSite/embed';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ clubSlug: string }>;
  searchParams: Promise<{ embed?: string }>;
}

export default async function PublicCourtSheetPage({ params, searchParams }: PageProps) {
  const { clubSlug } = await params;
  // Shown inside the club's own website — see lib/clubSite/embed.ts.
  const embedded = isEmbedParam((await searchParams).embed);
  const club = await resolvePublicClub(clubSlug);
  if (!club) notFound();

  const db = getSupabaseAdmin();
  const [{ data: courts }, chrome, { data: site }] = await Promise.all([
    db
      .from('courts')
      .select('*')
      .eq('club_id', club.id)
      .neq('status', 'hidden')
      .order('display_order', { ascending: true }),
    /*
     * The club's own colours, if they have a site.
     *
     * This page is linked FROM a club's website, so arriving here in
     * ClubMode's teal-and-lime tells the visitor the club does not own the
     * software. Null when the club has never set a palette, which leaves our
     * own look exactly as it was.
     */
    getClubChrome(club.id),
    // Open cells link to the club site's booking page, which only exists
    // for a club with a site.
    db.from('club_site').select('club_id').eq('club_id', club.id).maybeSingle(),
  ]);

  return (
    <ClubChrome chrome={chrome}>
      {embedded && <EmbedRuntime />}
      <PublicClient
        club={club as any}
        initialCourts={(courts ?? []) as any}
        hasSite={!!site}
        embedded={embedded}
      />
    </ClubChrome>
  );
}
