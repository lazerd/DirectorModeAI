/**
 * /api/checkin/staff — the director's side of QR Check-In.
 *
 *   GET   settings, every sign, the live courts and line (full names), today's
 *         check-ins, and the findings
 *   POST  { action, ... }
 *           update_settings  { settings: {...} }            owner / director
 *           update_space     { space_id, patch: {...} }     owner / director
 *           add_space        { kind, name, capacity? }      owner / director
 *           rotate_token     { space_id }                   owner / director
 *           clear_session    { session_id }                 any staff
 *           remove_wait      { wait_id }                    any staff
 *
 * requireStaffForClub resolves the club and refuses plain members. Writes go
 * through the admin client scoped by that club id on every query, so a
 * director can only ever touch their own club's rows.
 */

import { NextResponse } from 'next/server';
import { requireStaffForClub } from '@/lib/courtsheet/routeAuth';
import { APP_URL } from '@/lib/appUrl';
import { findings, type InsightSession, type InsightWait } from '@/lib/checkin/insights';
import {
  clubDayStart,
  endSession,
  ensureSpaces,
  getClubById,
  newSpaceToken,
  reconcileClub,
  SESSION_COLS,
  WAIT_COLS,
  type SessionRow,
  type SpaceRow,
  type WaitRow,
} from '@/lib/checkin/server';
import { courtCard, poolCards } from '@/lib/checkin/views';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const MANAGERS = ['owner', 'director'];

