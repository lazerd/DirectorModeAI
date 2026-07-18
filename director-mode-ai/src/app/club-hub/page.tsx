import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import ClubHubRoom, { type HubMsg } from '@/components/clubhub/ClubHubRoom';

export const dynamic = 'force-dynamic';

// Club Hub — the one shared, cross-club space. Every authenticated director sees
// the same community room (contrast with the rest of the app, which is siloed
// per club). Server component: auth-gate, fetch the initial message list via the
// service role for a fast first paint, then hand off to the realtime client room.
export default async function ClubHubPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?redirect=/club-hub');

  const meta = (user.user_metadata ?? {}) as Record<string, string>;
  const myName =
    (meta.full_name || meta.name || '').trim().split(/\s+/)[0] ||
    (user.email || '').split('@')[0] || 'Director';

  // Fetch the initial snapshot. Degrade gracefully to an empty room if the
  // service-role client or the table isn't available yet (e.g. deployed before
  // the club_hub.sql migration has been run) rather than crashing the page.
  let initial: HubMsg[] = [];
  try {
    const admin = getSupabaseAdmin();
    const { data } = await admin
      .from('club_hub_messages')
      .select('id, author_name, persona_id, is_persona, body, reply_to, created_at')
      .order('created_at', { ascending: false })
      .limit(60);
    initial = ((data as HubMsg[]) || []).slice().reverse();
  } catch { /* empty room */ }

  return <ClubHubRoom initialMessages={initial} myName={myName} />;
}
