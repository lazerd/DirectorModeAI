import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { APP_URL, LEGACY_HOST } from '@/lib/appUrl';

type CookieToSet = { name: string; value: string; options?: any };

/**
 * PERMANENT redirect from the old host to clubmode.ai, path and query preserved.
 *
 * This is not temporary migration scaffolding — it must stay forever. Links to
 * club.coachmode.ai are printed on posters, sitting in sent emails, and — the
 * one that actually matters — embedded in the tokenized scoring links league
 * coaches and captains use to enter scores without logging in. Those tokens live
 * in the URL path, so a path-preserving redirect keeps every link ever issued
 * working. Delete this and you silently break score entry for people who are not
 * looking at a screen you control.
 *
 * Status codes: 301 for page loads (the permanent signal search engines
 * consolidate on), but 308 for /api/* because 301 lets a browser rewrite a POST
 * into a GET. A coach with a stale tab open POSTing a score to the old host must
 * arrive at the new host still as a POST, or the score vanishes with no error.
 *
 * GATED ON PURPOSE. docs/DOMAIN-MIGRATION-PLAN.md puts the 301 last in the
 * cutover order, after Resend, Supabase and link generation have all moved. So
 * this ships dormant and is switched on with one env var at cutover:
 *
 *     LEGACY_HOST_REDIRECT=on
 *
 * Off (the default), club.coachmode.ai keeps serving normally, which means
 * merging and deploying this changes nothing. Once it is on, leave it on
 * forever — see the note above about what depends on it.
 */
function redirectLegacyHost(request: NextRequest): NextResponse | null {
  if (process.env.LEGACY_HOST_REDIRECT !== 'on') return null;

  const host = request.headers.get('host')?.toLowerCase().split(':')[0];
  if (host !== LEGACY_HOST) return null;

  const target = new URL(request.nextUrl.pathname + request.nextUrl.search, APP_URL);
  const isApi = request.nextUrl.pathname.startsWith('/api/');
  return NextResponse.redirect(target, isApi ? 308 : 301);
}

