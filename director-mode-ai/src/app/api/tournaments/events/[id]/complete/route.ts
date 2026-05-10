/**
 * POST /api/tournaments/events/[id]/complete
 *
 * Director-only. Marks the tournament public_status='completed'.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

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
    .select('id, user_id, slug')
    .eq('id', eventId)
    .maybeSingle();
  if (!ev) return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  if ((ev as any).user_id !== user.id) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  await admin.from('events').update({ public_status: 'completed' }).eq('id', eventId);

  return NextResponse.json({ success: true, slug: (ev as any).slug });
}
