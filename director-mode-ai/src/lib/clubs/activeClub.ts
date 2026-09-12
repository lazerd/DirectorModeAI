/**
 * Which club am I running right now?
 *
 * ClubMode has three levels of person and they need different answers:
 *
 *   1. The PLATFORM operator — owns ClubMode, not a club. Needs to reach any
 *      club to set one up or help a director out of a hole.
 *   2. A club OWNER or DIRECTOR — runs one club, sometimes two. Needs to pick.
 *   3. A MEMBER — runs nothing, and never sees any of this.
 *
 * Until now the answer was "the alphabetically first club you own", which is
 * fine for the common case of exactly one and silently wrong the moment there
 * are two: building a prospect's club under a real director's account
 * repointed every one of that director's own tools at somebody else's club,
 * with no screen saying so. One working club got hijacked that way.
 *
 * So the choice is now EXPLICIT and sticky, held in a cookie, and validated
 * against what the user may actually reach on every request — a stale or
 * tampered cookie falls back rather than granting anything.
 */

import { cookies } from 'next/headers';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { isPlatformOwnerEmail } from '@/lib/platformOwner';

export const ACTIVE_CLUB_COOKIE = 'cm_club';

export type ReachableClub = {
  id: string;
  name: string;
  slug: string;
  /** How they reach it. 'platform' means via the platform operator role. */
  via: 'owner' | 'staff' | 'platform';
  role: string;
};

/**
 * Every club this person may run, best claim first.
 *
 * Owned clubs lead, then clubs they are staff at, then — for a platform
 * operator only — everything else. The ordering matters: it decides the
 * default, and a director's own club must always win over one they are merely
 * helping with.
 */
export async function reachableClubs(
  userId: string,
  email: string | null | undefined,
): Promise<ReachableClub[]> {
  const db = getSupabaseAdmin();
  const out: ReachableClub[] = [];
  const seen = new Set<string>();

  const push = (
    row: { id: string; name: string; slug: string },
    via: ReachableClub['via'],
    role: string,
  ) => {
    if (seen.has(row.id)) return;
    seen.add(row.id);
    out.push({ id: row.id, name: row.name, slug: row.slug, via, role });
  };

  const { data: owned } = await db
    .from('cc_clubs')
    .select('id, name, slug')
    .eq('owner_id', userId)
    .order('name');
  for (const c of (owned as { id: string; name: string; slug: string }[] | null) ?? []) {
    push(c, 'owner', 'owner');
  }

  const { data: staff } = await db
    .from('cc_club_members')
    .select('club_id, role, cc_clubs(id, name, slug)')
    .eq('user_id', userId)
    .in('role', ['owner', 'director', 'coach', 'front_desk']);
  for (const m of (staff as
    | { role: string; cc_clubs: { id: string; name: string; slug: string } | null }[]
    | null) ?? []) {
    if (m.cc_clubs) push(m.cc_clubs, 'staff', m.role);
  }

  /*
   * The platform operator can reach every club, listed last so it never
   * displaces their own. This is what makes "I own ClubMode and I also run a
   * club" expressible: the two roles are separate, and their own club stays
   * the default.
   */
  if (isPlatformOwnerEmail(email)) {
    const { data: all } = await db
      .from('cc_clubs')
      .select('id, name, slug')
      .order('name')
      .limit(200);
    for (const c of (all as { id: string; name: string; slug: string }[] | null) ?? []) {
      push(c, 'platform', 'platform');
    }
  }

  return out;
}

/**
 * The club to act on: their explicit choice if it is still valid, else the
 * best claim they have.
 *
 * Returns null when they can run no club at all — which is a member, and the
 * caller's cue to send them to the member side rather than bootstrap a club
 * under them.
 */
export async function resolveActiveClub(
  userId: string,
  email: string | null | undefined,
): Promise<{ active: ReachableClub | null; clubs: ReachableClub[] }> {
  const clubs = await reachableClubs(userId, email);
  if (clubs.length === 0) return { active: null, clubs };

  const chosen = (await cookies()).get(ACTIVE_CLUB_COOKIE)?.value;
  // Validated against the list rather than trusted: a stale cookie from a club
  // they have left, or a hand-edited one, must fall back and never grant.
  const match = chosen ? clubs.find((c) => c.id === chosen) : undefined;

  return { active: match ?? clubs[0], clubs };
}

/** Remember the choice. Cleared by passing null. */
export async function setActiveClub(clubId: string | null) {
  const store = await cookies();
  if (!clubId) {
    store.set(ACTIVE_CLUB_COOKIE, '', { path: '/', maxAge: 0 });
    return;
  }
  store.set(ACTIVE_CLUB_COOKIE, clubId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    // 'lax' so arriving from an emailed link keeps the club they were working
    // on rather than silently switching them.
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 90,
  });
}
