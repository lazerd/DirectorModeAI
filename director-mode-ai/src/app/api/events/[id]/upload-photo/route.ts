/**
 * POST /api/events/[id]/upload-photo
 *
 * Director-only. Uploads one event photo to the `event-photos` storage bucket
 * using the service role (bypasses storage RLS) and records it in event_photos.
 * Body: multipart/form-data with a `file` field (already compressed client-side).
 * Returns: the inserted photo row { id, photo_url, storage_path, display_order }.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

const BUCKET = 'event-photos';
const MAX_PHOTOS = 5;

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

  const { count } = await admin
    .from('event_photos')
    .select('*', { count: 'exact', head: true })
    .eq('event_id', eventId);
  const existing = count ?? 0;
  if (existing >= MAX_PHOTOS) {
    return NextResponse.json({ error: `Up to ${MAX_PHOTOS} photos per event.` }, { status: 400 });
  }

  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  if (!file.type.startsWith('image/')) return NextResponse.json({ error: 'File must be an image' }, { status: 400 });
  if (file.size > 8 * 1024 * 1024) return NextResponse.json({ error: 'Photo too large' }, { status: 400 });

  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const path = `${user.id}/${eventId}/${crypto.randomUUID()}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: upErr } = await admin.storage
    .from(BUCKET)
    .upload(path, buffer, { contentType: file.type, upsert: false });
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  const { data: urlData } = admin.storage.from(BUCKET).getPublicUrl(path);

  const { data: row, error: dbErr } = await admin
    .from('event_photos')
    .insert({
      event_id: eventId,
      photo_url: urlData.publicUrl,
      storage_path: path,
      display_order: existing,
      uploaded_by: user.id,
    })
    .select('id, photo_url, storage_path, display_order')
    .single();
  if (dbErr) {
    // roll back the orphaned upload so a retry doesn't accumulate junk
    await admin.storage.from(BUCKET).remove([path]);
    return NextResponse.json({ error: dbErr.message }, { status: 500 });
  }

  return NextResponse.json({ photo: row });
}
