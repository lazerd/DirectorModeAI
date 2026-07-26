import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { getCaptainAccess, canAccessTeam } from '@/lib/captain/access';
import MatchWorkspace, { type MatchPlayer } from '@/components/captain/MatchWorkspace';

export const dynamic = 'force-dynamic';

export default async function MatchPage({
  params,
}: {
  params: { teamId: string; matchId: string };
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?redirect=/captain/${params.teamId}/match/${params.matchId}`);

  const access = await getCaptainAccess(user.id);
  if (!access.active) redirect('/captain/subscribe');
  if (!(await canAccessTeam(user.id, params.teamId))) notFound();

  const db = await createServiceClient();
  const [{ data: teamRow }, { data: matchRow }] = await Promise.all([
    db.from('captain_teams').select('*').eq('id', params.teamId).maybeSingle(),
    db
      .from('captain_matches')
      .select('*')
      .eq('id', params.matchId)
      .eq('team_id', params.teamId)
      .maybeSingle(),
  ]);
  if (!teamRow || !matchRow) notFound();

  const team = teamRow as { id: string; name: string; level: string | null };
  const match = matchRow as Record<string, unknown>;

  const [{ data: players }, { data: avail }, { data: lineups }, { data: results }] =
    await Promise.all([
    db
      .from('captain_players')
      .select('id, name, email, rating, gender, return_side, court_limit, is_sub')
      .eq('team_id', params.teamId)
      .eq('active', true)
      .order('name'),
    db
      .from('captain_availability')
      .select('player_id, status')
      .eq('match_id', params.matchId),
    db
      .from('captain_lineups')
      .select(
        'id, court_number, court_type, player1_id, player2_id, player1_confirmed_at, player2_confirmed_at',
      )
      .eq('match_id', params.matchId)
      .order('court_number'),
    db
      .from('captain_results')
      .select('court_number, score, won')
      .eq('match_id', params.matchId),
  ]);

  const statusOf = (id: string) =>
    ((avail as { player_id: string; status: string }[]) || []).find((a) => a.player_id === id)
      ?.status ?? null;

  const roster: MatchPlayer[] = ((players as Record<string, unknown>[]) || []).map((p) => ({
    id: p.id as string,
    name: p.name as string,
    rating: p.rating == null ? null : Number(p.rating),
    isSub: p.is_sub as boolean,
    hasEmail: !!p.email,
    availability: statusOf(p.id as string) as MatchPlayer['availability'],
  }));

  return (
    <div className="p-6 md:p-10 max-w-5xl">
      <Link href={`/captain/${team.id}`} className="text-white/40 text-sm hover:text-white">
        ← {team.name}
      </Link>
      <h1 className="text-3xl font-display text-white mt-2">
        {new Intl.DateTimeFormat('en-US', {
          weekday: 'long',
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        }).format(new Date(match.match_at as string))}
      </h1>
      <p className="text-white/50 mt-1">
        {(match.opponent as string) || 'TBD'} · {match.is_home ? 'Home' : 'Away'}
        {match.location ? ` · ${match.location}` : ''}
      </p>

      <MatchWorkspace
        teamId={team.id}
        matchId={params.matchId}
        players={roster}
        initialLineup={
          ((lineups as Record<string, unknown>[]) || []).map((l) => ({
            id: l.id as string,
            courtNumber: l.court_number as number,
            courtType: l.court_type as 'singles' | 'doubles',
            player1Id: (l.player1_id as string) ?? null,
            player2Id: (l.player2_id as string) ?? null,
            player1Confirmed: !!l.player1_confirmed_at,
            player2Confirmed: !!l.player2_confirmed_at,
          })) as never
        }
        singlesCourts={(match.singles_courts as number) ?? 2}
        doublesCourts={(match.doubles_courts as number) ?? 3}
        lineupSent={!!match.lineup_email_sent_at}
        matchAt={match.match_at as string}
        status={match.status as string}
        initialResults={((results as Record<string, unknown>[]) || []).map((r) => ({
          courtNumber: r.court_number as number,
          score: (r.score as string) ?? null,
          won: (r.won as boolean) ?? null,
        }))}
      />
    </div>
  );
}
