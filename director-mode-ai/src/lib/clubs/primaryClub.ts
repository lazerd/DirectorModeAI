/**
 * The club a user works at, looked up server-side with the admin client.
 *
 * Same rule as everywhere else (see pickPrimaryClub): most senior staff role,
 * then the earliest membership, then a club they own with no membership row.
 * Used where something the club sends — a family page, a pickup email — needs
 * to say whose club it is.
 */
import type { getSupabaseAdmin } from '@/lib/supabase/admin';
import { pickPrimaryClub } from '@/lib/clubRoles';

type Db = ReturnType<typeof getSupabaseAdmin>;

export async function primaryClubFor(
  db: Db,
  userId: string,
): Promise<{ id: string; name: string; timezone: string | null } | null> {
  const [{ data: memberships }, { data: owned }] = await Promise.all([
    db.from('cc_club_members').select('club_id, role, created_at').eq('user_id', userId),
    db.from('cc_clubs').select('id').eq('owner_id', userId).order('created_at').limit(1).maybeSingle(),
  ]);
  const clubId = pickPrimaryClub(
    (memberships as { club_id: string; role: string; created_at: string }[]) || [],
    (owned?.id as string) || null,
  );
  if (!clubId) return null;
  const { data: club } = await db.from('cc_clubs').select('id, name, timezone').eq('id', clubId).maybeSingle();
  return (club as { id: string; name: string; timezone: string | null }) ?? null;
}
