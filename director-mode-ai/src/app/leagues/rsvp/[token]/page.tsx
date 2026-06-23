import { getSupabaseAdmin } from '@/lib/supabase/admin';
import RsvpList, { type RsvpMatch } from './RsvpList';

export const dynamic = 'force-dynamic';

export default async function RsvpPage({ params }: { params: { token: string } }) {
  const admin = getSupabaseAdmin();
  const { data: roster } = await admin
    .from('league_team_rosters')
    .select('id, player_name, division_id, club_id')
    .eq('player_token', params.token)
    .maybeSingle();

  if (!roster) {
    return (
      <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 540, margin: '0 auto', padding: 40, color: '#1f2937' }}>
        <h1 style={{ fontSize: 22 }}>Reservation link not found</h1>
        <p style={{ color: '#6b7280' }}>Ask your director to resend your availability link.</p>
      </main>
    );
  }
  const r = roster as { id: string; player_name: string; division_id: string; club_id: string };

  const { data: division } = await admin.from('league_divisions').select('id, name, league_id').eq('id', r.division_id).maybeSingle();
  const div = division as { id: string; name: string; league_id: string };
  const { data: club } = await admin.from('league_clubs').select('name').eq('id', r.club_id).maybeSingle();
  const { data: league } = await admin.from('leagues').select('name').eq('id', div.league_id).maybeSingle();
  const { data: clubs } = await admin.from('league_clubs').select('id, name, short_code').eq('league_id', div.league_id);
  const clubById = new Map((clubs as Array<{ id: string; name: string; short_code: string }> || []).map((c) => [c.id, c]));

  const { data: matchups } = await admin
    .from('league_team_matchups')
    .select('id, match_date, start_time, home_club_id, away_club_id, status')
    .eq('division_id', r.division_id)
    .or(`home_club_id.eq.${r.club_id},away_club_id.eq.${r.club_id}`)
    .order('match_date');
  const { data: avail } = await admin.from('league_player_availability').select('matchup_id, status').eq('roster_id', r.id);
  const statusOf = (mid: string) => (avail as Array<{ matchup_id: string; status: string }> || []).find((a) => a.matchup_id === mid)?.status as 'yes' | 'no' | undefined || null;

  const list: RsvpMatch[] = ((matchups as Array<Record<string, unknown>>) || []).map((m) => {
    const home = m.home_club_id === r.club_id;
    const opp = clubById.get((home ? m.away_club_id : m.home_club_id) as string);
    return {
      matchup_id: m.id as string,
      date: String(m.match_date).slice(0, 10),
      start_time: (m.start_time as string) || null,
      home,
      opponent: opp?.name || opp?.short_code || 'TBD',
      cancelled: m.status === 'cancelled' || m.status === 'postponed',
      status: statusOf(m.id as string),
    };
  });

  return (
    <RsvpList
      token={params.token}
      playerName={r.player_name}
      leagueName={league?.name || 'JTT League'}
      clubName={club?.name || ''}
      divisionName={div.name}
      matches={list}
    />
  );
}
