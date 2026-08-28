/**
 * One World Tennis Number per player, everywhere in ClubMode.
 *
 * WTN describes a PERSON, not their membership of one team, so a captain who
 * pastes it into a league roster should never have to type it again in
 * PlayerVault, a mixer, or next season. Before this it was declared in three
 * unrelated tables and populated in none — three tools about to collect the
 * same number separately and then disagree about it.
 *
 * ## Shape
 *
 * `master_players` is the source of truth. It is RLS-locked to service_role on
 * purpose — it holds contact details for every person across every club, so a
 * browser client must never read it. That rules out reading the hub directly
 * from a page, which is why the club-scoped tables carry a MIRROR, protected by
 * the RLS they already have.
 *
 * Writes therefore go: hub first, then propagate outward. Nothing reads a club
 * table expecting a value the hub does not have.
 *
 * ## The scale
 *
 * WTN runs 1 (professional) to 40 (beginner): **lower is stronger**, the
 * opposite of NTRP and UTR. Every comparison here is written that way round,
 * and the band is enforced in the database as well as here, because one number
 * out of band silently ranks that player the strongest in the club.
 */
import { getSupabaseAdmin } from '@/lib/supabase/admin';

export const MIN_WTN = 1;
export const MAX_WTN = 40;

/** Where a number came from. Kept so an automated sync can refuse to overwrite a human. */
export type WtnSource = 'usta_paste' | 'manual' | 'usta_api';

export type WtnValue = {
  wtn: number | null;
  wtnDoubles: number | null;
};

/** Anything carrying a WTN, however the surrounding table spells the columns. */
export type WtnBearing = {
  wtn?: number | null;
  wtn_doubles?: number | null;
  wtnDoubles?: number | null;
};

/**
 * Every club-scoped table that mirrors the hub's number, with the column its
 * link lives in. Adding a player table to ClubMode means adding it here and to
 * the identity sync in the same commit, or its copy silently goes stale.
 */
const MIRROR_TABLES = [
  'cc_vault_players',
  'captain_players',
  'players',
] as const;

/** In range, and actually a number. Rejects the NaN a bad parse produces. */
export function isValidWtn(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= MIN_WTN && v <= MAX_WTN;
}

/**
 * The number a DOUBLES surface should use: the doubles WTN when the player has
 * one, otherwise their singles number. Null when they have neither — never 0,
 * which on this scale would read as better than a professional.
 */
export function doublesWtn(p: WtnBearing | null | undefined): number | null {
  if (!p) return null;
  const d = p.wtnDoubles ?? p.wtn_doubles;
  if (isValidWtn(d)) return d;
  return isValidWtn(p.wtn) ? p.wtn : null;
}

/** The number a SINGLES surface should use. */
export function singlesWtn(p: WtnBearing | null | undefined): number | null {
  if (!p) return null;
  return isValidWtn(p.wtn) ? p.wtn : null;
}

/** How a WTN reads on screen: one decimal, or an em dash when there isn't one. */
export function formatWtn(v: number | null | undefined): string {
  return isValidWtn(v) ? v.toFixed(1) : '—';
}

/**
 * Sort comparator, strongest first.
 *
 * Players with no WTN always sink to the bottom rather than being treated as a
 * 0 — on an inverted scale a missing number would otherwise outrank everybody.
 * Stable by name so a re-sort never reshuffles equals.
 */
export function byWtnStrongestFirst<T extends WtnBearing & { name?: string; full_name?: string }>(
  a: T,
  b: T,
  pick: (p: T) => number | null = doublesWtn,
): number {
  const wa = pick(a);
  const wb = pick(b);
  if (wa === null && wb === null) return nameOf(a).localeCompare(nameOf(b));
  if (wa === null) return 1;
  if (wb === null) return -1;
  return wa - wb || nameOf(a).localeCompare(nameOf(b));
}

function nameOf(p: { name?: string; full_name?: string }): string {
  return p.name ?? p.full_name ?? '';
}

/** The average WTN of a pair — how a doubles line gets its court number. */
export function pairWtn(a: WtnBearing | null, b: WtnBearing | null): number | null {
  const x = doublesWtn(a);
  const y = doublesWtn(b);
  if (x === null || y === null) return null;
  return (x + y) / 2;
}

