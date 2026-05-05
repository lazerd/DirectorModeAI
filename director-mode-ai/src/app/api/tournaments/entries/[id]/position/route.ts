/**
 * POST /api/tournaments/entries/[id]/position
 *
 * Director-only. Move an entry between positions.
 *
 * Body: { position: 'in_draw' | 'waitlist' | 'withdrawn' | 'pending_payment' }
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

const ALLOWED = new Set(['in_draw', 'waitlist', 'withdrawn', 'pending_payment']);

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
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
    .from('tournament_entries')
    .select('id, event_id')
    .eq('id', entryId)
    .maybeSingle();
  if (!entry) return NextResponse.json({ error: 'Entry not found' }, { status: 404 });

  const { data: ev } = await admin
    .from('events')
    .select('user_id')
    .eq('id', (entry as any).event_id)
    .maybeSingle();
  if (!ev || (ev as any).user_id !== user.id) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  await admin.from('tournament_entries').update({ position }).eq('id', entryId);
  return NextResponse.json({ success: true, position });
}
