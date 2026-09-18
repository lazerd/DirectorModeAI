/**
 * GET /api/clubs/levels — what the caller's club calls a level, per sport.
 *
 * { sports: ['pickleball'], levels: { pickleball: LevelScale } }
 *
 * PlayerVault and the vault forms are browser pages that read
 * cc_vault_players directly, so they have no other way to know that this
 * club's people are Novice and Intermediate rather than 2.0 and 2.8. Level
 * names are what a club publishes on its own website — nothing here is about
 * a person — so any signed-in member of the club may read them.
 *
 * The active club comes from resolveActiveClub (the same answer the /run pages
 * use, staff included), and a plain member falls back to their own club.
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { resolveActiveClub } from '@/lib/clubs/activeClub';
import { pickPrimaryClub, type Membership } from '@/lib/clubRoles';
import { clubLevelScales } from '@/lib/clubLevels';

export const dynamic = 'force-dynamic';

export async function GET() {
  const {
    data: { user },
  } = await (await createClient()).auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = getSupabaseAdmin();
  const { active } = await resolveActiveClub(user.id, user.email);
  let clubId = active?.id ?? null;
  if (!clubId) {
    const { data } = await admin.from('cc_club_members').select('club_id, role, created_at').eq('user_id', user.id);
    clubId = pickPrimaryClub(((data as Membership[] | null) ?? []), null);
  }
  if (!clubId) return NextResponse.json({ sports: [], levels: {} });

  const { data: club } = await admin.from('cc_clubs').select('id, sports').eq('id', clubId).maybeSingle();
  if (!club) return NextResponse.json({ sports: [], levels: {} });
  const sports = (club.sports as string[] | null) ?? ['tennis'];

  return NextResponse.json(
    { sports, levels: await clubLevelScales(admin, { id: club.id, sports }) },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
