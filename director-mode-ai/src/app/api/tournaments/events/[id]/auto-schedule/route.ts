/**
 * POST /api/tournaments/events/[id]/auto-schedule
 *
 * Director-only. Assigns a court + start time to every match in the
 * tournament based on event.start_time + round_duration_minutes.
 *
 * Strategy:
 *   - All matches in round 1 start at start_time, distributed across
 *     available courts. If more matches than courts, overflow matches
 *     start one round-duration later (same court).
 *   - Round 2 starts at start_time + 1 × round_duration_minutes.
 *   - Round N starts at start_time + (N-1) × round_duration_minutes.
 *   - Consolation matches run on the same time grid; same overflow rules.
 *
 * Returns: { matches_scheduled }
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { addMinutesToTime, resolveCourtList } from '@/lib/quads';

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
    .select('id, user_id, start_time, num_courts, court_names, round_duration_minutes')
    .eq('id', eventId)
    .maybeSingle();
  if (!ev) return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  if ((ev as any).user_id !== user.id) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  const e: any = ev;
  const startTime = (e.start_time || '09:00').slice(0, 5);
  const roundDur = e.round_duration_minutes ?? 45;
  const courts = resolveCourtList({ courtNames: e.court_names, numCourts: e.num_courts });
  if (courts.length === 0) {
    return NextResponse.json({ error: 'No courts configured' }, { status: 400 });
  }

  const { data: matchesData } = await admin
    .from('tournament_matches')
    .select('id, bracket, round, slot')
    .eq('event_id', eventId)
    .order('round')
    .order('slot');

  const matches = (matchesData as any[]) || [];

  // Group by round, then assign court + time. Main + consolation use the
  // same grid, so they'll never conflict if the same court is reused
  // across brackets at different times. Within a single round, distribute
  // matches across courts; overflow → next slot.
  const updates: Array<{ id: string; court: string; scheduled_at: string }> = [];

  const matchesByRound = new Map<number, any[]>();
  for (const m of matches) {
    if (!matchesByRound.has(m.round)) matchesByRound.set(m.round, []);
    matchesByRound.get(m.round)!.push(m);
  }

  for (const [round, roundMatches] of matchesByRound.entries()) {
    let courtIdx = 0;
    let extraSlot = 0;
    for (const m of roundMatches) {
      if (courtIdx >= courts.length) {
        courtIdx = 0;
        extraSlot += 1;
      }
      const slotOffset = (round - 1 + extraSlot) * roundDur;
      const scheduled_at = addMinutesToTime(startTime, slotOffset);
      const court = courts[courtIdx];
      updates.push({ id: m.id, court, scheduled_at });
      courtIdx += 1;
    }
  }

  for (const u of updates) {
    await admin
      .from('tournament_matches')
      .update({ court: u.court, scheduled_at: u.scheduled_at })
      .eq('id', u.id);
  }

  return NextResponse.json({ matches_scheduled: updates.length });
}
