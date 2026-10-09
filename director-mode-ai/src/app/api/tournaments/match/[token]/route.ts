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
import { recordTournamentScore } from '@/lib/tournamentScoring';

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

// Score canonicalization, auto-advance and reflow live in
// src/lib/tournamentScoring.ts, shared with the Ask ClubMode events pack.

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

  await recordTournamentScore(admin, m, {
    winnerSide: body.winner_side,
    score: body.score,
    reportedByToken: token,
    reportedByName: body.reported_by_name ?? null,
  });

  return NextResponse.json({ success: true });
}
