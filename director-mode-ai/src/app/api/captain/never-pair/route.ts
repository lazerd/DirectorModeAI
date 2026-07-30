/**
 * Never-pair list.
 *   POST   { team_id, player_a_id, player_b_id } — add a pairing to block
 *   DELETE ?team_id=…&id=…                       — unblock it
 *
 * The generator has always enforced this list (pairIsLegal) and the table has
 * always existed; nothing could write to it. It is a HARD constraint, so a
 * blocked pair is never played no matter how well the two score together.
 */
import { NextResponse } from 'next/server';
import { requireTeam, isError } from '@/lib/captain/server';

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    team_id?: string;
    player_a_id?: string;
    player_b_id?: string;
  };

  const ctx = await requireTeam(body.team_id || '');
  if (isError(ctx)) return ctx.error;

  const { player_a_id: a, player_b_id: b } = body;
  if (!a || !b) {
    return NextResponse.json({ error: 'Pick two players.' }, { status: 400 });
  }
  if (a === b) {
    return NextResponse.json({ error: 'That is the same player twice.' }, { status: 400 });
  }

  // Both must be on this team — the caller's ids are only a request.
  const { data: mine } = await ctx.db
    .from('captain_players')
    .select('id')
    .eq('team_id', ctx.teamId)
    .in('id', [a, b]);
  if (((mine as { id: string }[]) || []).length !== 2) {
    return NextResponse.json({ error: 'Those players are not on this team.' }, { status: 400 });
  }

  // Store in a stable order so (a,b) and (b,a) can't both be recorded.
  const [lo, hi] = a < b ? [a, b] : [b, a];

  const { data: existing } = await ctx.db
    .from('captain_never_pair')
    .select('id')
    .eq('team_id', ctx.teamId)
    .eq('player_a_id', lo)
    .eq('player_b_id', hi)
    .maybeSingle();
  if (existing) return NextResponse.json({ ok: true, id: (existing as { id: string }).id });

  const { data, error } = await ctx.db
    .from('captain_never_pair')
    .insert({ team_id: ctx.teamId, player_a_id: lo, player_b_id: hi })
    .select('id')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, id: (data as { id: string }).id });
}

export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const ctx = await requireTeam(url.searchParams.get('team_id') || '');
  if (isError(ctx)) return ctx.error;

  const id = url.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required.' }, { status: 400 });

  const { error } = await ctx.db
    .from('captain_never_pair')
    .delete()
    .eq('id', id)
    .eq('team_id', ctx.teamId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
