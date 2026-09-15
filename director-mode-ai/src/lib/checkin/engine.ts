/**
 * QR Check-In — the rules engine.
 *
 * Pure: every function takes "now" and plain rows and returns decisions. The
 * server layer (server.ts) loads rows, runs these, and writes what they say.
 * Nothing here reads a clock, a timezone or the database, which is what makes
 * the court register's rules testable at all.
 *
 * All instants are epoch milliseconds. Club-local concerns (closing time,
 * prime time) are converted to instants by the caller, in the club's zone.
 *
 * The rules are Rossmoor's paper register, generalised:
 *   - A group needs `minPlayers` present to sign in.
 *   - Singles / doubles / other each have a time limit, which by default only
 *     applies when someone is waiting.
 *   - The wait list is served in register order. A court that frees, or whose
 *     group runs past its limit while people wait, is OFFERED to the first
 *     waiting group, who has `claimMinutes` to walk over and start.
 *   - A group past its limit with people waiting "finishes the point":
 *     `graceMinutes`, then the session ends on its own.
 *   - Court time held by a reservation (lesson, event, blackout) is not
 *     walk-on-able, and walk-on play ends when a booking starts.
 */

export type PlayType = 'singles' | 'doubles' | 'other';
export type SessionPlayType = PlayType | 'visit';
export type SpaceKind = 'court' | 'kiosk' | 'pool' | 'room' | 'other';
export type EndReason = 'done' | 'limit' | 'max' | 'block' | 'staff' | 'bumped' | 'checkout';

const MIN = 60_000;

/** A court with less than this before its next booking is not offered or started. */
export const MIN_PLAYABLE_MINUTES = 15;
/** A wait-list entry nobody has served in this long is stale (they went home). */
export const WAIT_MAX_MINUTES = 240;

export interface ClubRules {
  singlesMinutes: number;
  doublesMinutes: number;
  otherMinutes: number;
  limitsOnlyWhenWaiting: boolean;
  minPlayers: number;
  graceMinutes: number;
  claimMinutes: number;
  maxSessionMinutes: number;
}

export const DEFAULT_RULES: ClubRules = {
  singlesMinutes: 60,
  doublesMinutes: 90,
  otherMinutes: 60,
  limitsOnlyWhenWaiting: true,
  minPlayers: 2,
  graceMinutes: 5,
  claimMinutes: 10,
  maxSessionMinutes: 180,
};

export interface SpaceOverrides {
  singlesMinutes?: number | null;
  doublesMinutes?: number | null;
  otherMinutes?: number | null;
  limitsOnlyWhenWaiting?: boolean | null;
  minPlayers?: number | null;
}

/** A space's rules: the club's, with any per-space override on top. */
export function effectiveRules(club: ClubRules, space: SpaceOverrides): ClubRules {
  const pick = <T>(v: T | null | undefined, fallback: T): T => (v === null || v === undefined ? fallback : v);
  return {
    ...club,
    singlesMinutes: pick(space.singlesMinutes, club.singlesMinutes),
    doublesMinutes: pick(space.doublesMinutes, club.doublesMinutes),
    otherMinutes: pick(space.otherMinutes, club.otherMinutes),
    limitsOnlyWhenWaiting: pick(space.limitsOnlyWhenWaiting, club.limitsOnlyWhenWaiting),
    minPlayers: pick(space.minPlayers, club.minPlayers),
  };
}

export function limitMinutes(rules: ClubRules, playType: PlayType): number {
  if (playType === 'singles') return rules.singlesMinutes;
  if (playType === 'doubles') return rules.doublesMinutes;
  return rules.otherMinutes;
}

export interface EngineSpace {
  id: string;
  kind: SpaceKind;
  name: string;
  courtId: string | null;
  /**
   * Courts whose bookings and play block this one: itself, its parent, and its
   * children (Sleepy Hollow's 11 / 11a / 11b). Sibling halves do not block
   * each other, so each space carries its own list.
   */
  relatedCourtIds: string[];
  active: boolean;
  displayOrder: number;
  capacity: number | null;
  rules: ClubRules;
}

export interface EngineSession {
  id: string;
  spaceId: string;
  exclusive: boolean;
  playType: SessionPlayType;
  startedAt: number;
  limitEndsAt: number | null;
  hardEndsAt: number;
  playerCount: number;
  guestCount: number;
}

