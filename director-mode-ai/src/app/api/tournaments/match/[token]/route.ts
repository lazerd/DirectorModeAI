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
import { syncPlacementPlayoffs } from '@/lib/tournamentPlayoffs';
import { isValidQuadScore, resolveCourtList } from '@/lib/quads';
import {
  optimizeTournamentSchedule,
  type SchedulerMatch,
} from '@/lib/tournamentScheduler';

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

/** Swap each set's two game counts ("6-3, 7-6" -> "3-6, 6-7"), preserving any
 * trailing marker (e.g. a tiebreak note). Non-numeric sets pass through. */
function flipSets(sets: string[]): string {
  return sets
    .map((s) => {
      const m = s.match(/^(\d+)\s*-\s*(\d+)(.*)$/);
      return m ? `${m[2]}-${m[1]}${m[3] ?? ''}` : s;
    })
    .join(', ');
}

/**
 * Canonicalize a score to PLAYER1-FIRST order (side a's games first, side b's
 * second) — the order every standings/draw reader assumes.
 *
 * Scores are entered WINNER-FIRST on the public /flex and desk score forms
 * ("we won 6-3, 7-6"), so a side-B win is typed with side B's games first and
 * must be reoriented before storage — otherwise the game-count columns read
 * backwards (the 2026-07-23 "9-13 should be 13-9" bug: multi-set scores were
 * being stored verbatim).
 *
 *  - Single set: the winner (known from winner_side) always holds the higher
 *    game count, so orient by magnitude — robust no matter how it was typed.
 *  - Multi set: per-set magnitude can't identify the winner (they may drop a
 *    set), but they ALWAYS win the deciding (last) set. Read that set's
 *    magnitude with winner_side to detect the current orientation, and flip
 *    every set only when it's winner-first.
 *
 * Idempotent: a score already in player1-first order is returned unchanged, so
 * it's safe to re-run on edits and on the one-time backfill. Marker scores
 * ("W/O", "RET") and anything non-numeric are left as entered.
 */
function canonicalScore(raw: string, winnerSide: 'a' | 'b'): string {
  const trimmed = raw.trim();
  const sets = trimmed.split(',').map((s) => s.trim()).filter(Boolean);
  if (sets.length === 0) return trimmed;

  if (sets.length === 1) {
    const m = sets[0].match(/^(\d+)\s*-\s*(\d+)$/);
    if (!m) return trimmed;
    const x = parseInt(m[1], 10);
    const y = parseInt(m[2], 10);
    if (x === y) return trimmed;
    const hi = Math.max(x, y);
    const lo = Math.min(x, y);
    return winnerSide === 'a' ? `${hi}-${lo}` : `${lo}-${hi}`;
  }

  // Multi-set: detect orientation from the deciding (last) set the winner took.
  const last = sets[sets.length - 1].match(/^(\d+)\s*-\s*(\d+)/);
  if (!last) return trimmed;
  const lf = parseInt(last[1], 10);
  const ls = parseInt(last[2], 10);
  if (lf === ls) return trimmed;
  const firstIsBigger = lf > ls;
  // player1-first target: winner 'a' won the last set → side a's games (shown
  // first) are the bigger of that set; winner 'b' → side a's games are smaller.
  const alreadyPlayer1First = winnerSide === 'a' ? firstIsBigger : !firstIsBigger;
  return alreadyPlayer1First ? sets.join(', ') : flipSets(sets);
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
      score: canonicalScore(body.score, body.winner_side),
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

  // Auto-reflow: re-run the scheduler over PENDING matches only. Completed
  // matches keep their (date, time, court). If this match finished early,
  // downstream pending matches get earlier slots; if late, they push back.
  // Best-effort — failures don't reject the score submission.
  try {
    await reflowDownstream(admin, m.event_id);
  } catch (err) {
    console.error('reflow failed:', err);
  }

  // Keep the placement playoff in sync: seat each pool's finishers into their
  // side of the (already-created) TBD placement matches as soon as that pool
  // finishes. Idempotent + best-effort.
  try {
    await syncPlacementPlayoffs(admin, m.event_id);
  } catch (err) {
    console.error('placement playoff sync failed:', err);
  }

  return NextResponse.json({ success: true });
}

async function reflowDownstream(
  admin: ReturnType<typeof getSupabaseAdmin>,
  eventId: string
) {
  const { data: ev } = await admin
    .from('events')
    .select(
      'event_date, end_date, start_time, daily_start_time, daily_end_time, num_courts, court_names, default_match_length_minutes, player_rest_minutes, match_buffer_minutes'
    )
    .eq('id', eventId)
    .maybeSingle();
  if (!ev) return;
  const e: any = ev;
  if (!e.event_date) return;

  const courts = resolveCourtList({ courtNames: e.court_names, numCourts: e.num_courts });
  if (courts.length === 0) return;

  const { data: matchesData } = await admin
    .from('tournament_matches')
    .select(
      'id, status, scheduled_date, scheduled_at, court, player1_id, player2_id, player3_id, player4_id, winner_feeds_to, loser_feeds_to, bracket, round, slot'
    )
    .eq('event_id', eventId);
  const dbMatches = (matchesData as any[]) || [];

  // Only re-time matches that were already auto-scheduled onto a court but
  // haven't started. NEVER touch a match that's on a court right now
  // (in_progress) or one waiting in the queue (no court yet) — those are owned
  // by whoever placed them (the desk / director). This is what stops scoring one
  // match from yanking other live matches off their courts.
  const pending = dbMatches.filter((m) => m.status === 'pending' && m.court != null);
  if (pending.length === 0) return;

  // Build predecessor map (same logic as auto-schedule endpoint)
  const idByPosition = new Map<string, string>();
  for (const m of dbMatches) {
    idByPosition.set(`${m.bracket}:${m.round}:${m.slot}`, m.id);
  }
  const predecessorsByMatch = new Map<string, string[]>();
  for (const m of dbMatches) predecessorsByMatch.set(m.id, []);
  for (const m of dbMatches) {
    for (const ref of [m.winner_feeds_to, m.loser_feeds_to].filter(Boolean)) {
      const [bracket, roundStr, slotStr] = String(ref).split(':');
      const destId = idByPosition.get(`${bracket}:${roundStr}:${slotStr}`);
      if (destId) {
        predecessorsByMatch.get(destId)!.push(m.id);
      }
    }
  }

  const schedulerMatches: SchedulerMatch[] = pending.map((m) => ({
    id: m.id,
    player_ids: [m.player1_id, m.player2_id, m.player3_id, m.player4_id].filter(
      (x): x is string => !!x
    ),
    predecessor_match_ids: (predecessorsByMatch.get(m.id) || []),
  }));

  const result = optimizeTournamentSchedule({
    matches: schedulerMatches,
    courts,
    startDate: e.event_date,
    endDate: e.end_date || e.event_date,
    dailyStartTime: (e.daily_start_time || e.start_time || '09:00').slice(0, 5),
    dailyEndTime: (e.daily_end_time || '18:00').slice(0, 5),
    matchLengthMinutes: e.default_match_length_minutes ?? 90,
    playerRestMinutes: e.player_rest_minutes ?? 60,
    matchBufferMinutes: e.match_buffer_minutes ?? 30,
  });

  for (const [matchId, slot] of result.assignments) {
    await admin
      .from('tournament_matches')
      .update({
        scheduled_date: slot.scheduled_date,
        scheduled_at: slot.scheduled_at,
        court: slot.court,
      })
      .eq('id', matchId);
  }
}
