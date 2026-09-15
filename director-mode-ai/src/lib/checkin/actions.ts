/**
 * The things a group does: start on a court, check in at the pool, join the
 * wait list, finish, add a player, leave the line.
 *
 * Each one reconciles first (so the decision is made against the present, not
 * against whenever someone last looked), asks the engine, then writes. The
 * database has the last word on races: one active session per court and one
 * offer per court are unique indexes, so a lost race is a 409, not a double
 * booking.
 */

import { getSupabaseAdmin } from '@/lib/supabase/admin';
import {
  occupantOf,
  planCourtStart,
  planVisit,
  type PlayType,
} from './engine';
import {
  clubCloseAt,
  clubDayEnd,
  endSession,
  engineInputs,
  reconcileClub,
  SESSION_COLS,
  WAIT_COLS,
  writeMirror,
  type CheckinClub,
  type Player,
  type SessionRow,
  type SpaceRow,
  type WaitRow,
} from './server';

const db = () => getSupabaseAdmin();

export type ActionResult =
  | { ok: true; groupToken: string }
  | { ok: false; status: number; error: string; code?: string; until?: string | null };

const fail = (status: number, error: string, code?: string, until?: number | null): ActionResult => ({
  ok: false,
  status,
  error,
  code,
  until: until ? new Date(until).toISOString() : null,
});

/** One running court per phone: signing in two courts for friends who are not here is the abuse. */
async function deviceBusy(clubId: string, device: string | null): Promise<string | null> {
  if (!device) return null;
  const { data } = await db()
    .from('checkin_sessions')
    .select('space_id')
    .eq('club_id', clubId)
    .eq('device_hash', device)
    .eq('status', 'active')
    .eq('exclusive', true)
    .limit(1);
  const row = ((data as { space_id: string }[] | null) ?? [])[0];
  if (!row) return null;
  const { data: space } = await db().from('checkin_spaces').select('name').eq('id', row.space_id).maybeSingle();
  return (space as { name: string } | null)?.name ?? 'another court';
}

export async function startCourt(opts: {
  club: CheckinClub;
  space: SpaceRow;
  playType: PlayType;
  players: Player[];
  email: string | null;
  userId: string | null;
  device: string | null;
  /** The phone's wait-list token, if it was offered this court. */
  waitToken: string | null;
}): Promise<ActionResult> {
  const state = await reconcileClub(opts.club);
  if (!state.settings.enabled) return fail(403, 'Check-in is turned off at this club right now.');
  const inputs = engineInputs(state);
  const es = state.engineSpaces.find((s) => s.id === opts.space.id);
  if (!es) return fail(404, 'This sign is no longer in use.');

  const heldRow = state.waits.find((w) => w.status === 'offered' && w.offered_space_id === es.id) ?? null;
  const claimRow = opts.waitToken ? state.waits.find((w) => w.group_token === opts.waitToken) ?? null : null;
  const heldFor = heldRow ? inputs.waits.find((w) => w.id === heldRow.id)! : null;
  const occupant = occupantOf(es, state.engineSpaces, inputs.sessions);

  const claiming = !!claimRow && claimRow.status === 'offered' && claimRow.offered_space_id === es.id;
  const plan = planCourtStart({
    now: state.now,
    space: es,
    playType: opts.playType,
    playerCount: opts.players.length,
    blocks: state.blocks,
    occupant,
    heldFor,
    claimingWaitId: claiming ? claimRow!.id : null,
    closeAt: clubCloseAt(opts.club, state.now),
  });
  if (!plan.ok) return fail(409, plan.message, plan.code, plan.until ?? null);

  if (!claiming) {
    const busy = await deviceBusy(opts.club.id, opts.device);
    if (busy) return fail(409, `This phone already has ${busy} running. Tap "We're done" there first.`, 'device_busy');
    // A phone already in line should take its offer, not a court someone else is owed.
    if (claimRow && (claimRow.status === 'waiting' || claimRow.status === 'offered')) {
      return fail(409, 'You are on the wait list. We will show you the court that is yours.', 'in_line');
    }
  }

  if (plan.bumpSessionId) await endSession(plan.bumpSessionId, 'bumped', state.now);

  const insert: Record<string, unknown> = {
    club_id: opts.club.id,
    space_id: es.id,
    exclusive: true,
    play_type: opts.playType,
    players: opts.players,
    player_count: opts.players.length,
    contact_email: opts.email ?? claimRow?.contact_email ?? null,
    user_id: opts.userId,
    started_at: new Date(state.now).toISOString(),
    limit_ends_at: new Date(plan.limitEndsAt).toISOString(),
    hard_ends_at: new Date(plan.hardEndsAt).toISOString(),
    device_hash: opts.device,
  };
  if (claiming) {
    insert.group_token = claimRow!.group_token;
    insert.wait_id = claimRow!.id;
  }

  const { data, error } = await db().from('checkin_sessions').insert(insert).select(SESSION_COLS).maybeSingle();
  if (error || !data) {
    if ((error as { code?: string } | null)?.code === '23505') {
      return fail(409, `Someone just started on ${es.name}.`, 'occupied');
    }
    return fail(500, error?.message || 'Could not start the timer.');
  }
  const session = data as SessionRow;

  if (claiming) {
    await db()
      .from('checkin_waits')
      .update({ status: 'playing', session_id: session.id, resolved_at: session.started_at })
      .eq('id', claimRow!.id);
  }
  if (state.settings.mirror_to_courtsheet && opts.space.court_id) {
    try {
      await writeMirror(opts.club, session, opts.space.court_id);
    } catch {
      // The grid copy is a convenience. Play has started either way.
    }
  }
  return { ok: true, groupToken: session.group_token };
}

