/**
 * What the public pages are allowed to see.
 *
 * Every name leaving through here is "Mary B." — the board hangs on a wall and
 * the scan page is open to anyone holding a phone at the fence. Emails, device
 * hashes and user ids never leave. A group's OWN page (group token) sees its
 * own full names, because they typed them.
 */

import {
  describeSpace,
  estimateCourtAt,
  headcount,
  publicName,
  queueOf,
  queuePosition,
  type SpaceState,
} from './engine';
import { engineInputs, toEngineSession, type ClubState, type SessionRow, type SpaceRow, type WaitRow } from './server';

const iso = (ms: number | null | undefined) => (ms === null || ms === undefined ? null : new Date(ms).toISOString());
const groupNames = (players: { name: string }[]) => players.map((p) => publicName(p.name)).join(', ');

export type CourtCard = {
  id: string;
  name: string;
  state: SpaceState;
  until: string | null;
  limitActive: boolean;
  playType: string | null;
  players: string | null;
  startedAt: string | null;
  heldFor: string | null;
  heldUntil: string | null;
  blockLabel: string | null;
};

export function courtCard(state: ClubState, space: SpaceRow): CourtCard {
  const inputs = engineInputs(state);
  const es = state.engineSpaces.find((s) => s.id === space.id)!;
  const v = describeSpace({ ...inputs, space: es });
  const sessionRow = v.session ? state.sessions.find((s) => s.id === v.session!.id) : null;
  const heldRow = v.heldFor ? state.waits.find((w) => w.id === v.heldFor!.id) : null;
  return {
    id: space.id,
    name: space.name,
    state: v.state,
    until: iso(v.until),
    limitActive: v.limitActive,
    playType: sessionRow?.play_type ?? null,
    players: sessionRow ? groupNames(sessionRow.players) : null,
    startedAt: sessionRow?.started_at ?? null,
    heldFor: heldRow ? groupNames(heldRow.players) : null,
    heldUntil: heldRow?.offer_expires_at ?? null,
    blockLabel: v.block?.label ?? null,
  };
}

export function clubHeader(state: ClubState) {
  return {
    name: state.club.name,
    slug: state.club.slug,
    logoUrl: state.club.logo_url,
    timezone: state.club.timezone,
  };
}

export function queueView(state: ClubState) {
  const waits = engineInputs(state).waits;
  const ordered = [
    ...state.waits.filter((w) => w.status === 'offered').sort((a, b) => a.joined_at.localeCompare(b.joined_at)),
    ...queueOf(waits).map((w) => state.waits.find((r) => r.id === w.id)!),
  ];
  return ordered.map((w) => ({
    names: groupNames(w.players),
    playType: w.play_type,
    joinedAt: w.joined_at,
    status: w.status,
    position: queuePosition(waits, w.id),
    offeredSpace: w.offered_space_id ? state.spaces.find((s) => s.id === w.offered_space_id)?.name ?? null : null,
    offerExpiresAt: w.offer_expires_at,
  }));
}

export function poolCards(state: ClubState) {
  const sessions = state.sessions.map(toEngineSession);
  return state.spaces
    .filter((s) => s.kind !== 'court' && s.kind !== 'kiosk' && s.active)
    .map((s) => ({ id: s.id, name: s.name, kind: s.kind, headcount: headcount(sessions, s.id), capacity: s.capacity }));
}

export function boardView(state: ClubState) {
  return {
    club: clubHeader(state),
    now: iso(state.now),
    courts: state.spaces.filter((s) => s.kind === 'court' && s.active).map((s) => courtCard(state, s)),
    queue: queueView(state),
    pools: poolCards(state),
  };
}

function spaceInfo(state: ClubState, space: SpaceRow) {
  const es = state.engineSpaces.find((s) => s.id === space.id)!;
  return {
    kind: space.kind,
    name: space.name,
    active: es.active,
    singlesMinutes: es.rules.singlesMinutes,
    doublesMinutes: es.rules.doublesMinutes,
    otherMinutes: es.rules.otherMinutes,
    minPlayers: es.rules.minPlayers,
    limitsOnlyWhenWaiting: es.rules.limitsOnlyWhenWaiting,
    capacity: space.capacity,
    trackGuests: space.track_guests,
    guestNamesRequired: space.guest_names_required,
  };
}

