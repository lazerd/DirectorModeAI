/**
 * Pre-season intake, reached from the emailed link. No login — the token is the
 * credential, same contract as /captain/availability/[token].
 */

import { getSupabaseAdmin } from '@/lib/supabase/admin';
import IntakeForm from './IntakeForm';

export const dynamic = 'force-dynamic';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const shell: React.CSSProperties = {
  fontFamily: 'system-ui, sans-serif',
  maxWidth: 540,
  margin: '0 auto',
  padding: 24,
  color: '#1f2937',
};

export default async function CaptainIntakePage({ params }: { params: { token: string } }) {
  const admin = getSupabaseAdmin();
  const { data: playerRow } = await admin
    .from('captain_players')
    .select(
      'id, team_id, name, active, return_side, court_limit, unavailable_days, notes, intake_completed_at',
    )
    .eq('player_token', params.token)
    .maybeSingle();

  if (!playerRow || !(playerRow as { active: boolean }).active) {
    return (
      <main style={shell}>
        <h1 style={{ fontSize: 22 }}>Link not recognized</h1>
        <p style={{ color: '#6b7280' }}>Ask your captain to resend your link.</p>
      </main>
    );
  }

  const player = playerRow as {
    id: string;
    team_id: string;
    name: string;
    return_side: string | null;
    court_limit: string | null;
    unavailable_days: string[] | null;
    notes: string | null;
    intake_completed_at: string | null;
  };

  const [{ data: team }, { data: mates }, { data: prefs }] = await Promise.all([
    admin.from('captain_teams').select('name').eq('id', player.team_id).maybeSingle(),
    admin
      .from('captain_players')
      .select('id, name')
      .eq('team_id', player.team_id)
      .eq('active', true)
      .neq('id', player.id)
      .order('name'),
    admin
      .from('captain_partner_prefs')
      .select('preferred_player_id, rank')
      .eq('player_id', player.id)
      .order('rank'),
  ]);

  return (
    <main style={shell}>
      <IntakeForm
        token={params.token}
        playerName={player.name}
        teamName={(team as { name: string } | null)?.name ?? 'your team'}
        teammates={(mates as { id: string; name: string }[]) || []}
        days={DAYS}
        current={{
          return_side: player.return_side,
          court_limit: player.court_limit,
          unavailable_days: player.unavailable_days || [],
          notes: player.notes,
          partner_ids: ((prefs as { preferred_player_id: string }[]) || []).map(
            (p) => p.preferred_player_id,
          ),
          completed_at: player.intake_completed_at,
        }}
      />
    </main>
  );
}
