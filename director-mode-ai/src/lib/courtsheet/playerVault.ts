/**
 * PlayerVault read helper — name → player resolution.
 *
 * Used by the Phase 4 AI agent (`resolve_group` / `book for the Johnson
 * clinic group`) and by the staff drawer when a director types a player
 * name to add as a signup.
 *
 * Reads `cc_vault_players` — the CLUB's PlayerVault.
 *
 * ⚠️ Every query in here asked for columns cc_vault_players does not have:
 * `display_name`, `ntrp`, and a scope of `owner_id`. The real names are
 * `full_name`, `usta_rating` and (since vault_belongs_to_a_club.sql) `club_id`.
 * PostgREST answers an unknown column with an error, and these calls never
 * read `error`, so every lookup quietly returned nothing. Nothing imports this
 * module yet, so no screen was wrong — but it was a trap for whoever wired it
 * up. Corrected to the real schema, and scoped to a club rather than a person.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

export interface VaultPlayer {
  id: string;
  full_name: string | null;
  email: string | null;
  utr_singles: number | null;
  utr_doubles: number | null;
  /** The club's NTRP for this person — `usta_rating` on the row. */
  ntrp: number | null;
  membership_status: string | null;
  cc_player_id: string | null;
}

const COLS = 'id, full_name, email, utr_singles, utr_doubles, usta_rating, membership_status, cc_player_id';

type Row = Omit<VaultPlayer, 'ntrp'> & { usta_rating: number | null };
const toPlayer = (r: Row): VaultPlayer => ({
  id: r.id,
  full_name: r.full_name,
  email: r.email,
  utr_singles: r.utr_singles,
  utr_doubles: r.utr_doubles,
  ntrp: r.usta_rating,
  membership_status: r.membership_status,
  cc_player_id: r.cc_player_id,
});

/** Free-text "Sarah Johnson" → matching vault players, fuzzy-ish. */
export async function resolveByName(
  club_id: string,
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
    .select(COLS)
    .eq('club_id', club_id)
    .ilike('full_name', `%${q}%`)
    .order('full_name', { ascending: true })
    .limit(limit);

  const seen = new Set<string>();
  const out: VaultPlayer[] = [];
  for (const row of (pass1.data ?? []) as Row[]) {
    out.push(toPlayer(row));
    seen.add(row.id);
  }

  if (out.length < limit) {
    const tokens = q.split(/\s+/);
    const lastToken = tokens[tokens.length - 1];
    if (lastToken && lastToken.length >= 2) {
      const pass2 = await db
        .from('cc_vault_players')
        .select(COLS)
        .eq('club_id', club_id)
        .ilike('full_name', `%${lastToken}%`)
        .order('full_name', { ascending: true })
        .limit(limit - out.length);
      for (const row of (pass2.data ?? []) as Row[]) {
        if (!seen.has(row.id)) {
          out.push(toPlayer(row));
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
  club_id: string,
  groupHint: string
): Promise<VaultPlayer[]> {
  // Strip group words ("group", "team", "clinic", "ladies", "men's").
  const cleaned = groupHint
    .replace(/\b(group|team|clinic|class|ladies|men's|mens|women's|womens|the)\b/gi, '')
    .trim();
  if (!cleaned) return [];
  return resolveByName(club_id, cleaned, 16);
}

/** Look up a vault player by id (used by signup endpoints). */
export async function getVaultPlayer(id: string): Promise<VaultPlayer | null> {
  const db = getSupabaseAdmin();
  const { data } = await db
    .from('cc_vault_players')
    .select(COLS)
    .eq('id', id)
    .maybeSingle();
  return data ? toPlayer(data as Row) : null;
}
