import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { reachableClubs } from '@/lib/clubs/activeClub';
import { resolvePlayingClub } from '@/lib/partnerFinder/server';

/**
 * /courtconnect — the standalone front door to CourtConnect.
 *
 * CourtConnect is the per-club partner finder (built as "Partner Finder", which
 * is why its code lives in lib/partnerFinder and pf_* tables). It shows up on
 * the court sheet, but a club that doesn't take reservations through us still
 * needs a door, and this is it. The old shared games pages under /courtconnect
 * redirect here too (next.config.mjs).
 *
 *   signed out        → sign in, then back here
 *   staff at a club   → the director view
 *   a playing member  → their club's board
 *   neither           → the member home, which explains what's next
 */
export const dynamic = 'force-dynamic';

export default async function CourtConnectEntry() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?redirect=/courtconnect');

  if ((await reachableClubs(user.id, user.email)).length > 0) redirect('/run/members/courtconnect');
  if (await resolvePlayingClub(getSupabaseAdmin(), user.id)) redirect('/member/games');
  redirect('/member');
}
