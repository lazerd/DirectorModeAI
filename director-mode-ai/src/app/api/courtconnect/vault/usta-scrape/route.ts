import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { scrapeUstaTeam, isSupportedUstaUrl } from '@/lib/ustaScraper';

// Simple per-user rate limit (same pattern as the recommend routes):
// 20 scrapes / minute so a runaway loop can't hammer USTA or Vercel.
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 20;
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    rateBuckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (bucket.count >= RATE_LIMIT_MAX) return false;
  bucket.count += 1;
  return true;
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!checkRateLimit(user.id)) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const body = await request.json().catch(() => ({}));
    const url = typeof body?.url === 'string' ? body.url.trim() : '';

    if (!url) {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 });
    }

    if (!isSupportedUstaUrl(url)) {
      return NextResponse.json(
        { error: 'Only leagues.ustanorcal.com URLs are supported right now. TennisLink support is coming.' },
        { status: 400 }
      );
    }

    const result = await scrapeUstaTeam(url);

    return NextResponse.json(result);
  } catch (err: any) {
    console.error('USTA scrape error:', err);
    return NextResponse.json(
      { error: err?.message || 'Failed to scrape team roster' },
      { status: 500 }
    );
  }
}
