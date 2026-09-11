/**
 * "View as" — the owner working inside another person's account.
 *
 * The honest way to do this on Supabase is to hand the browser a REAL session
 * for the target user, not to fake one at the app layer. RLS decides what most
 * of this app can see, and RLS reads the JWT: a pretend "current user" held in
 * a cookie would change the UI while every query still ran as the owner, which
 * is worse than not having the feature — the screen would look like the user's
 * and behave like the owner's. So a session swap it is, with the owner's own
 * refresh token parked in a second cookie so there is always a way back.
 *
 * What that costs, stated plainly: while it is on, the session IS the target
 * user's, and anything done is done as them. Hence the banner on every page,
 * the short lifetime, and the audit row.
 */

import { cookies } from 'next/headers';

/** Marks a session as borrowed, and names whose it is. Read server-side only. */
export const VIEW_AS_COOKIE = 'cm_view_as';
/** The owner's own refresh token, so exiting restores their session. */
export const RETURN_COOKIE = 'cm_view_as_return';

/**
 * Long enough to work through a captain's problem, short enough that a
 * forgotten tab is not a standing key to someone else's account.
 */
export const VIEW_AS_MAX_AGE = 60 * 60 * 2;

export type ViewAsState = {
  /** The person whose screen this is. */
  targetUserId: string;
  targetLabel: string;
  /** Who borrowed it — shown in the banner so a shared screen is unambiguous. */
  adminEmail: string;
  /** Audit row to close on exit. */
  logId: string;
};

const cookieOpts = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  // 'lax' rather than 'strict': arriving from an emailed link or an external
  // redirect must not silently drop the banner and leave the swapped session
  // looking like the owner's own.
  sameSite: 'lax' as const,
  path: '/',
};

export async function readViewAs(): Promise<ViewAsState | null> {
  const raw = (await cookies()).get(VIEW_AS_COOKIE)?.value;
  if (!raw) return null;
  try {
    const v = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as ViewAsState;
    return v.targetUserId ? v : null;
  } catch {
    return null;
  }
}

export async function writeViewAs(state: ViewAsState) {
  const store = await cookies();
  store.set(VIEW_AS_COOKIE, Buffer.from(JSON.stringify(state), 'utf8').toString('base64url'), {
    ...cookieOpts,
    maxAge: VIEW_AS_MAX_AGE,
  });
}

export async function writeReturnToken(refreshToken: string) {
  (await cookies()).set(RETURN_COOKIE, refreshToken, {
    ...cookieOpts,
    maxAge: VIEW_AS_MAX_AGE,
  });
}

export async function readReturnToken(): Promise<string | null> {
  return (await cookies()).get(RETURN_COOKIE)?.value ?? null;
}

export async function clearViewAs() {
  const store = await cookies();
  for (const name of [VIEW_AS_COOKIE, RETURN_COOKIE]) {
    store.set(name, '', { ...cookieOpts, maxAge: 0 });
  }
}
