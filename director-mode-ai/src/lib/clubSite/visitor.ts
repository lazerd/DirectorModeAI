/**
 * Who is looking at a club's site, and does this club count them as a member?
 *
 * The club site had no sign-in anywhere on it, which quietly broke the one
 * pricing rule that matters: members play free, everyone else pays. A member
 * arriving signed out was shown the public rate, told "members play free", and
 * given no way to become the member — so they either overpaid or phoned the
 * club, which is the thing the booking page exists to stop.
 *
 * Membership is read from the SESSION, never asserted by the visitor. At a club
 * where members play free, an "I'm a member" checkbox is a free-courts
 * checkbox.
 */

import { createClient } from '@/lib/supabase/server';
import { memberAudience } from '@/lib/courts/server';

export type SiteVisitor = {
  signedIn: boolean;
  /** What the club should call them. Null when signed out. */
  firstName: string | null;
  email: string | null;
  /** What they get charged — 'member' only if this club has them on the books. */
  audience: 'member' | 'public';
};

export const ANON_VISITOR: SiteVisitor = {
  signedIn: false,
  firstName: null,
  email: null,
  audience: 'public',
};

/** First name from whatever the account actually has, falling back to the local part. */
function firstNameOf(meta: Record<string, unknown>, email: string | null): string | null {
  const full =
    (typeof meta.full_name === 'string' && meta.full_name) ||
    (typeof meta.name === 'string' && meta.name) ||
    '';
  const first = full.trim().split(/\s+/)[0];
  if (first) return first;
  const local = (email || '').split('@')[0];
  return local || null;
}

export async function getSiteVisitor(clubId: string): Promise<SiteVisitor> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return ANON_VISITOR;

    const email = user.email ?? null;
    return {
      signedIn: true,
      firstName: firstNameOf((user.user_metadata ?? {}) as Record<string, unknown>, email),
      email,
      audience: await memberAudience(clubId, user.id),
    };
  } catch {
    // A club's site must render for the public even if auth is having a bad
    // day. Treating an error as "signed out" shows public rates, which is the
    // safe direction to be wrong in.
    return ANON_VISITOR;
  }
}
