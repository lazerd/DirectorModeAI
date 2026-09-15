/**
 * Everything the demo tour page shows, looked up at request time.
 *
 * Ids change every time the demo is reset (the seed scripts rebuild teams and
 * events), so nothing here is hardcoded: each link is found by what it IS —
 * the demo board member's mixer that has rounds drawn, the team with an open
 * sub request, the demo member's own availability token.
 *
 * No club facts live here or in the page. The club's name, colors and logo
 * come from its rows; the copy around them is generic.
 */

import QRCode from 'qrcode';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { getClubSite, type ClubSiteBundle } from '@/lib/clubSite/server';
import { ensureSpaces } from '@/lib/checkin/server';
import { getRateCards } from '@/lib/courts/server';
import { bookingEnabled } from '@/lib/courts/pricing';
import { APP_URL } from '@/lib/appUrl';
import type { DemoLink } from './server';
import { siteBuilderFrom } from './siteBuilder';

export type TourSign = { name: string; token: string; svg: string };

export type TourData = {
  bundle: ClubSiteBundle;
  /** "Wild Apricot", "Squarespace"… when the club's current site is on a builder we recognise. */
  siteBuilder: string | null;
  memberFirstName: string | null;
  signs: { court: TourSign | null; waitList: TourSign | null };
  mixer: {
    id: string;
    code: string;
    name: string;
    dateLabel: string | null;
    publicSlug: string | null;
    player: { id: string; name: string } | null;
  } | null;
  captain: {
    teamCount: number;
    highlight: { id: string; name: string } | null;
    memberAvailabilityToken: string | null;
  };
  /** The club takes court bookings online (it has rate cards). */
  booking: boolean;
  /** Courts on the court sheet. None means no court sheet or check-in to show. */
  courtCount: number;
  /** The year of the club's published calendar, or null when it has none. */
  calendarYear: number | null;
  /** CourtConnect (find a game) is open to members at this club. */
  hasMembers: boolean;
};