export interface EngineWait {
  id: string;
  status: 'waiting' | 'offered';
  joinedAt: number;
  offeredSpaceId: string | null;
  offerExpiresAt: number | null;
  playerCount: number;
  playType: PlayType;
}

export interface EngineBlock {
  courtId: string;
  startsAt: number;
  endsAt: number;
  label: string;
}

/* ------------------------------------------------------------ bookings */

function blocksFor(space: EngineSpace, blocks: EngineBlock[]): EngineBlock[] {
  if (space.kind !== 'court') return [];
  const ids = new Set(space.relatedCourtIds.length ? space.relatedCourtIds : space.courtId ? [space.courtId] : []);
  return blocks.filter((b) => ids.has(b.courtId));
}

/** The booking holding this court right now, if any. Half-open, like no_double_booking. */
export function currentBlock(space: EngineSpace, blocks: EngineBlock[], now: number): EngineBlock | null {
  return blocksFor(space, blocks).find((b) => b.startsAt <= now && now < b.endsAt) ?? null;
}

/** When the next booking on this court begins, or null if none is ahead. */
export function nextBlockStart(space: EngineSpace, blocks: EngineBlock[], now: number): number | null {
  const ahead = blocksFor(space, blocks)
    .filter((b) => b.startsAt > now)
    .map((b) => b.startsAt);
  return ahead.length ? Math.min(...ahead) : null;
}

/* ------------------------------------------------------------ occupancy */

/** The group on this court (or a court that shares its surface), if any. */
export function occupantOf(
  space: EngineSpace,
  spaces: EngineSpace[],
  sessions: EngineSession[],
): EngineSession | null {
  if (space.kind !== 'court') return null;
  const related = new Set(space.relatedCourtIds);
  const spaceIds = new Set(
    spaces.filter((s) => s.id === space.id || (s.courtId && related.has(s.courtId))).map((s) => s.id),
  );
  // Its own session first: that is the one the board names.
  return (
    sessions.find((s) => s.exclusive && s.spaceId === space.id) ??
    sessions.find((s) => s.exclusive && spaceIds.has(s.spaceId)) ??
    null
  );
}

/** Waiting groups in register order. Offered groups are out of the line. */
export function queueOf(waits: EngineWait[]): EngineWait[] {
  return waits.filter((w) => w.status === 'waiting').sort((a, b) => a.joinedAt - b.joinedAt);
}

/** 1-based place in line, or null if the group is not waiting. */
export function queuePosition(waits: EngineWait[], waitId: string): number | null {
  const i = queueOf(waits).findIndex((w) => w.id === waitId);
  return i === -1 ? null : i + 1;
}

/**
 * Is the time limit in force for this session? Always, if the club says so;
 * otherwise only while someone is in line or a group is being offered this court.
 */
export function limitInForce(
  rules: ClubRules,
  demand: { queueLength: number; heldForSomeone: boolean },
): boolean {
  if (!rules.limitsOnlyWhenWaiting) return true;
  return demand.queueLength > 0 || demand.heldForSomeone;
}

/* -------------------------------------------------------------- starting */

export type StartCheck =
  | { ok: true; limitEndsAt: number; hardEndsAt: number; bumpSessionId: string | null }
  | {
      ok: false;
      code: 'not_court' | 'closed' | 'min_players' | 'blocked' | 'held' | 'occupied' | 'too_short';
      message: string;
      until?: number | null;
    };

/**
 * May this group start playing on this court now, and until when?
 *
 * `claimingWaitId` is the waiting group that was offered this court; it may
 * start even though the previous group is still on it (they are bumped).
 * Anyone else is refused while the court is held or occupied, so a walk-up
 * cannot jump the line.
 */
