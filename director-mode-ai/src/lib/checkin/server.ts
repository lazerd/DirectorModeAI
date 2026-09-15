/**
 * QR Check-In — loading, reconciling and writing.
 *
 * Everything here uses the SERVICE-ROLE client. The public scan pages have no
 * login, so what authorises a write is the token in the URL: a space's sign
 * token to start or join, a group's token to finish or claim. Callers look
 * the token up here and never trust an id sent by the browser.
 *
 * Times: every column is TIMESTAMPTZ and every comparison is between instants.
 * The club's zone is used in exactly two places, both below — "when does the
 * club close today" and "when does today end" — and both go through
 * localToUtc, never a naive Date string.
 */

import { randomBytes, createHash } from 'crypto';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { localToUtc } from '@/lib/courtsheet/timezones';
import { clubDayOfWeek } from '@/lib/courts/server';
import { normalizeTimeZone } from '@/lib/captain/clubTime';
import {
  DEFAULT_RULES,
  effectiveRules,
  reconcile,
  type ClubRules,
  type EndReason,
  type EngineBlock,
  type EngineSession,
  type EngineSpace,
  type EngineWait,
  type PlayType,
  type SessionPlayType,
  type SpaceKind,
} from './engine';
import { notifyOffer } from './notify';

const db = () => getSupabaseAdmin();

/* ------------------------------------------------------------------ rows */

export type CheckinClub = {
  id: string;
  slug: string;
  name: string;
  timezone: string;
  owner_id: string;
  email: string | null;
  logo_url: string | null;
  is_public: boolean | null;
  operating_hours: Record<string, { open: string; close: string }[]> | null;
};

export type SettingsRow = {
  club_id: string;
  enabled: boolean;
  singles_minutes: number;
  doubles_minutes: number;
  other_minutes: number;
  limits_only_when_waiting: boolean;
  min_players: number;
  grace_minutes: number;
  claim_minutes: number;
  max_session_minutes: number;
  mirror_to_courtsheet: boolean;
  prime_start: string;
  prime_end: string;
  geofence_enabled: boolean;
  latitude: number | null;
  longitude: number | null;
  geofence_meters: number;
};

export type SpaceRow = {
  id: string;
  club_id: string;
  kind: SpaceKind;
  court_id: string | null;
  name: string;
  token: string;
  token_rotated_at: string | null;
  singles_minutes: number | null;
  doubles_minutes: number | null;
  other_minutes: number | null;
  limits_only_when_waiting: boolean | null;
  min_players: number | null;
  capacity: number | null;
  track_guests: boolean;
  guest_names_required: boolean;
  active: boolean;
  display_order: number;
};

export type Player = { name: string; user_id?: string | null };

export type SessionRow = {
  id: string;
  club_id: string;
  space_id: string;
  exclusive: boolean;
  play_type: SessionPlayType;
  players: Player[];
  player_count: number;
  guest_count: number;
  guest_names: string[];
  contact_email: string | null;
  user_id: string | null;
  group_token: string;
  status: 'active' | 'ended';
  started_at: string;
  limit_ends_at: string | null;
  hard_ends_at: string;
  ended_at: string | null;
  end_reason: EndReason | null;
  wait_id: string | null;
  reservation_id: string | null;
};

export type WaitRow = {
  id: string;
  club_id: string;
  joined_via_space_id: string | null;
  play_type: PlayType;
  players: Player[];
  player_count: number;
  contact_email: string | null;
  user_id: string | null;
  group_token: string;
  status: 'waiting' | 'offered' | 'playing' | 'left' | 'missed' | 'expired' | 'removed';
  joined_at: string;
  offered_space_id: string | null;
  offered_at: string | null;
  offer_expires_at: string | null;
  offer_notified_at: string | null;
  resolved_at: string | null;
  session_id: string | null;
};

type CourtRow = { id: string; name: string | null; number: number | null; status: string; parent_court_id: string | null; display_order: number };

const CLUB_COLS = 'id, slug, name, timezone, owner_id, email, logo_url, is_public, operating_hours';
export const SESSION_COLS =
  'id, club_id, space_id, exclusive, play_type, players, player_count, guest_count, guest_names, contact_email, user_id, group_token, status, started_at, limit_ends_at, hard_ends_at, ended_at, end_reason, wait_id, reservation_id';
export const WAIT_COLS =
  'id, club_id, joined_via_space_id, play_type, players, player_count, contact_email, user_id, group_token, status, joined_at, offered_space_id, offered_at, offer_expires_at, offer_notified_at, resolved_at, session_id';

