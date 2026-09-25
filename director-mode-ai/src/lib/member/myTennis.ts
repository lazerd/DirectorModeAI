import type { SupabaseClient } from '@supabase/supabase-js';
import { TOURNAMENT_FORMATS } from '@/lib/eventCategory';
import { isoToZonedWallTime } from '@/lib/captain/clubTime';

/**
 * My Tennis — everything one member is signed up for, in one list.
 *
 * Vi Le, 2026-09-25: a C-team player in five leagues was copying each league's
 * matches into Google Calendar one by one just to catch double bookings. The
 * club already knows most of her week — the team matches she said yes or maybe
 * to, the games she joined, her lessons, courts, events and rackets — it just
 * kept each in a different room. This gathers them.
 *
 * Identity (see project memory "people identity"): the person is the club's
 * PlayerVault row. Links are by id wherever the schema has one — account id,
 * vault id, `master_player_id`. Two sources carry no id at all and fall back to
 * the address the member signed in with: CaptainMode rosters (typed by a
 * captain before anyone has an account; `master_player_id` is tried first) and
 * stringing customers.
 *
 * Every read is service-role, filtered to this member's own ids, because most
 * of these tables are staff-only under RLS.
 */

export type AgendaKind = 'match' | 'game' | 'event' | 'lesson' | 'court' | 'signup';

export type AgendaItem = {
  id: string;
  kind: AgendaKind;
  /** Club wall-clock "YYYY-MM-DDTHH:MM". Sorts as a string; never shifted by UTC. */
  at: string;
  /** Wall-clock end, same shape, when known. */
  end?: string | null;
  /** True when only the date is known. */
  allDay?: boolean;
  title: string;
  /** Which league / program / source, e.g. "EBWT C Team". */
  source: string;
  where?: string | null;
  /** Their answer or place, in plain words: "You said yes", "Waitlist #2"... */
  status?: string | null;
  tone?: 'yes' | 'maybe' | 'ask' | 'wait' | null;
  href?: string | null;
  cta?: string | null;
  contact?: { label: string; href: string } | null;
};

export type Racket = {
  id: string;
  racket: string;
  string: string | null;
  status: 'pending' | 'in_progress' | 'done' | 'picked_up';
  when: string | null;
};

export type TeamCard = { id: string; name: string; level: string | null; href: string; cta: string };

type Ctx = {
  userId: string;
  email: string | null;
  club: { id: string; name: string; owner_id: string };
  personId: string | null;
  masterPlayerId: string | null;
  timeZone: string;
  /** How far ahead to look, in days. */
  days?: number;
};

const escLike = (s: string) => s.replace(/[\\%_]/g, '\\$&');