export async function middleware(request: NextRequest) {
  // Runs before anything else: no Supabase round-trip, and no session cookie
  // written against a host we are trying to retire.
  const legacy = redirectLegacyHost(request);
  if (legacy) return legacy;

  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();

  const protectedPaths = [
    '/mixer/home',
    '/mixer/events',
    '/mixer/leagues',
    '/mixer/subscription',
    '/mixer/settings',
    '/lessons/dashboard',
    '/stringing/jobs',
    // ClubMode Connect — the candidate profile + club match inbox require
    // auth. The /connect landing itself is public (anonymous market stats).
    '/connect/candidate',
    '/connect/clubs',
    // Total-comp profile (the proprietary dataset) is per-user.
    '/benchmarks/profile',
    // CourtSheet staff view requires auth. Public /courtsheet/[clubSlug]
    // does NOT — handled by the route, not the matcher (auth check inside
    // the route distinguishes staff vs public surface).
    '/courtsheet/staff',
    '/calendar',
    '/member',
    // MaintenanceMode — staff and the maintenance crew.
    '/maintenance',
    // CaptainMode subscription page. The rest of /captain is deliberately NOT
    // listed: the player-facing surfaces (/captain/availability|claim|confirm)
    // are tokenized and must work with no login, and a startsWith('/captain')
    // rule would bounce them to /login. The captain-only pages live in the
    // (app) route group, whose layout does the auth redirect — same split as
    // CourtSheet above.
    '/captain/subscribe',
    // "Run the club" section landing pages (/run/courts, /run/programs, ...)
    // and the full directory at /tools. They only list staff tools, so they get
    // the same gate the tools themselves have.
    '/run',
    '/tools',
    // First-run setup wizard — needs a signed-in user to attach the club to.
    '/start',
  ];
  /*
   * Public pages that live UNDER a protected prefix.
   *
   * protectedPaths is a startsWith list, which structurally cannot say
   * "exactly one segment deep" — so '/calendar' was also catching
   * /calendar/<clubSlug>, the club's published year calendar. That page is
   * written to be public and SEO-visible (it is the only club page in the app
   * with generateMetadata), and anonymous visitors were being bounced to
   * /login. A club site links to it, so the bug would have landed on a club's
   * own members. Checked BEFORE the protected test, and narrow on purpose: the
   * director children /calendar/board, /calendar/ideas and /calendar/import
   * have two segments or a reserved name, so they stay protected.
   */
  const CALENDAR_DIRECTOR_CHILDREN = ['board', 'ideas', 'import'];
  const publicUnderProtected = (() => {
    const m = /^\/calendar\/([^/]+)$/.exec(request.nextUrl.pathname);
    return !!m && !CALENDAR_DIRECTOR_CHILDREN.includes(m[1]);
  })();

  const isProtectedPath = !publicUnderProtected && protectedPaths.some(path =>
    request.nextUrl.pathname.startsWith(path)
  );

  if (isProtectedPath && !user) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('redirect', request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }

  // Block unconfirmed users from protected pages — they must verify their email first.
  if (isProtectedPath && user && !user.email_confirmed_at && !user.confirmed_at) {
    const url = request.nextUrl.clone();
    url.pathname = '/verify-email';
    if (user.email) url.searchParams.set('email', user.email);
    return NextResponse.redirect(url);
  }

  // Keep club MEMBERS (players who joined via the invite link) out of the
  // director-only tools. Their home is /client/dashboard. This is both a
  // courtesy (they don't land on an empty director shell) and a guard — the
  // data layer already denies them, but this stops the confusion at the door.
  // Only runs on director surfaces, and short-circuits for owners after one
  // query, so it costs nothing on the common path.
  const DIRECTOR_PATHS = [
    '/calendar', '/mixer', '/courtsheet/staff', '/lessons/dashboard',
    '/stringing', '/club-hub', '/club/members', '/connect/clubs',
    '/run', '/tools',
  ];
  const isDirectorPath =
    !publicUnderProtected && DIRECTOR_PATHS.some((p) => request.nextUrl.pathname.startsWith(p));
  // The maintenance crew sees ONLY MaintenanceMode. Their member home and the
  // director setup page are no use to them, so those send them to their board too.
  const isCrewHomePath = ['/member', '/welcome'].some(
    (p) => request.nextUrl.pathname === p || request.nextUrl.pathname.startsWith(p + '/'),
  );
  if ((isDirectorPath || isCrewHomePath) && user && (user.email_confirmed_at || user.confirmed_at)) {
    const { data: owned } = await supabase
      .from('cc_clubs').select('id').eq('owner_id', user.id).limit(1).maybeSingle();
    if (!owned) {
      const { data: staff } = await supabase
        .from('cc_club_members').select('role').eq('user_id', user.id)
        .in('role', ['owner', 'director', 'coach', 'front_desk']).limit(1).maybeSingle();
      if (!staff) {
        // Their own rows only (the "Read own memberships" policy).
        const { data: mine } = await supabase
          .from('cc_club_members').select('role').eq('user_id', user.id);
        const roles = ((mine as { role: string }[] | null) || []).map((m) => m.role);
        if (roles.includes('maintenance')) {
          const url = request.nextUrl.clone();
          url.pathname = '/maintenance';
          url.search = '';
          return NextResponse.redirect(url);
        }
        // A plain member on a director tool → send home. A brand-new user with
        // no club at all is left alone (they become a director on first use).
        if (isDirectorPath && roles.length) {
          const url = request.nextUrl.clone();
          url.pathname = '/member';
          url.search = '';
          return NextResponse.redirect(url);
        }
      }
    }
  }

  const authPaths = ['/login', '/register'];
  const isAuthPath = authPaths.includes(request.nextUrl.pathname);

  if (isAuthPath && user) {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};

