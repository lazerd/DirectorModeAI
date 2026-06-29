/**
 * POST /api/events/[id]/upload-logo
 *
 * Director-only. Uploads a club logo to the `event-assets` storage bucket
 * using the service role (bypasses storage RLS), then records it on the event.
 * Body: multipart/form-data with a `file` field.
 * Returns: { url }
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

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

  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  if (!file.type.startsWith('image/')) return NextResponse.json({ error: 'File must be an image' }, { status: 400 });
  if (file.size > 4 * 1024 * 1024) return NextResponse.json({ error: 'Logo must be under 4MB' }, { status: 400 });

  const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
  const path = `logos/${eventId}/logo-${Date.now()}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: upErr } = await admin.storage
    .from('event-assets')
    .upload(path, buffer, { contentType: file.type, upsert: true });
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  const { data: urlData } = admin.storage.from('event-assets').getPublicUrl(path);
  const url = urlData.publicUrl;

  const { error: updErr } = await admin.from('events').update({ logo_url: url }).eq('id', eventId);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  return NextResponse.json({ url });
}
