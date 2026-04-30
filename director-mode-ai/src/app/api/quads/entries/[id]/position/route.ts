/**
 * POST /api/quads/entries/[id]/position
 *
 * Director-only. Move an entry between positions (in_flight / waitlist /
 * withdrawn / pending_payment). Sends a "you've been promoted" email when
 * a waitlisted entry is moved to in_flight.
 *
 * Body: { position: 'in_flight' | 'waitlist' | 'withdrawn' | 'pending_payment' }
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { sendQuadsPromotedEmail } from '@/lib/quadEmails';

const ALLOWED = new Set(['in_flight', 'waitlist', 'withdrawn', 'pending_payment']);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: entryId } = await params;

  const userClient = await createClient();
  const {
    data: { user },
  } = await userClient.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const position = typeof body?.position === 'string' ? body.position : '';
  if (!ALLOWED.has(position)) {
    return NextResponse.json({ error: 'Invalid position' }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  const { data: entry } = await admin
    .from('quad_entries')
    .select('id, event_id, position, player_name, player_email, parent_email')
    .eq('id', entryId)
    .maybeSingle();
  if (!entry) return NextResponse.json({ error: 'Entry not found' }, { status: 404 });

  const { data: ev } = await admin
    .from('events')
    .select('user_id, name, slug')
    .eq('id', (entry as any).event_id)
    .maybeSingle();
  if (!ev || (ev as any).user_id !== user.id) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  const previous = (entry as any).position;
  await admin.from('quad_entries').update({ position }).eq('id', entryId);

  // Send promotion email when going waitlist -> in_flight.
  if (previous === 'waitlist' && position === 'in_flight') {
    try {
      const recipient = (entry as any).player_email || (entry as any).parent_email;
      if (recipient) {
        const origin = new URL(request.url).origin;
        await sendQuadsPromotedEmail({
          to: recipient,
          playerName: (entry as any).player_name,
          tournamentName: (ev as any).name,
          publicUrl: `${origin}/quads/${(ev as any).slug}`,
        });
      }
    } catch (err) {
      console.error('quad promote email failed:', err);
    }
  }

  return NextResponse.json({ success: true, position });
}