export function planCourtStart(opts: {
  now: number;
  space: EngineSpace;
  playType: PlayType;
  playerCount: number;
  blocks: EngineBlock[];
  occupant: EngineSession | null;
  heldFor: EngineWait | null;
  claimingWaitId?: string | null;
  /** Club closing today as an instant, when the club is open now. */
  closeAt: number | null;
}): StartCheck {
  const { now, space, playType, blocks } = opts;
  const rules = space.rules;
  if (space.kind !== 'court') return { ok: false, code: 'not_court', message: 'This sign is not for a court.' };
  if (!space.active) return { ok: false, code: 'closed', message: `${space.name} is closed right now.` };

  if (opts.playerCount < rules.minPlayers) {
    return {
      ok: false,
      code: 'min_players',
      message: `${rules.minPlayers} players need to be here to sign in.`,
    };
  }

  const block = currentBlock(space, blocks, now);
  if (block) {
    return {
      ok: false,
      code: 'blocked',
      message: `${space.name} is booked${block.label ? ` for ${block.label}` : ''}.`,
      until: block.endsAt,
    };
  }

  const claiming = !!opts.claimingWaitId && opts.heldFor?.id === opts.claimingWaitId;
  if (opts.heldFor && !claiming) {
    return {
      ok: false,
      code: 'held',
      message: `${space.name} is being held for the next group on the wait list.`,
      until: opts.heldFor.offerExpiresAt,
    };
  }
  if (opts.occupant && !claiming) {
    return {
      ok: false,
      code: 'occupied',
      message: `${space.name} is in use.`,
      until: opts.occupant.limitEndsAt ?? opts.occupant.hardEndsAt,
    };
  }

  const nextBlock = nextBlockStart(space, blocks, now);
  const candidates = [now + rules.maxSessionMinutes * MIN];
  if (opts.closeAt !== null && opts.closeAt > now) candidates.push(opts.closeAt);
  if (nextBlock !== null) candidates.push(nextBlock);
  const hardEndsAt = Math.min(...candidates);

  if (hardEndsAt - now < MIN_PLAYABLE_MINUTES * MIN) {
    return {
      ok: false,
      code: 'too_short',
      message: `${space.name} is booked very soon.`,
      until: nextBlock,
    };
  }

  return {
    ok: true,
    limitEndsAt: Math.min(now + limitMinutes(rules, playType) * MIN, hardEndsAt),
    hardEndsAt,
    bumpSessionId: claiming && opts.occupant ? opts.occupant.id : null,
  };
}

/* ------------------------------------------------------------------ pool */

export function headcount(sessions: EngineSession[], spaceId: string): number {
  return sessions
    .filter((s) => s.spaceId === spaceId)
    .reduce((n, s) => n + s.playerCount + s.guestCount, 0);
}

export type VisitCheck =
  | { ok: true; hardEndsAt: number; headcountAfter: number }
  | { ok: false; code: 'closed' | 'full' | 'guest_names'; message: string };

/** A pool-gate (or any shared space) check-in: capacity, guests, and when it lapses. */
export function planVisit(opts: {
  now: number;
  space: EngineSpace;
  sessions: EngineSession[];
  playerCount: number;
  guestCount: number;
  guestNamesGiven: number;
  guestNamesRequired: boolean;
  /** Closing today if open, else the end of the club-local day. */
  endAt: number;
}): VisitCheck {
  const { space } = opts;
  if (!space.active) return { ok: false, code: 'closed', message: `${space.name} is closed right now.` };
  if (opts.guestNamesRequired && opts.guestNamesGiven < opts.guestCount) {
    return { ok: false, code: 'guest_names', message: 'Please add a name for each guest.' };
  }
  const current = headcount(opts.sessions, space.id);
  const adding = opts.playerCount + opts.guestCount;
  if (space.capacity !== null && current + adding > space.capacity) {
    const left = Math.max(0, space.capacity - current);
    return {
      ok: false,
      code: 'full',
      message:
        left === 0
          ? `${space.name} is full (${space.capacity} people).`
          : `Only ${left} more ${left === 1 ? 'person' : 'people'} can come in right now.`,
    };
  }
  const endAt = opts.endAt > opts.now ? opts.endAt : opts.now + 4 * 60 * MIN;
  return { ok: true, hardEndsAt: endAt, headcountAfter: current + adding };
}

/* ------------------------------------------------------------- reconcile */

export interface ReconcileResult {
  endSessions: { id: string; reason: Extract<EndReason, 'limit' | 'max' | 'block'>; at: number }[];
  /** Offers nobody claimed in time. */
  missedOffers: string[];
  /** Waits nobody served for WAIT_MAX_MINUTES. */
  expiredWaits: string[];
  offers: { waitId: string; spaceId: string; expiresAt: number }[];
}

