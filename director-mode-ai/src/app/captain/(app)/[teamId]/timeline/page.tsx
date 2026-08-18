import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { gateTeam } from '@/lib/captain/access';
import { loadTeamEmailContext, timelineFor, MATCH_COLUMNS } from '@/lib/captain/timelineSend';
import { EMAIL_KINDS, KIND_META } from '@/lib/captain/timeline';
import TimelinePanel from '@/components/captain/TimelinePanel';

export const dynamic = 'force-dynamic';

export default async function TimelinePage({ params }: { params: { teamId: string } }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?redirect=/captain/${params.teamId}/timeline`);

  const gate = await gateTeam(user.id, params.teamId);
  if (gate === 'not_member') notFound();
  if (gate === 'needs_subscription') redirect('/captain/subscribe');

  const db = await createServiceClient();
  const { data: teamRow } = await db
    .from('captain_teams')
    .select('id, name, captain_user_id')
    .eq('id', params.teamId)
    .maybeSingle();
  if (!teamRow) notFound();
  const team = teamRow as { id: string; name: string; captain_user_id: string };

  const { data: matches } = await db
    .from('captain_matches')
    .select(MATCH_COLUMNS)
    .eq('team_id', team.id)
    .order('match_at');

  const ctx = await loadTeamEmailContext(
    db,
    team,
    (matches as unknown as Record<string, unknown>[]) || [],
  );
  const events = timelineFor(ctx, new Date());
  const settings = EMAIL_KINDS.map((k) => ({ ...ctx.settings[k], meta: KIND_META[k] }));

  return (
    <div className="p-5 md:p-10 max-w-5xl">
      <Link
        href={`/captain/${team.id}`}
        className="inline-flex items-center gap-2 text-white/50 hover:text-white text-sm mb-5"
      >
        <ArrowLeft size={16} /> {team.name}
      </Link>

      <h1 className="text-3xl font-display text-white">Season email timeline</h1>
      <p className="text-white/50 mt-1 max-w-2xl">
        Every email this team sends, in the order it goes out. Times are the daily send window in
        club time — nothing sends without appearing here first.
      </p>

      <TimelinePanel
        teamId={team.id}
        initialEvents={events}
        initialSettings={settings}
        rosterWithEmail={ctx.counts.roster}
      />
    </div>
  );
}