export type PropagateResult = {
  /** Rows updated, per table. */
  updated: Record<string, number>;
  errors: string[];
};

/**
 * Write a player's WTN to the hub and push it out to every club-scoped copy.
 *
 * Service-role throughout: the hub is not readable any other way, and the
 * mirrors have to be written regardless of which club's RLS the caller sits
 * under — the whole point is that the number reaches tools the caller may not
 * themselves have access to.
 *
 * Best-effort by design. A mirror that fails is stale, not wrong, and the
 * nightly repair pass picks it up; losing the captain's paste because one
 * table was briefly unavailable would be the worse outcome.
 */
export async function setWtnForPerson(
  masterPlayerId: string,
  value: WtnValue,
  source: WtnSource = 'manual',
): Promise<PropagateResult> {
  const admin = getSupabaseAdmin();
  const stamp = new Date().toISOString();
  const result: PropagateResult = { updated: {}, errors: [] };

  if (value.wtn != null && !isValidWtn(value.wtn)) {
    result.errors.push(`Singles WTN ${value.wtn} is outside ${MIN_WTN}–${MAX_WTN}.`);
    return result;
  }
  if (value.wtnDoubles != null && !isValidWtn(value.wtnDoubles)) {
    result.errors.push(`Doubles WTN ${value.wtnDoubles} is outside ${MIN_WTN}–${MAX_WTN}.`);
    return result;
  }

  // Only overwrite the doubles number when one was actually supplied — a
  // singles-only paste must not wipe a doubles WTN that is already there.
  const hubPatch: Record<string, unknown> = {
    wtn: value.wtn,
    wtn_updated_at: stamp,
    wtn_source: source,
    updated_at: stamp,
  };
  if (value.wtnDoubles != null) hubPatch.wtn_doubles = value.wtnDoubles;

  const { error: hubError } = await admin
    .from('master_players')
    .update(hubPatch)
    .eq('id', masterPlayerId);

  if (hubError) {
    result.errors.push(`master_players: ${hubError.message}`);
    return result; // Nothing to propagate if the source of truth didn't take it.
  }

  await Promise.all(
    MIRROR_TABLES.map(async (table) => {
      const patch: Record<string, unknown> = { wtn: value.wtn, updated_at: stamp };
      if (value.wtnDoubles != null) patch.wtn_doubles = value.wtnDoubles;
      const { data, error } = await admin
        .from(table)
        .update(patch)
        .eq('master_player_id', masterPlayerId)
        .select('id');
      if (error) result.errors.push(`${table}: ${error.message}`);
      else result.updated[table] = data?.length ?? 0;
    }),
  );

  return result;
}

/**
 * Push the hub's numbers back out to every mirror that disagrees.
 *
 * The self-healing pass: a mirror written while a table was unavailable, a row
 * linked to its person after the number was set, or a copy edited directly all
 * converge here. Safe to run repeatedly — it only writes rows that differ.
 */
export async function repairWtnMirrors(limit = 500): Promise<PropagateResult> {
  const admin = getSupabaseAdmin();
  const result: PropagateResult = { updated: {}, errors: [] };

  const { data: people, error } = await admin
    .from('master_players')
    .select('id, wtn, wtn_doubles')
    .not('wtn', 'is', null)
    .limit(limit);

  if (error) {
    result.errors.push(`master_players: ${error.message}`);
    return result;
  }

  const rows = (people as { id: string; wtn: number; wtn_doubles: number | null }[]) || [];
  const stamp = new Date().toISOString();

  for (const table of MIRROR_TABLES) {
    let count = 0;
    await Promise.all(
      rows.map(async (person) => {
        const patch: Record<string, unknown> = { wtn: person.wtn, updated_at: stamp };
        if (person.wtn_doubles != null) patch.wtn_doubles = person.wtn_doubles;
        const { data, error: upErr } = await admin
          .from(table)
          .update(patch)
          .eq('master_player_id', person.id)
          // Only rows that actually disagree — keeps this cheap to re-run.
          .or(`wtn.is.null,wtn.neq.${person.wtn}`)
          .select('id');
        if (upErr) result.errors.push(`${table}: ${upErr.message}`);
        else count += data?.length ?? 0;
      }),
    );
    result.updated[table] = count;
  }

  return result;
}
