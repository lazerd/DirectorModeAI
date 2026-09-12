/**
 * What is actually live at the club I am running — across every format.
 *
 * Events (mixers, socials, tournaments, quads, team battles), leagues, and
 * classes taking sign-ups. Laddering is not a fourth thing: it is auto-ordering
 * inside a league, so covering leagues covers it.
 *
 * "Show everything flagged running" would be useless, and that is the point of
 * this route. Sleepy Hollow had nine events marked 'running' with eight from
 * two months earlier, and six leagues of which four had July and August end
 * dates and were still 'running'. A bar trusting those flags would show
 * fifteen rows of which two mattered, and a director would stop reading it the
 * same day.
 *
 * So live is JUDGED, per format, by lib/events/live — shared with its tests so
 * the rule cannot drift into two versions that disagree.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { resolveActiveClub } from '@/lib/clubs/activeClub';
import { TOURNAMENT_FORMATS } from '@/lib/eventCategory';
import {
  classPhase,
  compareItems,
  daysUntil,
  isStaleRunning,
  leaguePhase,
  livePhase,
  type LiveKind,
  type LivePhase,
} from '@/lib/events/live';

export const dynamic = 'force-dynamic';

type Item = {
  id: string;
  name: string;
  kind: LiveKind;
  phase: LivePhase;
  daysAway: number | null;
  /** What kind of thing it is, in a word a director uses. */
  label: string;
  manage_href: string;
  public_href: string | null;
};

type EventRow = {
  id: string;
  name: string;
  slug: string | null;
  event_code: string | null;
  match_format: string | null;
  public_status: string;
  event_date: string | null;
};

/** The page a PLAYER would open — the one a director wants to hand out. */
function eventPublicHref(e: EventRow): string | null {
  if (e.match_format === 'quads' && e.slug) return `/quads/${e.slug}`;
  if (e.match_format && TOURNAMENT_FORMATS.has(e.match_format) && e.slug) {
    return `/tournaments/${e.slug}`;
  }
  return e.event_code ? `/event/${e.event_code}` : null;
}

/** "Tournament" / "Mixer" / "Quads" — what a director calls it. */
function eventLabel(format: string | null): string {
  if (!format) return 'Event';
  if (format === 'quads') return 'Quads';
  if (format === 'team-battle') return 'Team battle';
  if (TOURNAMENT_FORMATS.has(format)) return 'Tournament';
  return 'Mixer';
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ items: [] });

  const { active } = await resolveActiveClub(user.id, user.email);
  if (!active) return NextResponse.json({ items: [] });

  const db = getSupabaseAdmin();
  const today = new Date().toISOString().slice(0, 10);

  const { data: clubRow } = await db
    .from('cc_clubs')
    .select('owner_id')
    .eq('id', active.id)
    .maybeSingle();
  const ownerId = (clubRow as { owner_id: string } | null)?.owner_id;

  // Club-linked, plus the club owner's own — older rows predate club_id being
  // set, and a director should not lose sight of their own event because of it.
  const eventFilter = ownerId
    ? `club_id.eq.${active.id},user_id.eq.${ownerId}`
    : `club_id.eq.${active.id}`;
  const leagueFilter = ownerId
    ? `club_id.eq.${active.id},director_id.eq.${ownerId}`
    : `club_id.eq.${active.id}`;

  const [{ data: eventRows }, { data: leagueRows }, { data: classRows }] = await Promise.all([
    db
      .from('events')
      .select('id, name, slug, event_code, match_format, public_status, event_date')
      .or(eventFilter)
      .in('public_status', ['open', 'running'])
      .limit(150),
    db
      .from('leagues')
      .select(
        'id, name, slug, status, league_type, start_date, end_date, registration_opens_at, registration_closes_at',
      )
      .or(leagueFilter)
      .in('status', ['open', 'running'])
      .limit(100),
    db
      .from('club_programs')
      .select(
        'id, title, slug, status, registration_mode, range_start, range_end, registration_opens_at, registration_closes_at',
      )
      .eq('club_id', active.id)
      .eq('status', 'published')
      .limit(100),
  ]);

  const items: Item[] = [];

  // ------------------------------------------------------------- events
  const events = (eventRows as EventRow[] | null) ?? [];
  for (const e of events) {
    const daysAway = daysUntil(e.event_date, today);
    const phase = livePhase({ public_status: e.public_status, daysAway });
    if (!phase) continue;
    items.push({
      id: e.id,
      name: e.name,
      kind: 'event',
      phase,
      daysAway,
      label: eventLabel(e.match_format),
      manage_href: `/mixer/events/${e.id}`,
      public_href: eventPublicHref(e),
    });
  }

  // ------------------------------------------------------------ leagues
  type LeagueRow = {
    id: string;
    name: string;
    slug: string | null;
    status: string;
    league_type: string | null;
    start_date: string | null;
    end_date: string | null;
    registration_opens_at: string | null;
    registration_closes_at: string | null;
  };
  for (const l of (leagueRows as LeagueRow[] | null) ?? []) {
    const startsIn = daysUntil(l.start_date, today);
    const phase = leaguePhase({
      status: l.status,
      startsIn,
      endsIn: daysUntil(l.end_date, today),
      registrationOpensIn: daysUntil(l.registration_opens_at, today),
      registrationClosesIn: daysUntil(l.registration_closes_at, today),
    });
    if (!phase) continue;
    items.push({
      id: l.id,
      name: l.name,
      kind: 'league',
      phase,
      // An underway league is "now", not "N days ago".
      daysAway: phase === 'live' ? 0 : startsIn,
      label: l.league_type === 'jtt' ? 'JTT' : 'League',
      manage_href: `/mixer/leagues/${l.id}`,
      public_href: l.slug ? `/leagues/${l.slug}` : null,
    });
  }

  // ------------------------------------------------------------ classes
  type ClassRow = {
    id: string;
    title: string;
    slug: string;
    status: string;
    registration_mode: string;
    range_start: string | null;
    range_end: string | null;
    registration_opens_at: string | null;
    registration_closes_at: string | null;
  };
  for (const c of (classRows as ClassRow[] | null) ?? []) {
    const startsIn = daysUntil(c.range_start, today);
    const phase = classPhase({
      status: c.status,
      registrationMode: c.registration_mode,
      startsIn,
      endsIn: daysUntil(c.range_end, today),
      registrationOpensIn: daysUntil(c.registration_opens_at, today),
      registrationClosesIn: daysUntil(c.registration_closes_at, today),
    });
    if (!phase) continue;
    items.push({
      id: c.id,
      name: c.title,
      kind: 'class',
      phase,
      daysAway: startsIn,
      label: 'Class',
      manage_href: `/run/site/classes/${c.id}`,
      public_href: `/c/${active.slug}/programs/${c.slug}`,
    });
  }

  items.sort(compareItems);

  // Counted, not listed: how much of the club's data is claiming to be running
  // when it finished months ago. Offered as a number the bar can mention
  // rather than fifteen rows nobody wanted.
  const staleEvents = events.filter((e) =>
    isStaleRunning({ public_status: e.public_status, daysAway: daysUntil(e.event_date, today) }),
  ).length;
  const staleLeagues = ((leagueRows as LeagueRow[] | null) ?? []).filter((l) => {
    const endsIn = daysUntil(l.end_date, today);
    return l.status === 'running' && endsIn !== null && endsIn < -2;
  }).length;

  return NextResponse.json({
    club: { id: active.id, name: active.name },
    items: items.slice(0, 6),
    total: items.length,
    stale_running: staleEvents + staleLeagues,
  });
}
