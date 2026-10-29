import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { reachableClubs } from '@/lib/clubs/activeClub';
import { memberRow, resolvePlayingClub } from '@/lib/partnerFinder/server';
import { shortName } from '@/lib/partnerFinder/format';
import CourtConnectLanding from '@/components/partnerFinder/CourtConnectLanding';

/**
 * /courtconnect — the standalone front door to CourtConnect.
 *
 * CourtConnect is the per-club partner finder (built as "Partner Finder", which
 * is why its code lives in lib/partnerFinder and pf_* tables). It shows up on
 * the court sheet, but a club that doesn't take reservations through us still
 * needs a door, and this is it. The old shared games pages under /courtconnect
 * redirect here too (next.config.mjs).
 *
 *   signed out        → the CourtConnect landing page (what link previews see)
 *   staff at a club   → the director view
 *   a playing member  → their club's board
 *   neither           → the member home, which explains what's next
 */
export const dynamic = 'force-dynamic';

export default async function CourtConnectEntry({ searchParams }: { searchParams?: { ref?: string | string[] } }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const ref = Array.isArray(searchParams?.ref) ? searchParams?.ref[0] : searchParams?.ref;
  if (!user) return <CourtConnectLanding sharedBy={ref ? await openedShare(ref) : null} />;

  if ((await reachableClubs(user.id, user.email)).length > 0) redirect('/run/members/courtconnect');
  if (await resolvePlayingClub(getSupabaseAdmin(), user.id)) redirect('/member/games');
  redirect('/member');
}

/**
 * A champion's share link was opened (see sendChampionReferrals): count it, and
 * name who shared it. Short name only ("Walden B."), the way every CourtConnect
 * email names a member.
 */
async function openedShare(code: string): Promise<{ name: string; club: string } | null> {
  if (!/^[a-z0-9]{6,20}$/i.test(code)) return null;
  const db = getSupabaseAdmin();
  const { data } = await db.from('pf_referral_invites').select('user_id, club_id, cc_clubs(name)').eq('code', code).maybeSingle();
  if (!data) return null;
  await db.rpc('pf_referral_click', { p_code: code });
  const row = await memberRow(db, data.club_id as string, data.user_id as string);
  const club = (data as unknown as { cc_clubs: { name: string } | null }).cc_clubs?.name;
  if (!row?.full_name || !club) return null;
  return { name: shortName(row.full_name), club };
}
