import { notFound } from 'next/navigation';
import { resolvePublicClub } from '@/lib/courtsheet/routeAuth';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import ClubChrome, { getClubChrome } from '@/components/clubSite/ClubChrome';
import PublicClient from './PublicClient';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ clubSlug: string }>;
}

export default async function PublicCourtSheetPage({ params }: PageProps) {
  const { clubSlug } = await params;
  const club = await resolvePublicClub(clubSlug);
  if (!club) notFound();

  const db = getSupabaseAdmin();
  const [{ data: courts }, chrome] = await Promise.all([
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
  ]);

  return (
    <ClubChrome chrome={chrome}>
      <PublicClient
        club={club as any}
        initialCourts={(courts ?? []) as any}
      />
    </ClubChrome>
  );
}
