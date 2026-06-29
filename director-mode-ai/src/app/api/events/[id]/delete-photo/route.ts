/**
 * POST /api/events/[id]/delete-photo
 *
 * Director-only. Removes an event photo from storage + event_photos using the
 * service role. Body: JSON { photoId }.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

const BUCKET = 'event-photos';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: eventId } = await params;

  const userClient = await createClient();
  const {
    data: { user },
  } = await userClient.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = getSupabaseAdmin();
  const { data: ev } = await admin.from('events').select('id, user_id').eq('id', eventId).maybeSingle();
  if (!ev) return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  if ((ev as any).user_id !== user.id) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });

  const { photoId } = await req.json();
  if (!photoId) return NextResponse.json({ error: 'photoId required' }, { status: 400 });

  const { data: photo } = await admin
    .from('event_photos')
    .select('id, storage_path, event_id')
    .eq('id', photoId)
    .maybeSingle();
  if (!photo || (photo as any).event_id !== eventId) {
    return NextResponse.json({ error: 'Photo not found' }, { status: 404 });
  }

  if ((photo as any).storage_path) {
    await admin.storage.from(BUCKET).remove([(photo as any).storage_path]);
  }
  const { error: dbErr } = await admin.from('event_photos').delete().eq('id', photoId);
  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
