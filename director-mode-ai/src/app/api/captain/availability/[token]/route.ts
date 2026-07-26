/**
 * Player availability — the login-free surface.
 *   GET  /api/captain/availability/[token] — upcoming matches + current answers
 *   POST /api/captain/availability/[token] — { match_id, status:'yes'|'no'|'maybe' }
 *
 * No auth — the token is the credential. Every write re-validates that the
 * target match belongs to this player's team before touching anything.
 */
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

type PlayerRow = { id: string; team_id: string; name: string; active: boolean };

async function loadPlayer(token: string) {
  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from('captain_players')
    .select('id, team_id, name, active')
    .eq('player_token', token)
    .maybeSingle();
  return { admin, player: (data as PlayerRow) || null };
}

export async function GET(_req: Request, { params }: { params: { token: string } }) {
  const { admin, player } = await loadPlayer(params.token);
  if (!player) return NextResponse.json({ error: 'Link not recognized.' }, { status: 404 });

  const { data: team } = await admin
    .from('captain_teams')
    .select('id, name, level')
    .eq('id', player.team_id)
    .maybeSingle();

  const { data: matches } = await admin
    .from('captain_matches')
    .select('id, match_at, is_home, opponent, location, status')
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
      ?.status || null;

  return NextResponse.json({
    player: { name: player.name },
    team,
    matches: ((matches as Record<string, unknown>[]) || []).map((m) => ({
      id: m.id as string,
      match_at: m.match_at as string,
      is_home: m.is_home as boolean,
      opponent: (m.opponent as string) || null,
      location: (m.location as string) || null,
      status: statusOf(m.id as string),
    })),
  });
}

export async function POST(req: Request, { params }: { params: { token: string } }) {
  const { admin, player } = await loadPlayer(params.token);
  if (!player) return NextResponse.json({ error: 'Link not recognized.' }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as { match_id?: string; status?: string };
  const status = body.status;
  if (status !== 'yes' && status !== 'no' && status !== 'maybe') {
    return NextResponse.json({ error: "status must be 'yes', 'no' or 'maybe'." }, { status: 400 });
  }

  // The match must belong to this player's team — the token only speaks for
  // that team.
  const { data: match } = await admin
    .from('captain_matches')
    .select('id, team_id, status')
    .eq('id', body.match_id || '')
    .maybeSingle();
  const m = match as { id: string; team_id: string; status: string } | null;
  if (!m || m.team_id !== player.team_id) {
    return NextResponse.json({ error: 'That match is not on your schedule.' }, { status: 400 });
  }
  if (m.status !== 'scheduled') {
    return NextResponse.json({ error: 'That match is no longer scheduled.' }, { status: 400 });
  }

  const { error } = await admin.from('captain_availability').upsert(
    {
      team_id: player.team_id,
      match_id: m.id,
      player_id: player.id,
      status,
      responded_at: new Date().toISOString(),
    },
    { onConflict: 'match_id,player_id' },
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, status });
}
