import { notFound } from 'next/navigation';
import { resolvePublicClub } from '@/lib/courtsheet/routeAuth';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
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
  const { data: courts } = await db
    .from('courts')
    .select('*')
    .eq('club_id', club.id)
    .neq('status', 'hidden')
    .order('display_order', { ascending: true });

  return (
    <PublicClient
      club={club as any}
      initialCourts={(courts ?? []) as any}
    />
  );
}
