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
