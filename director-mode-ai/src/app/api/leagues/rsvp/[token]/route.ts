/**
 * Per-player match availability (the parent's reservation page backend).
 *   GET  /api/leagues/rsvp/[token]  — player_token -> their match schedule + current Yes/No.
 *   POST /api/leagues/rsvp/[token]  — { matchup_id, status:'yes'|'no' }.
 *       'yes' upserts availability + writes league_matchup_checkins (so the
 *       facilitator/coach lineup tools see them). 'no' clears the check-in.
 * No auth — the token is the credential.
 */
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

type Roster = { id: string; player_name: string; division_id: string; club_id: string };

async function loadPlayer(token: string) {
  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from('league_team_rosters')
    .select('id, player_name, division_id, club_id')
    .eq('player_token', token)
    .maybeSingle();
  return { admin, roster: (data as Roster) || null };
}

export async function GET(_req: Request, { params }: { params: { token: string } }) {
  const { admin, roster } = await loadPlayer(params.token);
  if (!roster) return NextResponse.json({ error: 'Link not recognized.' }, { status: 404 });

  const { data: division } = await admin
    .from('league_divisions').select('id, name, short_code, league_id').eq('id', roster.division_id).maybeSingle();
  const div = division as { id: string; name: string; short_code: string; league_id: string };
  const { data: club } = await admin.from('league_clubs').select('id, name, short_code').eq('id', roster.club_id).maybeSingle();
  const { data: league } = await admin.from('leagues').select('name').eq('id', div.league_id).maybeSingle();
  const { data: clubs } = await admin.from('league_clubs').select('id, name, short_code').eq('league_id', div.league_id);
  const clubName = (id: string) => (clubs as Array<{ id: string; name: string; short_code: string }>)?.find((c) => c.id === id);

  const { data: matchups } = await admin
    .from('league_team_matchups')
    .select('id, match_date, start_time, home_club_id, away_club_id, status')
    .eq('division_id', roster.division_id)
    .or(`home_club_id.eq.${roster.club_id},away_club_id.eq.${roster.club_id}`)
    .order('match_date');

  const { data: avail } = await admin
    .from('league_player_availability').select('matchup_id, status').eq('roster_id', roster.id);
  const statusOf = (mid: string) =>
    ((avail as Array<{ matchup_id: string; status: string }>) || []).find((a) => a.matchup_id === mid)?.status || null;

  const list = ((matchups as Array<Record<string, unknown>>) || []).map((m) => {
    const home = m.home_club_id === roster.club_id;
    const opp = clubName((home ? m.away_club_id : m.home_club_id) as string);
    return {
      matchup_id: m.id as string,
      date: String(m.match_date).slice(0, 10),
      start_time: (m.start_time as string) || null,
      home,
      opponent: opp?.name || opp?.short_code || 'TBD',
      cancelled: m.status === 'cancelled' || m.status === 'postponed',
      status: statusOf(m.id as string),
    };
  });

  return NextResponse.json({
    player: { name: roster.player_name },
    club: club, division: div, league: league,
    matchups: list,
  });
}

export async function POST(req: Request, { params }: { params: { token: string } }) {
  const { admin, roster } = await loadPlayer(params.token);
  if (!roster) return NextResponse.json({ error: 'Link not recognized.' }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as { matchup_id?: string; status?: string };
  const status = body.status;
  if (status !== 'yes' && status !== 'no')
    return NextResponse.json({ error: "status must be 'yes' or 'no'." }, { status: 400 });

  // verify the matchup is in this player's division and involves their club
  const { data: mu } = await admin
    .from('league_team_matchups')
    .select('id, division_id, home_club_id, away_club_id')
    .eq('id', body.matchup_id || '')
    .maybeSingle();
  const m = mu as { id: string; division_id: string; home_club_id: string; away_club_id: string } | null;
  if (!m || m.division_id !== roster.division_id || ![m.home_club_id, m.away_club_id].includes(roster.club_id))
    return NextResponse.json({ error: 'That match is not on your schedule.' }, { status: 400 });

  const { error: aerr } = await admin
    .from('league_player_availability')
    .upsert({ roster_id: roster.id, matchup_id: m.id, status, responded_at: new Date().toISOString() },
      { onConflict: 'roster_id,matchup_id' });
  if (aerr) return NextResponse.json({ error: aerr.message }, { status: 500 });

  if (status === 'yes') {
    await admin.from('league_matchup_checkins')
      .upsert({ matchup_id: m.id, roster_id: roster.id }, { onConflict: 'matchup_id,roster_id', ignoreDuplicates: true });
  } else {
    await admin.from('league_matchup_checkins').delete().eq('matchup_id', m.id).eq('roster_id', roster.id);
  }
  return NextResponse.json({ ok: true, status });
}
