/**
 * PlayerVault read helper — name → player resolution.
 *
 * Used by the Phase 4 AI agent (`resolve_group` / `book for the Johnson
 * clinic group`) and by the staff drawer when a director types a player
 * name to add as a signup.
 *
 * Reads `cc_vault_players` (director's PlayerVault — has utr_singles/doubles,
 * rating_source, membership_status, cc_player_id). Optional fallback to
 * `cc_players` (CourtConnect-wide) is not used here — Phase 4 can layer
 * it on if needed.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

export interface VaultPlayer {
  id: string;
  display_name: string;
  full_name: string | null;
  email: string | null;
  utr_singles: number | null;
  utr_doubles: number | null;
  ntrp: number | null;
  membership_status: string | null;
  cc_player_id: string | null;
}

/** Free-text "Sarah Johnson" → matching vault players, fuzzy-ish. */
export async function resolveByName(
  user_id: string,
  query: string,
  limit = 5
): Promise<VaultPlayer[]> {
  if (!query.trim()) return [];
  const db = getSupabaseAdmin();
  const q = query.trim();

  // Two passes:
  //   1) Full-text-ish: ilike on display_name and full_name.
  //   2) If <limit results, try last-name-only match against the last token.
  const pass1 = await db
    .from('cc_vault_players')
    .select('id, display_name, full_name, email, utr_singles, utr_doubles, ntrp, membership_status, cc_player_id')
    .eq('owner_id', user_id)
    .or(`display_name.ilike.%${q}%,full_name.ilike.%${q}%`)
    .order('display_name', { ascending: true })
    .limit(limit);

  const seen = new Set<string>();
  const out: VaultPlayer[] = [];
  for (const row of (pass1.data ?? []) as VaultPlayer[]) {
    out.push(row);
    seen.add(row.id);
  }

  if (out.length < limit) {
    const tokens = q.split(/\s+/);
    const lastToken = tokens[tokens.length - 1];
    if (lastToken && lastToken.length >= 2) {
      const pass2 = await db
        .from('cc_vault_players')
        .select('id, display_name, full_name, email, utr_singles, utr_doubles, ntrp, membership_status, cc_player_id')
        .eq('owner_id', user_id)
        .or(`display_name.ilike.%${lastToken}%,full_name.ilike.%${lastToken}%`)
        .order('display_name', { ascending: true })
        .limit(limit - out.length);
      for (const row of (pass2.data ?? []) as VaultPlayer[]) {
        if (!seen.has(row.id)) {
          out.push(row);
          seen.add(row.id);
        }
      }
    }
  }

  return out;
}

/**
 * "the Johnson group" / "the morning ladies" — Phase 4 will use grouping
 * tags from PlayerVault. Today there's no grouping column, so this is
 * a stub that falls back to last-name matching.
 */
export async function resolveGroup(
  user_id: string,
  groupHint: string
): Promise<VaultPlayer[]> {
  // Strip group words ("group", "team", "clinic", "ladies", "men's").
  const cleaned = groupHint
    .replace(/\b(group|team|clinic|class|ladies|men's|mens|women's|womens|the)\b/gi, '')
    .trim();
  if (!cleaned) return [];
  return resolveByName(user_id, cleaned, 16);
}

/** Look up a vault player by id (used by signup endpoints). */
export async function getVaultPlayer(id: string): Promise<VaultPlayer | null> {
  const db = getSupabaseAdmin();
  const { data } = await db
    .from('cc_vault_players')
    .select('id, display_name, full_name, email, utr_singles, utr_doubles, ntrp, membership_status, cc_player_id')
    .eq('id', id)
    .maybeSingle();
  return (data as VaultPlayer) ?? null;
}
