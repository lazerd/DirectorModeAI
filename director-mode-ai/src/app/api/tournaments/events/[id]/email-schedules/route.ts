/**
 * POST /api/tournaments/events/[id]/email-schedules
 *
 * Director-only. For each confirmed entry, send an email listing every
 * match they're in: bracket, round, opponent(s), court, time.
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
    .from('tournament_entries')
    .select('id, player_name, player_email, parent_email, partner_name, player_token, position')
    .eq('event_id', eventId)
    .eq('position', 'in_draw');

  const list = (entries as any[]) || [];

  const { data: matchesData } = await admin
    .from('tournament_matches')
    .select('*')
    .eq('event_id', eventId);
  const matches = (matchesData as any[]) || [];

  const { data: allEntriesData } = await admin
    .from('tournament_entries')
    .select('id, player_name, partner_name')
    .eq('event_id', eventId);
  const labelEntry = (id: string | null) => {
    if (!id) return 'TBD';
    const ent = ((allEntriesData as any[]) || []).find((x) => x.id === id);
    if (!ent) return '—';
    return ent.partner_name ? `${ent.player_name} + ${ent.partner_name}` : ent.player_name;
  };

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

    const playerMatches = matches
      .filter(
        (m) =>
          m.player1_id === entry.id ||
          m.player2_id === entry.id ||
          m.player3_id === entry.id ||
          m.player4_id === entry.id
      )
      .sort(
        (a, b) =>
          a.round - b.round ||
          (a.scheduled_at || '').localeCompare(b.scheduled_at || '')
      );

    const emailMatches = playerMatches.map((m) => {
      const youOnA = m.player1_id === entry.id || m.player2_id === entry.id;
      const opponentSide = youOnA ? 'b' : 'a';
      const oppLabel =
        opponentSide === 'a'
          ? labelEntry(m.player1_id)
          : labelEntry(m.player3_id);
      const bracketLabel = m.bracket === 'consolation' ? ' (Consolation)' : '';
      return {
        label: `R${m.round}${bracketLabel} · vs ${oppLabel}`,
        timeDisplay: m.scheduled_at ? formatTimeDisplay(m.scheduled_at) : 'TBD',
        court: m.court || '',
      };
    });

    const result = await sendQuadsScheduleEmail({
      to: recipient,
      playerName: entry.player_name,
      tournamentName: event.name,
      tournamentDate: event.event_date,
      flightName: null,
      matches: emailMatches,
      scoringUrl: `${origin}/tournaments/player/${entry.player_token}`,
    });
    if (result.sent) sent++;
    else if (result.reason === 'unsubscribed') skipped_unsubscribed++;
    else skipped_no_email++;
  }

  return NextResponse.json({ sent, total: list.length, skipped_no_email, skipped_unsubscribed });
}