export async function GET() {
  const ctx = await requireStaffForClub();
  if ('error' in ctx) return ctx.error;
  const club = await getClubById(ctx.club.id);
  if (!club) return NextResponse.json({ error: 'Club not found.' }, { status: 404 });

  await ensureSpaces(club.id);
  const state = await reconcileClub(club);
  const now = state.now;
  const dayStart = new Date(clubDayStart(club.timezone, now)).toISOString();
  const sinceInsights = new Date(now - 45 * 24 * 3600_000).toISOString();

  const [{ data: history }, { data: waitHistory }] = await Promise.all([
    ctx.db.from('checkin_sessions').select(SESSION_COLS).eq('club_id', club.id).gte('started_at', sinceInsights).order('started_at', { ascending: false }).limit(5000),
    ctx.db.from('checkin_waits').select(WAIT_COLS).eq('club_id', club.id).gte('joined_at', sinceInsights).order('joined_at', { ascending: false }).limit(5000),
  ]);
  const sessions = (history as SessionRow[] | null) ?? [];
  const waits = (waitHistory as WaitRow[] | null) ?? [];
  const kindOf = new Map(state.spaces.map((s) => [s.id, s.kind]));
  const nameOf = new Map(state.spaces.map((s) => [s.id, s.name]));

  const insightSessions: InsightSession[] = sessions.map((s) => ({
    spaceId: s.space_id,
    kind: kindOf.get(s.space_id) ?? 'court',
    startedAt: Date.parse(s.started_at),
    endedAt: s.ended_at ? Date.parse(s.ended_at) : Math.min(now, Date.parse(s.hard_ends_at)),
    playType: s.play_type,
    playerCount: s.player_count,
    guestCount: s.guest_count,
    endReason: s.end_reason,
  }));
  const insightWaits: InsightWait[] = waits.map((w) => ({
    joinedAt: Date.parse(w.joined_at),
    offeredAt: w.offered_at ? Date.parse(w.offered_at) : null,
    status: w.status,
  }));

  const today = sessions.filter((s) => s.started_at >= dayStart);
  const liveCourts = state.spaces
    .filter((s) => s.kind === 'court')
    .map((s) => {
      const card = courtCard(state, s);
      const live = state.sessions.find((x) => x.space_id === s.id);
      return { ...card, sessionId: live?.id ?? null, fullNames: live ? live.players.map((p) => p.name).join(', ') : null };
    });

  return NextResponse.json(
    {
      club: { id: club.id, name: club.name, slug: club.slug, timezone: club.timezone, logoUrl: club.logo_url, isPublic: !!club.is_public },
      role: ctx.role,
      appUrl: APP_URL,
      settings: state.settings,
      spaces: state.spaces.map((s) => ({ ...s, url: `${APP_URL}/q/${s.token}` })),
      live: {
        courts: liveCourts,
        waits: state.waits.map((w) => ({
          id: w.id,
          names: w.players.map((p) => p.name).join(', '),
          playType: w.play_type,
          status: w.status,
          joinedAt: w.joined_at,
          offeredSpace: w.offered_space_id ? nameOf.get(w.offered_space_id) ?? null : null,
          offerExpiresAt: w.offer_expires_at,
          email: w.contact_email,
        })),
        pools: poolCards(state),
      },
      today: today.map((s) => ({
        id: s.id,
        space: nameOf.get(s.space_id) ?? '',
        kind: kindOf.get(s.space_id) ?? 'court',
        playType: s.play_type,
        names: s.players.map((p) => p.name).join(', '),
        members: s.players.filter((p) => p.user_id).length,
        guestCount: s.guest_count,
        guestNames: s.guest_names,
        startedAt: s.started_at,
        endedAt: s.ended_at,
        endReason: s.end_reason,
        status: s.status,
      })),
      findings: findings({
        now,
        timezone: club.timezone,
        primeStart: state.settings.prime_start,
        primeEnd: state.settings.prime_end,
        courts: state.spaces.filter((s) => s.kind === 'court' && s.active).map((s) => ({ id: s.id, name: s.name })),
        sessions: insightSessions,
        waits: insightWaits,
      }),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

const int = (v: unknown, min: number, max: number): number | undefined => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n >= min && n <= max ? n : undefined;
};
const optInt = (v: unknown, min: number, max: number): number | null | undefined =>
  v === null || v === '' ? null : int(v, min, max);
const time = (v: unknown) => (typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : undefined);
const bool = (v: unknown) => (typeof v === 'boolean' ? v : undefined);
const coord = (v: unknown, lim: number) => (v === null || v === '' ? null : Number.isFinite(Number(v)) && Math.abs(Number(v)) <= lim ? Number(v) : undefined);
const clean = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

export async function POST(req: Request) {
  const ctx = await requireStaffForClub();
  if ('error' in ctx) return ctx.error;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const clubId = ctx.club.id;
  const isManager = MANAGERS.includes(ctx.role);
  const managerOnly = () => NextResponse.json({ error: 'Only an owner or director can change check-in setup.' }, { status: 403 });

  switch (body.action) {
    case 'update_settings': {
      if (!isManager) return managerOnly();
      const s = (body.settings ?? {}) as Record<string, unknown>;
      const patch = clean({
        enabled: bool(s.enabled),
        singles_minutes: int(s.singles_minutes, 5, 600),
        doubles_minutes: int(s.doubles_minutes, 5, 600),
        other_minutes: int(s.other_minutes, 5, 600),
        limits_only_when_waiting: bool(s.limits_only_when_waiting),
        min_players: int(s.min_players, 1, 8),
        grace_minutes: int(s.grace_minutes, 0, 60),
        claim_minutes: int(s.claim_minutes, 1, 60),
        max_session_minutes: int(s.max_session_minutes, 15, 720),
        mirror_to_courtsheet: bool(s.mirror_to_courtsheet),
        prime_start: time(s.prime_start),
        prime_end: time(s.prime_end),
        geofence_enabled: bool(s.geofence_enabled),
        latitude: coord(s.latitude, 90),
        longitude: coord(s.longitude, 180),
        geofence_meters: int(s.geofence_meters, 50, 20000),
      });
      const { error } = await ctx.db.from('checkin_settings').upsert({ club_id: clubId, ...patch }, { onConflict: 'club_id' });
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ ok: true });
    }

    case 'update_space': {
      if (!isManager) return managerOnly();
      const p = (body.patch ?? {}) as Record<string, unknown>;
      const name = typeof p.name === 'string' && p.name.trim() ? p.name.trim().slice(0, 60) : undefined;
      const patch = clean({
        name,
        active: bool(p.active),
        singles_minutes: optInt(p.singles_minutes, 5, 600),
        doubles_minutes: optInt(p.doubles_minutes, 5, 600),
        other_minutes: optInt(p.other_minutes, 5, 600),
        min_players: optInt(p.min_players, 1, 8),
        limits_only_when_waiting: p.limits_only_when_waiting === null ? null : bool(p.limits_only_when_waiting),
        capacity: optInt(p.capacity, 1, 5000),
        track_guests: bool(p.track_guests),
        guest_names_required: bool(p.guest_names_required),
        display_order: int(p.display_order, 0, 10000),
      });
      const { error } = await ctx.db.from('checkin_spaces').update(patch).eq('id', String(body.space_id)).eq('club_id', clubId);
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ ok: true });
    }

    case 'add_space': {
      if (!isManager) return managerOnly();
      const kind = ['pool', 'room', 'other'].includes(String(body.kind)) ? String(body.kind) : null;
      const name = typeof body.name === 'string' ? body.name.trim().slice(0, 60) : '';
      if (!kind || !name) return NextResponse.json({ error: 'Give the space a name.' }, { status: 400 });
      const { error } = await ctx.db.from('checkin_spaces').insert({
        club_id: clubId,
        kind,
        name,
        token: newSpaceToken(),
        capacity: int(body.capacity, 1, 5000) ?? null,
        track_guests: kind === 'pool',
        display_order: 1000,
      });
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ ok: true });
    }

    case 'rotate_token': {
      if (!isManager) return managerOnly();
      const { data, error } = await ctx.db
        .from('checkin_spaces')
        .update({ token: newSpaceToken(), token_rotated_at: new Date().toISOString() })
        .eq('id', String(body.space_id))
        .eq('club_id', clubId)
        .select('token')
        .maybeSingle();
      if (error || !data) return NextResponse.json({ error: error?.message || 'Sign not found.' }, { status: 400 });
      return NextResponse.json({ ok: true, token: (data as Pick<SpaceRow, 'token'>).token });
    }

    case 'clear_session': {
      const { data } = await ctx.db.from('checkin_sessions').select('id').eq('id', String(body.session_id)).eq('club_id', clubId).maybeSingle();
      if (!data) return NextResponse.json({ error: 'Session not found.' }, { status: 404 });
      await endSession(String(body.session_id), 'staff');
      const club = await getClubById(clubId);
      if (club) await reconcileClub(club);
      return NextResponse.json({ ok: true });
    }

    case 'remove_wait': {
      const { error } = await ctx.db
        .from('checkin_waits')
        .update({ status: 'removed', resolved_at: new Date().toISOString() })
        .eq('id', String(body.wait_id))
        .eq('club_id', clubId)
        .in('status', ['waiting', 'offered']);
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      const club = await getClubById(clubId);
      if (club) await reconcileClub(club);
      return NextResponse.json({ ok: true });
    }

    default:
      return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  }
}
