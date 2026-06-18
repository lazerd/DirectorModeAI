import { getSupabaseAdmin } from '@/lib/supabase/admin';
import EnterScores from './EnterScores';

export const dynamic = 'force-dynamic';

export default async function EnterScoresPage({ params }: { params: { slug: string } }) {
  const admin = getSupabaseAdmin();
  const { data: ev } = await admin
    .from('events')
    .select('id, name, format_notes')
    .eq('slug', params.slug)
    .maybeSingle();
  if (!ev) {
    return (
      <main style={{ fontFamily: 'system-ui, sans-serif', padding: 40, color: '#1f2937' }}>
        Event not found.
      </main>
    );
  }
  const e = ev as { id: string; name: string; format_notes: string | null };

  const { data: entries } = await admin
    .from('tournament_entries')
    .select('id, player_name, partner_name')
    .eq('event_id', e.id);
  const nameById = new Map(
    ((entries as Array<{ id: string; player_name: string; partner_name: string | null }>) || []).map((en) => [
      en.id,
      en.partner_name ? `${en.player_name} / ${en.partner_name}` : en.player_name,
    ])
  );

  const { data: matches } = await admin
    .from('tournament_matches')
    .select('id, score_token, round, slot, player1_id, player3_id, score, winner_side, status')
    .eq('event_id', e.id)
    .order('round')
    .order('slot');

  const rows = ((matches as Array<Record<string, unknown>>) || []).map((m) => ({
    token: m.score_token as string,
    a: (nameById.get(m.player1_id as string) as string) || 'TBD',
    b: (nameById.get(m.player3_id as string) as string) || 'TBD',
    score: (m.score as string) || '',
    winner_side: (m.winner_side as 'a' | 'b' | null) || null,
    status: m.status as string,
  }));

  return <EnterScores eventName={e.name} notes={e.format_notes || ''} matches={rows} />;
}
