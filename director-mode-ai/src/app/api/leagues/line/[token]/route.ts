/**
 * POST /api/leagues/line/[token]
 *
 * Magic-link score entry for a JTT matchup line. No auth required; the
 * token is the credential. Body:
 *   {
 *     winner: 'home' | 'away',
 *     score: string,              // e.g. "6-3, 6-4"
 *     reported_by_name?: string,  // whoever is scoring, for audit
 *     home_player1_id?, home_player2_id?,
 *     away_player1_id?, away_player2_id?
 *   }
 *
 * Only updates the line matching the token. Uses service role to bypass
 * RLS and set status='completed' + reporter audit fields.
 */

import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

type Body = {
  winner?: 'home' | 'away';
  score?: string;
  reported_by_name?: string;
  home_player1_id?: string | null;
  home_player2_id?: string | null;
  away_player1_id?: string | null;
  away_player2_id?: string | null;
};

export async function POST(
  request: Request,
  { params }: { params: { token: string } }
) {
  const token = params.token;
  if (!token || token.length < 8) {
    return NextResponse.json({ error: 'Invalid token.' }, { status: 400 });
  }

  const body = (await request.json().catch(() => ({}))) as Body;
  if (body.winner !== 'home' && body.winner !== 'away') {
    return NextResponse.json(
      { error: 'winner must be "home" or "away".' },
      { status: 400 }
    );
  }
  if (!body.score || typeof body.score !== 'string' || body.score.length > 100) {
    return NextResponse.json(
      { error: 'score is required (max 100 chars).' },
      { status: 400 }
    );
  }

  const admin = getSupabaseAdmin();
  const { data: existing, error: findErr } = await admin
    .from('league_matchup_lines')
    .select('id, status, matchup_id')
    .eq('score_token', token)
    .maybeSingle();

  if (findErr) {
    return NextResponse.json({ error: findErr.message }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: 'Token not recognized.' }, { status: 404 });
  }

  const patch: Record<string, any> = {
    winner: body.winner,
    score: body.score.trim(),
    status: 'completed',
    reported_at: new Date().toISOString(),
    reported_by_token: token,
    reported_by_name: body.reported_by_name?.slice(0, 80) || null,
  };
  if (body.home_player1_id !== undefined) patch.home_player1_id = body.home_player1_id;
  if (body.home_player2_id !== undefined) patch.home_player2_id = body.home_player2_id;
  if (body.away_player1_id !== undefined) patch.away_player1_id = body.away_player1_id;
  if (body.away_player2_id !== undefined) patch.away_player2_id = body.away_player2_id;

  const { error: updErr } = await admin
    .from('league_matchup_lines')
    .update(patch)
    .eq('id', (existing as any).id);

  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

export async function GET(
  _request: Request,
  { params }: { params: { token: string } }
) {
  const token = params.token;
  if (!token || token.length < 8) {
    return NextResponse.json({ error: 'Invalid token.' }, { status: 400 });
  }
  const admin = getSupabaseAdmin();

  const { data: line } = await admin
    .from('league_matchup_lines')
    .select('*')
    .eq('score_token', token)
    .maybeSingle();
  if (!line) {
    return NextResponse.json({ error: 'Token not recognized.' }, { status: 404 });
  }

  const lineRow = line as any;
  const [mRes, lRosters] = await Promise.all([
    admin
      .from('league_team_matchups')
      .select('*, division:league_divisions(id, name, league_id), home_club:league_clubs!league_team_matchups_home_club_id_fkey(*), away_club:league_clubs!league_team_matchups_away_club_id_fkey(*)')
      .eq('id', lineRow.matchup_id)
      .single(),
    admin
      .from('league_team_rosters')
      .select('id, division_id, club_id, player_name, ladder_position, status'),
  ]);

  const matchup = (mRes.data as any) || null;
  if (!matchup) {
    return NextResponse.json({ error: 'Matchup not found.' }, { status: 404 });
  }

  const rostersList = ((lRosters.data as any[]) || []).filter(
    r => r.division_id === matchup.division.id
  );
  const homeRosters = rostersList
    .filter(r => r.club_id === matchup.home_club_id)
    .sort((a, b) => (a.ladder_position ?? 9999) - (b.ladder_position ?? 9999));
  const awayRosters = rostersList
    .filter(r => r.club_id === matchup.away_club_id)
    .sort((a, b) => (a.ladder_position ?? 9999) - (b.ladder_position ?? 9999));

  return NextResponse.json({
    line: lineRow,
    matchup,
    homeClub: matchup.home_club,
    awayClub: matchup.away_club,
    division: matchup.division,
    homeRosters,
    awayRosters,
  });
}
