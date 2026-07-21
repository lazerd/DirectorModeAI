import { getSupabaseAdmin } from '@/lib/supabase/admin';
import HubView from '@/components/tournaments/HubView';
import type { HubEvent } from '@/components/tournaments/hubShared';

export const dynamic = 'force-dynamic';

// Sleepy Hollow's JTT Season-End Championships hub. Kept as a stable public URL
// (shared with coaches, printed on QR posters); it renders the same shared
// HubView as the generic /tournaments/hub/[slug] pages. Discovers the draws by
// the "Season-End" name convention, scoped to the director.
const DIRECTOR_ID = '7ff5078a-ee6d-46b7-9af7-20b35f62729d';

export default async function SeasonEndHubPage() {
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from('events')
    .select('id, name, slug, match_format, public_status, event_date')
    .eq('user_id', DIRECTOR_ID)
    .ilike('name', '%season-end%')
    .in('public_status', ['open', 'running', 'completed'])
    .order('event_date');

  return (
    <HubView
      title="Season-End Championships"
      eyebrow="Lamorinda Junior Team Tennis"
      events={(data as HubEvent[]) || []}
      postersHref="/tournaments/season-end/posters"
    />
  );
}
