/**
 * POST /api/clubs/[slug]/host — a visiting team asks to host its season here.
 *
 * A REQUEST, not a sale. Five or six match days across three to five courts is
 * a large block of a club's best hours, so the club looks at its season before
 * committing — the team submits, the club approves, payment follows approval.
 * Selling it instantly would let two teams buy the same Saturday.
 *
 * The package's numbers are COPIED onto the request. A club that raises its
 * prices next season must not silently reprice a season somebody already
 * agreed to.
 */

import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { sendHostRequestEmails } from '@/lib/host/emails';
import { resolveTheme } from '@/lib/clubSite/theme';

export const dynamic = 'force-dynamic';

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 6;
const buckets = new Map<string, { count: number; resetAt: number }>();

function rateLimited(key: string): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  if (b.count >= RATE_LIMIT_MAX) return true;
  b.count += 1;
  return false;
}

const clamp = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length === 0 ? null : t.slice(0, max);
};

const looksLikeEmail = (s: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const ip =
      req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
      req.headers.get('x-real-ip') ||
      'unknown';
    if (rateLimited(ip)) {
      return NextResponse.json(
        { error: 'Too many requests. Try again in a minute.' },
        { status: 429 },
      );
    }

    const { slug } = await params;
    const db = getSupabaseAdmin();

    const { data: clubRow } = await db
      .from('cc_clubs')
      .select('id, slug, name, email, phone, owner_id, is_public')
      .eq('slug', (slug || '').trim().toLowerCase())
      .maybeSingle();
    const club = clubRow as {
      id: string;
      slug: string;
      name: string;
      email: string | null;
      phone: string | null;
      owner_id: string;
      is_public: boolean;
    } | null;
    if (!club || !club.is_public) {
      return NextResponse.json({ error: 'Club not found.' }, { status: 404 });
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    const teamName = clamp(body.team_name, 160);
    const captainName = clamp(body.captain_name, 120);
    const captainEmailRaw = clamp(body.captain_email, 200);
    if (!teamName) return NextResponse.json({ error: 'We need the team name.' }, { status: 400 });
    if (!captainName) {
      return NextResponse.json({ error: "We need the captain's name." }, { status: 400 });
    }
    if (!captainEmailRaw || !looksLikeEmail(captainEmailRaw)) {
      return NextResponse.json({ error: 'We need a valid email address.' }, { status: 400 });
    }
    const captainEmail = captainEmailRaw.toLowerCase();

    // --------------------------------------------------------- the package
    const packageId = clamp(body.package_id, 64);
    if (!packageId) {
      return NextResponse.json({ error: 'Pick a package.' }, { status: 400 });
    }
    const { data: pkgRow } = await db
      .from('club_host_packages')
      .select('*')
      .eq('id', packageId)
      .eq('club_id', club.id)
      .eq('active', true)
      .maybeSingle();
    const pkg = pkgRow as {
      id: string;
      label: string;
      courts: number;
      matches_included: number;
      price_cents: number;
      playoff_price_cents: number | null;
    } | null;
    if (!pkg) {
      return NextResponse.json({ error: 'That package is no longer offered.' }, { status: 409 });
    }

    const playoffsRaw = Number(body.expected_playoffs);
    const expectedPlayoffs =
      Number.isFinite(playoffsRaw) && playoffsRaw >= 0 ? Math.min(20, Math.round(playoffsRaw)) : 0;

    // --------------------------------------- one open request per team, per club
    const { data: existing } = await db
      .from('club_host_requests')
      .select('id, status')
      .eq('club_id', club.id)
      .ilike('team_name', teamName)
      .in('status', ['requested', 'approved'])
      .maybeSingle();
    if (existing) {
      const open = existing as { status: string };
      return NextResponse.json(
        {
          error:
            open.status === 'approved'
              ? `${teamName} is already booked in here — check your email, or call the club.`
              : `We already have a request in for ${teamName}. The club will be in touch.`,
        },
        { status: 409 },
      );
    }

    const { data: inserted, error } = await db
      .from('club_host_requests')
      .insert({
        club_id: club.id,
        package_id: pkg.id,
        // Frozen at the moment of asking.
        quoted_label: pkg.label,
        quoted_courts: pkg.courts,
        quoted_matches: pkg.matches_included,
        quoted_cents: pkg.price_cents,
        quoted_playoff_cents: pkg.playoff_price_cents,
        team_name: teamName,
        league: clamp(body.league, 120),
        division: clamp(body.division, 80),
        captain_name: captainName,
        captain_email: captainEmail,
        captain_phone: clamp(body.captain_phone, 40),
        preferred_day: clamp(body.preferred_day, 40),
        preferred_time: clamp(body.preferred_time, 40),
        season_note: clamp(body.season_note, 1000),
        expected_playoffs: expectedPlayoffs,
      })
      .select('id')
      .maybeSingle();

    if (error || !inserted) {
      return NextResponse.json(
        { error: error?.message || 'Could not save the request.' },
        { status: 500 },
      );
    }

    // ------------------------------------------------------------- emails
    const { data: siteRow } = await db
      .from('club_site')
      .select('color_primary, color_secondary, color_ink, color_cream, color_surface, font_choice')
      .eq('club_id', club.id)
      .maybeSingle();

    let emailed = false;
    let warning: string | null = null;
    try {
      const result = await sendHostRequestEmails({
        ownerId: club.owner_id,
        clubName: club.name,
        clubSlug: club.slug,
        clubEmail: club.email,
        clubPhone: club.phone,
        accent: resolveTheme(siteRow as Record<string, unknown> | null).primary,
        request: {
          teamName,
          league: clamp(body.league, 120),
          division: clamp(body.division, 80),
          captainName,
          captainEmail,
          captainPhone: clamp(body.captain_phone, 40),
          preferredDay: clamp(body.preferred_day, 40),
          preferredTime: clamp(body.preferred_time, 40),
          seasonNote: clamp(body.season_note, 1000),
          expectedPlayoffs,
        },
        pkg,
      });
      emailed = result.captain;
    } catch {
      // The request is recorded either way. Telling them it failed would make
      // them submit again, and the club would have two.
      warning = 'Request received, but the confirmation email could not be sent.';
    }

    return NextResponse.json({
      ok: true,
      request_id: (inserted as { id: string }).id,
      emailed,
      ...(warning ? { warning } : {}),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Something went wrong.' },
      { status: 500 },
    );
  }
}
