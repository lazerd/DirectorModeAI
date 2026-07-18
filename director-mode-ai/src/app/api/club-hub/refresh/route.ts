import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { runOneBurst, msSinceLastMessage, REFRESH_THRESHOLD_MS } from '@/lib/clubhub/tick';

export const dynamic = 'force-dynamic';

// POST /api/club-hub/refresh — keeps the room alive while directors are in it.
// Called by the client when the Hub is open. Server-throttled: it only actually
// generates a burst if the room is empty or the last message is older than the
// threshold, so any number of visitors pinging can't spam or run up cost.
export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

  let admin: ReturnType<typeof getSupabaseAdmin>;
  try { admin = getSupabaseAdmin(); }
  catch { return NextResponse.json({ ok: false, skipped: 'no-admin' }); }

  const age = await msSinceLastMessage(admin);
  // Fresh enough — nothing to do (empty room => age null => generate).
  if (age !== null && age < REFRESH_THRESHOLD_MS) {
    return NextResponse.json({ ok: true, skipped: 'fresh' });
  }

  const result = await runOneBurst(admin);
  return NextResponse.json(result);
}
