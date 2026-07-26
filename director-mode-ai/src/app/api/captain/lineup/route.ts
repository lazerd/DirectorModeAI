/**
 * Lineup generation, saving, and sending.
 *   POST { action:'generate', match_id }  — propose a lineup (does not save)
 *   POST { action:'save', match_id, courts } — persist captain's final version
 *   POST { action:'send', match_id }      — email it to the whole team
 */
import { NextResponse } from 'next/server';
import {
  requireTeam,
  isError,
  capForTeam,
  playedCounts,
  pairRecords,
  rulesFor,
} from '@/lib/captain/server';
import {
  generateLineup,
  requiredMatches,
  type Player,
  type LeagueType,
  type RatingType,
} from '@/lib/captain/lineup';
import { lineupEmail, sendAll, type LineupRow, type MatchInfo } from '@/lib/captain/emails';
import { CreditLimitError } from '@/lib/billing';
import { creditLimitResponse } from '@/lib/email';

type Body = {
  action?: 'generate' | 'save' | 'send';
  team_id?: string;
  match_id?: string;
  courts?: {
    courtNumber: number;
    courtType: 'singles' | 'doubles';
    player1Id: string | null;
    player2Id: string | null;
  }[];
};

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Body;
  if (!body.team_id || !body.match_id) {
    return NextResponse.json({ error: 'team_id and match_id are required.' }, { status: 400 });
  }

  const ctx = await requireTeam(body.team_id);
  if (isError(ctx)) return ctx.error;
  const { db, team, teamId } = ctx;

  const { data: matchRow } = await db
    .from('captain_matches')
    .select('*')
    .eq('id', body.match_id)
    .eq('team_id', teamId)
    .maybeSingle();
  if (!matchRow) return NextResponse.json({ error: 'Match not found.' }, { status: 404 });
  const match = matchRow as Record<string, unknown>;

  // ---------------------------------------------------------------- generate
  if (body.action === 'generate') {
    const { data: players } = await db
      .from('captain_players')
      .select('id, name, rating, rating_type, gender, return_side, court_limit, is_sub')
      .eq('team_id', teamId)
      .eq('active', true);

    const { data: avail } = await db
      .from('captain_availability')
      .select('player_id, status')
      .eq('match_id', body.match_id);

    const yes = new Set(
      ((avail as { player_id: string; status: string }[]) || [])
        .filter((a) => a.status === 'yes')
        .map((a) => a.player_id),
    );

    const counts = await playedCounts(db, teamId);
    const rules = rulesFor(team);
    const history = await pairRecords(db, teamId);

    const available: Player[] = ((players as Record<string, unknown>[]) || [])
      .filter((p) => yes.has(p.id as string))
      .map((p) => {
        const played = counts[p.id as string] ?? 0;
        const need = requiredMatches(rules, (p.rating_type as RatingType) ?? 'computer');
        return {
          id: p.id as string,
          name: p.name as string,
          rating: p.rating == null ? null : Number(p.rating),
          gender: (p.gender as 'M' | 'F' | null) ?? null,
          returnSide: (p.return_side as 'deuce' | 'ad' | null) ?? null,
          courtLimit: (p.court_limit as Player['courtLimit']) ?? null,
          matchesPlayed: played,
          // false for leagues with no playoffs — requiredMatches returns 0
          needsEligibility: need > 0 && played < need,
        };
      });

    const [{ data: prefs }, { data: never }] = await Promise.all([
      db.from('captain_partner_prefs').select('player_id, preferred_player_id, rank').eq('team_id', teamId),
      db.from('captain_never_pair').select('player_a_id, player_b_id').eq('team_id', teamId),
    ]);

    const result = generateLineup({
      available,
      pairHistory: history,
      partnerPrefs: ((prefs as Record<string, unknown>[]) || []).map((r) => ({
        playerId: r.player_id as string,
        preferredPlayerId: r.preferred_player_id as string,
        rank: r.rank as number,
      })),
      neverPairs: ((never as Record<string, unknown>[]) || []).map((r) => ({
        playerAId: r.player_a_id as string,
        playerBId: r.player_b_id as string,
      })),
      singlesCourts: (match.singles_courts as number) ?? 2,
      doublesCourts: (match.doubles_courts as number) ?? 3,
      leagueType: (team.league_type as LeagueType) || 'usta_adult',
      combinedRatingCap: capForTeam(team),
    });

    const nameOf = (id: string | null) =>
      id ? ((players as { id: string; name: string }[]) || []).find((p) => p.id === id)?.name ?? null : null;

    return NextResponse.json({
      ...result,
      courts: result.courts.map((c) => ({
        ...c,
        player1Name: nameOf(c.player1Id),
        player2Name: nameOf(c.player2Id),
      })),
      availableCount: available.length,
    });
  }

  // -------------------------------------------------------------------- save
  if (body.action === 'save') {
    const courts = body.courts || [];
    await db.from('captain_lineups').delete().eq('match_id', body.match_id);
    if (courts.length) {
      const { error } = await db.from('captain_lineups').insert(
        courts.map((c) => ({
          team_id: teamId,
          match_id: body.match_id,
          court_number: c.courtNumber,
          court_type: c.courtType,
          player1_id: c.player1Id,
          player2_id: c.player2Id,
        })),
      );
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, saved: courts.length });
  }

  // -------------------------------------------------------------------- send
  if (body.action === 'send') {
    const { data: lineups } = await db
      .from('captain_lineups')
      .select('court_number, court_type, player1_id, player2_id')
      .eq('match_id', body.match_id)
      .order('court_number');
    if (!lineups?.length) {
      return NextResponse.json({ error: 'Save a lineup before sending it.' }, { status: 400 });
    }

    const { data: players } = await db
      .from('captain_players')
      .select('id, name, email, player_token')
      .eq('team_id', teamId)
      .eq('active', true);

    const roster = (players as { id: string; name: string; email: string | null; player_token: string }[]) || [];
    const nameOf = (id: string | null) => (id ? roster.find((p) => p.id === id)?.name ?? '—' : '—');

    const rows: LineupRow[] = ((lineups as Record<string, unknown>[]) || []).map((l) => ({
      courtNumber: l.court_number as number,
      courtType: l.court_type as 'singles' | 'doubles',
      names: [nameOf(l.player1_id as string | null)].concat(
        l.court_type === 'doubles' ? [nameOf(l.player2_id as string | null)] : [],
      ),
    }));

    const playing = new Set(
      ((lineups as Record<string, unknown>[]) || [])
        .flatMap((l) => [l.player1_id, l.player2_id])
        .filter(Boolean) as string[],
    );

    const info: MatchInfo = {
      id: match.id as string,
      matchAt: match.match_at as string,
      isHome: match.is_home as boolean,
      opponent: (match.opponent as string) || null,
      location: (match.location as string) || null,
      arrivalNote: (match.arrival_note as string) || null,
      opposingCaptainName: (match.opposing_captain_name as string) || null,
      opposingCaptainPhone: (match.opposing_captain_phone as string) || null,
    };

    const payloads = roster
      .filter((p) => !!p.email)
      .map((p) =>
        lineupEmail(
          team.name,
          info,
          rows,
          { playerId: p.id, name: p.name, email: p.email as string, token: p.player_token },
          playing.has(p.id),
        ),
      );

    try {
      const results = await sendAll(ctx.userId, payloads);
      await db
        .from('captain_matches')
        .update({ lineup_email_sent_at: new Date().toISOString() })
        .eq('id', body.match_id);
      return NextResponse.json({ ok: true, sent: results.filter((r) => r.sent).length });
    } catch (err) {
      if (err instanceof CreditLimitError) return creditLimitResponse(err);
      return NextResponse.json({ error: 'Could not send the lineup.' }, { status: 502 });
    }
  }

  return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
}
