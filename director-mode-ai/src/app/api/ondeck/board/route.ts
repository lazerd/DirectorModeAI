import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

/**
 * How old a snapshot may be before the board stops presenting it as live.
 * The desk republishes on change plus a 90-second heartbeat, so this has to
 * clear the heartbeat comfortably or a quiet spell reads as a failure.
 */
const STALE_AFTER_MS = 6 * 60_000;

/**
 * Public read of the current wait board. No auth: this is the page parents
 * scan a QR code to reach. It returns only what the snapshot holds, which
 * is the same information already printed on the order of play.
 */
export async function GET(request: NextRequest) {
  const slug = (request.nextUrl.searchParams.get('slug') ?? '').trim().toLowerCase();
  if (!/^[a-z0-9-]{3,64}$/.test(slug)) {
    return NextResponse.json({ error: 'bad_slug' }, { status: 400 });
  }

  // Cookie-free admin client — see the note in the snapshot route.
  const service = getSupabaseAdmin();
  const { data, error } = await service
    .from('td_snapshots')
    .select('slug, title, payload, updated_at')
    .eq('slug', slug)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // If the desk laptop has stopped publishing, say so rather than showing
  // stale wait times as though they were current — a wrong number here
  // sends a family away from the courts.
  const ageMs = Date.now() - new Date(data.updated_at).getTime();

  return NextResponse.json(
    {
      slug: data.slug,
      title: data.title,
      board: data.payload,
      updatedAt: data.updated_at,
      ageSeconds: Math.round(ageMs / 1000),
      stale: ageMs > STALE_AFTER_MS,
    },
    { headers: { 'cache-control': 'no-store' } }
  );
}
