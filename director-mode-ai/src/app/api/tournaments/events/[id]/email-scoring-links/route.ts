/**
 * POST /api/tournaments/events/[id]/email-scoring-links
 *
 * Director-only. Sends every confirmed entry (position='in_draw') a
 * personal scoring URL — `${origin}/tournaments/player/${entry.player_token}`.
 *
 * Returns: { sent, total, skipped_no_email, skipped_unsubscribed }
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { sendQuadsScoringLinkEmail } from '@/lib/quadEmails';

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
    .select('id, name, user_id, slug')
    .eq('id', eventId)
    .maybeSingle();
  if (!ev) return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  if ((ev as any).user_id !== user.id) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  const { data: entries } = await admin
    .from('tournament_entries')
    .select('id, player_name, player_email, parent_email, player_token, position')
    .eq('event_id', eventId)
    .eq('position', 'in_draw');

  const list = (entries as any[]) || [];
  const origin = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;

  let sent = 0;
  let skipped_no_email = 0;
  let skipped_unsubscribed = 0;

  for (const e of list) {
    const recipient = e.player_email || e.parent_email;
    if (!recipient) {
      skipped_no_email++;
      continue;
    }
    const result = await sendQuadsScoringLinkEmail({
      to: recipient,
      playerName: e.player_name,
      tournamentName: (ev as any).name,
      flightName: null,
      scoringUrl: `${origin}/tournaments/player/${e.player_token}`,
    });
    if (result.sent) sent++;
    else if (result.reason === 'unsubscribed') skipped_unsubscribed++;
    else skipped_no_email++;
  }

  return NextResponse.json({ sent, skipped_no_email, skipped_unsubscribed, total: list.length });
}
