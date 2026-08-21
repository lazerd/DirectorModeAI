import { getSupabaseAdmin } from '@/lib/supabase/admin';
import AvailabilityList, { type AvailMatch } from './AvailabilityList';

export const dynamic = 'force-dynamic';

export default async function CaptainAvailabilityPage({
  params,
  searchParams,
}: {
  params: { token: string };
  searchParams: { m?: string; r?: string };
}) {
  const admin = getSupabaseAdmin();
  const { data: playerRow } = await admin
    .from('captain_players')
    .select('id, team_id, name, active')
    .eq('player_token', params.token)
    .maybeSingle();

  if (!playerRow) {
    return (
      <div style={{ colorScheme: 'light', background: '#f1f5f9', minHeight: '100vh' }}>
        <main
          style={{
            fontFamily: 'system-ui, sans-serif',
            maxWidth: 540,
            margin: '0 auto',
            padding: 40,
            color: '#0f172a',
          }}
        >
          <h1 style={{ fontSize: 22 }}>Link not recognized</h1>
          <p style={{ color: '#475569' }}>Ask your captain to resend your availability link.</p>
        </main>
      </div>
    );
  }
  const player = playerRow as { id: string; team_id: string; name: string; active: boolean };

  const { data: team } = await admin
    .from('captain_teams')
    .select('name, level')
    .eq('id', player.team_id)
    .maybeSingle();

  const { data: matches } = await admin
    .from('captain_matches')
    .select('id, match_at, is_home, opponent, location')
    .eq('team_id', player.team_id)
    .eq('status', 'scheduled')
    .gte('match_at', new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString())
    .order('match_at');

  const { data: avail } = await admin
    .from('captain_availability')
    .select('match_id, status')
    .eq('player_id', player.id);

  const statusOf = (id: string) =>
    ((avail as { match_id: string; status: string }[]) || []).find((a) => a.match_id === id)
      ?.status ?? null;

  const list: AvailMatch[] = ((matches as Record<string, unknown>[]) || []).map((m) => ({
    id: m.id as string,
    matchAt: m.match_at as string,
    isHome: m.is_home as boolean,
    opponent: (m.opponent as string) || null,
    location: (m.location as string) || null,
    status: statusOf(m.id as string) as AvailMatch['status'],
  }));

  const t = team as { name: string; level: string | null } | null;
  const pre =
    searchParams.m && ['yes', 'no', 'maybe'].includes(searchParams.r || '')
      ? { matchId: searchParams.m, status: searchParams.r as 'yes' | 'no' | 'maybe' }
      : null;

  return (
    <AvailabilityList
      token={params.token}
      playerName={player.name}
      teamName={t?.name || 'Your team'}
      teamLevel={t?.level || null}
      matches={list}
      preselect={pre}
    />
  );
}
