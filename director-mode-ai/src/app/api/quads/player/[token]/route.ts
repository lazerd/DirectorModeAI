/**
 * GET /api/quads/player/[token]
 *
 * Public endpoint — no auth. Returns everything needed to render a player's
 * personal scoring page: their entry, the flight context, the tournament,
 * everyone in the flight (so we can show "you vs whoever"), and the player's
 * matches (R1-R3 singles + R4 doubles, if generated yet).
 *
 * Each match in the response includes its score_token so the client form can
 * POST scores via the existing /api/quads/match/[score_token] endpoint.
 */

import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

export async function GET(_req: Request, { params }: { params: { token: string } }) {
  const token = params.token;
  if (!token || token.length < 8) {
    return NextResponse.json({ error: 'Invalid token.' }, { status: 400 });
  }
  const admin = getSupabaseAdmin();

  const { data: entry } = await admin
    .from('quad_entries')
    .select('*')
    .eq('player_token', token)
    .maybeSingle();
  if (!entry) return NextResponse.json({ error: 'Token not recognized.' }, { status: 404 });
  const e: any = entry;

  const [{ data: ev }, { data: flight }, { data: flightEntries }] = await Promise.all([
    admin
      .from('events')
      .select('id, name, slug, event_date, event_scoring_format')
      .eq('id', e.event_id)
      .maybeSingle(),
    e.flight_id
      ? admin.from('quad_flights').select('id, name, tier_label').eq('id', e.flight_id).maybeSingle()
      : Promise.resolve({ data: null }),
    e.flight_id
      ? admin.from('quad_entries').select('id, player_name, flight_seed').eq('flight_id', e.flight_id)
      : Promise.resolve({ data: [] }),
  ]);

  let matches: any[] = [];
  if (e.flight_id) {
    const { data: ms } = await admin
      .from('quad_matches')
      .select('*')
      .eq('flight_id', e.flight_id)
      .order('round');
    matches = ((ms as any[]) || []).filter(
      (m) =>
        m.player1_id === e.id ||
        m.player2_id === e.id ||
        m.player3_id === e.id ||
        m.player4_id === e.id
    );
  }

  return NextResponse.json({
    entry: e,
    event: ev,
    flight: flight,
    flightEntries: flightEntries || [],
    matches,
  });
}
