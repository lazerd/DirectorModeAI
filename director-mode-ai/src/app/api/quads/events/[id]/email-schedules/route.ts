/**
 * POST /api/quads/events/[id]/email-schedules
 *
 * Director-only. For each confirmed entry (position='in_flight'), send an
 * email listing every match they're in: round, opponent(s), court, time.
 *
 * Returns: { sent, total, skipped_no_email, skipped_unsubscribed }
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { sendQuadsScheduleEmail } from '@/lib/quadEmails';
import { formatTimeDisplay } from '@/lib/quads';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: eventId } = await params;

  const userClient = await createClient();
  const {
    data: { user },
  } = await userClient.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = getSupabaseAdmin();

  const { data: ev } = await admin
    .from('events')
    .select('id, name, user_id, slug, event_date')
    .eq('id', eventId)
    .maybeSingle();
  if (!ev) return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  if ((ev as any).user_id !== user.id) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  const event: any = ev;

  const { data: entries } = await admin
    .from('quad_entries')
    .select('id, player_name, player_email, parent_email, player_token, position, flight_id')
    .eq('event_id', eventId)
    .eq('position', 'in_flight');

  const list = (entries as any[]) || [];

  const flightIds = Array.from(new Set(list.map((e) => e.flight_id).filter(Boolean)));
  const [{ data: flights }, { data: matches }, { data: allFlightEntries }] = await Promise.all([
    flightIds.length
      ? admin.from('quad_flights').select('id, name').in('id', flightIds)
      : Promise.resolve({ data: [] as any[] }),
    flightIds.length
      ? admin.from('quad_matches').select('*').in('flight_id', flightIds)
      : Promise.resolve({ data: [] as any[] }),
    flightIds.length
      ? admin
          .from('quad_entries')
          .select('id, player_name, flight_id')
          .in('flight_id', flightIds)
      : Promise.resolve({ data: [] as any[] }),
  ]);

  const flightById = new Map(((flights as any[]) || []).map((f) => [f.id, f]));
  const nameById = new Map(((allFlightEntries as any[]) || []).map((p) => [p.id, p.player_name]));
  const matchesByFlight = new Map<string, any[]>();
  for (const m of (matches as any[]) || []) {
    if (!matchesByFlight.has(m.flight_id)) matchesByFlight.set(m.flight_id, []);
    matchesByFlight.get(m.flight_id)!.push(m);
  }

  const origin = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;

  let sent = 0;
  let skipped_no_email = 0;
  let skipped_unsubscribed = 0;

  for (const entry of list) {
    const recipient = entry.player_email || entry.parent_email;
    if (!recipient) {
      skipped_no_email++;
      continue;
    }
    const flightMatches = (matchesByFlight.get(entry.flight_id) || [])
      .filter(
        (m) =>
          m.player1_id === entry.id ||
          m.player2_id === entry.id ||
          m.player3_id === entry.id ||
          m.player4_id === entry.id
      )
      .sort((a, b) => a.round - b.round || (a.scheduled_at || '').localeCompare(b.scheduled_at || ''));

    const emailMatches = flightMatches.map((m) => {
      const isDoubles = m.match_type === 'doubles';
      const youOnA = m.player1_id === entry.id || m.player2_id === entry.id;
      let label = '';
      if (isDoubles) {
        const partnerId = youOnA
          ? m.player1_id === entry.id
            ? m.player2_id
            : m.player1_id
          : m.player3_id === entry.id
            ? m.player4_id
            : m.player3_id;
        const opp1 = youOnA ? m.player3_id : m.player1_id;
        const opp2 = youOnA ? m.player4_id : m.player2_id;
        label = `R4 Doubles · with ${nameById.get(partnerId) || '?'} vs ${nameById.get(opp1) || '?'} + ${nameById.get(opp2) || '?'}`;
      } else {
        const opp = youOnA ? m.player3_id : m.player1_id;
        label = `R${m.round} Singles · vs ${nameById.get(opp) || '?'}`;
      }
      return {
        label,
        timeDisplay: m.scheduled_at ? formatTimeDisplay(m.scheduled_at) : 'TBD',
        court: m.court || '',
      };
    });

    const result = await sendQuadsScheduleEmail({
      to: recipient,
      playerName: entry.player_name,
      tournamentName: event.name,
      tournamentDate: event.event_date,
      flightName: flightById.get(entry.flight_id)?.name ?? null,
      matches: emailMatches,
      scoringUrl: `${origin}/quads/player/${entry.player_token}`,
    });
    if (result.sent) sent++;
    else if (result.reason === 'unsubscribed') skipped_unsubscribed++;
    else skipped_no_email++;
  }

  return NextResponse.json({ sent, total: list.length, skipped_no_email, skipped_unsubscribed });
}
