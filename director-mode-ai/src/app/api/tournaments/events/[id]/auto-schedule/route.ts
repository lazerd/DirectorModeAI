/**
 * POST /api/tournaments/events/[id]/auto-schedule
 *
 * Director-only. Calls the multi-day tournament scheduler to assign
 * (date, time, court) to every match in this event, respecting:
 *   - Bracket dependencies (predecessors finish before successors start)
 *   - Player rest between consecutive matches
 *   - Player conflicts across multiple matches
 *   - Daily start/end window across the tournament's date range
 *   - Court fairness (distributes load evenly)
 *
 * Returns: { matches_scheduled, unscheduled }
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { resolveCourtList } from '@/lib/quads';
import {
  optimizeTournamentSchedule,
  type SchedulerMatch,
} from '@/lib/tournamentScheduler';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: eventId } = await params;

  const userClient = await createClient();
  const {
    data: { user },
  } = await userClient.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = getSupabaseAdmin();

  const { data: ev } = await admin
    .from('events')
    .select(
      'id, user_id, event_date, end_date, start_time, daily_start_time, daily_end_time, num_courts, court_names, default_match_length_minutes, player_rest_minutes, match_buffer_minutes, round_duration_minutes'
    )
    .eq('id', eventId)
    .maybeSingle();
  if (!ev) return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  if ((ev as any).user_id !== user.id) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  const e: any = ev;
  const startDate = e.event_date;
  const endDate = e.end_date || e.event_date;
  const dailyStartTime = (e.daily_start_time || e.start_time || '09:00').slice(0, 5);
  const dailyEndTime = (e.daily_end_time || '18:00').slice(0, 5);
  // Prefer the new default_match_length_minutes; fall back to round_duration for legacy events
  const matchLengthMinutes =
    e.default_match_length_minutes ?? e.round_duration_minutes ?? 90;
  const playerRestMinutes = e.player_rest_minutes ?? 60;
  const matchBufferMinutes = e.match_buffer_minutes ?? 30;
  const courts = resolveCourtList({ courtNames: e.court_names, numCourts: e.num_courts });
  if (courts.length === 0) {
    return NextResponse.json({ error: 'No courts configured' }, { status: 400 });
  }
  if (!startDate) {
    return NextResponse.json({ error: 'Tournament start date not set' }, { status: 400 });
  }

  const { data: matchesData } = await admin
    .from('tournament_matches')
    .select('id, bracket, round, slot, player1_id, player2_id, player3_id, player4_id, winner_feeds_to, loser_feeds_to')
    .eq('event_id', eventId)
    .order('round')
    .order('slot');

  const dbMatches = (matchesData as any[]) || [];

  // Build predecessor map: for match X, find every match whose
  // winner_feeds_to or loser_feeds_to points at X.
  // Format: "bracket:round:slot:side" → matchId of (bracket, round, slot)
  const idByPosition = new Map<string, string>();
  for (const m of dbMatches) {
    idByPosition.set(`${m.bracket}:${m.round}:${m.slot}`, m.id);
  }

  const predecessorsByMatch = new Map<string, string[]>();
  for (const m of dbMatches) {
    predecessorsByMatch.set(m.id, []);
  }
  for (const m of dbMatches) {
    const refs = [m.winner_feeds_to, m.loser_feeds_to].filter(Boolean);
    for (const ref of refs) {
      // ref looks like "main:2:1:a" — destination is (bracket, round, slot)
      const [bracket, roundStr, slotStr] = String(ref).split(':');
      const destId = idByPosition.get(`${bracket}:${roundStr}:${slotStr}`);
      if (destId) {
        const list = predecessorsByMatch.get(destId) || [];
        list.push(m.id);
        predecessorsByMatch.set(destId, list);
      }
    }
  }

  const schedulerMatches: SchedulerMatch[] = dbMatches.map((m) => ({
    id: m.id,
    player_ids: [m.player1_id, m.player2_id, m.player3_id, m.player4_id].filter(
      (x): x is string => !!x
    ),
    predecessor_match_ids: predecessorsByMatch.get(m.id) || [],
  }));

  const out = optimizeTournamentSchedule({
    matches: schedulerMatches,
    courts,
    startDate,
    endDate,
    dailyStartTime,
    dailyEndTime,
    matchLengthMinutes,
    playerRestMinutes,
    matchBufferMinutes,
  });

  // Persist
  for (const [matchId, slot] of out.assignments) {
    await admin
      .from('tournament_matches')
      .update({
        scheduled_date: slot.scheduled_date,
        scheduled_at: slot.scheduled_at,
        court: slot.court,
      })
      .eq('id', matchId);
  }

  return NextResponse.json({
    matches_scheduled: out.assignments.size,
    unscheduled: out.unscheduled,
  });
}