export const DEFAULT_SETTINGS: Omit<SettingsRow, 'club_id'> = {
  enabled: true,
  singles_minutes: DEFAULT_RULES.singlesMinutes,
  doubles_minutes: DEFAULT_RULES.doublesMinutes,
  other_minutes: DEFAULT_RULES.otherMinutes,
  limits_only_when_waiting: DEFAULT_RULES.limitsOnlyWhenWaiting,
  min_players: DEFAULT_RULES.minPlayers,
  grace_minutes: DEFAULT_RULES.graceMinutes,
  claim_minutes: DEFAULT_RULES.claimMinutes,
  max_session_minutes: DEFAULT_RULES.maxSessionMinutes,
  mirror_to_courtsheet: false,
  prime_start: '07:00',
  prime_end: '11:00',
  geofence_enabled: false,
  latitude: null,
  longitude: null,
  geofence_meters: 400,
};

export function rulesFromSettings(s: Omit<SettingsRow, 'club_id'>): ClubRules {
  return {
    singlesMinutes: s.singles_minutes,
    doublesMinutes: s.doubles_minutes,
    otherMinutes: s.other_minutes,
    limitsOnlyWhenWaiting: s.limits_only_when_waiting,
    minPlayers: s.min_players,
    graceMinutes: s.grace_minutes,
    claimMinutes: s.claim_minutes,
    maxSessionMinutes: s.max_session_minutes,
  };
}

export function spaceRules(settings: Omit<SettingsRow, 'club_id'>, space: SpaceRow): ClubRules {
  return effectiveRules(rulesFromSettings(settings), {
    singlesMinutes: space.singles_minutes,
    doublesMinutes: space.doubles_minutes,
    otherMinutes: space.other_minutes,
    limitsOnlyWhenWaiting: space.limits_only_when_waiting,
    minPlayers: space.min_players,
  });
}

/* ---------------------------------------------------------------- tokens */

// No 0/o, 1/l/i: people type these off a sign in the sun.
const TOKEN_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

/** 10 characters from a 31-letter alphabet: ~49 bits, short enough to type. */
export function newSpaceToken(): string {
  const bytes = randomBytes(10);
  return Array.from(bytes, (b) => TOKEN_ALPHABET[b % TOKEN_ALPHABET.length]).join('');
}

export const isSpaceToken = (t: string) => /^[a-z0-9]{10}$/.test(t);
export const isGroupToken = (t: string) => /^[a-f0-9]{36}$/.test(t);

export function hashDevice(deviceId: string | null): string | null {
  if (!deviceId) return null;
  return createHash('sha256').update(`checkin:${deviceId}`).digest('hex').slice(0, 32);
}

/* ------------------------------------------------------------ club time */

/** When the club closes today, if it is open right now per operating_hours. */
export function clubCloseAt(club: CheckinClub, nowMs: number): number | null {
  const tz = normalizeTimeZone(club.timezone);
  const { ymd, minute } = clubNowAt(tz, nowMs);
  const windows = club.operating_hours?.[String(clubDayOfWeek(ymd, tz))] ?? [];
  for (const w of windows) {
    const [oh, om] = w.open.split(':').map(Number);
    const [ch, cm] = w.close.split(':').map(Number);
    if (oh * 60 + om <= minute && minute < ch * 60 + cm) return localToUtc(ymd, w.close, tz).getTime();
  }
  return null;
}

