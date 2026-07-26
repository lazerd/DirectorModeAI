/**
 * Sub claim — first to tap wins.
 *   GET  — what's being offered (so the page can render before claiming)
 *   POST — attempt the claim
 *
 * No auth; two tokens are the credential (which request, which player).
 *
 * The race is resolved by a single conditional UPDATE — never read-then-write.
 * If zero rows come back, somebody else got there first.
 */
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

type Ctx = { params: { requestToken: string; playerToken: string } };

async function load(requestToken: string, playerToken: string) {
  const admin = getSupabaseAdmin();
  const { data: reqRow } = await admin
    .from('captain_sub_requests')
    .select('id, team_id, match_id, lineup_id, slot, status, claimed_by_player_id')
    .eq('request_token', requestToken)
    .maybeSingle();
  const { data: playerRow } = await admin
    .from('captain_players')
    .select('id, team_id, name, active')
    .eq('player_token', playerToken)
    .maybeSingle();
  return {
    admin,
    request: reqRow as {
      id: string;
      team_id: string;
      match_id: string;
      lineup_id: string | null;
      slot: number;
      status: string;
      claimed_by_player_id: string | null;
    } | null,
    player: playerRow as { id: string; team_id: string; name: string; active: boolean } | null,
  };
}

export async function GET(_req: Request, { params }: Ctx) {
  const { admin, request, player } = await load(params.requestToken, params.playerToken);
  if (!request || !player || request.team_id !== player.team_id) {
    return NextResponse.json({ error: 'Link not recognized.' }, { status: 404 });
  }

  const { data: match } = await admin
    .from('captain_matches')
    .select('id, match_at, is_home, opponent, location')
    .eq('id', request.match_id)
    .maybeSingle();
  const { data: team } = await admin
    .from('captain_teams')
    .select('name')
    .eq('id', request.team_id)
    .maybeSingle();

  let claimedByYou = false;
  if (request.claimed_by_player_id) claimedByYou = request.claimed_by_player_id === player.id;

  return NextResponse.json({
    player: { name: player.name },
    team,
    match,
    status: request.status,
    claimedByYou,
  });
}

export async function POST(_req: Request, { params }: Ctx) {
  const { admin, request, player } = await load(params.requestToken, params.playerToken);
  if (!request || !player || request.team_id !== player.team_id) {
    return NextResponse.json({ error: 'Link not recognized.' }, { status: 404 });
  }
  if (!player.active) {
    return NextResponse.json({ error: 'You are no longer on this roster.' }, { status: 400 });
  }

  // Single conditional update decides the winner.
  const { data: won, error } = await admin
    .from('captain_sub_requests')
    .update({
      status: 'filled',
      claimed_by_player_id: player.id,
      claimed_at: new Date().toISOString(),
    })
    .eq('id', request.id)
    .eq('status', 'open')
    .select('id')
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (!won) {
    const alreadyYours = request.claimed_by_player_id === player.id;
    return NextResponse.json(
      { ok: false, filled: true, claimedByYou: alreadyYours },
      { status: 200 },
    );
  }

  // Slot the claimer into the lineup they're covering.
  if (request.lineup_id) {
    const col = request.slot === 2 ? 'player2_id' : 'player1_id';
    const confirmCol = request.slot === 2 ? 'player2_confirmed_at' : 'player1_confirmed_at';
    await admin
      .from('captain_lineups')
      .update({
        [col]: player.id,
        [confirmCol]: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', request.lineup_id);
  }

  // Claiming is also a statement of availability.
  await admin.from('captain_availability').upsert(
    {
      team_id: player.team_id,
      match_id: request.match_id,
      player_id: player.id,
      status: 'yes',
      responded_at: new Date().toISOString(),
    },
    { onConflict: 'match_id,player_id' },
  );

  return NextResponse.json({ ok: true, filled: true, claimedByYou: true });
}