/**
 * Bring the club's check-in state up to date with the clock.
 *
 * There is no cron: every scan, poll and board refresh calls this first, so
 * the register is always as current as the last phone that looked at it. The
 * order matters and is the rulebook:
 *   1. stale offers lapse (that group missed its court), stale waits expire;
 *   2. sessions past their hard end, or run into a booking, end;
 *   3. free courts are offered to the line, in register order;
 *   4. only the line still unserved bumps anyone: over-limit courts are
 *      offered, longest past its limit first;
 *   5. a group past limit + grace ends, if its court is wanted (or the club
 *      enforces limits always). Two groups over time and one group waiting
 *      bumps one court, not two.
 */
export function reconcile(opts: {
  now: number;
  spaces: EngineSpace[];
  sessions: EngineSession[];
  waits: EngineWait[];
  blocks: EngineBlock[];
}): ReconcileResult {
  const { now, spaces, blocks } = opts;
  const out: ReconcileResult = { endSessions: [], missedOffers: [], expiredWaits: [], offers: [] };
  const spaceById = new Map(spaces.map((s) => [s.id, s]));

  // 1. offers and waits that have gone stale
  const waits = opts.waits.filter((w) => {
    if (w.status === 'offered' && w.offerExpiresAt !== null && now >= w.offerExpiresAt) {
      out.missedOffers.push(w.id);
      return false;
    }
    if (w.status === 'waiting' && now - w.joinedAt >= WAIT_MAX_MINUTES * MIN) {
      out.expiredWaits.push(w.id);
      return false;
    }
    return true;
  });

  // 2. sessions that are over whatever anyone wants
  const sessions = opts.sessions.filter((s) => {
    if (now >= s.hardEndsAt) {
      out.endSessions.push({ id: s.id, reason: 'max', at: s.hardEndsAt });
      return false;
    }
    const space = spaceById.get(s.spaceId);
    if (!space || !s.exclusive) return true;
    const block = currentBlock(space, blocks, now);
    if (block) {
      out.endSessions.push({ id: s.id, reason: 'block', at: Math.max(block.startsAt, s.startedAt + 1) });
      return false;
    }
    return true;
  });

  const held = new Set(waits.filter((w) => w.status === 'offered').map((w) => w.offeredSpaceId as string));
  const offerable = (space: EngineSpace) => {
    if (space.kind !== 'court' || !space.active || held.has(space.id)) return false;
    if (currentBlock(space, blocks, now)) return false;
    const next = nextBlockStart(space, blocks, now);
    return next === null || next - now >= MIN_PLAYABLE_MINUTES * MIN;
  };
  const line = queueOf(waits);
  const offer = (waitId: string, space: EngineSpace) => {
    held.add(space.id);
    out.offers.push({ waitId, spaceId: space.id, expiresAt: now + space.rules.claimMinutes * MIN });
  };

  // 3. free courts to the line
  const free = spaces
    .filter((space) => offerable(space) && !occupantOf(space, spaces, sessions))
    .sort((a, b) => a.displayOrder - b.displayOrder);
  for (const space of free) {
    if (!line.length) break;
    if (sharesSurface(space, spaces, held)) continue;
    offer(line.shift()!.id, space);
  }

  // 4. over-limit courts to whoever is still in line
  if (line.length) {
    const overtime = spaces
      .map((space) => ({ space, occ: occupantOf(space, spaces, sessions) }))
      .filter(
        (x): x is { space: EngineSpace; occ: EngineSession } =>
          offerable(x.space) &&
          !!x.occ &&
          x.occ.spaceId === x.space.id &&
          x.occ.limitEndsAt !== null &&
          now >= x.occ.limitEndsAt,
      )
      .sort((a, b) => a.occ.limitEndsAt! - b.occ.limitEndsAt!);
    for (const { space } of overtime) {
      if (!line.length) break;
      offer(line.shift()!.id, space);
    }
  }

  // 5. finish the point: past limit + grace, and the court is wanted
  for (const s of sessions) {
    const space = spaceById.get(s.spaceId);
    if (!space || !s.exclusive || s.limitEndsAt === null) continue;
    const graceEnd = s.limitEndsAt + space.rules.graceMinutes * MIN;
    if (now < graceEnd) continue;
    // Only a court someone has actually been offered is "wanted": anyone still
    // in line after step 4 could not be given this court anyway (a booking is
    // about to start on it), so ending this group would free it for nobody.
    if (!limitInForce(space.rules, { queueLength: 0, heldForSomeone: held.has(space.id) })) continue;
    out.endSessions.push({ id: s.id, reason: 'limit', at: graceEnd });
  }

  return out;
}