/** What a phone sees right after scanning a sign. */
export function scanView(state: ClubState, space: SpaceRow, groupToken: string | null) {
  const inputs = engineInputs(state);
  const courts = state.spaces.filter((s) => s.kind === 'court' && s.active);
  const cards = courts.map((s) => courtCard(state, s));
  const myWait = groupToken ? state.waits.find((w) => w.group_token === groupToken) ?? null : null;
  const mySession = groupToken ? state.sessions.find((s) => s.group_token === groupToken) ?? null : null;
  const queue = queueOf(inputs.waits);
  return {
    club: clubHeader(state),
    now: iso(state.now),
    geofence: state.settings.geofence_enabled && state.settings.latitude !== null,
    enabled: state.settings.enabled,
    space: spaceInfo(state, space),
    court: space.kind === 'court' ? courtCard(state, space) : null,
    courts: cards.map((c) => ({ name: c.name, state: c.state, until: c.until })),
    queueLength: queue.length,
    // "You're next" estimate for someone thinking of joining.
    nextCourtAt: iso(estimateCourtAt({ ...inputs, position: queue.length + 1 })),
    pool:
      space.kind !== 'court' && space.kind !== 'kiosk'
        ? { headcount: headcount(inputs.sessions, space.id), capacity: space.capacity }
        : null,
    mine: mySession
      ? { kind: 'session' as const, token: mySession.group_token, spaceName: state.spaces.find((s) => s.id === mySession.space_id)?.name ?? '' }
      : myWait
        ? {
            kind: 'wait' as const,
            token: myWait.group_token,
            offeredHere: myWait.status === 'offered' && myWait.offered_space_id === space.id,
          }
        : null,
  };
}

/** A group's own page: its session timer or its place in line. */
export function groupView(state: ClubState, session: SessionRow | null, wait: WaitRow | null) {
  const inputs = engineInputs(state);
  const queue = queueOf(inputs.waits);
  const base = { club: clubHeader(state), now: iso(state.now), queueLength: queue.length };

  // A wait that became a session: the session is the story now.
  if (session) {
    const space = state.spaces.find((s) => s.id === session.space_id);
    const live = state.sessions.find((s) => s.id === session.id);
    const card = space && space.kind === 'court' && live ? courtCard(state, space) : null;
    const sessions = inputs.sessions;
    return {
      ...base,
      kind: 'session' as const,
      session: {
        token: session.group_token,
        spaceKind: space?.kind ?? 'court',
        spaceName: space?.name ?? '',
        playType: session.play_type,
        players: session.players.map((p) => p.name),
        guestCount: session.guest_count,
        guestNames: session.guest_names,
        status: live ? 'active' : 'ended',
        startedAt: session.started_at,
        limitEndsAt: session.limit_ends_at,
        hardEndsAt: session.hard_ends_at,
        endedAt: session.ended_at,
        endReason: session.end_reason,
        until: card?.until ?? null,
        limitActive: card?.limitActive ?? false,
        overtime: card?.state === 'overtime',
        // Someone has been offered THIS court: the group is being asked to finish.
        heldFor: !!card?.heldFor,
        minPlayers: space ? state.engineSpaces.find((s) => s.id === space.id)?.rules.minPlayers ?? 1 : 1,
      },
      pool:
        space && space.kind !== 'court'
          ? { headcount: headcount(sessions, space.id), capacity: space.capacity }
          : null,
    };
  }

  const w = wait!;
  const live = state.waits.find((x) => x.id === w.id) ?? w;
  const position = queuePosition(inputs.waits, live.id);
  return {
    ...base,
    kind: 'wait' as const,
    wait: {
      token: live.group_token,
      status: live.status,
      playType: live.play_type,
      players: live.players.map((p) => p.name),
      joinedAt: live.joined_at,
      position,
      estimate: position ? iso(estimateCourtAt({ ...inputs, position })) : null,
      offeredSpace: live.offered_space_id ? state.spaces.find((s) => s.id === live.offered_space_id)?.name ?? null : null,
      offerExpiresAt: live.offer_expires_at,
    },
  };
}
