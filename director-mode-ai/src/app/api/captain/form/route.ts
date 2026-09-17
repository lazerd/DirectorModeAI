/**
 * Strength order proposed from match results.
 *   GET ?team_id=… — each player's form from played lines, plus the order it
 *        suggests and the moves that would make.
 *
 * Read-only. The captain applies an order through the existing
 * PATCH /api/captain/players { order } — nothing here writes, because with
 * juniors a demotion is a conversation, not a calculation. See lib/captain/formOrder.
 */
import { NextResponse } from 'next/server';
import { requireTeam, isError } from '@/lib/captain/server';
import { proposeOrder, type FormMatch, type FormPlayer } from '@/lib/captain/formOrder';

export const dynamic = 'force-dynamic';

type Lineup = {
  match_id: string;
  court_number: number;
  court_type: 'singles' | 'doubles';
  player1_id: string | null;
  player2_id: string | null;
};
type Result = { match_id: string; court_number: number; score: string | null; won: boolean | null; defaulted: boolean };

export async function GET(req: Request) {
  const teamId = new URL(req.url).searchParams.get('team_id') || '';
  const ctx = await requireTeam(teamId);
  if (isError(ctx)) return ctx.error;
  const { db } = ctx;

  const [{ data: players }, { data: matches }] = await Promise.all([
    db
      .from('captain_players')
      .select('id, name, sort_order, is_sub')
      .eq('team_id', teamId)
      .eq('active', true)
      .order('sort_order', { ascending: true, nullsFirst: false })
      .order('name'),
    db
      .from('captain_matches')
      .select('id, match_at')
      .eq('team_id', teamId)
      .eq('status', 'played')
      .order('match_at'),
  ]);

  const roster = ((players as { id: string; name: string; sort_order: number | null; is_sub: boolean }[]) || []).filter(
    (p) => !p.is_sub,
  );
  // Seeds come from the list as ordered above, so an unranked player sits after
  // the ranked ones rather than jumping to the top on a null.
  const formPlayers: FormPlayer[] = roster.map((p, i) => ({ id: p.id, name: p.name, seed: i + 1 }));
  const matchIds = ((matches as { id: string }[]) || []).map((m) => m.id);

  let lineups: Lineup[] = [];
  let results: Result[] = [];
  if (matchIds.length) {
    const [{ data: l }, { data: r }] = await Promise.all([
      db
        .from('captain_lineups')
        .select('match_id, court_number, court_type, player1_id, player2_id')
        .in('match_id', matchIds),
      db.from('captain_results').select('match_id, court_number, score, won, defaulted').in('match_id', matchIds),
    ]);
    lineups = (l as Lineup[]) || [];
    results = (r as Result[]) || [];
  }

  const formMatches: FormMatch[] = matchIds.map((id) => {
    const courts = lineups.filter((l) => l.match_id === id);
    // Line number is per KIND: a JTT sheet numbers courts 1-8 across four
    // singles then four doubles, but "singles #1" is what a captain means.
    const numbered = (['singles', 'doubles'] as const).flatMap((type) =>
      courts
        .filter((c) => c.court_type === type)
        .sort((a, b) => a.court_number - b.court_number)
        .map((c, i) => ({ c, lineNumber: i + 1 })),
    );
    return {
      matchId: id,
      lines: numbered.map(({ c, lineNumber }) => {
        const res = results.find((x) => x.match_id === id && x.court_number === c.court_number);
        return {
          lineNumber,
          courtType: c.court_type,
          playerIds: [c.player1_id, c.player2_id].filter(Boolean) as string[],
          won: res?.won ?? null,
          score: res?.score ?? null,
          defaulted: res?.defaulted === true,
        };
      }),
    };
  });

  const { order, proposals, form } = proposeOrder(formPlayers, formMatches);
  const nameOf = new Map(formPlayers.map((p) => [p.id, p.name]));

  return NextResponse.json({
    matchDays: formMatches.filter((m) => m.lines.some((l) => l.won != null && !l.defaulted)).length,
    current: formPlayers.map((p) => {
      const f = form.find((x) => x.playerId === p.id);
      return {
        id: p.id,
        name: p.name,
        seed: p.seed,
        form: Math.round((f?.form ?? 0) * 10) / 10,
        wins: f?.wins ?? 0,
        losses: f?.losses ?? 0,
        days: f?.days ?? 0,
        reasons: f?.reasons ?? [],
      };
    }),
    proposals,
    // The full order the proposals add up to, ready to PATCH to /players.
    order: order.map((id) => ({ id, name: nameOf.get(id) ?? '' })),
  });
}
