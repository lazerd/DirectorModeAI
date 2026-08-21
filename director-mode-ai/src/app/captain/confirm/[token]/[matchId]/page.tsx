import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { googleCalendarUrl, matchEvent } from '@/lib/captain/calendar';
import { CLUB_TZ } from '@/lib/captain/clubTime';
import type { MatchInfo } from '@/lib/captain/emails';
import ConfirmButton from './ConfirmButton';

export const dynamic = 'force-dynamic';

/**
 * The landing page for both lineup-email buttons. `?a=in` / `?a=out` only
 * PRE-SELECTS which panel is open — neither fires on arrival. A confirm could
 * safely auto-apply, but a withdrawal cannot: an accidental tap in a mail app
 * would pull someone out of a match and page the captain, so both actions cost
 * one deliberate tap on this page.
 */
export default async function ConfirmPage({
  params,
  searchParams,
}: {
  params: { token: string; matchId: string };
  searchParams: { a?: string };
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
      <div style={{ colorScheme: 'light', background: '#f1f5f9', minHeight: '100vh' }}>
        <main
          style={{
            fontFamily: 'system-ui, sans-serif',
            maxWidth: 520,
            margin: '0 auto',
            padding: 40,
            color: '#0f172a',
          }}
        >
          <h1 style={{ fontSize: 22 }}>Link not recognized</h1>
          <p style={{ color: '#475569' }}>Ask your captain to resend the lineup.</p>
        </main>
      </div>
    );
  }

  const [{ data: match }, { data: team }, { data: lineup }] = await Promise.all([
    admin
      .from('captain_matches')
      .select(
        'id, match_at, is_home, opponent, location, arrival_note, opposing_captain_name, opposing_captain_phone',
      )
      .eq('id', params.matchId)
      .eq('team_id', player.team_id)
      .maybeSingle(),
    admin.from('captain_teams').select('name').eq('id', player.team_id).maybeSingle(),
    admin
      .from('captain_lineups')
      .select(
        'court_number, court_type, player1_id, player2_id, player1_confirmed_at, player2_confirmed_at, player1_declined_at, player2_declined_at',
      )
      .eq('match_id', params.matchId)
      .or(`player1_id.eq.${player.id},player2_id.eq.${player.id}`)
      .maybeSingle(),
  ]);

  const m = match as Record<string, unknown> | null;
  const l = lineup as {
    court_number: number;
    court_type: string;
    player1_id: string | null;
    player1_confirmed_at: string | null;
    player2_confirmed_at: string | null;
    player1_declined_at: string | null;
    player2_declined_at: string | null;
  } | null;

  // Vercel runs UTC. Without an explicit zone a 9:30am match reads as 4:30 PM.
  const when = m
    ? new Intl.DateTimeFormat('en-US', {
        weekday: 'long',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZone: CLUB_TZ,
      }).format(new Date(m.match_at as string))
    : '';

  const isSlot1 = l ? l.player1_id === player.id : false;
  const already = l ? !!(isSlot1 ? l.player1_confirmed_at : l.player2_confirmed_at) : false;
  const declined = l ? !!(isSlot1 ? l.player1_declined_at : l.player2_declined_at) : false;
  const court = l ? `${l.court_type === 'singles' ? 'Singles' : 'Doubles'} ${l.court_number}` : null;

  const teamName = (team as { name: string } | null)?.name || 'your team';

  let googleUrl: string | null = null;
  if (m) {
    const info: MatchInfo = {
      id: m.id as string,
      matchAt: m.match_at as string,
      isHome: m.is_home as boolean,
      opponent: (m.opponent as string) || null,
      location: (m.location as string) || null,
      arrivalNote: (m.arrival_note as string) || null,
      opposingCaptainName: (m.opposing_captain_name as string) || null,
      opposingCaptainPhone: (m.opposing_captain_phone as string) || null,
    };
    googleUrl = googleCalendarUrl(matchEvent(teamName, info, court));
  }

  return (
    <ConfirmButton
      token={params.token}
      matchId={params.matchId}
      playerName={player.name}
      teamName={teamName}
      when={when}
      detail={[
        m?.opponent ? `vs ${m.opponent}` : null,
        m?.is_home ? 'Home' : 'Away',
        m?.location,
        m?.arrival_note,
      ]
        .filter(Boolean)
        .join(' · ')}
      court={court}
      inLineup={!!l}
      alreadyConfirmed={already}
      alreadyDeclined={declined}
      openPanel={searchParams?.a === 'out' ? 'out' : null}
      googleUrl={googleUrl}
      icsUrl={`/api/captain/calendar/${params.token}/${params.matchId}`}
    />
  );
}
