/**
 * Who may open the CRM.
 *
 * Two ways in, and they are not the same thing:
 *
 *   - a row in crm_users, active — the sales reps. Keyed on email so the row
 *     can be added before the person has ever signed in, and on user_id once
 *     they have, because an account's email can be changed under us.
 *   - a platform owner (PLATFORM_OWNER_EMAILS) — us, always, even with an
 *     empty allowlist. This is what stops a bad `crm-user.mjs --remove` from
 *     locking everyone out of their own pipeline.
 *
 * Nobody else, ever. Not a club owner, not a director, not a ClubMode
 * subscriber with every role there is. This file is deliberately ignorant of
 * cc_club_members: there is no club role that grants CRM access, so there is
 * nothing here to get wrong later.
 *
 * The predicate is pure and takes its rows, so it can be tested without a
 * database and reused by the server helper next door. The SQL half of the same
 * rule is is_crm_user() in supabase/migrations/crm.sql — keep them in step.
 */

import { platformOwnerEmails } from '@/lib/platformOwner';

export interface CrmUserRow {
  email: string;
  user_id: string | null;
  full_name: string | null;
  initials: string | null;
  active: boolean;
}

export interface CrmIdentity {
  /** The signed-in user's id, or null when signed out. */
  userId: string | null;
  /** Their email, or null. */
  email: string | null;
}

export interface CrmAccess {
  allowed: boolean;
  /** How they got in — useful in a log line, never shown to a stranger. */
  via: 'allowlist' | 'platform_owner' | null;
  /** Their allowlist row, when they have one. A platform owner may not. */
  row: CrmUserRow | null;
  /** Lower-cased email, or '' — what activity rows are stamped with. */
  email: string;
}

const DENIED: CrmAccess = { allowed: false, via: null, row: null, email: '' };

function norm(v: string | null | undefined): string {
  return (v ?? '').trim().toLowerCase();
}

/**
 * Resolve an identity against the allowlist.
 *
 * `owners` is injectable so a test can state the platform owners rather than
 * depend on the environment the suite happens to run in.
 */
export function crmAccessFor(
  identity: CrmIdentity,
  rows: CrmUserRow[],
  owners: string[] = platformOwnerEmails(),
): CrmAccess {
  // Signed out is denied before anything else is consulted. An allowlist row
  // with a null user_id must never match a null auth.uid().
  if (!identity.userId) return DENIED;

  const email = norm(identity.email);
  const row =
    rows.find((r) => r.active && r.user_id && r.user_id === identity.userId) ??
    rows.find((r) => r.active && !!email && norm(r.email) === email) ??
    null;
  if (row) return { allowed: true, via: 'allowlist', row, email: email || norm(row.email) };

  if (email && owners.map(norm).includes(email)) {
    return { allowed: true, via: 'platform_owner', row: null, email };
  }
  return DENIED;
}

/**
 * Two characters for a pipeline card.
 *
 * An explicit `initials` on the row always wins — "Kevin Carey" and "Kim
 * Carter" both come out KC otherwise, and the reps get to disambiguate
 * themselves. Falls back to the first letter of the first and last word, then
 * to the email, then to '?'. Never returns an empty string, because a blank
 * badge on a card reads as a rendering bug.
 */
export function initialsFor(
  person: { initials?: string | null; full_name?: string | null; email?: string | null } | null,
): string {
  if (!person) return '?';
  const explicit = (person.initials ?? '').trim();
  if (explicit) return explicit.slice(0, 3).toUpperCase();

  const words = (person.full_name ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[words.length - 1][0]).toUpperCase();
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();

  const email = (person.email ?? '').trim();
  if (email) return email.slice(0, 2).toUpperCase();
  return '?';
}
