import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { maybeRunBurst, REFRESH_THRESHOLD_MS } from '@/lib/clubhub/tick';

export const dynamic = 'force-dynamic';

// POST /api/club-hub/refresh — keeps the room alive while directors are in it.
// Called by the client when the Hub is open and right after a human posts.
// maybeRunBurst replies to an unanswered human immediately, and otherwise only
// generates ambient banter when the room has gone quiet — so pinging visitors
// can't spam or run up cost, but real questions get answered right away.
export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

  let admin: ReturnType<typeof getSupabaseAdmin>;
  try { admin = getSupabaseAdmin(); }
  catch { return NextResponse.json({ ok: false, skipped: 'no-admin' }); }

  const result = await maybeRunBurst(admin, REFRESH_THRESHOLD_MS);
  return NextResponse.json(result);
}
