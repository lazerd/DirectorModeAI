/**
 * GET    /api/leagues/roster/[token] — fetch club info, divisions, and roster
 * POST   /api/leagues/roster/[token] — add a player to the club's roster
 * PATCH  /api/leagues/roster/[token] — reorder players (swap ladder positions)
 * DELETE /api/leagues/roster/[token] — remove a player by id
 *
 * Magic-link roster management for JTT coaches. No auth required; the
 * roster_token on league_clubs is the credential. Uses service role to
 * bypass RLS.
 */

import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

async function resolveClub(token: string) {
  if (!token || token.length < 8) return null;
  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from('league_clubs')
    .select('id, league_id, name, short_code')
    .eq('roster_token', token)
    .maybeSingle();
  return data as { id: string; league_id: string; name: string; short_code: string } | null;
}

export async function GET(
  _request: Request,
  { params }: { params: { token: string } }
) {
  const club = await resolveClub(params.token);
  if (!club) {
    return NextResponse.json({ error: 'Token not recognized.' }, { status: 404 });
  }

  const admin = getSupabaseAdmin();

  const [leagueRes, divsRes, dcRes, rosterRes] = await Promise.all([
    admin.from('leagues').select('id, name, slug, status').eq('id', club.league_id).single(),
    admin.from('league_divisions').select('id, name, short_code, sort_order').eq('league_id', club.league_id).order('sort_order'),
    admin.from('league_division_clubs').select('division_id, club_id').eq('club_id', club.id),
    admin.from('league_team_rosters').select('id, division_id, club_id, player_name, ntrp, utr, ladder_position, status').eq('club_id', club.id).order('ladder_position', { ascending: true, nullsFirst: false }),
  ]);

  const league = leagueRes.data as any;
  const divisions = (divsRes.data || []) as any[];
  const divisionClubs = (dcRes.data || []) as any[];
  const rosters = (rosterRes.data || []) as any[];

  // Only return divisions this club participates in
  const clubDivisionIds = new Set(divisionClubs.map((dc: any) => dc.division_id));
  const clubDivisions = divisions.filter((d: any) => clubDivisionIds.has(d.id));

  return NextResponse.json({
    club,
    league,
    divisions: clubDivisions,
    rosters,
  });
}

export async function POST(
  request: Request,
  { params }: { params: { token: string } }
) {
  const club = await resolveClub(params.token);
  if (!club) {
    return NextResponse.json({ error: 'Token not recognized.' }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const { division_id, player_name, ntrp, utr } = body as Record<string, any>;

  if (!division_id || !player_name?.trim()) {
    return NextResponse.json(
      { error: 'division_id and player_name are required.' },
      { status: 400 }
    );
  }

  const admin = getSupabaseAdmin();

  // Verify this club is in the requested division
  const { data: dcCheck } = await admin
    .from('league_division_clubs')
    .select('id')
    .eq('club_id', club.id)
    .eq('division_id', division_id)
    .maybeSingle();

  if (!dcCheck) {
    return NextResponse.json(
      { error: 'Your club does not participate in this division.' },
      { status: 400 }
    );
  }

  // Get current max ladder position for this club+division
  const { data: existing } = await admin
    .from('league_team_rosters')
    .select('ladder_position')
    .eq('club_id', club.id)
    .eq('division_id', division_id)
    .order('ladder_position', { ascending: false, nullsFirst: true })
    .limit(1);

  const nextLadder = ((existing?.[0] as any)?.ladder_position || 0) + 1;

  const { data: inserted, error: insErr } = await admin
    .from('league_team_rosters')
    .insert({
      division_id,
      club_id: club.id,
      player_name: player_name.trim(),
      ntrp: ntrp ? parseFloat(ntrp) : null,
      utr: utr ? parseFloat(utr) : null,
      ladder_position: nextLadder,
      status: 'active',
    })
    .select('id, player_name, division_id, ladder_position')
    .single();

  if (insErr) {
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, player: inserted });
}

export async function PATCH(
  request: Request,
  { params }: { params: { token: string } }
) {
  const club = await resolveClub(params.token);
  if (!club) {
    return NextResponse.json({ error: 'Token not recognized.' }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const swaps = body?.swaps as Array<{ id: string; ladder_position: number }> | undefined;

  if (!swaps || !Array.isArray(swaps) || swaps.length === 0) {
    return NextResponse.json(
      { error: 'swaps array is required.' },
      { status: 400 }
    );
  }

  const admin = getSupabaseAdmin();

  // Verify all players belong to this club before updating
  const { data: owned } = await admin
    .from('league_team_rosters')
    .select('id')
    .eq('club_id', club.id)
    .in('id', swaps.map(s => s.id));

  const ownedIds = new Set((owned || []).map((r: any) => r.id));
  const unauthorized = swaps.filter(s => !ownedIds.has(s.id));
  if (unauthorized.length > 0) {
    return NextResponse.json(
      { error: 'Cannot reorder players from another club.' },
      { status: 403 }
    );
  }

  // Apply all position swaps
  for (const swap of swaps) {
    await admin
      .from('league_team_rosters')
      .update({ ladder_position: swap.ladder_position })
      .eq('id', swap.id);
  }

  return NextResponse.json({ success: true });
}

export async function DELETE(
  request: Request,
  { params }: { params: { token: string } }
) {
  const club = await resolveClub(params.token);
  if (!club) {
    return NextResponse.json({ error: 'Token not recognized.' }, { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const playerId = searchParams.get('playerId');
  if (!playerId) {
    return NextResponse.json({ error: 'playerId is required.' }, { status: 400 });
  }

  const admin = getSupabaseAdmin();

  // Only allow deleting players that belong to this club
  const { error: delErr } = await admin
    .from('league_team_rosters')
    .delete()
    .eq('id', playerId)
    .eq('club_id', club.id);

  if (delErr) {
    return NextResponse.json({ error: delErr.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
