import { getSupabaseAdmin } from '@/lib/supabase/admin';
import ConfirmButton from './ConfirmButton';

export const dynamic = 'force-dynamic';

export default async function ConfirmPage({
  params,
}: {
  params: { token: string; matchId: string };
}) {
  const admin = getSupabaseAdmin();

  const { data: playerRow } = await admin
    .from('captain_players')
    .select('id, team_id, name')
    .eq('player_token', params.token)
    .maybeSingle();
  const player = playerRow as { id: string; team_id: string; name: string } | null;

  if (!player) {
    return (
      <main
        style={{
          fontFamily: 'system-ui, sans-serif',
          maxWidth: 520,
          margin: '0 auto',
          padding: 40,
          color: '#1f2937',
        }}
      >
        <h1 style={{ fontSize: 22 }}>Link not recognized</h1>
        <p style={{ color: '#6b7280' }}>Ask your captain to resend the lineup.</p>
      </main>
    );
  }

  const [{ data: match }, { data: team }, { data: lineup }] = await Promise.all([
    admin
      .from('captain_matches')
      .select('match_at, is_home, opponent, location, arrival_note')
      .eq('id', params.matchId)
      .eq('team_id', player.team_id)
      .maybeSingle(),
    admin.from('captain_teams').select('name').eq('id', player.team_id).maybeSingle(),
    admin
      .from('captain_lineups')
      .select('court_number, court_type, player1_id, player2_id, player1_confirmed_at, player2_confirmed_at')
      .eq('match_id', params.matchId)
      .or(`player1_id.eq.${player.id},player2_id.eq.${player.id}`)
      .maybeSingle(),
  ]);

  const m = match as {
    match_at: string;
    is_home: boolean;
    opponent: string | null;
    location: string | null;
    arrival_note: string | null;
  } | null;
  const l = lineup as {
    court_number: number;
    court_type: string;
    player1_id: string | null;
    player1_confirmed_at: string | null;
    player2_confirmed_at: string | null;
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

  const already = l
    ? l.player1_id === player.id
      ? !!l.player1_confirmed_at
      : !!l.player2_confirmed_at
    : false;

  return (
    <ConfirmButton
      token={params.token}
      matchId={params.matchId}
      playerName={player.name}
      teamName={(team as { name: string } | null)?.name || 'your team'}
      when={when}
      detail={[m?.opponent ? `vs ${m.opponent}` : null, m?.is_home ? 'Home' : 'Away', m?.location, m?.arrival_note]
        .filter(Boolean)
        .join(' · ')}
      court={l ? `${l.court_type === 'singles' ? 'Singles' : 'Doubles'} ${l.court_number}` : null}
      inLineup={!!l}
      alreadyConfirmed={already}
    />
  );
}
