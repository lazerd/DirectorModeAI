/**
 * Step inside a demo.
 *
 *   GET  /demo/<token>/enter?as=member|director&next=/path
 *   POST /demo/<token>/enter   (form: as, next) — the "Continue" on the
 *                               "you're signed in as someone else" screen
 *
 * Validates the link, signs this browser into that link's demo account (a real
 * session: RLS reads the JWT, so a pretend one would show the member's screen
 * with the wrong data), marks the browser with cm_demo for the banner, and
 * lands on `next` — a same-site path only (lib/demo/nextPath.ts).
 *
 * A browser already signed in as a REAL account is never swapped silently. It
 * goes to /demo/<token>/switch to say whose account it is and confirm, and
 * only that screen's POST replaces the session. Moving between the link's own
 * member and board member logins needs no confirmation.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { createClient as createSsrClient } from '@/lib/supabase/server';
import { ACTIVE_CLUB_COOKIE } from '@/lib/clubs/activeClub';
import { clearViewAs, readViewAs } from '@/lib/impersonation';
import { demoLanding, parseDemoRole, type DemoRole } from '@/lib/demo/nextPath';
import {
  DEMO_COOKIE,
  DEMO_COOKIE_MAX_AGE,
  accountFor,
  getLiveDemoLink,
  isDemoTokenShape,
  roleOf,
  recordDemoVisit,
  touchDemoLink,
} from '@/lib/demo/server';
import { demoAccountEmail, signInAs } from '@/lib/demo/session';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ token: string }> };

const see = (req: NextRequest, path: string) => NextResponse.redirect(new URL(path, req.nextUrl.origin), 303);

export async function GET(req: NextRequest, { params }: Params) {
  const { token } = await params;
  const sp = req.nextUrl.searchParams;
  if (isDemoTokenShape(token)) await recordDemoVisit(token, sp.get('r'), `enter:${sp.get('as') ?? ''}:${sp.get('next') ?? ''}`, req.headers.get('user-agent'));
  return enter(req, token, parseDemoRole(sp.get('as')), sp.get('next'), false);
}

export async function POST(req: NextRequest, { params }: Params) {
  const { token } = await params;
  // The confirm form lives on this site. A cross-site POST that signs someone
  // out of their own account is exactly what the confirmation exists to stop.
  const origin = req.headers.get('origin');
  if (origin && origin !== req.nextUrl.origin) {
    return NextResponse.json({ error: 'Cross-site request refused.' }, { status: 403 });
  }
  const form = await req.formData().catch(() => null);
  const as = parseDemoRole(String(form?.get('as') ?? ''));
  const next = form?.get('next');
  return enter(req, token, as, typeof next === 'string' ? next : null, true);
}

async function enter(
  req: NextRequest,
  token: string,
  role: DemoRole | null,
  rawNext: string | null,
  confirmed: boolean,
) {
  const tour = isDemoTokenShape(token) ? `/demo/${token}` : '/demo/unavailable';
  const link = await getLiveDemoLink(token);
  if (!link || !role) return see(req, tour);
  const targetId = accountFor(link, role);
  if (!targetId) return see(req, tour);
  const landing = demoLanding(role, rawNext);

  const supabase = await createSsrClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const borrowing = await readViewAs();
  const insideThisDemo = !!user && !borrowing && !!roleOf(link, user.id);

  if (user && !insideThisDemo && !confirmed) {
    const q = new URLSearchParams({ as: role, next: landing });
    return see(req, `/demo/${token}/switch?${q}`);
  }

  if (!(user?.id === targetId && !borrowing)) {
    const account = await demoAccountEmail(targetId);
    if ('refused' in account) {
      console.error(`[demo] link ${token.slice(0, 6)}… points at a non-demo account (${account.refused}); refusing`);
      return see(req, tour);
    }
    if (borrowing) await clearViewAs();
    const err = await signInAs(account.email);
    if (err) {
      console.error('[demo] sign-in failed', err);
      return see(req, `${tour}?trouble=1`);
    }
  }

  const store = await cookies();
  store.set(DEMO_COOKIE, link.token, {
    // Readable by script: the banner only asks the server when this is present.
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: DEMO_COOKIE_MAX_AGE,
  });
  // The board member's tools all open on the demo club, whatever an earlier
  // session in this browser had chosen.
  store.set(ACTIVE_CLUB_COOKIE, link.club_id, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: DEMO_COOKIE_MAX_AGE,
  });

  await touchDemoLink(link);
  return see(req, landing);
}
