/**
 * POST /api/me/club-link — put me in the club that already has me on its roster.
 *
 * Called when someone first lands after signing up. If their email is on a
 * club's PlayerVault, that club has already said they are a member; this makes
 * the app agree. See src/lib/clubAutoJoin.ts for why matching on email is safe.
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { attachByEmail } from '@/lib/clubAutoJoin';

export const dynamic = 'force-dynamic';

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

  const result = await attachByEmail(getSupabaseAdmin(), user.id, user.email);

  return NextResponse.json({
    ok: true,
    joined: result.joined.length,
    clubs: result.clubIds.length,
  });
}
