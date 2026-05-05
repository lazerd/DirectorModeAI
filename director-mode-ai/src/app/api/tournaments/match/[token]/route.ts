/**
 * GET  /api/tournaments/match/[token] — fetch match + context
 * POST /api/tournaments/match/[token] — submit score + auto-advance
 *
 * Magic-link scoring for any tournament_matches row. The token is the
 * credential (no auth). After saving the score, the winner (and loser
 * for FMLC/FFIC) is automatically placed into the next match per the
 * `winner_feeds_to` / `loser_feeds_to` references that the bracket
 * generator wired up.
 */

import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { isValidQuadScore } from '@/lib/quads';

export async function GET(_req: Request, { params }: { params: { token: string } }) {
  const token = params.token;
  if (!token || token.length < 8) {
    return NextResponse.json({ error: 'Invalid token.' }, { status: 400 });
  }
  const admin = getSupabaseAdmin();

  const { data: match } = await admin
    .from('tournament_matches')
    .select('*')
    .eq('score_token', token)
    .maybeSingle();
  if (!match) return NextResponse.json({ error: 'Token not recognized.' }, { status: 404 });

  const m: any = match;
  const { data: ev } = await admin
    .from('events')
    .select('id, name, slug, event_scoring_format, match_format')
    .eq('id', m.event_id)
    .maybeSingle();
  const { data: entries } = await admin
    .from('tournament_entries')
    .select('id, player_name, partner_name, seed')
    .eq('event_id', m.event_id);

  return NextResponse.json({
    match: m,
    event: ev,
    entries: (entries as any[]) || [],
  });
}

type Body = {
  winner_side?: 'a' | 'b';
  score?: string;
  reported_by_name?: string;
};

/**
 * Parse a `bracket:round:slot:side` reference and return the destination match.
 * Returns null if invalid or match not found.
 */
async function resolveFeedRef(
  admin: ReturnType<typeof getSupabaseAdmin>,
  eventId: string,
  ref: string | null
): Promise<{ matchId: string; side: 'a' | 'b' } | null> {
  if (!ref) return null;
  const parts = ref.split(':');
  if (parts.length !== 4) return null;
  const [bracket, roundStr, slotStr, side] = parts;
  if (side !== 'a' && side !== 'b') return null;
  const { data } = await admin
    .from('tournament_matches')
    .select('id')
    .eq('event_id', eventId)
    .eq('bracket', bracket)
    .eq('round', parseInt(roundStr, 10))
    .eq('slot', parseInt(slotStr, 10))
    .maybeSingle();
  if (!data) return null;
  return { matchId: (data as any).id, side };
}

/** Place a player (singles) or a pair (doubles) into a destination match's side. */
async function placePlayersInSlot(
  admin: ReturnType<typeof getSupabaseAdmin>,
  destMatchId: string,
  destSide: 'a' | 'b',
  player1: string | null,
  player2: string | null
) {
  const update: Record<string, any> = {};
  if (destSide === 'a') {
    update.player1_id = player1;
    update.player2_id = player2;
  } else {
    update.player3_id = player1;
    update.player4_id = player2;
  }
  await admin.from('tournament_matches').update(update).eq('id', destMatchId);
}

export async function POST(req: Request, { params }: { params: { token: string } }) {
  const token = params.token;
  if (!token || token.length < 8) {
    return NextResponse.json({ error: 'Invalid token.' }, { status: 400 });
  }
  const body = (await req.json().catch(() => ({}))) as Body;
  if (body.winner_side !== 'a' && body.winner_side !== 'b') {
    return NextResponse.json({ error: 'winner_side must be "a" or "b".' }, { status: 400 });
  }
  if (!body.score || typeof body.score !== 'string' || body.score.length > 100) {
    return NextResponse.json({ error: 'score is required.' }, { status: 400 });
  }
  if (!isValidQuadScore(body.score)) {
    return NextResponse.json(
      { error: 'Score must be in tennis format like "6-3" or "6-3, 6-4".' },
      { status: 400 }
    );
  }

  const admin = getSupabaseAdmin();
  const { data: match } = await admin
    .from('tournament_matches')
    .select('*')
    .eq('score_token', token)
    .maybeSingle();
  if (!match) return NextResponse.json({ error: 'Token not recognized.' }, { status: 404 });
  const m: any = match;

  await admin
    .from('tournament_matches')
    .update({
      winner_side: body.winner_side,
      score: body.score.trim(),
      status: 'completed',
      reported_at: new Date().toISOString(),
      reported_by_token: token,
      reported_by_name: body.reported_by_name?.slice(0, 80) || null,
    })
    .eq('id', m.id);

  // Auto-advance: place winner into winner_feeds_to, loser into loser_feeds_to
  const winnerSide = body.winner_side;
  const winnerP1 = winnerSide === 'a' ? m.player1_id : m.player3_id;
  const winnerP2 = winnerSide === 'a' ? m.player2_id : m.player4_id;
  const loserP1 = winnerSide === 'a' ? m.player3_id : m.player1_id;
  const loserP2 = winnerSide === 'a' ? m.player4_id : m.player2_id;

  const winnerDest = await resolveFeedRef(admin, m.event_id, m.winner_feeds_to);
  if (winnerDest) {
    await placePlayersInSlot(admin, winnerDest.matchId, winnerDest.side, winnerP1, winnerP2);
  }
  const loserDest = await resolveFeedRef(admin, m.event_id, m.loser_feeds_to);
  if (loserDest) {
    await placePlayersInSlot(admin, loserDest.matchId, loserDest.side, loserP1, loserP2);
  }

  return NextResponse.json({ success: true });
}
