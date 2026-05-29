/**
 * GET   /api/leagues/roster/[token]/matchday — current/next matchup for this club
 * POST  /api/leagues/roster/[token]/matchday — actions: checkin, checkout, autoAssign, submitScore
 *
 * Coach-facing match day API. Token = roster_token on league_clubs.
 */

import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { autoAssignByStrength, recomputeLadder } from '@/lib/jtt';

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
  request: Request,
  { params }: { params: { token: string } }
) {
  const club = await resolveClub(params.token);
  if (!club) {
    return NextResponse.json({ error: 'Token not recognized.' }, { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const requestedDate = searchParams.get('date');
  const admin = getSupabaseAdmin();

  // Get all divisions this club is in
  const { data: dcRows } = await admin
    .from('league_division_clubs')
    .select('division_id')
    .eq('club_id', club.id);
  const divisionIds = (dcRows || []).map((r: any) => r.division_id);

  if (divisionIds.length === 0) {
    return NextResponse.json({ error: 'No divisions found for this club.' }, { status: 404 });
  }

  // Find all matchups for this club across all divisions, ordered by date
  const { data: allMatchups } = await admin
    .from('league_team_matchups')
    .select('*')
    .in('division_id', divisionIds)
    .or(`home_club_id.eq.${club.id},away_club_id.eq.${club.id}`)
    .order('match_date')
    .order('division_id');

  if (!allMatchups || allMatchups.length === 0) {
    return NextResponse.json({ error: 'No matchups found.' }, { status: 404 });
  }

  // Find the best matchup group: today's matches, or the next upcoming group
  const today = new Date().toISOString().slice(0, 10);
  const matchupsByDate = new Map<string, any[]>();
  for (const m of allMatchups) {
    const date = (m as any).match_date;
    if (!matchupsByDate.has(date)) matchupsByDate.set(date, []);
    matchupsByDate.get(date)!.push(m);
  }

  let targetDate: string | null = null;
  // If a specific date was requested and exists, use it
  if (requestedDate && matchupsByDate.has(requestedDate)) {
    targetDate = requestedDate;
  } else if (matchupsByDate.has(today)) {
    // Prefer today
    targetDate = today;
  } else {
    // Next future date
    for (const date of matchupsByDate.keys()) {
      if (date >= today) {
        targetDate = date;
        break;
      }
    }
    // If no future dates, use most recent past date
    if (!targetDate) {
      const dates = [...matchupsByDate.keys()];
      targetDate = dates[dates.length - 1];
    }
  }

  const matchups = matchupsByDate.get(targetDate!) || [];
  const matchupIds = matchups.map((m: any) => m.id);

  // Gather all related data for these matchups
  const divIdsForMatchups = [...new Set(matchups.map((m: any) => m.division_id))];
  const clubIdsForMatchups = [...new Set(matchups.flatMap((m: any) => [m.home_club_id, m.away_club_id]))];

  // Also get ALL division IDs in the league (for cross-division player pull-up)
  const { data: allDivsInLeague } = await admin
    .from('league_divisions')
    .select('id')
    .eq('league_id', club.league_id);
  const allDivisionIds = (allDivsInLeague || []).map((d: any) => d.id);

  const [divsRes, clubsRes, rostersRes, linesRes, checkinsRes] = await Promise.all([
    admin.from('league_divisions').select('id, name, short_code, start_time, end_time, line_format, sort_order').eq('league_id', club.league_id).order('sort_order'),
    admin.from('league_clubs').select('id, name, short_code, courts_available').in('id', clubIdsForMatchups),
    // Fetch rosters for ALL divisions (not just today's) so cross-division pull-up works
    admin.from('league_team_rosters').select('id, division_id, club_id, player_name, ladder_position, status').in('division_id', allDivisionIds).in('club_id', clubIdsForMatchups).order('ladder_position', { ascending: true, nullsFirst: false }),
    admin.from('league_matchup_lines').select('*').in('matchup_id', matchupIds).order('line_number'),
    admin.from('league_matchup_checkins').select('roster_id, matchup_id').in('matchup_id', matchupIds),
  ]);

  // All matchup dates for navigation
  const allDates = [...matchupsByDate.keys()];

  return NextResponse.json({
    club,
    targetDate,
    allDates,
    matchups,
    divisions: divsRes.data || [],
    clubs: clubsRes.data || [],
    rosters: rostersRes.data || [],
    lines: linesRes.data || [],
    checkins: checkinsRes.data || [],
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
  const { action } = body as { action: string };
  const admin = getSupabaseAdmin();

  // --- CHECK IN a player ---
  if (action === 'checkin') {
    const { matchup_id, roster_id } = body;
    if (!matchup_id || !roster_id) {
      return NextResponse.json({ error: 'matchup_id and roster_id required.' }, { status: 400 });
    }
    await admin.from('league_matchup_checkins').upsert(
      { matchup_id, roster_id },
      { onConflict: 'matchup_id,roster_id' }
    );
    return NextResponse.json({ success: true });
  }

  // --- CHECK OUT a player ---
  if (action === 'checkout') {
    const { matchup_id, roster_id } = body;
    if (!matchup_id || !roster_id) {
      return NextResponse.json({ error: 'matchup_id and roster_id required.' }, { status: 400 });
    }
    await admin
      .from('league_matchup_checkins')
      .delete()
      .eq('matchup_id', matchup_id)
      .eq('roster_id', roster_id);
    return NextResponse.json({ success: true });
  }

  // --- CHECK IN ALL active players for a club ---
  if (action === 'checkinAll') {
    const { matchup_id, division_id } = body;
    if (!matchup_id || !division_id) {
      return NextResponse.json({ error: 'matchup_id and division_id required.' }, { status: 400 });
    }
    const { data: roster } = await admin
      .from('league_team_rosters')
      .select('id')
      .eq('club_id', club.id)
      .eq('division_id', division_id)
      .eq('status', 'active');
    if (roster && roster.length > 0) {
      await admin.from('league_matchup_checkins').upsert(
        roster.map((r: any) => ({ matchup_id, roster_id: r.id })),
        { onConflict: 'matchup_id,roster_id' }
      );
    }
    return NextResponse.json({ success: true });
  }

  // --- CLEAR all check-ins for a club ---
  if (action === 'clearCheckins') {
    const { matchup_id, division_id } = body;
    if (!matchup_id || !division_id) {
      return NextResponse.json({ error: 'matchup_id and division_id required.' }, { status: 400 });
    }
    const { data: roster } = await admin
      .from('league_team_rosters')
      .select('id')
      .eq('club_id', club.id)
      .eq('division_id', division_id);
    if (roster && roster.length > 0) {
      await admin
        .from('league_matchup_checkins')
        .delete()
        .eq('matchup_id', matchup_id)
        .in('roster_id', roster.map((r: any) => r.id));
    }
    return NextResponse.json({ success: true });
  }

  // --- AUTO-ASSIGN lines by strength ---
  if (action === 'autoAssign') {
    const { matchup_id } = body;
    if (!matchup_id) {
      return NextResponse.json({ error: 'matchup_id required.' }, { status: 400 });
    }

    // Get matchup
    const { data: matchup } = await admin
      .from('league_team_matchups')
      .select('*')
      .eq('id', matchup_id)
      .single();
    if (!matchup) {
      return NextResponse.json({ error: 'Matchup not found.' }, { status: 404 });
    }
    const m = matchup as any;

    // Get rosters + check-ins + lines
    const [rostersRes, checkinsRes, linesRes] = await Promise.all([
      admin.from('league_team_rosters').select('id, division_id, club_id, player_name, ladder_position, status')
        .eq('division_id', m.division_id)
        .in('club_id', [m.home_club_id, m.away_club_id])
        .order('ladder_position', { ascending: true, nullsFirst: false }),
      admin.from('league_matchup_checkins').select('roster_id').eq('matchup_id', matchup_id),
      admin.from('league_matchup_lines').select('*').eq('matchup_id', matchup_id).order('line_number'),
    ]);

    const rosters = (rostersRes.data || []) as any[];
    const checkedInIds = new Set((checkinsRes.data || []).map((c: any) => c.roster_id));
    const lines = (linesRes.data || []) as any[];
    const hasCheckins = checkedInIds.size > 0;

    const homeRosters = rosters.filter((r: any) => r.club_id === m.home_club_id && r.status === 'active');
    const awayRosters = rosters.filter((r: any) => r.club_id === m.away_club_id && r.status === 'active');
    const availableHome = hasCheckins ? homeRosters.filter((r: any) => checkedInIds.has(r.id)) : homeRosters;
    const availableAway = hasCheckins ? awayRosters.filter((r: any) => checkedInIds.has(r.id)) : awayRosters;

    const patches = autoAssignByStrength(lines, availableHome, availableAway);
    if (patches.length === 0) {
      return NextResponse.json({ success: true, note: 'All lines already assigned.' });
    }

    await Promise.all(
      patches.map((p: any) =>
        admin.from('league_matchup_lines').update({
          home_player1_id: p.home_player1_id,
          home_player2_id: p.home_player2_id,
          away_player1_id: p.away_player1_id,
          away_player2_id: p.away_player2_id,
        }).eq('id', p.id)
      )
    );

    return NextResponse.json({ success: true, assigned: patches.length });
  }

  // --- SUBMIT SCORE for a line ---
  if (action === 'submitScore') {
    const { line_id, winner, score } = body;
    if (!line_id || !winner || !score) {
      return NextResponse.json({ error: 'line_id, winner, and score required.' }, { status: 400 });
    }
    if (winner !== 'home' && winner !== 'away') {
      return NextResponse.json({ error: 'winner must be "home" or "away".' }, { status: 400 });
    }

    const { error: updErr } = await admin
      .from('league_matchup_lines')
      .update({
        winner,
        score: score.trim(),
        status: 'completed',
        reported_at: new Date().toISOString(),
        reported_by_name: `Coach (${club.short_code})`,
      })
      .eq('id', line_id);

    if (updErr) {
      return NextResponse.json({ error: updErr.message }, { status: 500 });
    }

    // Auto re-ladder both clubs
    try {
      const { data: line } = await admin
        .from('league_matchup_lines')
        .select('matchup_id')
        .eq('id', line_id)
        .single();
      if (line) {
        const { data: matchup } = await admin
          .from('league_team_matchups')
          .select('division_id, home_club_id, away_club_id')
          .eq('id', (line as any).matchup_id)
          .single();
        if (matchup) {
          const m2 = matchup as any;
          const { data: divMatchups } = await admin
            .from('league_team_matchups')
            .select('id')
            .eq('division_id', m2.division_id);
          const mIds = (divMatchups || []).map((dm: any) => dm.id);
          const { data: allLines } = await admin
            .from('league_matchup_lines')
            .select('home_player1_id, home_player2_id, away_player1_id, away_player2_id, winner, status')
            .in('matchup_id', mIds)
            .eq('status', 'completed');

          for (const cid of [m2.home_club_id, m2.away_club_id]) {
            const { data: clubRosters } = await admin
              .from('league_team_rosters')
              .select('id, ladder_position, status')
              .eq('club_id', cid)
              .eq('division_id', m2.division_id);
            if (clubRosters && clubRosters.length > 0) {
              const updates = recomputeLadder(clubRosters as any[], (allLines || []) as any[]);
              for (const u of updates) {
                await admin.from('league_team_rosters').update({ ladder_position: u.newPosition }).eq('id', u.rosterId);
              }
            }
          }
        }
      }
    } catch {
      // best-effort
    }

    return NextResponse.json({ success: true });
  }

  // --- ASSIGN PLAYER to a line slot ---
  if (action === 'assignPlayer') {
    const { line_id, slot, roster_id } = body;
    const validSlots = ['home_player1_id', 'home_player2_id', 'away_player1_id', 'away_player2_id'];
    if (!line_id || !slot || !validSlots.includes(slot)) {
      return NextResponse.json({ error: 'line_id and valid slot required.' }, { status: 400 });
    }

    // Validate: if assigning (not clearing), check player isn't already in another slot on same line
    if (roster_id) {
      const { data: line } = await admin
        .from('league_matchup_lines')
        .select('home_player1_id, home_player2_id, away_player1_id, away_player2_id')
        .eq('id', line_id)
        .single();
      if (line) {
        const l = line as any;
        const otherSlots = validSlots.filter(s => s !== slot);
        const occupied = otherSlots.filter(s => l[s] === roster_id);
        if (occupied.length > 0) {
          return NextResponse.json({ error: 'Player is already assigned to another slot on this line.' }, { status: 400 });
        }
      }
    }

    await admin
      .from('league_matchup_lines')
      .update({ [slot]: roster_id || null })
      .eq('id', line_id);
    return NextResponse.json({ success: true });
  }

  // --- PULL UP PLAYER from another division ---
  if (action === 'pullUpPlayer') {
    const { source_roster_id, target_division_id, matchup_id, line_id, slot } = body;
    if (!source_roster_id || !target_division_id) {
      return NextResponse.json({ error: 'source_roster_id and target_division_id required.' }, { status: 400 });
    }

    // Get the source player's info
    const { data: source } = await admin
      .from('league_team_rosters')
      .select('player_name, player_email, ntrp, utr, club_id')
      .eq('id', source_roster_id)
      .single();
    if (!source) {
      return NextResponse.json({ error: 'Source player not found.' }, { status: 404 });
    }
    const s = source as any;

    // Check if this player already exists in the target division (by name + club)
    const { data: existing } = await admin
      .from('league_team_rosters')
      .select('id')
      .eq('club_id', s.club_id)
      .eq('division_id', target_division_id)
      .eq('player_name', s.player_name)
      .maybeSingle();

    let newRosterId: string;
    if (existing) {
      newRosterId = (existing as any).id;
    } else {
      // Get next ladder position
      const { data: maxPos } = await admin
        .from('league_team_rosters')
        .select('ladder_position')
        .eq('club_id', s.club_id)
        .eq('division_id', target_division_id)
        .order('ladder_position', { ascending: false })
        .limit(1);
      const nextLadder = ((maxPos?.[0] as any)?.ladder_position || 0) + 1;

      const { data: inserted, error: insErr } = await admin
        .from('league_team_rosters')
        .insert({
          division_id: target_division_id,
          club_id: s.club_id,
          player_name: s.player_name,
          player_email: s.player_email,
          ntrp: s.ntrp,
          utr: s.utr,
          ladder_position: nextLadder,
          status: 'active',
        })
        .select('id')
        .single();
      if (insErr || !inserted) {
        return NextResponse.json({ error: insErr?.message || 'Failed to create roster entry.' }, { status: 500 });
      }
      newRosterId = (inserted as any).id;
    }

    // If line_id and slot provided, also assign them to the line
    if (line_id && slot) {
      const validSlots = ['home_player1_id', 'home_player2_id', 'away_player1_id', 'away_player2_id'];
      if (validSlots.includes(slot)) {
        await admin
          .from('league_matchup_lines')
          .update({ [slot]: newRosterId })
          .eq('id', line_id);
      }
    }

    return NextResponse.json({ success: true, roster_id: newRosterId });
  }

  // --- REVISE SCORE (unlock a completed line) ---
  if (action === 'reviseScore') {
    const { line_id } = body;
    if (!line_id) {
      return NextResponse.json({ error: 'line_id required.' }, { status: 400 });
    }
    await admin
      .from('league_matchup_lines')
      .update({ winner: null, score: null, status: 'pending', reported_at: null, reported_by_name: null })
      .eq('id', line_id);
    return NextResponse.json({ success: true });
  }

  // --- CLEAR ALL LINES for a matchup ---
  if (action === 'clearLines') {
    const { matchup_id } = body;
    if (!matchup_id) {
      return NextResponse.json({ error: 'matchup_id required.' }, { status: 400 });
    }
    // Only delete lines that haven't been scored
    const { data: completedLines } = await admin
      .from('league_matchup_lines')
      .select('id')
      .eq('matchup_id', matchup_id)
      .eq('status', 'completed');

    if (completedLines && completedLines.length > 0) {
      return NextResponse.json({
        error: `${completedLines.length} line(s) already scored. Revise or remove them individually first.`,
      }, { status: 400 });
    }

    await admin
      .from('league_matchup_lines')
      .delete()
      .eq('matchup_id', matchup_id);
    return NextResponse.json({ success: true });
  }

  // --- ADD A LINE (singles or doubles) ---
  if (action === 'addLine') {
    const { matchup_id, line_type } = body;
    if (!matchup_id || (line_type !== 'singles' && line_type !== 'doubles')) {
      return NextResponse.json({ error: 'matchup_id and line_type (singles|doubles) required.' }, { status: 400 });
    }

    // Get current max line_number for this matchup
    const { data: existing } = await admin
      .from('league_matchup_lines')
      .select('line_number')
      .eq('matchup_id', matchup_id)
      .order('line_number', { ascending: false })
      .limit(1);

    let nextNum = ((existing?.[0] as any)?.line_number || 0) + 1;

    // Retry with incremented line_number if collision (concurrent add)
    for (let attempt = 0; attempt < 3; attempt++) {
      const { data: inserted, error: insErr } = await admin
        .from('league_matchup_lines')
        .insert({
          matchup_id,
          line_type,
          line_number: nextNum + attempt,
        })
        .select('id, line_type, line_number')
        .single();

      if (!insErr) {
        return NextResponse.json({ success: true, line: inserted });
      }
      if (!insErr.message.includes('duplicate') && !insErr.message.includes('unique')) {
        return NextResponse.json({ error: insErr.message }, { status: 500 });
      }
    }
    return NextResponse.json({ error: 'Could not create line — try again.' }, { status: 500 });
  }

  // --- REMOVE A LINE ---
  if (action === 'removeLine') {
    const { line_id } = body;
    if (!line_id) {
      return NextResponse.json({ error: 'line_id required.' }, { status: 400 });
    }
    const { error: delErr } = await admin
      .from('league_matchup_lines')
      .delete()
      .eq('id', line_id);
    if (delErr) {
      return NextResponse.json({ error: delErr.message }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  }

  // --- SET COURTS for a matchup ---
  if (action === 'setCourts') {
    const { matchup_id, courts } = body;
    if (!matchup_id || courts === undefined) {
      return NextResponse.json({ error: 'matchup_id and courts required.' }, { status: 400 });
    }
    const courtsVal = parseInt(courts, 10);
    if (isNaN(courtsVal) || courtsVal < 0 || courtsVal > 50) {
      return NextResponse.json({ error: 'courts must be 0-50.' }, { status: 400 });
    }
    await admin
      .from('league_team_matchups')
      .update({ courts_override: courtsVal })
      .eq('id', matchup_id);
    return NextResponse.json({ success: true });
  }

  // --- USE SUGGESTED LINEUP (bulk-create lines) ---
  if (action === 'useSuggestion') {
    const { matchup_id, singles, doubles } = body;
    if (!matchup_id || singles === undefined || doubles === undefined) {
      return NextResponse.json({ error: 'matchup_id, singles, and doubles required.' }, { status: 400 });
    }

    // Get current max line_number
    const { data: existing } = await admin
      .from('league_matchup_lines')
      .select('line_number')
      .eq('matchup_id', matchup_id)
      .order('line_number', { ascending: false })
      .limit(1);

    let nextNum = ((existing?.[0] as any)?.line_number || 0) + 1;
    const rows: Array<{ matchup_id: string; line_type: string; line_number: number }> = [];

    for (let i = 0; i < singles; i++) {
      rows.push({ matchup_id, line_type: 'singles', line_number: nextNum++ });
    }
    for (let i = 0; i < doubles; i++) {
      rows.push({ matchup_id, line_type: 'doubles', line_number: nextNum++ });
    }

    if (rows.length > 0) {
      const { error: insErr } = await admin.from('league_matchup_lines').insert(rows);
      if (insErr) {
        return NextResponse.json({ error: insErr.message }, { status: 500 });
      }
    }

    return NextResponse.json({ success: true, created: rows.length });
  }

  return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
}