/** The end of the club-local day that contains `nowMs`. */
export function clubDayEnd(timezone: string, nowMs: number): number {
  const tz = normalizeTimeZone(timezone);
  const { ymd } = clubNowAt(tz, nowMs);
  const next = new Date(`${ymd}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return localToUtc(next.toISOString().slice(0, 10), '00:00', tz).getTime();
}

/** The start of the club-local day that contains `nowMs`. */
export function clubDayStart(timezone: string, nowMs: number): number {
  const tz = normalizeTimeZone(timezone);
  return localToUtc(clubNowAt(tz, nowMs).ymd, '00:00', tz).getTime();
}

/** Club-local date and minute for an instant (clubNow in lib/courts, for any instant). */
function clubNowAt(tz: string, nowMs: number): { ymd: string; minute: number } {
  const d = new Date(nowMs);
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d);
  const hhmm = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
  const [h, m] = hhmm.split(':').map(Number);
  return { ymd, minute: (h % 24) * 60 + m };
}

/* --------------------------------------------------------------- lookups */

export async function getClubBySlug(slug: string): Promise<CheckinClub | null> {
  const { data } = await db().from('cc_clubs').select(CLUB_COLS).eq('slug', slug.trim().toLowerCase()).maybeSingle();
  return (data as CheckinClub | null) ?? null;
}

export async function getClubById(id: string): Promise<CheckinClub | null> {
  const { data } = await db().from('cc_clubs').select(CLUB_COLS).eq('id', id).maybeSingle();
  return (data as CheckinClub | null) ?? null;
}

export async function getSettings(clubId: string): Promise<SettingsRow> {
  const { data } = await db().from('checkin_settings').select('*').eq('club_id', clubId).maybeSingle();
  if (!data) return { club_id: clubId, ...DEFAULT_SETTINGS };
  const row = data as SettingsRow;
  // TIME comes back as HH:MM:SS.
  return { ...row, prime_start: row.prime_start.slice(0, 5), prime_end: row.prime_end.slice(0, 5) };
}

export async function spaceByToken(token: string): Promise<{ space: SpaceRow; club: CheckinClub } | null> {
  if (!isSpaceToken(token)) return null;
  const { data } = await db().from('checkin_spaces').select('*').eq('token', token).maybeSingle();
  if (!data) return null;
  const space = data as SpaceRow;
  const club = await getClubById(space.club_id);
  return club ? { space, club } : null;
}

/**
 * Give every court a check-in space, and the club a kiosk sign. Called when a
 * director opens the check-in page, so a court added in CourtSheet shows up on
 * the next visit with its own sign. Never renames or re-tokens an existing one.
 */
export async function ensureSpaces(clubId: string): Promise<void> {
  const [{ data: courts }, { data: spaces }] = await Promise.all([
    db().from('courts').select('id, name, number, status, display_order').eq('club_id', clubId).neq('status', 'hidden'),
    db().from('checkin_spaces').select('court_id, kind').eq('club_id', clubId),
  ]);
  const have = new Set(((spaces as { court_id: string | null }[] | null) ?? []).map((s) => s.court_id).filter(Boolean));
  const rows: Record<string, unknown>[] = ((courts as CourtRow[] | null) ?? [])
    .filter((c) => !have.has(c.id))
    .map((c) => ({
      club_id: clubId,
      kind: 'court',
      court_id: c.id,
      name: c.name || (c.number != null ? `Court ${c.number}` : 'Court'),
      token: newSpaceToken(),
      display_order: c.display_order || c.number || 0,
    }));
  if (rows.length) {
    // ignoreDuplicates: two director tabs opening at once must not 500.
    await db().from('checkin_spaces').upsert(rows, { onConflict: 'court_id', ignoreDuplicates: true });
  }
  const hasKiosk = ((spaces as { kind: string }[] | null) ?? []).some((s) => s.kind === 'kiosk');
  if (!hasKiosk) {
    // A racing second insert hits idx_checkin_spaces_one_kiosk and is ignored.
    await db()
      .from('checkin_spaces')
      .insert({ club_id: clubId, kind: 'kiosk', name: 'Wait list', token: newSpaceToken(), display_order: 0 });
  }
}

/* ----------------------------------------------------------------- state */

export type ClubState = {
  club: CheckinClub;
  settings: SettingsRow;
  spaces: SpaceRow[];
  engineSpaces: EngineSpace[];
  sessions: SessionRow[];
  waits: WaitRow[];
  blocks: EngineBlock[];
  now: number;
};

const BLOCK_LABEL: Record<string, string> = {
  lesson: 'a lesson',
  camp: 'a camp',
  event: 'a club event',
  match: 'a team match',
  member: 'a booking',
  maintenance: 'maintenance',
  blackout: 'club use',
  hold: 'club use',
};

export async function loadState(club: CheckinClub, now = Date.now()): Promise<ClubState> {
  const horizon = new Date(now + 18 * 3600_000).toISOString();
  const [settings, spacesRes, courtsRes, sessionsRes, waitsRes, resRes] = await Promise.all([
    getSettings(club.id),
    db().from('checkin_spaces').select('*').eq('club_id', club.id).order('display_order'),
    db().from('courts').select('id, name, number, status, parent_court_id, display_order').eq('club_id', club.id),
    db().from('checkin_sessions').select(SESSION_COLS).eq('club_id', club.id).eq('status', 'active'),
    db().from('checkin_waits').select(WAIT_COLS).eq('club_id', club.id).in('status', ['waiting', 'offered']).order('joined_at'),
    db()
      .from('reservations')
      .select('court_id, starts_at, ends_at, type, meta')
      .eq('club_id', club.id)
      .neq('status', 'cancelled')
      .lt('starts_at', horizon)
      .gt('ends_at', new Date(now).toISOString()),
  ]);

  const spaces = (spacesRes.data as SpaceRow[] | null) ?? [];
  const courts = (courtsRes.data as CourtRow[] | null) ?? [];
  const courtById = new Map(courts.map((c) => [c.id, c]));

  const engineSpaces: EngineSpace[] = spaces.map((s) => {
    const court = s.court_id ? courtById.get(s.court_id) : undefined;
    const related = court
      ? [court.id, ...(court.parent_court_id ? [court.parent_court_id] : []), ...courts.filter((c) => c.parent_court_id === court.id).map((c) => c.id)]
      : [];
    return {
      id: s.id,
      kind: s.kind,
      name: s.name,
      courtId: s.court_id,
      relatedCourtIds: related,
      // A court CourtSheet marks under maintenance cannot be walked onto.
      active: s.active && (!s.court_id || (!!court && court.status === 'active')),
      displayOrder: s.display_order,
      capacity: s.capacity,
      rules: spaceRules(settings, s),
    };
  });

  type ResRow = { court_id: string; starts_at: string; ends_at: string; type: string; meta: Record<string, unknown> | null };
  const blocks: EngineBlock[] = ((resRes.data as ResRow[] | null) ?? [])
    // Our own mirrors are not bookings; they ARE the walk-on play.
    .filter((r) => (r.meta as { origin?: string } | null)?.origin !== 'checkin')
    .map((r) => ({
      courtId: r.court_id,
      startsAt: Date.parse(r.starts_at),
      endsAt: Date.parse(r.ends_at),
      label: BLOCK_LABEL[r.type] ?? 'a booking',
    }));

  return {
    club,
    settings,
    spaces,
    engineSpaces,
    sessions: (sessionsRes.data as SessionRow[] | null) ?? [],
    waits: (waitsRes.data as WaitRow[] | null) ?? [],
    blocks,
    now,
  };
}

export const toEngineSession = (s: SessionRow): EngineSession => ({
  id: s.id,
  spaceId: s.space_id,
  exclusive: s.exclusive,
  playType: s.play_type,
  startedAt: Date.parse(s.started_at),
  limitEndsAt: s.limit_ends_at ? Date.parse(s.limit_ends_at) : null,
  hardEndsAt: Date.parse(s.hard_ends_at),
  playerCount: s.player_count,
  guestCount: s.guest_count,
});

export const toEngineWait = (w: WaitRow): EngineWait => ({
  id: w.id,
  status: w.status as 'waiting' | 'offered',
  joinedAt: Date.parse(w.joined_at),
  offeredSpaceId: w.offered_space_id,
  offerExpiresAt: w.offer_expires_at ? Date.parse(w.offer_expires_at) : null,
  playerCount: w.player_count,
  playType: w.play_type,
});

export function engineInputs(state: ClubState) {
  return {
    now: state.now,
    spaces: state.engineSpaces,
    sessions: state.sessions.map(toEngineSession),
    waits: state.waits.map(toEngineWait),
    blocks: state.blocks,
  };
}

/**
 * Load the club, apply whatever the clock says has happened since anyone last
 * looked, and return the up-to-date state. Every public read and write starts
 * here. Writes are conditional on the row still being in the state the engine
 * saw, and the unique indexes catch the rest, so two phones reconciling the
 * same second cannot double-offer a court or end a session twice.
 */
export async function reconcileClub(club: CheckinClub, now = Date.now()): Promise<ClubState> {
  const state = await loadState(club, now);
  const result = reconcile(engineInputs(state));
  const nothing =
    !result.endSessions.length && !result.missedOffers.length && !result.expiredWaits.length && !result.offers.length;
  if (nothing) return state;

  const nowIso = new Date(now).toISOString();

  if (result.missedOffers.length) {
    await db()
      .from('checkin_waits')
      .update({ status: 'missed', resolved_at: nowIso })
      .in('id', result.missedOffers)
      .eq('status', 'offered');
  }
  if (result.expiredWaits.length) {
    await db()
      .from('checkin_waits')
      .update({ status: 'expired', resolved_at: nowIso })
      .in('id', result.expiredWaits)
      .eq('status', 'waiting');
  }
  for (const end of result.endSessions) {
    await endSession(end.id, end.reason, end.at);
  }
  for (const offer of result.offers) {
    const { data, error } = await db()
      .from('checkin_waits')
      .update({
        status: 'offered',
        offered_space_id: offer.spaceId,
        offered_at: nowIso,
        offer_expires_at: new Date(offer.expiresAt).toISOString(),
      })
      .eq('id', offer.waitId)
      .eq('status', 'waiting')
      .select(WAIT_COLS)
      .maybeSingle();
    // 23505: another request offered this court a moment ago. Theirs stands.
    if (error || !data) continue;
    const wait = data as WaitRow;
    const space = state.spaces.find((s) => s.id === offer.spaceId);
    if (wait.contact_email && space) {
      try {
        const sent = await notifyOffer({ club, wait, spaceName: space.name, expiresAt: offer.expiresAt });
        if (sent) await db().from('checkin_waits').update({ offer_notified_at: nowIso }).eq('id', wait.id);
      } catch {
        // The phone page shows the offer either way; an email failure must not
        // stop the court being offered.
      }
    }
  }

  return loadState(club, now);
}

/* ---------------------------------------------------------------- writes */

/** End a session (if still active) and trim its court-sheet mirror to match. */
export async function endSession(sessionId: string, reason: EndReason, atMs = Date.now()): Promise<SessionRow | null> {
  const { data } = await db()
    .from('checkin_sessions')
    .update({ status: 'ended', ended_at: new Date(atMs).toISOString(), end_reason: reason })
    .eq('id', sessionId)
    .eq('status', 'active')
    .select(SESSION_COLS)
    .maybeSingle();
  const row = (data as SessionRow | null) ?? null;
  if (row?.reservation_id) await trimMirror(row.reservation_id, Date.parse(row.started_at), atMs);
  return row;
}

async function trimMirror(reservationId: string, startedAt: number, endedAt: number) {
  // Under a couple of minutes is a mis-scan, not court time worth a grid block.
  if (endedAt - startedAt < 2 * 60_000) {
    await db().from('reservations').update({ status: 'cancelled' }).eq('id', reservationId);
    return;
  }
  await db().from('reservations').update({ ends_at: new Date(endedAt).toISOString() }).eq('id', reservationId);
}

/**
 * The optional CourtSheet copy of a walk-on session. Source 'manual' and type
 * 'member' because both CHECKs already allow them — adding a 'checkin' source
 * would mean rewriting a constraint every other subsystem writes through.
 * meta.origin = 'checkin' is how this engine (and a curious director) tells
 * them apart. A clash with a booking just means no mirror, never no play.
 */
export async function writeMirror(club: CheckinClub, session: SessionRow, courtId: string): Promise<void> {
  const names = session.players.map((p) => p.name.split(/\s+/).pop()).filter(Boolean).join(' / ');
  const { data } = await db()
    .from('reservations')
    .insert({
      club_id: club.id,
      court_id: courtId,
      starts_at: session.started_at,
      ends_at: session.limit_ends_at ?? session.hard_ends_at,
      type: 'member',
      source: 'manual',
      title: `Walk-on ${session.play_type}${names ? ` — ${names}` : ''}`,
      status: 'confirmed',
      created_by: club.owner_id,
      meta: { origin: 'checkin', checkin_session_id: session.id },
    })
    .select('id')
    .maybeSingle();
  if (data) {
    await db().from('checkin_sessions').update({ reservation_id: (data as { id: string }).id }).eq('id', session.id);
  }
}

/* ------------------------------------------------------------ group lookup */

export async function groupByToken(
  token: string,
): Promise<{ club: CheckinClub; session: SessionRow | null; wait: WaitRow | null } | null> {
  if (!isGroupToken(token)) return null;
  const [{ data: sessions }, { data: wait }] = await Promise.all([
    db().from('checkin_sessions').select(SESSION_COLS).eq('group_token', token).limit(1),
    db().from('checkin_waits').select(WAIT_COLS).eq('group_token', token).maybeSingle(),
  ]);
  const session = ((sessions as SessionRow[] | null) ?? [])[0] ?? null;
  const clubId = session?.club_id ?? (wait as WaitRow | null)?.club_id;
  if (!clubId) return null;
  const club = await getClubById(clubId);
  return club ? { club, session, wait: (wait as WaitRow | null) ?? null } : null;
}
