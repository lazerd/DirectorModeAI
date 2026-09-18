/**
 * DUPR — pickleball's rating.
 *
 * NTRP is a self-assessment; DUPR (dupr.com) is computed from results, runs
 * roughly 2.000 to 8.000 to three decimals, and gives a player separate
 * singles and doubles numbers. Where a person HAS one it is the honest answer
 * to "what level are you", so a pickleball club shows it in place of a tier
 * name — and a club like Rossmoor Pickleball, whose members have their own
 * four tiers and no DUPR, never sees it at all.
 *
 * WHAT IS BUILT: the columns (master_players / cc_vault_players, see
 * supabase/migrations/dupr_ratings.sql), the rendering choice, the mapping
 * CourtConnect matches on, and a director typing a rating in by hand.
 *
 * WHAT IS NOT: the sync. Reading a club's ratings from DUPR needs PARTNER
 * APPROVAL — an application and a conversation with DUPR, the way CourtReserve
 * and PlayerU have one — not a key you sign up for. Nobody has applied yet.
 * `fetchDuprRating` below is the shape that call will take and it refuses to
 * run without credentials; the endpoint and payload are placeholders and must
 * be replaced with DUPR's real ones once we have their documentation. When it
 * lands it runs weekly, like scripts/sync-master-players.mjs, writing onto the
 * person and letting the club copies follow.
 */
import { tierOf, isTiered, levelValue, type LevelScale } from './index';

/** DUPR's published band. Anything outside it is a mis-parse, not a player. */
export const DUPR_MIN = 2;
export const DUPR_MAX = 8;

/** What a person's row carries. Both tables spell these columns the same way. */
export type DuprRating = {
  dupr_id?: string | null;
  dupr_singles?: number | string | null;
  dupr_doubles?: number | string | null;
  dupr_updated_at?: string | null;
};

const num = (v: number | string | null | undefined): number | null => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isNaN(n) || n < DUPR_MIN || n > DUPR_MAX ? null : n;
};

/**
 * The number to show: doubles when there is one, else singles.
 *
 * Doubles first because club pickleball is doubles — the same rule
 * lib/ratings/wtn.ts uses for tennis, for the same reason.
 */
export function duprOf(p: DuprRating | null | undefined): number | null {
  if (!p) return null;
  return num(p.dupr_doubles) ?? num(p.dupr_singles);
}

/** "3.412" — three decimals, always, because that is how DUPR is written. */
export const formatDupr = (n: number | string): string => Number(n).toFixed(3);

/** "DUPR 3.412". The scale's name is not "level" here; it is the rating's own. */
export const duprLabel = (n: number | string): string => `DUPR ${formatDupr(n)}`;

/** Does this club's sport use DUPR at all? Pickleball's rating, nobody else's. */
export const usesDupr = (scale: LevelScale): boolean => scale.sport === 'pickleball';

/**
 * How a DUPR-rated player and a tier-rated one compare at the same club.
 *
 * COURTCONNECT MATCHES ON ONE NUMBER and that does not change: pf_games holds
 * rating_min/rating_max, levelFits() compares master_players.ntrp against
 * them, and a game posted as "Intermediate to Advanced Intermediate" is stored
 * as the two tiers' representative numbers. A DUPR rating is folded into that
 * same axis here, by reading it as the tier whose band contains it and taking
 * that tier's rating.
 *
 * This works because the two scales share a neighbourhood — a 3.4 DUPR and a
 * club's "3.0–3.5" tier mean roughly the same standard of play — and because
 * the alternative, a second comparison axis, would mean a game could fit one
 * member and not another for reasons neither could see. Approximate on
 * purpose: it decides who gets emailed about a pick-up game, not who wins.
 *
 * Returns null at a club with no tiers, where there is nothing to map onto.
 */
export function duprToRating(scale: LevelScale, dupr: number | string | null | undefined): number | null {
  const n = num(dupr);
  if (n == null || !isTiered(scale)) return null;
  return tierOf(scale, n)?.rating ?? null;
}

/**
 * What one person's level reads as: their DUPR if they have one and the club
 * plays a sport that uses it, otherwise the club's own word for the number on
 * file — a tier name, an NTRP decimal, or "Not set yet".
 */
export function personLevel(
  scale: LevelScale,
  person: (DuprRating & { ntrp?: number | string | null; usta_rating?: number | string | null }) | null | undefined,
): string {
  const dupr = usesDupr(scale) ? duprOf(person) : null;
  if (dupr != null) return duprLabel(dupr);
  return levelValue(scale, person?.ntrp ?? person?.usta_rating ?? null);
}

/* ------------------------------------------------------- the sync, unbuilt */

/** One player's ratings as DUPR would return them. */
export type DuprLookup = {
  duprId: string;
  singles: number | null;
  doubles: number | null;
};

/**
 * Read one player's rating from DUPR.
 *
 * NOT WIRED UP. DUPR's partner API (api.dupr.gg) is open to approved partners
 * only; until we are one there is no key, no documentation, and nothing here
 * has been tested against the real thing. The request below is a PLACEHOLDER
 * for shape — treat the path and the response fields as unknown until DUPR
 * says otherwise.
 *
 * When access arrives: set DUPR_API_KEY, correct this call against their docs,
 * and call it from a weekly script alongside sync-master-players.mjs, writing
 * dupr_singles / dupr_doubles / dupr_updated_at onto master_players — and
 * writing duprToRating() into master_players.ntrp at the same time, so a
 * DUPR-rated member has the one number CourtConnect matches on and is never
 * asked to self-select a tier they have already outgrown.
 */
export async function fetchDuprRating(duprId: string): Promise<DuprLookup> {
  const key = process.env.DUPR_API_KEY;
  if (!key) throw new Error('DUPR partner access not configured');

  const res = await fetch(`https://api.dupr.gg/player/v1/${encodeURIComponent(duprId)}`, {
    headers: { Authorization: `Bearer ${key}` },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`DUPR lookup failed: ${res.status}`);
  const body = (await res.json()) as { result?: { ratings?: { singles?: unknown; doubles?: unknown } } };
  const r = body.result?.ratings ?? {};
  return {
    duprId,
    singles: num(r.singles as number | string | null),
    doubles: num(r.doubles as number | string | null),
  };
}
