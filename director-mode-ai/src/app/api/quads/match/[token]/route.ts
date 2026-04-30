/**
 * GET  /api/quads/match/[token] — fetch the match + flight context for the
 *                                 public scoring page.
 * POST /api/quads/match/[token] — submit the score. After R1–R3 singles in a
 *                                 flight are all completed, the R4 doubles
 *                                 match is auto-created with 1+4 vs 2+3.
 */

import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import {
  computeFlightStandings,
  buildQuadDoublesRound,
  type QuadMatchView,
} from '@/lib/quads';

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

  // If this was a singles match and all 6 singles in the flight are now
  // complete and there's no doubles match yet, auto-create it 1+4 vs 2+3.
  if ((match as any).match_type === 'singles') {
    const flightId = (match as any).flight_id;
    const { data: allMatches } = await admin
      .from('quad_matches')
      .select('*')
      .eq('flight_id', flightId);

    const list = (allMatches as any[]) || [];
    const singles = list.filter((m) => m.match_type === 'singles');
    const doubles = list.find((m) => m.match_type === 'doubles');

    if (
      singles.length === 6 &&
      singles.every((m) => m.status === 'completed') &&
      !doubles
    ) {
      const { data: entriesData } = await admin
        .from('quad_entries')
        .select('id, flight_seed')
        .eq('flight_id', flightId);

      const entries = ((entriesData as any[]) || []).map((e) => ({
        id: e.id,
        flight_seed: e.flight_seed,
      }));

      const standings = computeFlightStandings(entries, singles as QuadMatchView[]);
      const dm = buildQuadDoublesRound(standings);
      if (dm) {
        await admin.from('quad_matches').insert({
          flight_id: flightId,
          round: 4,
          match_type: 'doubles',
          player1_id: dm.player1_id,
          player2_id: dm.player2_id,
          player3_id: dm.player3_id,
          player4_id: dm.player4_id,
        });
      }
    }
  }

  return NextResponse.json({ success: true });
}