export async function startVisit(opts: {
  club: CheckinClub;
  space: SpaceRow;
  names: string[];
  players: Player[];
  guestCount: number;
  guestNames: string[];
  email: string | null;
  userId: string | null;
  device: string | null;
}): Promise<ActionResult> {
  const state = await reconcileClub(opts.club);
  if (!state.settings.enabled) return fail(403, 'Check-in is turned off at this club right now.');
  const es = state.engineSpaces.find((s) => s.id === opts.space.id);
  if (!es) return fail(404, 'This sign is no longer in use.');

  const guestCount = opts.space.track_guests ? opts.guestCount : 0;
  const plan = planVisit({
    now: state.now,
    space: es,
    sessions: engineInputs(state).sessions,
    playerCount: opts.players.length,
    guestCount,
    guestNamesGiven: opts.guestNames.length,
    guestNamesRequired: opts.space.guest_names_required,
    endAt: clubCloseAt(opts.club, state.now) ?? clubDayEnd(opts.club.timezone, state.now),
  });
  if (!plan.ok) return fail(409, plan.message, plan.code);

  const { data, error } = await db()
    .from('checkin_sessions')
    .insert({
      club_id: opts.club.id,
      space_id: es.id,
      exclusive: false,
      play_type: 'visit',
      players: opts.players,
      player_count: opts.players.length,
      guest_count: guestCount,
      guest_names: opts.space.track_guests ? opts.guestNames.slice(0, guestCount) : [],
      contact_email: opts.email,
      user_id: opts.userId,
      started_at: new Date(state.now).toISOString(),
      hard_ends_at: new Date(plan.hardEndsAt).toISOString(),
      device_hash: opts.device,
    })
    .select('group_token')
    .maybeSingle();
  if (error || !data) return fail(500, error?.message || 'Could not check you in.');
  return { ok: true, groupToken: (data as { group_token: string }).group_token };
}

