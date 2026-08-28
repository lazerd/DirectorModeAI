import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

type CookieToSet = { name: string; value: string; options?: any };

export async function middleware(request: NextRequest) {
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
    // CaptainMode subscription page. The rest of /captain is deliberately NOT
    // listed: the player-facing surfaces (/captain/availability|claim|confirm)
    // are tokenized and must work with no login, and a startsWith('/captain')
    // rule would bounce them to /login. The captain-only pages live in the
    // (app) route group, whose layout does the auth redirect — same split as
    // CourtSheet above.
    '/captain/subscribe',
    // "Run the club" section landing pages (/run/courts, /run/programs, ...).
    // They only list staff tools, so they get the same gate the tools have.
    '/run',
  ];
  const isProtectedPath = protectedPaths.some(path =>
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
    '/run',
  ];
  const isDirectorPath = DIRECTOR_PATHS.some((p) => request.nextUrl.pathname.startsWith(p));
  if (isDirectorPath && user && (user.email_confirmed_at || user.confirmed_at)) {
    const { data: owned } = await supabase
      .from('cc_clubs').select('id').eq('owner_id', user.id).limit(1).maybeSingle();
    if (!owned) {
      const { data: staff } = await supabase
        .from('cc_club_members').select('role').eq('user_id', user.id)
        .in('role', ['owner', 'director', 'coach', 'front_desk']).limit(1).maybeSingle();
      if (!staff) {
        const { data: anyMembership } = await supabase
          .from('cc_club_members').select('club_id').eq('user_id', user.id).limit(1).maybeSingle();
        // A plain member → send home. A brand-new user with no club at all is
        // left alone (they become a director on first use).
        if (anyMembership) {
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

