/**
 * Rain-out makeup poll — the player's side. No auth: the token is the
 * credential, and every write re-checks that the poll belongs to this player's
 * team before touching anything.
 *   POST { poll_id, option_index, answer: 'yes'|'no' }
 */
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

export async function POST(req: Request, { params }: { params: { token: string } }) {
  const admin = getSupabaseAdmin();
  const { data: player } = await admin
    .from('captain_players')
    .select('id, team_id')
    .eq('player_token', params.token)
    .maybeSingle();
  if (!player) return NextResponse.json({ error: 'Link not recognized.' }, { status: 404 });
  const p = player as { id: string; team_id: string };

  const body = (await req.json().catch(() => ({}))) as {
    poll_id?: string;
    option_index?: number;
    answer?: string;
  };
  if (body.answer !== 'yes' && body.answer !== 'no') {
    return NextResponse.json({ error: "answer must be 'yes' or 'no'." }, { status: 400 });
  }

  const { data: poll } = await admin
    .from('captain_makeup_polls')
    .select('id, team_id, options')
    .eq('id', body.poll_id || '')
    .maybeSingle();
  const pl = poll as { id: string; team_id: string; options: { at: string }[] } | null;
  if (!pl || pl.team_id !== p.team_id) {
    return NextResponse.json({ error: 'That poll is not for your team.' }, { status: 404 });
  }
  const idx = Number(body.option_index);
  if (!Number.isInteger(idx) || idx < 0 || idx >= pl.options.length) {
    return NextResponse.json({ error: 'Unknown date.' }, { status: 400 });
  }

  const { error } = await admin.from('captain_makeup_votes').upsert(
    {
      poll_id: pl.id,
      player_id: p.id,
      option_index: idx,
      answer: body.answer,
      responded_at: new Date().toISOString(),
    },
    { onConflict: 'poll_id,player_id,option_index' },
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
