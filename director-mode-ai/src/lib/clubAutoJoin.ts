/**
 * A person the club already knows should not have to be let in twice.
 *
 * PlayerVault is the club's roster: every junior and adult a director has
 * loaded is, by definition, a member of that club. But membership in the app
 * lives in cc_club_members, keyed to an auth account — so a player who signs up
 * arrived as a stranger, saw nothing, and had to be found and added by hand.
 *
 * This closes that: when someone's email matches a vault player, they are made
 * a member of that player's club automatically.
 *
 * Safe because the address is proven. Supabase requires email confirmation, so
 * matching an email means controlling that inbox — and the club itself put that
 * address on its roster, which is the club asserting "this person is ours".
 * It only ever ADDS the lowest role; it never promotes and never demotes.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export type AutoJoinResult = { clubIds: string[]; joined: string[] };

export async function attachByEmail(
  db: SupabaseClient,
  userId: string,
  email: string | null | undefined,
): Promise<AutoJoinResult> {
  const addr = (email || '').trim().toLowerCase();
  if (!addr) return { clubIds: [], joined: [] };

  /**
   * The vault belongs to a director, and a director's club is the one they own.
   * That indirection is why this cannot be a foreign key.
   */
  const { data: vaultRows } = await db
    .from('cc_vault_players')
    .select('director_id')
    .ilike('email', addr);

  const directorIds = [
    ...new Set(((vaultRows as { director_id: string }[]) || []).map((v) => v.director_id).filter(Boolean)),
  ];
  if (!directorIds.length) return { clubIds: [], joined: [] };

  const { data: clubs } = await db.from('cc_clubs').select('id').in('owner_id', directorIds);
  const clubIds = [...new Set(((clubs as { id: string }[]) || []).map((c) => c.id))];
  if (!clubIds.length) return { clubIds: [], joined: [] };

  const { data: existing } = await db
    .from('cc_club_members')
    .select('club_id')
    .eq('user_id', userId)
    .in('club_id', clubIds);
  const already = new Set(((existing as { club_id: string }[]) || []).map((m) => m.club_id));

  const toAdd = clubIds.filter((id) => !already.has(id));
  if (toAdd.length) {
    // 'member' only. Staff is always an explicit act by a director.
    await db
      .from('cc_club_members')
      .insert(toAdd.map((club_id) => ({ club_id, user_id: userId, role: 'member' })));
  }

  return { clubIds, joined: toAdd };
}
