/**
 * Who counts as staff at a club.
 *
 * The public join link (`/join/<code>`) grants **member** — that is the whole
 * point of it, a code a club shares widely. Anything that speaks for the club
 * has to check for a staff role on top, or a code passed around a member
 * newsletter becomes a way to be listed as an instructor on the club's own
 * booking page.
 *
 * Kept next to the SQL helper's definition (`is_club_team()` / staff checks) so
 * the two do not drift.
 */
export const CLUB_ROLES = ['owner', 'director', 'coach', 'front_desk', 'member'] as const;
export type ClubRole = (typeof CLUB_ROLES)[number];

export const STAFF_ROLES: ClubRole[] = ['owner', 'director', 'coach', 'front_desk'];

export function isStaffRole(role: string | null | undefined): boolean {
  return !!role && (STAFF_ROLES as string[]).includes(role);
}

/** The roles that may list themselves as bookable instructors on a club page. */
export const INSTRUCTOR_ROLES: ClubRole[] = ['owner', 'director', 'coach'];

export function isInstructorRole(role: string | null | undefined): boolean {
  return !!role && (INSTRUCTOR_ROLES as string[]).includes(role);
}

export const ROLE_LABEL: Record<string, string> = {
  owner: 'Owner',
  director: 'Director',
  coach: 'Coach',
  front_desk: 'Front desk',
  member: 'Member',
};

/**
 * Which club a person "belongs to", when the app has to pick one.
 *
 * Several places need a single club for a signed-in user, and they all used to
 * take whatever row came back first from an unordered `limit(1)` — fine while
 * everyone is in exactly one club, arbitrary the moment anyone is in two.
 * Worse, an owned club won by default, so a coach who wandered into the
 * create-a-club screen would silently detach from the club they actually teach
 * at.
 *
 * The rule, in order:
 *   1. The club where they hold the most senior STAFF role (owner > director >
 *      coach > front_desk). Staff means they work there.
 *   2. Otherwise the club they joined first — the earliest membership.
 *   3. Otherwise a club they own outright with no membership row.
 *
 * Deterministic in every case, which is the property that matters: the same
 * user resolves to the same club on every page and every request.
 */
const ROLE_RANK: Record<string, number> = {
  owner: 0,
  director: 1,
  coach: 2,
  front_desk: 3,
  member: 4,
};

export type Membership = { club_id: string; role: string; created_at?: string | null };

export function pickPrimaryClub(
  memberships: Membership[] | null | undefined,
  ownedClubId?: string | null,
): string | null {
  const rows = (memberships || []).filter((m) => !!m.club_id);
  if (rows.length) {
    const sorted = [...rows].sort((a, b) => {
      const ra = ROLE_RANK[a.role] ?? 9;
      const rb = ROLE_RANK[b.role] ?? 9;
      if (ra !== rb) return ra - rb;
      return String(a.created_at || '').localeCompare(String(b.created_at || ''));
    });
    return sorted[0].club_id;
  }
  return ownedClubId || null;
}
