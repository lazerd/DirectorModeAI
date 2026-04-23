/**
 * POST /api/leagues/seed-lamorinda-jtt
 *
 * Creates the Lamorinda JTT Summer 2026 league end-to-end:
 *   - leagues row (format=team)
 *   - 5 clubs (OCC, MCC, Rancho, Sleepy Hollow, Meadow)
 *   - 4 divisions (10&U / 12&U / 13&O Tuesdays, Open Thursdays)
 *   - league_division_clubs (Meadow 10U-only; others in all 4)
 *   - league_team_matchups for the full season (Jun 9 – Jul 16)
 *   - empty league_matchup_lines for each matchup per division.line_format
 *
 * Idempotent-ish: refuses to run if a league with the seed slug already
 * exists for the director. Pass `overwrite: true` to delete-and-recreate.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { LAMORINDA_2026, linesForFormat } from '@/lib/jtt';

export async function POST(request: Request) {
  try {
    const userClient = await createClient();
    const {
      data: { user },
    } = await userClient.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: 'Sign in as a director first.' },
        { status: 401 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const overwrite = body?.overwrite === true;

    const admin = getSupabaseAdmin();
    const seed = LAMORINDA_2026;

    // If the slug already exists for this director, either bail or wipe.
    const { data: existing } = await admin
      .from('leagues')
      .select('id, director_id')
      .eq('slug', seed.leagueSlug)
      .maybeSingle();

    if (existing && !overwrite) {
      return NextResponse.json(
        {
          error: `League "${seed.leagueSlug}" already exists. Pass { overwrite: true } to wipe and recreate.`,
          existingLeagueId: (existing as any).id,
        },
        { status: 409 }
      );
    }

    if (existing && overwrite) {
      await admin.from('leagues').delete().eq('id', (existing as any).id);
    }

    // 1. League
    const { data: league, error: leagueErr } = await admin
      .from('leagues')
      .insert({
        director_id: user.id,
        name: seed.leagueName,
        slug: seed.leagueSlug,
        description:
          'Five-club junior team tennis league — Tuesdays (10&U / 12&U / 13&O) and Thursdays (Open). Season-ending tournament Jul 21.',
        format: 'team',
        league_type: 'round_robin',
        start_date: seed.start_date,
        end_date: seed.end_date,
        status: 'running',
      })
      .select('id')
      .single();

    if (leagueErr || !league) {
      return NextResponse.json(
        { error: `Failed to create league: ${leagueErr?.message}` },
        { status: 500 }
      );
    }
    const leagueId = (league as any).id as string;

    // 2. Clubs
    const clubRows = seed.clubs.map((c, i) => ({
      league_id: leagueId,
      name: c.name,
      short_code: c.short_code,
      sort_order: i,
    }));
    const { data: clubs, error: clubsErr } = await admin
      .from('league_clubs')
      .insert(clubRows)
      .select('id, short_code');
    if (clubsErr || !clubs) {
      return NextResponse.json(
        { error: `Failed to create clubs: ${clubsErr?.message}` },
        { status: 500 }
      );
    }
    const clubIdByShort = new Map<string, string>();
    for (const c of clubs) clubIdByShort.set((c as any).short_code, (c as any).id);

    // 3. Divisions
    const divisionRows = seed.divisions.map((d, i) => ({
      league_id: leagueId,
      name: d.name,
      short_code: d.short_code,
      day_of_week: d.day_of_week,
      start_time: d.start_time,
      end_time: d.end_time,
      line_format: d.line_format,
      sort_order: i,
    }));
    const { data: divisions, error: divErr } = await admin
      .from('league_divisions')
      .insert(divisionRows)
      .select('id, short_code, line_format');
    if (divErr || !divisions) {
      return NextResponse.json(
        { error: `Failed to create divisions: ${divErr?.message}` },
        { status: 500 }
      );
    }
    const divisionIdByShort = new Map<string, string>();
    const divisionFormatByShort = new Map<string, string>();
    for (const d of divisions) {
      divisionIdByShort.set((d as any).short_code, (d as any).id);
      divisionFormatByShort.set((d as any).short_code, (d as any).line_format);
    }

    // 4. division-club associations
    const dcRows: Array<{ division_id: string; club_id: string }> = [];
    for (const [divShort, clubShorts] of Object.entries(seed.divisionClubs)) {
      const divId = divisionIdByShort.get(divShort);
      if (!divId) continue;
      for (const s of clubShorts) {
        const cid = clubIdByShort.get(s);
        if (cid) dcRows.push({ division_id: divId, club_id: cid });
      }
    }
    const { error: dcErr } = await admin.from('league_division_clubs').insert(dcRows);
    if (dcErr) {
      return NextResponse.json(
        { error: `Failed to create division-club links: ${dcErr.message}` },
        { status: 500 }
      );
    }

    // 5. Matchups
    const matchupRows = seed.matchups
      .map(m => {
        const divId = divisionIdByShort.get(m.division_short);
        const home = clubIdByShort.get(m.home_short);
        const away = clubIdByShort.get(m.away_short);
        if (!divId || !home || !away) return null;
        return {
          division_id: divId,
          match_date: m.match_date,
          home_club_id: home,
          away_club_id: away,
          status: 'scheduled',
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    const { data: matchups, error: matchupErr } = await admin
      .from('league_team_matchups')
      .insert(matchupRows)
      .select('id, division_id');
    if (matchupErr || !matchups) {
      return NextResponse.json(
        { error: `Failed to create matchups: ${matchupErr?.message}` },
        { status: 500 }
      );
    }

    // 6. Empty lines per matchup, based on each division's line_format
    const divisionFormatById = new Map<string, string>();
    for (const [shortCode, id] of divisionIdByShort) {
      divisionFormatById.set(id, divisionFormatByShort.get(shortCode) || 'singles_and_doubles');
    }

    const lineRows: Array<{
      matchup_id: string;
      line_type: string;
      line_number: number;
    }> = [];
    for (const m of matchups) {
      const fmt = divisionFormatById.get((m as any).division_id) || 'singles_and_doubles';
      const skel = linesForFormat(fmt as any);
      for (const line of skel) {
        lineRows.push({
          matchup_id: (m as any).id,
          line_type: line.line_type,
          line_number: line.line_number,
        });
      }
    }

    if (lineRows.length > 0) {
      const { error: linesErr } = await admin.from('league_matchup_lines').insert(lineRows);
      if (linesErr) {
        return NextResponse.json(
          { error: `Failed to create lines: ${linesErr.message}` },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({
      success: true,
      leagueId,
      leagueName: seed.leagueName,
      url: `/mixer/leagues/${leagueId}`,
      publicUrl: `/leagues/${seed.leagueSlug}`,
      clubsCreated: clubs.length,
      divisionsCreated: divisions.length,
      matchupsCreated: matchups.length,
      linesCreated: lineRows.length,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: `Seed failed: ${e.message}` },
      { status: 500 }
    );
  }
}
