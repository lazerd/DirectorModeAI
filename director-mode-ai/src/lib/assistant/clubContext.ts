import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { CLUB_TZ } from '@/lib/captain/clubTime';
import { resolveActiveClub } from '@/lib/clubs/activeClub';

/**
 * The club a director is running, for any assistant pack.
 *
 * Ask Claude is on every director page (Darrin, 2026-10-09: "an intercom to you
 * from each page"), so packs no longer gate on the URL. They gate on this: a
 * person who runs a club gets that club's tools wherever they are; a member,
 * who runs nothing, gets none.
 *
 * The club is the one they have CHOSEN in the switcher, validated against what
 * they may reach — never the alphabetically-first one they own, which once
 * pointed a director's tools at a prospect's club. Same precedence as the
 * clubSite pack, which this was lifted from.
 */
export interface ClubCtx {
  userId: string;
  db: ReturnType<typeof getSupabaseAdmin>;
  clubId: string;
  clubName: string;
  clubSlug: string;
  timeZone: string;
  /** owner | director | coach | front_desk | platform */
  role: string;
}

export async function resolveClubCtx(userId: string): Promise<ClubCtx | null> {
  const db = getSupabaseAdmin();
  const { active } = await resolveActiveClub(userId, null);
  if (!active) return null;
  const { data } = await db
    .from('cc_clubs')
    .select('id, name, slug, timezone')
    .eq('id', active.id)
    .maybeSingle();
  const club = data as { id: string; name: string; slug: string; timezone: string | null } | null;
  if (!club) return null;
  return {
    userId,
    db,
    clubId: club.id,
    clubName: club.name,
    clubSlug: club.slug,
    timeZone: club.timezone || CLUB_TZ,
    role: active.role,
  };
}

/** Roles allowed to make changes. A coach can read and mark attendance; money needs these. */
export const MANAGER_ROLES = new Set(['owner', 'director', 'platform']);
