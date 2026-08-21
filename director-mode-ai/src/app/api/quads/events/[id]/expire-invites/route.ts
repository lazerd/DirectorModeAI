/**
 * POST /api/quads/events/[id]/expire-invites
 *
 * Director-only. Releases every invite on this event whose 24-hour payment
 * window has passed without payment, and emails those players. The freed
 * spots then show up in the allocation planner for the next round of invites.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { expireOverdueQuadInvites } from '@/lib/quadInviteExpiry';

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
    .select('id, user_id')
    .eq('id', eventId)
    .maybeSingle();
  if (!ev) return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  if ((ev as any).user_id !== user.id) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  const origin = new URL(request.url).origin;
  const result = await expireOverdueQuadInvites(admin, { eventId, origin, notify: true });
  return NextResponse.json(result);
}
