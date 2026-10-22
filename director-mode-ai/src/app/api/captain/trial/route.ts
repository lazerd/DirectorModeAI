/**
 * POST /api/captain/trial — legacy.
 *
 * CaptainMode used to start with a 14-day trial; it is now free for every
 * signed-in captain (2026-10-21), so there is nothing to start. Kept so a page
 * still open from before the change gets a success rather than a 404, and
 * writes nothing.
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

  return NextResponse.json({ ok: true, free: true });
}
