/**
 * Match results.
 *   GET  ?team_id=…            — partnership records across the season
 *   POST { team_id, match_id, results[], mark_played } — save court-by-court
 *         scores and (optionally) mark the match played.
 *
 * Marking a match 'played' is what makes it count toward playoff eligibility
 * and play-time fairness, and the won/lost flags are what drive the
 * generator's partnership-chemistry signal.
 */
import { NextResponse } from 'next/server';
import { requireTeam, isError, pairRecords } from '@/lib/captain/server';

export async function GET(req: Request) {
  const teamId = new URL(req.url).searchParams.get('team_id') || '';
  const ctx = await requireTeam(teamId);
  if (isError(ctx)) return ctx.error;

  const records = await pairRecords(ctx.db, teamId);
  const { data: players } = await ctx.db
    .from('captain_players')
    .select('id, name')
    .eq('team_id', teamId);
  const nameOf = (id: string) =>
    ((players as { id: string; name: string }[]) || []).find((p) => p.id === id)?.name ?? '—';

  return NextResponse.json({
    partnerships: records.map((r) => ({
      ...r,
      playerAName: nameOf(r.playerAId),
      playerBName: nameOf(r.playerBId),
      played: r.wins + r.losses,
      winRate: r.wins + r.losses ? r.wins / (r.wins + r.losses) : null,
    })),
  });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    team_id?: string;
    match_id?: string;
    mark_played?: boolean;
    results?: { court_number: number; score?: string | null; won?: boolean | null; defaulted?: boolean; default_by?: 'us' | 'them' }[];
  };
  if (!body.team_id || !body.match_id) {
    return NextResponse.json({ error: 'team_id and match_id are required.' }, { status: 400 });
  }

  const ctx = await requireTeam(body.team_id);
  if (isError(ctx)) return ctx.error;
  const { db, teamId } = ctx;

  const { data: match } = await db
    .from('captain_matches')
    .select('id')
    .eq('id', body.match_id)
    .eq('team_id', teamId)
    .maybeSingle();
  if (!match) return NextResponse.json({ error: 'Match not found.' }, { status: 404 });

  const rows = (body.results || []).filter((r) => typeof r.court_number === 'number');
  if (rows.length) {
    const { error } = await db.from('captain_results').upsert(
      rows.map((r) => ({
        team_id: teamId,
        match_id: body.match_id,
        court_number: r.court_number,
        score: r.score?.trim() || null,
        won: r.won ?? null,
        // A defaulted court still carries a win/loss for the team, but the two
        // players on it did not play — playedCounts() skips it so fairness and
        // playoff eligibility stay honest.
        defaulted: r.defaulted === true,
        default_by: r.defaulted === true ? (r.default_by === 'us' ? 'us' : 'them') : null,
      })),
      { onConflict: 'match_id,court_number' },
    );
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (body.mark_played) {
    const { error } = await db
      .from('captain_matches')
      .update({ status: 'played', updated_at: new Date().toISOString() })
      .eq('id', body.match_id)
      .eq('team_id', teamId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const courtsWon = rows.filter((r) => r.won === true).length;
  const courtsLost = rows.filter((r) => r.won === false).length;

  return NextResponse.json({
    ok: true,
    saved: rows.length,
    played: !!body.mark_played,
    teamResult:
      courtsWon || courtsLost
        ? courtsWon > courtsLost
          ? 'won'
          : courtsWon < courtsLost
            ? 'lost'
            : 'tied'
        : null,
  });
}
