/**
 * POST /api/leagues/[id]/seed-fake-rosters
 *
 * Fills every (division, club) pair in a JTT league with a handful of
 * fake active players so the director can exercise check-in, auto-assign,
 * and the line optimizer without hand-entering names.
 *
 * Body:
 *   {
 *     playersPerTeam?: number,   // default 8
 *     overwrite?: boolean        // default false — skip teams that already
 *                                // have any rosters. With true, wipes first.
 *   }
 *
 * Only the league's director can run this.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

const FIRST_NAMES = [
  'Ava', 'Ben', 'Chloe', 'Diego', 'Ella', 'Finn', 'Gabi', 'Henry',
  'Isla', 'Jace', 'Kai', 'Lila', 'Mason', 'Nora', 'Owen', 'Piper',
  'Quinn', 'Ruby', 'Sawyer', 'Tess', 'Uma', 'Vik', 'Wren', 'Xander',
  'Yumi', 'Zane',
];

const LAST_NAMES = [
  'Ahmed', 'Brown', 'Chen', 'Davis', 'Evans', 'Fernandez',
  'Garcia', 'Hughes', 'Ito', 'Jackson', 'Kim', 'Lee',
  'Martin', 'Nguyen', 'Obi', 'Patel', 'Reed', 'Singh',
  'Tran', 'Umeda', 'Vargas', 'Walsh',
];

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const leagueId = params.id;
  if (!leagueId) {
    return NextResponse.json({ error: 'Missing league id.' }, { status: 400 });
  }

  const userClient = await createClient();
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }

  const admin = getSupabaseAdmin();

  const { data: league } = await admin
    .from('leagues')
    .select('id, director_id, format')
    .eq('id', leagueId)
    .single();
  if (!league) {
    return NextResponse.json({ error: 'League not found.' }, { status: 404 });
  }
  if ((league as any).director_id !== user.id) {
    return NextResponse.json({ error: 'Not your league.' }, { status: 403 });
  }
  if ((league as any).format !== 'team') {
    return NextResponse.json(
      { error: 'Only team-format leagues can be seeded with fake rosters.' },
      { status: 400 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const playersPerTeam =
    typeof body?.playersPerTeam === 'number'
      ? Math.min(Math.max(1, Math.floor(body.playersPerTeam)), 24)
      : 8;
  const overwrite = body?.overwrite === true;

  // Pull division-club pairs for this league
  const { data: divisions } = await admin
    .from('league_divisions')
    .select('id, short_code, sort_order')
    .eq('league_id', leagueId);
  const { data: clubs } = await admin
    .from('league_clubs')
    .select('id, short_code')
    .eq('league_id', leagueId);
  const { data: divisionClubs } = await admin
    .from('league_division_clubs')
    .select('division_id, club_id');

  const divList = (divisions as any[]) || [];
  const clubList = (clubs as any[]) || [];
  const dcList = (divisionClubs as any[]) || [];

  const divIds = new Set(divList.map(d => d.id));
  const relevantDc = dcList.filter(dc => divIds.has(dc.division_id));

  const clubById = new Map(clubList.map(c => [c.id, c]));

  // Existing rosters for these divisions
  const { data: existing } = await admin
    .from('league_team_rosters')
    .select('id, division_id, club_id')
    .in(
      'division_id',
      divList.map(d => d.id)
    );
  const existingKey = new Set(
    ((existing as any[]) || []).map(r => `${r.division_id}:${r.club_id}`)
  );

  // Optional wipe
  if (overwrite && existing && (existing as any[]).length > 0) {
    await admin
      .from('league_team_rosters')
      .delete()
      .in(
        'id',
        (existing as any[]).map(r => r.id)
      );
  }

  const rowsToInsert: Array<any> = [];
  let n = 0;

  for (const dc of relevantDc) {
    const key = `${dc.division_id}:${dc.club_id}`;
    if (!overwrite && existingKey.has(key)) continue;

    const club = clubById.get(dc.club_id);
    if (!club) continue;

    const baseUtr = 3 + Math.random() * 6; // varies team "strength" a bit
    for (let i = 0; i < playersPerTeam; i++) {
      const first = FIRST_NAMES[(n + i) % FIRST_NAMES.length];
      const last = LAST_NAMES[(n * 3 + i * 7) % LAST_NAMES.length];
      const utr = Math.max(1, Math.min(12, baseUtr - i * 0.3 + (Math.random() - 0.5)));
      rowsToInsert.push({
        division_id: dc.division_id,
        club_id: dc.club_id,
        player_name: `${first} ${last} (${(club as any).short_code})`,
        utr: Number(utr.toFixed(2)),
        ntrp: null,
        ladder_position: i + 1,
        status: 'active',
      });
    }
    n += playersPerTeam;
  }

  if (rowsToInsert.length === 0) {
    return NextResponse.json({
      success: true,
      inserted: 0,
      note: overwrite
        ? 'Nothing to insert — check your division-club assignments.'
        : 'All teams already have rosters. Pass { overwrite: true } to wipe and reseed.',
    });
  }

  const { error: insErr } = await admin.from('league_team_rosters').insert(rowsToInsert);
  if (insErr) {
    return NextResponse.json(
      { error: `Insert failed: ${insErr.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    inserted: rowsToInsert.length,
    playersPerTeam,
    teamsSeeded: rowsToInsert.length / playersPerTeam,
  });
}
