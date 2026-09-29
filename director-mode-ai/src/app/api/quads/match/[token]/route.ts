/**
 * GET  /api/quads/match/[token] — fetch the match + flight context for the
 *                                 public scoring page.
 * POST /api/quads/match/[token] — submit the score. After R1–R3 singles in a
 *                                 flight are all completed, the R4 doubles
 *                                 match is auto-created with 1+4 vs 2+3
 *                                 (see lib/quadDoubles).
 */

import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { isValidQuadScore } from '@/lib/quads';
import { syncQuadDoublesRound } from '@/lib/quadDoubles';

export async function GET(_req: Request, { params }: { params: { token: string } }) {
  const token = params.token;
  if (!token || token.length < 8) {
    return NextResponse.json({ error: 'Invalid token.' }, { status: 400 });
  }
  const admin = getSupabaseAdmin();

  const { data: match } = await admin
    .from('quad_matches')
    .select('*')
    .eq('score_token', token)
    .maybeSingle();
  if (!match) return NextResponse.json({ error: 'Token not recognized.' }, { status: 404 });

  const m = match as any;
  const [flightRes, entriesRes] = await Promise.all([
    admin.from('quad_flights').select('*, event:events(id, name, slug, event_scoring_format)').eq('id', m.flight_id).maybeSingle(),
    admin
      .from('quad_entries')
      .select('id, player_name, flight_seed')
      .eq('flight_id', m.flight_id),
  ]);
  if (!flightRes.data) {
    return NextResponse.json({ error: 'Flight not found.' }, { status: 404 });
  }

  return NextResponse.json({
    match: m,
    flight: flightRes.data,
    entries: (entriesRes.data as any[]) || [],
  });
}

type Body = {
  winner_side?: 'a' | 'b';
  score?: string;
  reported_by_name?: string;
};

export async function POST(req: Request, { params }: { params: { token: string } }) {
  const token = params.token;
  if (!token || token.length < 8) {
    return NextResponse.json({ error: 'Invalid token.' }, { status: 400 });
  }
  const body = (await req.json().catch(() => ({}))) as Body;
  if (body.winner_side !== 'a' && body.winner_side !== 'b') {
    return NextResponse.json(
      { error: 'winner_side must be "a" or "b".' },
      { status: 400 }
    );
  }
  if (!body.score || typeof body.score !== 'string' || body.score.length > 100) {
    return NextResponse.json(
      { error: 'score is required (max 100 chars).' },
      { status: 400 }
    );
  }
  if (!isValidQuadScore(body.score)) {
    return NextResponse.json(
      {
        error:
          'Score must be in tennis format like "6-3" or "6-3, 6-4". Got: ' + body.score,
      },
      { status: 400 }
    );
  }

  const admin = getSupabaseAdmin();
  const { data: match } = await admin
    .from('quad_matches')
    .select('id, flight_id, match_type, round, status')
    .eq('score_token', token)
    .maybeSingle();
  if (!match) return NextResponse.json({ error: 'Token not recognized.' }, { status: 404 });

  await admin
    .from('quad_matches')
    .update({
      winner_side: body.winner_side,
      score: body.score.trim(),
      status: 'completed',
      reported_at: new Date().toISOString(),
      reported_by_token: token,
      reported_by_name: body.reported_by_name?.slice(0, 80) || null,
    })
    .eq('id', (match as any).id);

  // Creates round 4 once all six singles are in, or re-pairs an unscored
  // doubles if this was a corrected singles score.
  if ((match as any).match_type === 'singles') {
    await syncQuadDoublesRound(admin, (match as any).flight_id);
  }

  return NextResponse.json({ success: true });
}
