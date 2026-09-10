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
 * The default home for a signed-in user with nowhere specific to go.
 *
 * Mirrors ClubSidebar's member check: owners and staff (and brand-new users with
 * no club yet, who become directors on first use) get the /welcome setup
 * checklist; a plain club MEMBER gets their clubhouse at /member, because the
 * checklist is all director tools they cannot open.
 */
export async function defaultDestination(supabase: SupabaseClient, userId: string): Promise<string> {
  try {
    const { data: owned } = await supabase
      .from('cc_clubs').select('id').eq('owner_id', userId).limit(1).maybeSingle();
    if (owned) return '/welcome';
    const { data: mems } = await supabase
      .from('cc_club_members').select('club_id, role, created_at').eq('user_id', userId);
    const primary = pickPrimaryClub(mems || [], null);
    const mem = (mems || []).find((m) => m.club_id === primary);
    return mem?.role === 'member' ? '/member' : '/welcome';
  } catch {
    return '/welcome';
  }
}
