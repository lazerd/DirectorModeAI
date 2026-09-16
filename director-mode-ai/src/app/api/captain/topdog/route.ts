/**
 * Carrying saved scores to TopDog's Enter Score page.
 *   GET   ?team_id=…&match_id=…          — the entry link + fill code, built from
 *          what is SAVED (not the unsaved form), plus anything it couldn't fill.
 *   PATCH { team_id, match_id, link }     — link this match to its TopDog match
 *          from any TopDog url for it; an empty link unlinks.
 *
 * Nothing here contacts TopDog. The captain's browser does the filling
 * (public/topdog-fill.js) and the captain presses Submit — see lib/captain/topdog.
 */
import { NextResponse } from 'next/server';
import { requireTeam, isError } from '@/lib/captain/server';
import { resolveClubTimeZone } from '@/lib/captain/clubTime';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import {
  buildFillPayload,
  encodeFillPayload,
  parseTopDogLink,
  topdogEntryUrl,
  topdogScorecardUrl,
  type FillCourt,
} from '@/lib/captain/topdog';

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const ctx = await requireTeam(q.get('team_id') || '');
  if (isError(ctx)) return ctx.error;
  const { db, teamId, team } = ctx;
  const matchId = q.get('match_id') || '';

  const { data: match } = await db
    .from('captain_matches')
    .select('id, match_at, is_home, opponent, source_host, source_match_id')
    .eq('id', matchId)
    .eq('team_id', teamId)
    .maybeSingle();
  if (!match) return NextResponse.json({ error: 'Match not found.' }, { status: 404 });
  const m = match as {
    match_at: string;
    is_home: boolean;
    opponent: string | null;
    source_host: string | null;
    source_match_id: string | null;
  };
  if (!m.source_host || !m.source_match_id) {
    return NextResponse.json({ error: 'This match is not linked to TopDog yet.' }, { status: 409 });
  }

  const [{ data: lineups }, { data: results }, { data: players }] = await Promise.all([
    db
      .from('captain_lineups')
      .select('court_number, court_type, player1_id, player2_id')
      .eq('match_id', matchId),
    db
      .from('captain_results')
      .select('court_number, score, won, defaulted, default_by')
      .eq('match_id', matchId),
    db.from('captain_players').select('id, name').eq('team_id', teamId),
  ]);
  const nameOf = (id: string | null) =>
    id ? (((players as { id: string; name: string }[]) || []).find((p) => p.id === id)?.name ?? null) : null;

  const saved = (results as Record<string, unknown>[]) || [];
  if (!saved.length) {
    return NextResponse.json(
      { error: 'Save the court scores in ClubMode first, then send them to TopDog.' },
      { status: 409 },
    );
  }

  const courts: FillCourt[] = ((lineups as Record<string, unknown>[]) || []).map((l) => {
    const r = saved.find((x) => x.court_number === l.court_number);
    return {
      courtNumber: l.court_number as number,
      courtType: l.court_type as 'singles' | 'doubles',
      players: [nameOf(l.player1_id as string | null), nameOf(l.player2_id as string | null)],
      score: (r?.score as string | null) ?? null,
      won: (r?.won as boolean | null) ?? null,
      defaulted: r?.defaulted === true,
      defaultBy: (r?.default_by as 'us' | 'them' | null) ?? null,
    };
  });

  const timeZone = await resolveClubTimeZone(getSupabaseAdmin(), team.club_id);
  const { payload, problems } = buildFillPayload({
    matchId: m.source_match_id,
    matchAt: m.match_at,
    timeZone,
    isHome: m.is_home,
    opponent: m.opponent,
    courts,
  });
  const code = encodeFillPayload(payload);
  const link = { host: m.source_host, matchId: m.source_match_id };

  return NextResponse.json({
    code,
    entryUrl: `${topdogEntryUrl(link, 'insert')}#clubmode=${code}`,
    updateUrl: `${topdogEntryUrl(link, 'update')}#clubmode=${code}`,
    scorecardUrl: topdogScorecardUrl(link),
    problems,
  });
}

export async function PATCH(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    team_id?: string;
    match_id?: string;
    link?: string;
  };
  const ctx = await requireTeam(body.team_id || '');
  if (isError(ctx)) return ctx.error;
  const { db, teamId } = ctx;
  if (!body.match_id) return NextResponse.json({ error: 'match_id required.' }, { status: 400 });

  let host: string | null = null;
  let id: string | null = null;
  if ((body.link || '').trim()) {
    // A bare id is fine once any other match on the team knows the host.
    const { data: sibling } = await db
      .from('captain_matches')
      .select('source_host')
      .eq('team_id', teamId)
      .not('source_host', 'is', null)
      .limit(1)
      .maybeSingle();
    const parsed = parseTopDogLink(body.link || '', (sibling as { source_host?: string } | null)?.source_host);
    if (!parsed) {
      return NextResponse.json(
        { error: "That isn't a TopDog match link. Open the match on TopDog and copy the address." },
        { status: 400 },
      );
    }
    host = parsed.host;
    id = parsed.matchId;
  }

  const { data, error } = await db
    .from('captain_matches')
    .update({ source_host: host, source_match_id: id, updated_at: new Date().toISOString() })
    .eq('id', body.match_id)
    .eq('team_id', teamId)
    .select('id');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: 'Match not found.' }, { status: 404 });
  return NextResponse.json({ ok: true, host, matchId: id });
}
