/**
 * A club's level scale, read from the database.
 *
 * lib/levels.ts is the pure half — it decides what a level is CALLED and how it
 * reads. This is the half that needs a database: the club's own tier rows, if
 * it has any, out of cc_club_level_tiers.
 *
 * Separate file because levels.ts is imported by client components, and a
 * module that reaches for the admin client cannot be.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { levelScaleFor, type LevelScale, type LevelTier } from '@/lib/levels';

type Db = SupabaseClient<any, 'public', any>;

type TierRow = { sport: string; name: string; rating: number | string; min_rating: number | string; max_rating: number | string | null };

const toTier = (r: TierRow): LevelTier => ({
  name: r.name,
  rating: Number(r.rating),
  min: Number(r.min_rating),
  max: r.max_rating == null ? null : Number(r.max_rating),
});

/**
 * The scale for one club.
 *
 * `sport` is the specific one when the surface is about a single sport; without
 * it a mixed club falls back to the first sport on cc_clubs.sports, its primary.
 * A club with no rows of its own gets the defaults for that sport.
 */
export async function clubLevelScale(
  db: Db,
  club: { id: string; sports?: string[] | null },
  sport?: string | null,
): Promise<LevelScale> {
  const want = (sport || club.sports?.[0] || 'tennis').toLowerCase();
  const { data } = await db
    .from('cc_club_level_tiers')
    .select('sport, name, rating, min_rating, max_rating')
    .eq('club_id', club.id)
    .eq('sport', want)
    .order('position');
  return levelScaleFor({ sports: club.sports, sport: want, tiers: ((data as TierRow[] | null) ?? []).map(toTier) });
}

/** Every scale a club uses, keyed by sport — PlayerVault, whose rows carry their own. */
export async function clubLevelScales(
  db: Db,
  club: { id: string; sports?: string[] | null },
): Promise<Record<string, LevelScale>> {
  const { data } = await db
    .from('cc_club_level_tiers')
    .select('sport, name, rating, min_rating, max_rating')
    .eq('club_id', club.id)
    .order('position');
  const bySport = new Map<string, LevelTier[]>();
  for (const r of (data as TierRow[] | null) ?? []) {
    bySport.set(r.sport, [...(bySport.get(r.sport) ?? []), toTier(r)]);
  }
  const sports = new Set([...(club.sports ?? ['tennis']), ...bySport.keys()]);
  const out: Record<string, LevelScale> = {};
  for (const s of sports) out[s] = levelScaleFor({ sports: club.sports, sport: s, tiers: bySport.get(s) ?? null });
  return out;
}
