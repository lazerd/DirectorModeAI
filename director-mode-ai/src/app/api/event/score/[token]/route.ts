/**
 * GET/POST /api/event/score/[token]
 *
 * No-login score entry for event participants. The token is the credential —
 * one per event, held in `event_score_tokens` (service-role only). Mirrors the
 * JTT magic-link pattern in /api/leagues/line/[token].
 *
 * Why this exists: PublicScoreDialog used to update `matches` straight from the
 * browser with the anon key, but `anon` has no UPDATE or SELECT grant on
 * `matches`, so every logged-out submission failed the RLS check. Routing the
 * write through the service role keeps score entry account-free without making
 * the anon key a write key.
 *
 * GET  → { event, matches[] } for the event's most recent round.
 * POST → { match_id, team1_score, team2_score } updates one match.
 *
 * Deliberately does NOT touch `event_players` standings. The director's
 * MatchScoreDialog applies a delta (old score out, new score in) when they
 * verify; recomputing here too would double-count. Participant scores land on
 * the match and the director confirms them, which is what the dialog's copy
 * already promises ("The director will verify before the round closes").
 */

import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

type Body = {
  match_id?: string;
  team1_score?: number;
  team2_score?: number;
};

const MAX_SCORE = 99;

/** Resolve the token to its event, or null. */
async function eventForToken(token: string) {
  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from('event_score_tokens')
    .select('event_id')
    .eq('token', token)
    .maybeSingle();
  return (data as any)?.event_id ?? null;
}

export async function GET(
  _request: Request,
  { params }: { params: { token: string } }
) {
  const token = params.token;
  if (!token || token.length < 8) {
    return NextResponse.json({ error: 'Invalid token.' }, { status: 400 });
  }

  const eventId = await eventForToken(token);
  if (!eventId) {
    return NextResponse.json({ error: 'Token not recognized.' }, { status: 404 });
  }

  const admin = getSupabaseAdmin();
  const { data: event, error: eventErr } = await admin
    .from('events')
    .select('id, name, event_code, event_date, scoring_format, num_courts')
    .eq('id', eventId)
    .single();

  if (eventErr || !event) {
    return NextResponse.json({ error: 'Event not found.' }, { status: 404 });
  }

  // Most recent round for this event — that's the one being played.
  const { data: round } = await admin
    .from('rounds')
    .select('id, round_number, status')
    .eq('event_id', eventId)
    .order('round_number', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!round) {
    return NextResponse.json({ event, round: null, matches: [] });
  }

  const { data: matches } = await admin
    .from('matches')
    .select(
      'id, court_number, team1_score, team2_score, winner_team, player1_id, player2_id, player3_id, player4_id'
    )
    .eq('round_id', (round as any).id)
    .order('court_number', { ascending: true });

  // Resolve player names in one round-trip rather than four joins.
  const ids = Array.from(
    new Set(
      (matches || []).flatMap((m: any) =>
        [m.player1_id, m.player2_id, m.player3_id, m.player4_id].filter(Boolean)
      )
    )
  );
  const nameById = new Map<string, string>();
  if (ids.length) {
    const { data: players } = await admin
      .from('players')
      .select('id, name')
      .in('id', ids);
    for (const p of (players as any[]) || []) nameById.set(p.id, p.name);
  }

  const shaped = (matches || []).map((m: any) => ({
    id: m.id,
    court_number: m.court_number,
    team1_score: m.team1_score,
    team2_score: m.team2_score,
    player1_name: m.player1_id ? nameById.get(m.player1_id) ?? null : null,
    player2_name: m.player2_id ? nameById.get(m.player2_id) ?? null : null,
    player3_name: m.player3_id ? nameById.get(m.player3_id) ?? null : null,
    player4_name: m.player4_id ? nameById.get(m.player4_id) ?? null : null,
  }));

  return NextResponse.json({ event, round, matches: shaped });
}

export async function POST(
  request: Request,
  { params }: { params: { token: string } }
) {
  const token = params.token;
  if (!token || token.length < 8) {
    return NextResponse.json({ error: 'Invalid token.' }, { status: 400 });
  }

  const eventId = await eventForToken(token);
  if (!eventId) {
    return NextResponse.json({ error: 'Token not recognized.' }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as Body;
  const { match_id: matchId } = body;
  const t1 = body.team1_score;
  const t2 = body.team2_score;

  if (!matchId || typeof matchId !== 'string') {
    return NextResponse.json({ error: 'match_id is required.' }, { status: 400 });
  }
  const valid = (n: unknown) =>
    typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= MAX_SCORE;
  if (!valid(t1) || !valid(t2)) {
    return NextResponse.json(
      { error: `Scores must be whole numbers between 0 and ${MAX_SCORE}.` },
      { status: 400 }
    );
  }
  if (t1 === 0 && t2 === 0) {
    return NextResponse.json(
      { error: 'Enter a score for at least one team.' },
      { status: 400 }
    );
  }

  // The token scopes the write: the match must belong to a round of THIS event.
  // Without this check a token for any event could score every other event.
  const admin = getSupabaseAdmin();
  const { data: match } = await admin
    .from('matches')
    .select('id, round_id, rounds!inner(event_id)')
    .eq('id', matchId)
    .maybeSingle();

  if (!match || (match as any).rounds?.event_id !== eventId) {
    return NextResponse.json(
      { error: 'That match is not part of this event.' },
      { status: 404 }
    );
  }

  const winnerTeam = t1! > t2! ? 1 : t2! > t1! ? 2 : null;

  const { error: updErr } = await admin
    .from('matches')
    .update({ team1_score: t1, team2_score: t2, winner_team: winnerTeam })
    .eq('id', matchId);

  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