export async function joinWait(opts: {
  club: CheckinClub;
  viaSpace: SpaceRow;
  playType: PlayType;
  players: Player[];
  email: string | null;
  userId: string | null;
  device: string | null;
}): Promise<ActionResult> {
  const state = await reconcileClub(opts.club);
  if (!state.settings.enabled) return fail(403, 'Check-in is turned off at this club right now.');
  const minPlayers = state.settings.min_players;
  if (opts.players.length < minPlayers) {
    return fail(400, `${minPlayers} players need to be here to sign the wait list.`, 'min_players');
  }
  if (opts.device) {
    const { data } = await db()
      .from('checkin_waits')
      .select('group_token')
      .eq('club_id', opts.club.id)
      .eq('device_hash', opts.device)
      .in('status', ['waiting', 'offered'])
      .limit(1);
    const existing = ((data as { group_token: string }[] | null) ?? [])[0];
    // Same phone, same line: take them back to their place rather than a second one.
    if (existing) return { ok: true, groupToken: existing.group_token };
  }

  const { data, error } = await db()
    .from('checkin_waits')
    .insert({
      club_id: opts.club.id,
      joined_via_space_id: opts.viaSpace.id,
      play_type: opts.playType,
      players: opts.players,
      player_count: opts.players.length,
      contact_email: opts.email,
      user_id: opts.userId,
      joined_at: new Date(state.now).toISOString(),
      device_hash: opts.device,
    })
    .select('group_token')
    .maybeSingle();
  if (error || !data) return fail(500, error?.message || 'Could not add you to the list.');

  // A court may be free right now (someone scanned the kiosk while Court 6 sat
  // empty): reconciling immediately turns that into an offer on their screen.
  await reconcileClub(opts.club);
  return { ok: true, groupToken: (data as { group_token: string }).group_token };
}

export type GroupAction = 'done' | 'add_player' | 'leave' | 'claim';

export async function groupAction(opts: {
  club: CheckinClub;
  session: SessionRow | null;
  wait: WaitRow | null;
  action: GroupAction;
  name: string | null;
  device: string | null;
}): Promise<ActionResult> {
  const { club, action } = opts;
  const state = await reconcileClub(club);

  if (action === 'done') {
    const live = opts.session && state.sessions.find((s) => s.id === opts.session!.id);
    if (!live) return fail(409, 'This session has already ended.');
    await endSession(live.id, live.exclusive ? 'done' : 'checkout', state.now);
    // Hand the court straight to the line.
    await reconcileClub(club);
    return { ok: true, groupToken: live.group_token };
  }

  if (action === 'add_player') {
    const live = opts.session && state.sessions.find((s) => s.id === opts.session!.id);
    if (!live) return fail(409, 'This session has already ended.');
    if (!opts.name) return fail(400, 'Type the player’s name.');
    if (live.players.length >= 8) return fail(400, 'That is a full court already.');
    const players = [...live.players, { name: opts.name }];
    await db()
      .from('checkin_sessions')
      .update({ players, player_count: players.length })
      .eq('id', live.id)
      .eq('status', 'active');
    return { ok: true, groupToken: live.group_token };
  }

  const wait = opts.wait && (await db().from('checkin_waits').select(WAIT_COLS).eq('id', opts.wait.id).maybeSingle()).data as WaitRow | null;
  if (!wait) return fail(404, 'We could not find your place on the list.');

  if (action === 'leave') {
    if (wait.status !== 'waiting' && wait.status !== 'offered') return fail(409, 'You are no longer on the list.');
    await db()
      .from('checkin_waits')
      .update({ status: 'left', resolved_at: new Date(state.now).toISOString() })
      .eq('id', wait.id)
      .in('status', ['waiting', 'offered']);
    await reconcileClub(club);
    return { ok: true, groupToken: wait.group_token };
  }

  // claim: start on the court they were offered, from their own page.
  if (wait.status !== 'offered' || !wait.offered_space_id) {
    return fail(409, wait.status === 'missed' ? 'That court offer ran out. Scan a court sign to sign in again.' : 'No court is waiting for you yet.');
  }
  const { data: space } = await db().from('checkin_spaces').select('*').eq('id', wait.offered_space_id).maybeSingle();
  if (!space) return fail(404, 'That court is no longer in use.');
  return startCourt({
    club,
    space: space as SpaceRow,
    playType: wait.play_type,
    players: wait.players,
    email: wait.contact_email,
    userId: wait.user_id,
    device: opts.device,
    waitToken: wait.group_token,
  });
}
