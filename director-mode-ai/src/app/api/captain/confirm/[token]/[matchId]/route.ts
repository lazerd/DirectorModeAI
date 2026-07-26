/**
 * "I'll be there" confirmation from the 7-day lineup email.
 * No auth — the player token is the credential. Stamps whichever lineup slot
 * this player occupies for that match.
 */
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

type Ctx = { params: { token: string; matchId: string } };

export async function POST(_req: Request, { params }: Ctx) {
  const admin = getSupabaseAdmin();

  const { data: playerRow } = await admin
    .from('captain_players')
    .select('id, team_id, name')
    .eq('player_token', params.token)
    .maybeSingle();
  const player = playerRow as { id: string; team_id: string; name: string } | null;
  if (!player) return NextResponse.json({ error: 'Link not recognized.' }, { status: 404 });

  const { data: lineupRow } = await admin
    .from('captain_lineups')
    .select('id, team_id, match_id, player1_id, player2_id')
    .eq('match_id', params.matchId)
    .or(`player1_id.eq.${player.id},player2_id.eq.${player.id}`)
    .maybeSingle();
  const lineup = lineupRow as {
    id: string;
    team_id: string;
    match_id: string;
    player1_id: string | null;
    player2_id: string | null;
  } | null;

  if (!lineup || lineup.team_id !== player.team_id) {
    return NextResponse.json({ error: "You're not in this lineup." }, { status: 400 });
  }

  const col = lineup.player1_id === player.id ? 'player1_confirmed_at' : 'player2_confirmed_at';
  const { error } = await admin
    .from('captain_lineups')
    .update({ [col]: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', lineup.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await admin.from('captain_availability').upsert(
    {
      team_id: player.team_id,
      match_id: lineup.match_id,
      player_id: player.id,
      status: 'yes',
      responded_at: new Date().toISOString(),
    },
    { onConflict: 'match_id,player_id' },
  );

  return NextResponse.json({ ok: true, name: player.name });
}