export async function loadMyTennis(admin: SupabaseClient<any, 'public', any>, ctx: Ctx) {
  const now = new Date();
  const nowIso = now.toISOString();
  const untilIso = new Date(now.getTime() + (ctx.days ?? 90) * 864e5).toISOString();
  const wall = (iso: string) => isoToZonedWallTime(iso, ctx.timeZone);
  const todayWall = wall(nowIso).slice(0, 10);
  const untilWall = wall(untilIso).slice(0, 10);

  const [{ items: matches, teams }, games, lessons, courts, signups, events, rackets] = await Promise.all([
    teamMatches(),
    courtConnect(),
    lessonSlots(),
    courtBookings(),
    sheetSignups(),
    eventEntries(),
    stringing(),
  ]);

  const agenda = [...matches, ...games, ...lessons, ...courts, ...signups, ...events].sort((a, b) =>
    a.at.localeCompare(b.at),
  );
  return { agenda, rackets, teams };

  /* ---------------------------------------------------------------- teams */
  async function teamMatches(): Promise<{ items: AgendaItem[]; teams: TeamCard[] }> {
    const matchTeams: TeamCard[] = [];
    const byEmail = ctx.email
      ? admin
          .from('captain_players')
          .select('id, player_token, team_id')
          .ilike('email', escLike(ctx.email))
          .eq('active', true)
      : null;
    const byId = ctx.masterPlayerId
      ? admin
          .from('captain_players')
          .select('id, player_token, team_id')
          .eq('master_player_id', ctx.masterPlayerId)
          .eq('active', true)
      : null;
    const [a, b] = await Promise.all([byEmail, byId]);
    const rows = new Map<string, { id: string; player_token: string | null; team_id: string }>();
    for (const r of [...((a?.data as any[]) || []), ...((b?.data as any[]) || [])]) rows.set(r.id, r);
    if (!rows.size) return { items: [], teams: matchTeams };

    const playerByTeam = new Map<string, { id: string; player_token: string | null }>();
    for (const r of rows.values()) if (!playerByTeam.has(r.team_id)) playerByTeam.set(r.team_id, r);
    const teamIds = [...playerByTeam.keys()];

    const { data: teams } = await admin
      .from('captain_teams')
      .select('id, name, level, captain_user_id, archived, cc_clubs(name)')
      .in('id', teamIds)
      .eq('archived', false);
    const teamById = new Map<string, any>(((teams as any[]) || []).map((t) => [t.id, t]));
    if (!teamById.size) return { items: [], teams: matchTeams };

    // The captain, for "Ask the captain".
    const captainIds = [...new Set([...teamById.values()].map((t) => t.captain_user_id).filter(Boolean))];
    const captains = new Map<string, { name: string | null; email: string | null }>();
    await Promise.all(
      captainIds.map(async (id: string) => {
        const [{ data: u }, { data: p }] = await Promise.all([
          admin.auth.admin.getUserById(id),
          admin.from('profiles').select('full_name').eq('id', id).maybeSingle(),
        ]);
        captains.set(id, { name: (p as any)?.full_name || null, email: u?.user?.email || null });
      }),
    );

    for (const t of teamById.values()) {
      const p = playerByTeam.get(t.id)!;
      if (!p.player_token) continue;
      matchTeams.push({
        id: t.id,
        name: t.name,
        level: t.level,
        href: `/captain/availability/${p.player_token}`,
        cta: 'My availability →',
      });
    }

    const { data: ms } = await admin
      .from('captain_matches')
      .select('id, team_id, match_at, is_home, opponent, location')
      .in('team_id', [...teamById.keys()])
      .eq('status', 'scheduled')
      .gte('match_at', nowIso)
      .lte('match_at', untilIso)
      .order('match_at');
    const matchRows = (ms as any[]) || [];
    if (!matchRows.length) return { items: [], teams: matchTeams };

    const { data: av } = await admin
      .from('captain_availability')
      .select('match_id, player_id, status')
      .in('match_id', matchRows.map((m) => m.id))
      .in('player_id', [...playerByTeam.values()].map((p) => p.id));
    const answer = new Map<string, string>(((av as any[]) || []).map((r) => [r.match_id, r.status]));

    const out: AgendaItem[] = [];
    for (const m of matchRows) {
      const t = teamById.get(m.team_id);
      const p = playerByTeam.get(m.team_id);
      const a = answer.get(m.id);
      // "No" drops off her calendar. Unanswered stays, asking for an answer.
      if (a === 'no') continue;
      const cap = t.captain_user_id ? captains.get(t.captain_user_id) : null;
      const homeClub = t.cc_clubs?.name || ctx.club.name;
      out.push({
        id: `match:${m.id}`,
        kind: 'match',
        at: wall(m.match_at),
        title: `${m.is_home ? 'vs' : 'at'} ${m.opponent || 'TBD'}`,
        source: t.name,
        where: m.location || (m.is_home ? homeClub : m.opponent ? `Away, ${m.opponent}` : 'Away'),
        status: a === 'yes' ? 'You said yes' : a === 'maybe' ? 'You said maybe' : 'Not answered yet',
        tone: a === 'yes' ? 'yes' : a === 'maybe' ? 'maybe' : 'ask',
        href: p?.player_token ? `/captain/availability/${p.player_token}` : null,
        cta: a ? 'Change answer' : 'Answer',
        contact: cap?.email
          ? {
              label: `Ask ${cap.name?.split(/\s+/)[0] || 'the captain'}`,
              href: `mailto:${cap.email}?subject=${encodeURIComponent(`${t.name}: ${m.is_home ? 'vs' : 'at'} ${m.opponent || 'match'}`)}`,
            }
          : null,
      });
    }
    return { items: out, teams: matchTeams };
  }

  /* ---------------------------------------------------------- CourtConnect */
  async function courtConnect(): Promise<AgendaItem[]> {
    if (!ctx.personId) return [];
    const { data } = await admin
      .from('pf_game_players')
      .select('status, game:pf_games!inner(id, starts_at, duration_min, format, court, status)')
      .eq('person_id', ctx.personId)
      .in('status', ['in', 'wait']);
    return ((data as any[]) || [])
      .filter((r) => r.game && ['open', 'full'].includes(r.game.status) && r.game.starts_at >= nowIso && r.game.starts_at <= untilIso)
      .map((r) => {
        const g = r.game;
        const end = new Date(new Date(g.starts_at).getTime() + (g.duration_min || 90) * 60_000).toISOString();
        return {
          id: `game:${g.id}`,
          kind: 'game' as const,
          at: wall(g.starts_at),
          end: wall(end),
          title: `${cap(g.format || 'tennis')} game`,
          source: 'CourtConnect',
          where: g.court ? `Court ${String(g.court).replace(/^court\s*/i, '')}` : ctx.club.name,
          status: r.status === 'in' ? "You're in" : 'On the waitlist',
          tone: r.status === 'in' ? ('yes' as const) : ('wait' as const),
          href: '/member/games',
          cta: 'Open',
        };
      });
  }

  /* --------------------------------------------------------------- lessons */
  async function lessonSlots(): Promise<AgendaItem[]> {
    const { data: clients } = await admin.from('lesson_clients').select('id').eq('profile_id', ctx.userId);
    const ids = ((clients as any[]) || []).map((c) => c.id);
    if (!ids.length) return [];
    const { data } = await admin
      .from('lesson_slots')
      .select('id, start_time, end_time, location, coach:lesson_coaches(display_name)')
      .in('booked_by_client_id', ids)
      .eq('status', 'booked')
      .gte('start_time', nowIso)
      .lte('start_time', untilIso)
      .order('start_time');
    return ((data as any[]) || []).map((s) => ({
      id: `lesson:${s.id}`,
      kind: 'lesson' as const,
      at: wall(s.start_time),
      end: s.end_time ? wall(s.end_time) : null,
      title: s.coach?.display_name ? `Lesson with ${s.coach.display_name}` : 'Lesson',
      source: 'Lessons',
      where: s.location || ctx.club.name,
      status: 'Booked',
      tone: 'yes' as const,
      href: '/client/dashboard',
      cta: 'My lessons',
    }));
  }

  /* ---------------------------------------------------------------- courts */
  async function courtBookings(): Promise<AgendaItem[]> {
    const { data } = await admin
      .from('court_bookings')
      .select('id, reservation:reservations!inner(starts_at, ends_at, status), court:courts(number, name)')
      .eq('booker_user_id', ctx.userId)
      .eq('club_id', ctx.club.id)
      .eq('status', 'booked');
    return ((data as any[]) || [])
      .filter((b) => b.reservation && b.reservation.status !== 'cancelled' && b.reservation.starts_at >= nowIso && b.reservation.starts_at <= untilIso)
      .map((b) => ({
        id: `court:${b.id}`,
        kind: 'court' as const,
        at: wall(b.reservation.starts_at),
        end: b.reservation.ends_at ? wall(b.reservation.ends_at) : null,
        title: b.court ? b.court.name || `Court ${b.court.number}` : 'Court',
        source: 'Court reservation',
        where: ctx.club.name,
        status: 'Reserved',
        tone: 'yes' as const,
      }));
  }

  /* ------------------------------------- court-sheet signups (clinics etc.) */
  async function sheetSignups(): Promise<AgendaItem[]> {
    const ors = [`user_id.eq.${ctx.userId}`];
    if (ctx.personId) ors.push(`vault_player_id.eq.${ctx.personId}`);
    const { data } = await admin
      .from('reservation_signups')
      .select('id, status, reservation:reservations!inner(id, starts_at, ends_at, title, status, club_id)')
      .or(ors.join(','))
      .in('status', ['requested', 'confirmed', 'waitlist']);
    const seen = new Set<string>();
    return ((data as any[]) || [])
      .filter((s) => {
        const r = s.reservation;
        if (!r || r.club_id !== ctx.club.id || r.status === 'cancelled' || r.starts_at < nowIso || r.starts_at > untilIso || seen.has(r.id)) return false;
        seen.add(r.id);
        return true;
      })
      .map((s) => ({
        id: `signup:${s.id}`,
        kind: 'signup' as const,
        at: wall(s.reservation.starts_at),
        end: s.reservation.ends_at ? wall(s.reservation.ends_at) : null,
        title: s.reservation.title || 'Club session',
        source: 'Signed up',
        where: ctx.club.name,
        status: s.status === 'confirmed' ? "You're in" : s.status === 'waitlist' ? 'On the waitlist' : 'Requested',
        tone: s.status === 'confirmed' ? ('yes' as const) : ('wait' as const),
      }));
  }

  /* ------------------------------------------ socials, tournaments, quads */
  async function eventEntries(): Promise<AgendaItem[]> {
    const eventIds = new Map<string, string>(); // event id -> status line
    const mp = ctx.masterPlayerId;

    // Socials / mixers: the player row is per director, joined by account or person.
    const pOr = [`linked_user_id.eq.${ctx.userId}`];
    if (mp) pOr.push(`master_player_id.eq.${mp}`);
    const { data: players } = await admin.from('players').select('id').or(pOr.join(','));
    const pIds = ((players as any[]) || []).map((p) => p.id);
    const [ep, te, qe] = await Promise.all([
      pIds.length ? admin.from('event_players').select('event_id').in('player_id', pIds).eq('active', true) : null,
      mp ? admin.from('tournament_entries').select('event_id, position').eq('master_player_id', mp).in('position', ['in_draw', 'waitlist', 'pending_payment']) : null,
      mp ? admin.from('quad_entries').select('event_id, position').eq('master_player_id', mp).in('position', ['in_draw', 'waitlist', 'pending_payment', 'requested']) : null,
    ]);
    for (const r of ((ep?.data as any[]) || [])) eventIds.set(r.event_id, "You're in");
    for (const r of [...((te?.data as any[]) || []), ...((qe?.data as any[]) || [])]) {
      eventIds.set(
        r.event_id,
        r.position === 'waitlist' ? 'On the waitlist' : r.position === 'pending_payment' ? 'Payment due' : r.position === 'requested' ? 'Requested' : "You're in",
      );
    }
    if (!eventIds.size) return [];

    const { data: evs } = await admin
      .from('events')
      .select('id, name, event_date, start_time, event_code, slug, match_format, public_status')
      .in('id', [...eventIds.keys()])
      .gte('event_date', todayWall)
      .lte('event_date', untilWall);
    return ((evs as any[]) || [])
      .filter((e) => e.public_status !== 'cancelled')
      .map((e) => {
        const status = eventIds.get(e.id)!;
        const time = (e.start_time || '').slice(0, 5);
        const isTourney = e.match_format === 'quads' || (e.match_format && TOURNAMENT_FORMATS.has(e.match_format));
        return {
          id: `event:${e.id}`,
          kind: 'event' as const,
          at: `${e.event_date}T${time || '00:00'}`,
          allDay: !time,
          title: e.name,
          source: isTourney ? 'Tournament' : 'Club event',
          where: ctx.club.name,
          status,
          tone: status === "You're in" ? ('yes' as const) : status === 'Payment due' ? ('ask' as const) : ('wait' as const),
          href:
            e.match_format === 'quads' && e.slug
              ? `/quads/${e.slug}`
              : isTourney && e.slug
                ? `/tournaments/${e.slug}`
                : e.event_code
                  ? `/event/${e.event_code}`
                  : null,
          cta: 'Open',
        };
      });
  }

  /* ------------------------------------------------------------- stringing */
  async function stringing(): Promise<Racket[]> {
    const cOr: string[] = [];
    if (ctx.masterPlayerId) cOr.push(`master_player_id.eq.${ctx.masterPlayerId}`);
    if (ctx.email) cOr.push(`email.ilike.${escLike(ctx.email)}`);
    if (!cOr.length) return [];
    const { data: customers } = await admin
      .from('stringing_customers')
      .select('id, club_id')
      .or(cOr.join(','));
    // Only this club's stringing desk, or one that predates club_id.
    const ids = ((customers as any[]) || []).filter((c) => !c.club_id || c.club_id === ctx.club.id).map((c) => c.id);
    if (!ids.length) return [];
    const since = new Date(now.getTime() - 14 * 864e5).toISOString();
    const { data } = await admin
      .from('stringing_jobs')
      .select('id, status, quoted_ready_at, completed_at, picked_up_at, custom_string_name, created_at, racket:stringing_rackets(brand, model), string:stringing_catalog(brand, name)')
      .in('customer_id', ids)
      .neq('status', 'cancelled')
      .or(`status.in.(pending,in_progress,done),picked_up_at.gte.${since}`)
      .order('created_at', { ascending: false })
      .limit(6);
    return ((data as any[]) || []).map((j) => ({
      id: j.id,
      racket: [j.racket?.brand, j.racket?.model].filter(Boolean).join(' ') || 'Racket',
      string: j.custom_string_name || [j.string?.brand, j.string?.name].filter(Boolean).join(' ') || null,
      status: j.status,
      when:
        j.status === 'done'
          ? j.completed_at
          : j.status === 'picked_up'
            ? j.picked_up_at
            : j.quoted_ready_at,
    }));
  }
}

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
