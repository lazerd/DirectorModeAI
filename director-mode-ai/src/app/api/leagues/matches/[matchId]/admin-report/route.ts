/**
 * POST /api/leagues/matches/[matchId]/admin-report
 *
 * Director-only score entry for any match in one of the director's leagues.
 * Mirrors the magic-link /api/leagues/match POST report path but authenticates
 * via the Supabase session instead of a token, and goes straight to
 * 'confirmed' status (no 24h dispute window since the director is vouching
 * for the score).
 *
 * Body: { score: string, winnerEntryId: string }
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ matchId: string }> }
) {
  try {
    const { matchId } = await params;

    const userClient = await createClient();
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const admin = getSupabaseAdmin();

    // Load the match + verify the caller owns the league
    const { data: match } = await admin
      .from('league_matches')
      .select('*')
      .eq('id', matchId)
      .maybeSingle();
    if (!match) return NextResponse.json({ error: 'Match not found' }, { status: 404 });

    const { data: flight } = await admin
      .from('league_flights')
      .select('league_id')
      .eq('id', (match as any).flight_id)
      .maybeSingle();
    if (!flight) return NextResponse.json({ error: 'Flight not found' }, { status: 404 });

    const { data: league } = await admin
      .from('leagues')
      .select('director_id')
      .eq('id', (flight as any).league_id)
      .maybeSingle();
    if (!league || (league as any).director_id !== user.id) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const score = typeof body?.score === 'string' ? body.score.trim().slice(0, 64) : '';
    const winnerEntryId = typeof body?.winnerEntryId === 'string' ? body.winnerEntryId : '';

    if (!score) return NextResponse.json({ error: 'Score is required' }, { status: 400 });
    if (!winnerEntryId) return NextResponse.json({ error: 'Winner is required' }, { status: 400 });
    if (winnerEntryId !== (match as any).entry_a_id && winnerEntryId !== (match as any).entry_b_id) {
      return NextResponse.json({ error: 'Winner must be one of the two teams' }, { status: 400 });
    }

    // Admin-entered scores skip the dispute window and go straight to confirmed.
    await admin
      .from('league_matches')
      .update({
        score,
        winner_entry_id: winnerEntryId,
        reported_at: new Date().toISOString(),
        reported_by_token: 'admin',
        status: 'confirmed',
      })
      .eq('id', matchId);

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal error' }, { status: 500 });
  }
}
