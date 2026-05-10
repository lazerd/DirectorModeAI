import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { eventCanUsePremium } from '@/lib/billing';

export const dynamic = 'force-dynamic';

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB — covers ~2-3 minute MP3 at 128kbps
const ALLOWED_TYPES = ['audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/x-m4a', 'audio/m4a', 'audio/wav', 'audio/ogg', 'audio/webm'];

export async function POST(request: NextRequest) {
  try {
    const auth = await createClient();
    const {
      data: { user },
    } = await auth.auth.getUser();
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const form = await request.formData();
    const file = form.get('file');
    const eventId = form.get('eventId') as string | null;
    const playerId = form.get('playerId') as string | null;

    if (!eventId || !playerId) {
      return NextResponse.json({ error: 'eventId_and_playerId_required' }, { status: 400 });
    }
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'file_required' }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: 'file_too_large', message: `Max ${MAX_BYTES / 1024 / 1024} MB.` },
        { status: 400 }
      );
    }
    if (file.type && !ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: 'invalid_type', message: 'Upload an MP3, M4A, WAV, OGG, or WebM audio file.' },
        { status: 400 }
      );
    }

    const allowed = await eventCanUsePremium(user.id, eventId, 'dj_console');
    if (!allowed) {
      return NextResponse.json(
        { error: 'feature_locked', upgradeUrl: '/pricing' },
        { status: 402 }
      );
    }

    const admin = getSupabaseAdmin();
    const ext = file.name.split('.').pop()?.toLowerCase() || 'mp3';
    const path = `${user.id}/walkouts/${playerId}-${Date.now()}.${ext}`;
    const arrayBuf = await file.arrayBuffer();
    const { error: uploadErr } = await admin.storage
      .from('dj-audio')
      .upload(path, new Uint8Array(arrayBuf), {
        contentType: file.type || 'audio/mpeg',
        upsert: false,
      });
    if (uploadErr) {
      console.error('[dj/upload-walkout] storage error', uploadErr);
      return NextResponse.json(
        { error: 'storage_failed', message: uploadErr.message },
        { status: 500 }
      );
    }
    const {
      data: { publicUrl },
    } = admin.storage.from('dj-audio').getPublicUrl(path);

    return NextResponse.json({
      url: publicUrl,
      title: file.name.replace(/\.[^/.]+$/, ''),
      duration: null,
    });
  } catch (err: any) {
    console.error('[dj/upload-walkout]', err);
    return NextResponse.json({ error: 'upload_failed', message: err?.message }, { status: 500 });
  }
}
