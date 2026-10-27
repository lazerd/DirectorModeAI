/**
 * "Someone bailed" — open a sub request and blast every eligible sub at once.
 * First to claim wins (see /api/captain/claim/[requestToken]/[playerToken]).
 *
 * POST { team_id, match_id, lineup_id, slot, dropped_player_id? }
 *
 * Eligible = active roster member or sub, not already in this lineup, and
 * (for capped leagues) their rating still fits the court they'd be joining.
 */
import { NextResponse } from 'next/server';
import { requireTeam, isError, capForTeam, type CaptainCtx } from '@/lib/captain/server';
import { subRequestEmail, sendAll, type MatchInfo } from '@/lib/captain/emails';
import { withSecondContact } from '@/lib/captain/teamContacts';
import { resolveClubTimeZone } from '@/lib/captain/clubTime';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { CreditLimitError } from '@/lib/billing';
import { creditLimitResponse } from '@/lib/email';

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    team_id?: string;
    match_id?: string;
    lineup_id?: string;
    slot?: 1 | 2;
    dropped_player_id?: string;
  };
  if (!body.team_id || !body.match_id || !body.lineup_id) {
    return NextResponse.json(
      { error: 'team_id, match_id and lineup_id are required.' },
      { status: 400 },
    );
  }

  const ctx = await requireTeam(body.team_id);
  if (isError(ctx)) return ctx.error;
  const { db, team, teamId } = ctx;
  const slot = body.slot === 2 ? 2 : 1;

  const { data: matchRow } = await db
    .from('captain_matches')
    .select('*')
    .eq('id', body.match_id)
    .eq('team_id', teamId)
    .maybeSingle();
  if (!matchRow) return NextResponse.json({ error: 'Match not found.' }, { status: 404 });
  const match = matchRow as Record<string, unknown>;

  const { data: lineupRow } = await db
    .from('captain_lineups')
    .select('*')
    .eq('id', body.lineup_id)
    .eq('match_id', body.match_id)
    .maybeSingle();
  if (!lineupRow) return NextResponse.json({ error: 'Lineup court not found.' }, { status: 404 });
  const lineup = lineupRow as Record<string, unknown>;

  // The seat is only vacated once somebody has actually been asked (below).
  // Clearing it first meant a "nobody to ask" answer still emptied the slot
  // and wiped the dropout off the captain's page.
  const col = slot === 2 ? 'player2_id' : 'player1_id';
  const confirmCol = slot === 2 ? 'player2_confirmed_at' : 'player1_confirmed_at';
  const occupant = (lineup[col] as string | null) ?? null;

  // Who is already committed to this match's lineup? (The dropout still sits in
  // the seat, so they count as busy and are never asked to cover themselves.)
  const { data: allCourts } = await db
    .from('captain_lineups')
    .select('player1_id, player2_id')
    .eq('match_id', body.match_id);
  const busy = new Set(
    ((allCourts as Record<string, unknown>[]) || [])
      .flatMap((c) => [c.player1_id, c.player2_id])
      .filter(Boolean) as string[],
  );
  if (body.dropped_player_id) busy.add(body.dropped_player_id);

  const { data: players } = await db
    .from('captain_players')
    .select('id, name, email, player_token, rating, gender, court_limit, contact2_email')
    .eq('team_id', teamId)
    .eq('active', true);

  const cap = capForTeam(team);
  const partnerId = (slot === 2 ? lineup.player1_id : lineup.player2_id) as string | null;
  const all =
    (players as {
      id: string;
      name: string;
      email: string | null;
      contact2_email: string | null;
      player_token: string;
      rating: number | null;
      gender: 'M' | 'F' | null;
      court_limit: string | null;
    }[]) || [];
  const partner = partnerId ? all.find((p) => p.id === partnerId) : null;
  const isDoubles = lineup.court_type === 'doubles';

  const eligible = all.filter((p) => {
    if (busy.has(p.id) || !p.email) return false;
    if (isDoubles && p.court_limit === 'singles_only') return false;
    if (!isDoubles && p.court_limit === 'doubles_only') return false;
    if (isDoubles && partner) {
      if (team.league_type === 'usta_mixed' && p.gender && partner.gender && p.gender === partner.gender) {
        return false;
      }
      if (cap != null) {
        const combined = Number(p.rating ?? 0) + Number(partner.rating ?? 0);
        if (combined > cap + 1e-9) return false;
      }
    }
    return true;
  });

  if (!eligible.length) {
    // Not an error the captain did — nothing changed, so say so plainly and
    // leave the seat, the dropout and their note exactly as they were.
    return NextResponse.json({
      ok: false,
      nobody: true,
      asked: 0,
      message:
        "There's nobody left to ask — everyone is already playing, has no email, or is ruled out by league limits. Nothing was changed.",
    });
  }

  const { data: created, error: reqErr } = await db
    .from('captain_sub_requests')
    .insert({
      team_id: teamId,
      match_id: body.match_id,
      lineup_id: body.lineup_id,
      slot,
      dropped_player_id: body.dropped_player_id ?? null,
      status: 'open',
    })
    .select('id, request_token')
    .single();
  if (reqErr || !created) {
    return NextResponse.json({ error: reqErr?.message || 'Could not open the request.' }, { status: 500 });
  }
  const request = created as { id: string; request_token: string };

  const info: MatchInfo = {
    id: match.id as string,
    matchAt: match.match_at as string,
    isHome: match.is_home as boolean,
    opponent: (match.opponent as string) || null,
    location: (match.location as string) || null,
  };
  const tz = await resolveClubTimeZone(getSupabaseAdmin(), team.club_id);

  try {
    const results = await sendAll(
      ctx.userId,
      eligible.flatMap((p) =>
        withSecondContact(
          subRequestEmail(team.name, info, request.request_token, {
            playerId: p.id,
            name: p.name,
            email: p.email as string,
            token: p.player_token,
          }, tz),
          p.contact2_email,
        ),
      ),
    );
    const asked = results.filter((r) => r.sent).length;
    if (!asked) {
      await cancelRequest(db, request.id);
      return NextResponse.json({
        ok: false,
        nobody: true,
        asked: 0,
        message: "None of the sub emails could be sent, so nobody was asked. Nothing was changed.",
      });
    }

    // Now vacate the seat — but only if the dropout is still in it. A quick
    // sub may already have claimed it between the send and this line, and
    // their name must not be wiped.
    if (occupant) {
      await db
        .from('captain_lineups')
        .update({ [col]: null, [confirmCol]: null, updated_at: new Date().toISOString() })
        .eq('id', body.lineup_id)
        .eq(col, occupant);
    }

    return NextResponse.json({ ok: true, request_id: request.id, asked });
  } catch (err) {
    await cancelRequest(db, request.id);
    if (err instanceof CreditLimitError) return creditLimitResponse(err);
    return NextResponse.json({ error: 'Could not send the sub request.' }, { status: 502 });
  }
}

/** A request nobody received must not sit 'open' and look like a live ask. */
async function cancelRequest(
  db: CaptainCtx['db'],
  requestId: string,
) {
  await db
    .from('captain_sub_requests')
    .update({ status: 'cancelled' })
    .eq('id', requestId)
    .eq('status', 'open');
}