/** Offering 11 and 11a together would promise the same surface twice. */
function sharesSurface(space: EngineSpace, spaces: EngineSpace[], heldIds: Set<string>): boolean {
  if (!space.courtId) return false;
  return spaces.some(
    (other) =>
      heldIds.has(other.id) &&
      other.id !== space.id &&
      other.courtId !== null &&
      space.relatedCourtIds.includes(other.courtId),
  );
}

/* ------------------------------------------------------------------ views */

export type SpaceState = 'free' | 'playing' | 'overtime' | 'held' | 'blocked' | 'closed';

export interface SpaceView {
  state: SpaceState;
  session: EngineSession | null;
  heldFor: EngineWait | null;
  block: EngineBlock | null;
  /** When this space is expected to be free, or null if open-ended / free. */
  until: number | null;
  /** True when the group on it is on the clock (someone waiting, or always-on limits). */
  limitActive: boolean;
}

export function describeSpace(opts: {
  now: number;
  space: EngineSpace;
  spaces: EngineSpace[];
  sessions: EngineSession[];
  waits: EngineWait[];
  blocks: EngineBlock[];
}): SpaceView {
  const { now, space } = opts;
  const heldFor = opts.waits.find((w) => w.status === 'offered' && w.offeredSpaceId === space.id) ?? null;
  const base = { heldFor, block: null, session: null, until: null, limitActive: false };
  if (!space.active) return { ...base, state: 'closed' };

  const block = currentBlock(space, opts.blocks, now);
  if (block) return { ...base, state: 'blocked', block, until: block.endsAt };

  const session = occupantOf(space, opts.spaces, opts.sessions);
  if (session) {
    const limitActive =
      session.limitEndsAt !== null &&
      limitInForce(space.rules, { queueLength: queueOf(opts.waits).length, heldForSomeone: !!heldFor });
    const until = limitActive ? session.limitEndsAt : session.hardEndsAt;
    const overtime = limitActive && session.limitEndsAt !== null && now >= session.limitEndsAt;
    return { ...base, state: overtime ? 'overtime' : 'playing', session, until, limitActive };
  }
  if (heldFor) return { ...base, state: 'held', until: heldFor.offerExpiresAt };
  return { ...base, state: 'free' };
}

/**
 * Roughly when the Nth group in line will get a court: the Nth earliest time a
 * court is due to free up, assuming everyone ahead plays to their limit.
 */
export function estimateCourtAt(opts: {
  now: number;
  position: number;
  spaces: EngineSpace[];
  sessions: EngineSession[];
  waits: EngineWait[];
  blocks: EngineBlock[];
}): number | null {
  const times: number[] = [];
  for (const space of opts.spaces) {
    if (space.kind !== 'court' || !space.active) continue;
    const v = describeSpace({ ...opts, space });
    if (v.state === 'free') times.push(opts.now);
    else if (v.state === 'playing' || v.state === 'overtime') {
      const s = v.session!;
      times.push(Math.max(opts.now, s.limitEndsAt ?? s.hardEndsAt));
    } else if (v.state === 'held' && v.until) times.push(v.until);
    else if (v.state === 'blocked' && v.until) times.push(v.until);
  }
  times.sort((a, b) => a - b);
  return times[opts.position - 1] ?? null;
}

/* ------------------------------------------------------------- geofence */

/** Metres between two points (haversine). Kept here so the client bundle can use it. */
export function metresBetween(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6_371_000;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/* ---------------------------------------------------------------- names */

/** "Mary Benin" -> "Mary B." — all a public board or a stranger's phone ever sees. */
export function publicName(full: string): string {
  const parts = (full || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'Player';
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}
