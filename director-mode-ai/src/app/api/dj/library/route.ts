import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { LIBRARY_TRACKS, libraryStoragePath } from '@/lib/dj-library';

export const dynamic = 'force-dynamic';

/**
 * Returns the curated library catalog with current Supabase public URLs.
 * Tracks that haven't been seeded yet are flagged available=false so the
 * UI can grey them out.
 */
export async function GET() {
  const admin = getSupabaseAdmin();
  const { data: files } = await admin.storage.from('dj-audio').list('library', { limit: 100 });
  const seededIds = new Set((files || []).map((f) => f.name.replace(/\.mp3$/, '')));

  const tracks = LIBRARY_TRACKS.map((t) => {
    const path = libraryStoragePath(t.id);
    const {
      data: { publicUrl },
    } = admin.storage.from('dj-audio').getPublicUrl(path);
    return {
      id: t.id,
      title: t.title,
      vibe: t.vibe,
      composer: t.composer,
      durationSec: t.durationSec,
      url: publicUrl,
      available: seededIds.has(t.id),
    };
  });

  return NextResponse.json({ tracks });
}
