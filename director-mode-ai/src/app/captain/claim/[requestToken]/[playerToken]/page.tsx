import { getSupabaseAdmin } from '@/lib/supabase/admin';
import ClaimButton from './ClaimButton';

export const dynamic = 'force-dynamic';

const shell = (title: string, body: string) => (
  <main
    style={{
      fontFamily: 'system-ui, sans-serif',
      maxWidth: 520,
      margin: '0 auto',
      padding: 40,
      color: '#1f2937',
    }}
  >
    <h1 style={{ fontSize: 22 }}>{title}</h1>
    <p style={{ color: '#6b7280' }}>{body}</p>
  </main>
);

export default async function ClaimPage({
  params,
}: {
  params: { requestToken: string; playerToken: string };
}) {
  const admin = getSupabaseAdmin();

  const { data: reqRow } = await admin
    .from('captain_sub_requests')
    .select('id, team_id, match_id, status, claimed_by_player_id')
    .eq('request_token', params.requestToken)
    .maybeSingle();
  const { data: playerRow } = await admin
    .from('captain_players')
    .select('id, team_id, name')
    .eq('player_token', params.playerToken)
    .maybeSingle();

  const request = reqRow as {
    id: string;
    team_id: string;
    match_id: string;
    status: string;
    claimed_by_player_id: string | null;
  } | null;
  const player = playerRow as { id: string; team_id: string; name: string } | null;

  if (!request || !player || request.team_id !== player.team_id) {
    return shell('Link not recognized', 'Ask your captain to resend the request.');
  }

  const [{ data: match }, { data: team }] = await Promise.all([
    admin
      .from('captain_matches')
      .select('match_at, is_home, opponent, location')
      .eq('id', request.match_id)
      .maybeSingle(),
    admin.from('captain_teams').select('name').eq('id', request.team_id).maybeSingle(),
  ]);

  const m = match as {
    match_at: string;
    is_home: boolean;
    opponent: string | null;
    location: string | null;
  } | null;

  const when = m
    ? new Intl.DateTimeFormat('en-US', {
        weekday: 'long',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      }).format(new Date(m.match_at))
    : '';

  return (
    <ClaimButton
      requestToken={params.requestToken}
      playerToken={params.playerToken}
      playerName={player.name}
      teamName={(team as { name: string } | null)?.name || 'the team'}
      when={when}
      detail={[m?.opponent ? `vs ${m.opponent}` : null, m?.is_home ? 'Home' : 'Away', m?.location]
        .filter(Boolean)
        .join(' · ')}
      initialStatus={request.status}
      initiallyMine={request.claimed_by_player_id === player.id}
    />
  );
}