/** 'Sat, Oct 3' from a date-only 'YYYY-MM-DD'. Noon UTC so no zone can move the day. */
function dateLabel(ymd: string | null): string | null {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}/.test(ymd)) return null;
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${ymd.slice(0, 10)}T12:00:00Z`));
}

const qr = (token: string) =>
  QRCode.toString(`${APP_URL}/q/${token}`, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });

export async function loadTour(link: DemoLink): Promise<TourData | null> {
  const db = getSupabaseAdmin();
  const { data: clubRow } = await db.from('cc_clubs').select('slug').eq('id', link.club_id).maybeSingle();
  const slug = (clubRow as { slug: string } | null)?.slug;
  if (!slug) return null;
  const bundle = await getClubSite(slug);
  if (!bundle) return null;
  const { club, site } = bundle;

  // Signs are created lazily on a director's first visit to check-in; the
  // tour prints two of them, so make sure they exist before rendering.
  await ensureSpaces(club.id);

  const directorId = link.director_user_id;
  const memberId = link.member_user_id;

  const [spacesRes, courtsRes, profileRes, memberUserRes, eventsRes, teamsRes, plansRes, rateCards] = await Promise.all([
    db.from('checkin_spaces').select('kind, name, token, court_id, display_order').eq('club_id', club.id).eq('active', true).order('display_order'),
    db.from('courts').select('id, number').eq('club_id', club.id),
    memberId ? db.from('profiles').select('full_name').eq('id', memberId).maybeSingle() : Promise.resolve({ data: null }),
    memberId ? db.auth.admin.getUserById(memberId) : Promise.resolve({ data: { user: null } }),
    directorId
      ? db
          .from('events')
          .select('id, event_code, name, event_date, slug, rounds(id)')
          .eq('club_id', club.id)
          .eq('user_id', directorId)
          .not('event_code', 'is', null)
          .order('event_date', { ascending: true })
      : Promise.resolve({ data: [] }),
    directorId
      ? db.from('captain_teams').select('id, name').eq('captain_user_id', directorId).eq('archived', false).order('name')
      : Promise.resolve({ data: [] }),
    db.from('calendar_plans').select('year').eq('club_id', club.id).eq('status', 'published').order('year', { ascending: false }).limit(1),
    getRateCards(club.id),
  ]);

  // ------------------------------------------------------------ signs
  type Space = { kind: string; name: string; token: string; court_id: string | null };
  const spaces = (spacesRes.data as Space[] | null) ?? [];
  const numberOf = new Map(((courtsRes.data as { id: string; number: number | null }[] | null) ?? []).map((c) => [c.id, c.number]));
  const courts = spaces.filter((s) => s.kind === 'court');
  // Court 4 when there is one — a middle court reads as "a real court" on a
  // sign — else the first.
  const court = courts.find((s) => s.court_id && numberOf.get(s.court_id) === 4) ?? courts[0] ?? null;
  const kiosk = spaces.find((s) => s.kind === 'kiosk') ?? null;
  const [courtSvg, kioskSvg] = await Promise.all([court ? qr(court.token) : null, kiosk ? qr(kiosk.token) : null]);

  // ------------------------------------------------------------ mixer
  type Ev = { id: string; event_code: string; name: string; event_date: string | null; slug: string | null; rounds: { id: string }[] | null };
  const drawn = ((eventsRes.data as Ev[] | null) ?? []).find((e) => (e.rounds?.length ?? 0) > 0) ?? null;
  let player: { id: string; name: string } | null = null;
  if (drawn) {
    const { data: ep } = await db
      .from('event_players')
      .select('player_id, strength_order, players(name)')
      .eq('event_id', drawn.id)
      .order('strength_order')
      .limit(1);
    const row = (ep as { player_id: string; players: { name: string } | { name: string }[] | null }[] | null)?.[0];
    const p = Array.isArray(row?.players) ? row?.players[0] : row?.players;
    if (row) player = { id: row.player_id, name: p?.name || 'a player' };
  }

  // ---------------------------------------------------------- captain
  const teams = (teamsRes.data as { id: string; name: string }[] | null) ?? [];
  let highlight = teams[0] ?? null;
  let memberAvailabilityToken: string | null = null;
  if (teams.length) {
    const ids = teams.map((t) => t.id);
    const memberEmail = memberUserRes.data?.user?.email ?? null;
    const [{ data: open }, { data: mine }] = await Promise.all([
      db.from('captain_sub_requests').select('team_id').in('team_id', ids).eq('status', 'open').limit(1),
      memberEmail
        ? db.from('captain_players').select('player_token').in('team_id', ids).ilike('email', memberEmail).limit(1)
        : Promise.resolve({ data: null }),
    ]);
    const openTeam = (open as { team_id: string }[] | null)?.[0]?.team_id;
    highlight = teams.find((t) => t.id === openTeam) ?? highlight;
    memberAvailabilityToken = (mine as { player_token: string }[] | null)?.[0]?.player_token ?? null;
  }

  // --------------------------------------------------------- calendar
  const plannedYear = (plansRes.data as { year: number }[] | null)?.[0]?.year ?? null;

  const fullName = (profileRes.data as { full_name?: string | null } | null)?.full_name || '';

  return {
    bundle,
    siteBuilder: siteBuilderFrom([
      club.website,
      ...site.nav_links.map((l) => l.href),
      ...site.documents.map((d) => d.href),
      ...site.membership_tiers.map((t) => t.cta_href),
    ]),
    memberFirstName: fullName.trim().split(/\s+/)[0] || null,
    signs: {
      court: court && courtSvg ? { name: court.name, token: court.token, svg: courtSvg } : null,
      waitList: kiosk && kioskSvg ? { name: kiosk.name, token: kiosk.token, svg: kioskSvg } : null,
    },
    mixer: drawn
      ? {
          id: drawn.id,
          code: drawn.event_code,
          name: drawn.name,
          dateLabel: dateLabel(drawn.event_date),
          publicSlug: drawn.slug,
          player,
        }
      : null,
    captain: { teamCount: teams.length, highlight, memberAvailabilityToken },
    booking: bookingEnabled(rateCards),
    courtCount: numberOf.size,
    calendarYear: plannedYear,
    hasMembers: !!memberId,
  };
}
