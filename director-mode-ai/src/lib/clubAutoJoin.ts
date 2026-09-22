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
    .select('id, director_id, user_id')
    .ilike('email', addr);

  const matched = ((vaultRows as { id: string; director_id: string; user_id: string | null }[]) || []);

  /*
   * Nail the vault row to the account while the addresses still agree.
   *
   * This is the only moment we can be certain the two are the same person:
   * they proved the address, and the club put it on the roster. From here on
   * the roster reads cc_vault_players.user_id, so the director can correct the
   * email later and this person keeps their rating and their history instead
   * of quietly splitting into two half-people (see pf_vault_user_link.sql).
   */
  // But only where the director holds ONE row on this address. Couples share
  // an inbox, and linking both halves of a pair to whichever of them signed in
  // hands one spouse the other's rating (see step 4 of pf_vault_user_link.sql).
  // Two rows, one address: leave both for a human.
  const rowsPerDirector = new Map<string, number>();
  for (const v of matched) rowsPerDirector.set(v.director_id, (rowsPerDirector.get(v.director_id) ?? 0) + 1);
  const unlinked = matched
    .filter((v) => !v.user_id && rowsPerDirector.get(v.director_id) === 1)
    .map((v) => v.id);
  if (unlinked.length) {
    await db.from('cc_vault_players').update({ user_id: userId }).in('id', unlinked);
  }

  const directorIds = [
    ...new Set(matched.map((v) => v.director_id).filter(Boolean)),
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
