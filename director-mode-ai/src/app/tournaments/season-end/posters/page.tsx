import QRCode from 'qrcode';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import HubPosters, { type HubPoster } from '@/components/tournaments/HubPosters';
import { HUB_FORMAT_LABELS, hubSortKey, hubParseName, type HubEvent } from '@/components/tournaments/hubShared';

import { APP_URL } from '@/lib/appUrl';
export const dynamic = 'force-dynamic';

const DIRECTOR_ID = '7ff5078a-ee6d-46b7-9af7-20b35f62729d';
const BASE_URL = APP_URL;

export default async function SeasonEndPostersPage() {
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from('events')
    .select('id, name, slug, match_format, public_status')
    .eq('user_id', DIRECTOR_ID)
    .ilike('name', '%season-end%')
    .in('public_status', ['open', 'running', 'completed'])
    .order('event_date');

  const events = ((data as HubEvent[]) || []).filter((e) => e.slug);

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

  return <HubPosters eyebrow="Lamorinda JTT · Season-End Championships" posters={posters} />;
}
