/**
 * postLogin.ts — where a person goes after signing in or clicking an email link.
 *
 * Before this, /login sent everyone without a `redirect` param to '/', the
 * marketing homepage — so a director who had just confirmed their email and
 * signed in was shown the pitch for the product they had just joined.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { pickPrimaryClub } from '@/lib/clubRoles';

/**
 * A caller-supplied destination, or null if it isn't safe to follow.
 *
 * Relative paths only. An absolute URL (or a protocol-relative `//host`) would
 * turn every sign-in and email link into an open redirect — a phishing gift.
 * Backslashes are refused too: some browsers normalise `/\host` to `//host`.
 */
export function safeNext(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return null;
  return raw;
}

/**
 * True when every club role this person holds is plain `member`.
 *
 * No roles at all is NOT member-only: a brand-new account with no club becomes
 * a director on first use, and sending it to an empty clubhouse would strand
 * the one person about to set a club up. Owners are checked separately by the
 * callers, because ownership lives on cc_clubs rather than in these rows.
 */
export function isMemberOnly(roles: string[]): boolean {
  return roles.length > 0 && roles.every((r) => r === 'member');
}

/**
 * The default home for a signed-in user with nowhere specific to go.
 *
 * Mirrors ClubSidebar's member check: owners and staff (and brand-new users with
 * no club yet, who become directors on first use) get the /welcome setup
 * checklist; a plain club MEMBER gets their clubhouse at /member, because the
 * checklist is all director tools they cannot open.
 */
/**
 * A captain with no club: they captain (or co-captain) a team but own no club
 * and belong to none. CaptainMode is their whole app. The club landing, the
 * club welcome page and the club tools rail mean nothing to them (Darrin,
 * 2026-09-18, viewing as Artem Melnik).
 */
export async function isCaptainOnly(supabase: SupabaseClient, userId: string): Promise<boolean> {
  const [{ data: owned }, { data: mems }] = await Promise.all([
    supabase.from('cc_clubs').select('id').eq('owner_id', userId).limit(1).maybeSingle(),
    supabase.from('cc_club_members').select('club_id').eq('user_id', userId).limit(1),
  ]);
  if (owned || (mems && mems.length)) return false;
  const [{ data: own }, { data: staff }] = await Promise.all([
    supabase.from('captain_teams').select('id').eq('captain_user_id', userId).limit(1),
    supabase.from('captain_team_staff').select('team_id').eq('user_id', userId).limit(1),
  ]);
  return !!((own && own.length) || (staff && staff.length));
}

export async function defaultDestination(supabase: SupabaseClient, userId: string): Promise<string> {
  try {
    if (await isCaptainOnly(supabase, userId)) return '/captain';
    const { data: owned } = await supabase
      .from('cc_clubs').select('id').eq('owner_id', userId).limit(1).maybeSingle();
    if (owned) return '/welcome';
    const { data: mems } = await supabase
      .from('cc_club_members').select('club_id, role, created_at').eq('user_id', userId);
    if (isMemberOnly((mems || []).map((m) => m.role))) return '/member';
    const primary = pickPrimaryClub(mems || [], null);
    const mem = (mems || []).find((m) => m.club_id === primary);
    if (mem?.role === 'member') return '/member';
    // The maintenance crew's whole app is their board.
    if (mem?.role === 'maintenance') return '/maintenance';
    return '/welcome';
  } catch {
    return '/welcome';
  }
}
