import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { LIBRARY_TRACKS, libraryStoragePath } from '@/lib/dj-library';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes — downloading 15 tracks can take a while

/**
 * Admin-only seed endpoint. Downloads each curated library track from its
 * source URL (archive.org) and uploads to Supabase storage at
 * dj-audio/library/<track-id>.mp3.
 *
 * Auth: requires CRON_SECRET in the Authorization header (so this is the
 * same gate as the monthly usage cron). Hit it once after deploy:
 *
 *   curl -X POST https://club.coachmode.ai/api/admin/dj/seed-library \
 *        -H "Authorization: Bearer $CRON_SECRET"
 *
 * Returns a per-track result list so you can see which sources worked and
 * which need replacing.
 */
export async function POST(request: NextRequest) {
  const auth = request.headers.get('authorization');
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const admin = getSupabaseAdmin();
  const results: Array<{ id: string; status: 'seeded' | 'skipped' | 'failed'; reason?: string; size?: number }> = [];

  const body = await request.json().catch(() => ({}));
  const force = body.force === true;

  for (const track of LIBRARY_TRACKS) {
    const path = libraryStoragePath(track.id);

    // Skip if already in storage and not forcing
    if (!force) {
      const { data: existing } = await admin.storage.from('dj-audio').list('library', {
        search: `${track.id}.mp3`,
      });
      if (existing && existing.some((f) => f.name === `${track.id}.mp3`)) {
        results.push({ id: track.id, status: 'skipped', reason: 'already exists' });
        continue;
      }
    }

    try {
      const res = await fetch(track.sourceUrl, {
        headers: {
          'User-Agent': 'ClubModeAI-LibrarySeeder/1.0 (+https://club.coachmode.ai)',
        },
      });
      if (!res.ok) {
        results.push({ id: track.id, status: 'failed', reason: `source ${res.status}` });
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 1000) {
        results.push({ id: track.id, status: 'failed', reason: 'source too small (likely HTML 404 page)' });
        continue;
      }
      const { error: uploadErr } = await admin.storage
        .from('dj-audio')
        .upload(path, new Uint8Array(buf), {
          contentType: 'audio/mpeg',
          upsert: true,
        });
      if (uploadErr) {
        results.push({ id: track.id, status: 'failed', reason: uploadErr.message });
        continue;
      }
      results.push({ id: track.id, status: 'seeded', size: buf.length });
    } catch (err: any) {
      results.push({ id: track.id, status: 'failed', reason: err?.message || 'unknown' });
    }
  }

  return NextResponse.json({
    total: LIBRARY_TRACKS.length,
    seeded: results.filter((r) => r.status === 'seeded').length,
    skipped: results.filter((r) => r.status === 'skipped').length,
    failed: results.filter((r) => r.status === 'failed').length,
    results,
  });
}
