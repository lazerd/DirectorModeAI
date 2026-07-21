import { notFound } from 'next/navigation';
import QRCode from 'qrcode';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import HubPosters, { type HubPoster } from '@/components/tournaments/HubPosters';
import { HUB_FORMAT_LABELS, hubSortKey, hubParseName, type HubEvent } from '@/components/tournaments/hubShared';

export const dynamic = 'force-dynamic';

const BASE_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://club.coachmode.ai').replace(/\/$/, '');

export default async function TournamentHubPostersPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from('events')
    .select('id, name, slug, match_format, public_status, hub_title')
    .eq('hub_slug', slug)
    .in('public_status', ['open', 'running', 'completed'])
    .order('event_date');

  const events = ((data as (HubEvent & { hub_title: string | null })[]) || []).filter((e) => e.slug);
  if (events.length === 0) return notFound();

  const eyebrow = events.find((e) => e.hub_title)?.hub_title || 'Tournament Hub';

  const posters: HubPoster[] = await Promise.all(
    events
      .sort((a, b) => hubSortKey(a.name) - hubSortKey(b.name) || a.name.localeCompare(b.name))
      .map(async (e) => {
        const url = `${BASE_URL}/tournaments/${e.slug}/results`;
        const qr = await QRCode.toDataURL(url, { width: 900, margin: 1, errorCorrectionLevel: 'M' });
        const { title, venue } = hubParseName(e.name);
        return { id: e.id, title, venue, format: HUB_FORMAT_LABELS[e.match_format || ''] || e.match_format, url, qr };
      })
  );

  return <HubPosters eyebrow={eyebrow} posters={posters} />;
}
