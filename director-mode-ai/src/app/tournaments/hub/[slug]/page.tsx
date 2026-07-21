import { notFound } from 'next/navigation';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import HubView from '@/components/tournaments/HubView';
import type { HubEvent } from '@/components/tournaments/hubShared';

export const dynamic = 'force-dynamic';

// Generic tournament hub: one page listing every event that shares this
// hub_slug, with per-division Standings / Enter / Draw links + QR posters.
export default async function TournamentHubPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from('events')
    .select('id, name, slug, match_format, public_status, event_date, hub_title')
    .eq('hub_slug', slug)
    .in('public_status', ['open', 'running', 'completed'])
    .order('event_date');

  const events = (data as (HubEvent & { hub_title: string | null })[]) || [];
  if (events.length === 0) return notFound();

  const title = events.find((e) => e.hub_title)?.hub_title || 'Tournament Hub';

  return <HubView title={title} events={events} postersHref={`/tournaments/hub/${slug}/posters`} />;
}
