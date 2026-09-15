import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RULES,
  describeSpace,
  effectiveRules,
  estimateCourtAt,
  planCourtStart,
  planVisit,
  publicName,
  queuePosition,
  reconcile,
  type ClubRules,
  type EngineBlock,
  type EngineSession,
  type EngineSpace,
  type EngineWait,
} from './engine';

const MIN = 60_000;
const T0 = Date.parse('2026-09-15T16:00:00Z'); // 9:00 AM Pacific

function court(n: number, rules: Partial<ClubRules> = {}, extra: Partial<EngineSpace> = {}): EngineSpace {
  return {
    id: `space-${n}`,
    kind: 'court',
    name: `Court ${n}`,
    courtId: `court-${n}`,
    relatedCourtIds: [`court-${n}`],
    active: true,
    displayOrder: n,
    capacity: null,
    rules: { ...DEFAULT_RULES, ...rules },
    ...extra,
  };
}

function session(spaceN: number, startMin: number, playType: 'singles' | 'doubles' = 'doubles', over: Partial<EngineSession> = {}): EngineSession {
  const startedAt = T0 + startMin * MIN;
  const limit = playType === 'singles' ? 60 : 90;
  return {
    id: `sess-${spaceN}`,
    spaceId: `space-${spaceN}`,
    exclusive: true,
    playType,
    startedAt,
    limitEndsAt: startedAt + limit * MIN,
    hardEndsAt: startedAt + 180 * MIN,
    playerCount: playType === 'singles' ? 2 : 4,
    guestCount: 0,
    ...over,
  };
}

function wait(id: string, joinedMin: number, over: Partial<EngineWait> = {}): EngineWait {
  return {
    id,
    status: 'waiting',
    joinedAt: T0 + joinedMin * MIN,
    offeredSpaceId: null,
    offerExpiresAt: null,
    playerCount: 4,
    playType: 'doubles',
    ...over,
  };
}

describe('time limits apply only when someone is waiting', () => {
  it('lets a group play on past its limit when nobody is waiting', () => {
    const spaces = [court(1)];
    const r = reconcile({ now: T0 + 120 * MIN, spaces, sessions: [session(1, 0)], waits: [], blocks: [] });
    expect(r.endSessions).toEqual([]);
    const view = describeSpace({ now: T0 + 120 * MIN, space: spaces[0], spaces, sessions: [session(1, 0)], waits: [], blocks: [] });
    expect(view.state).toBe('playing');
    expect(view.limitActive).toBe(false);
    expect(view.until).toBe(T0 + 180 * MIN); // the hard end, not the limit
  });

  it('offers an over-limit court to a waiting group, then ends the session after the grace period', () => {
    const spaces = [court(1)];
    const s = session(1, 0); // doubles, limit at 90
    const w = wait('w1', 60);

    // At the limit: offered, but the players still have their grace to finish the point.
    const atLimit = reconcile({ now: T0 + 90 * MIN, spaces, sessions: [s], waits: [w], blocks: [] });
    expect(atLimit.offers).toEqual([{ waitId: 'w1', spaceId: 'space-1', expiresAt: T0 + 100 * MIN }]);
    expect(atLimit.endSessions).toEqual([]);

    // After grace, with the court now held for w1: the session ends at limit + grace.
    const held = { ...w, status: 'offered' as const, offeredSpaceId: 'space-1', offerExpiresAt: T0 + 100 * MIN };
    const afterGrace = reconcile({ now: T0 + 96 * MIN, spaces, sessions: [s], waits: [held], blocks: [] });
    expect(afterGrace.endSessions).toEqual([{ id: 'sess-1', reason: 'limit', at: T0 + 95 * MIN }]);
  });

  it('before the limit, a waiting group is only told when the court frees', () => {
    const spaces = [court(1)];
    const r = reconcile({ now: T0 + 30 * MIN, spaces, sessions: [session(1, 0)], waits: [wait('w1', 20)], blocks: [] });
    expect(r.offers).toEqual([]);
    const view = describeSpace({ now: T0 + 30 * MIN, space: spaces[0], spaces, sessions: [session(1, 0)], waits: [wait('w1', 20)], blocks: [] });
    expect(view.limitActive).toBe(true);
    expect(view.until).toBe(T0 + 90 * MIN);
  });

  it('enforces the limit with nobody waiting when the club turns that off', () => {
    const spaces = [court(1, { limitsOnlyWhenWaiting: false })];
    const r = reconcile({ now: T0 + 66 * MIN, spaces, sessions: [session(1, 0, 'singles')], waits: [], blocks: [] });
    expect(r.endSessions).toEqual([{ id: 'sess-1', reason: 'limit', at: T0 + 65 * MIN }]);
  });

  it('uses per-space overrides on top of the club rules', () => {
    const rules = effectiveRules(DEFAULT_RULES, { doublesMinutes: 120, minPlayers: null });
    expect(rules.doublesMinutes).toBe(120);
    expect(rules.minPlayers).toBe(2);
  });
});

describe('the wait list', () => {
  it('serves groups in register order', () => {
    const spaces = [court(1), court(2)];
    const waits = [wait('late', 30), wait('early', 10), wait('middle', 20)];
    const r = reconcile({ now: T0 + 40 * MIN, spaces, sessions: [], waits, blocks: [] });
    expect(r.offers.map((o) => [o.waitId, o.spaceId])).toEqual([
      ['early', 'space-1'],
      ['middle', 'space-2'],
    ]);
    expect(queuePosition(waits, 'late')).toBe(3);
  });

  it('gives a waiting group a free court before bumping anyone', () => {
    const spaces = [court(1), court(2)];
    const r = reconcile({ now: T0 + 100 * MIN, spaces, sessions: [session(1, 0)], waits: [wait('w1', 50)], blocks: [] });
    expect(r.offers).toEqual([{ waitId: 'w1', spaceId: 'space-2', expiresAt: T0 + 110 * MIN }]);
    expect(r.endSessions).toEqual([]); // court 1 is not wanted, so its group plays on
  });

  it('bumps the group longest past its limit, and only as many as are waiting', () => {
    const spaces = [court(1), court(2)];
    const sessions = [session(1, 10), session(2, 0)]; // court 2 went over first
    const r = reconcile({ now: T0 + 110 * MIN, spaces, sessions, waits: [wait('w1', 30)], blocks: [] });
    expect(r.offers.map((o) => o.spaceId)).toEqual(['space-2']);
    expect(r.endSessions.map((e) => e.id)).toEqual(['sess-2']);
  });

  it('a missed offer lapses and the court goes to the next group', () => {
    const spaces = [court(1)];
    const waits = [
      wait('slow', 0, { status: 'offered', offeredSpaceId: 'space-1', offerExpiresAt: T0 + 20 * MIN }),
      wait('next', 5),
    ];
    const r = reconcile({ now: T0 + 21 * MIN, spaces, sessions: [], waits, blocks: [] });
    expect(r.missedOffers).toEqual(['slow']);
    expect(r.offers.map((o) => o.waitId)).toEqual(['next']);
  });

  it('a walk-up cannot take a court held for the wait list, but the offered group can', () => {
    const space = court(1);
    const heldFor = wait('w1', 0, { status: 'offered', offeredSpaceId: 'space-1', offerExpiresAt: T0 + 10 * MIN });
    const base = { now: T0, space, playType: 'doubles' as const, playerCount: 4, blocks: [], occupant: null, heldFor, closeAt: null };
    const walkUp = planCourtStart(base);
    expect(walkUp.ok).toBe(false);
    if (!walkUp.ok) expect(walkUp.code).toBe('held');
    expect(planCourtStart({ ...base, claimingWaitId: 'w1' }).ok).toBe(true);
  });

  it('the offered group bumps the over-limit group when it starts', () => {
    const space = court(1);
    const occupant = session(1, -100);
    const heldFor = wait('w1', -50, { status: 'offered', offeredSpaceId: 'space-1', offerExpiresAt: T0 + 10 * MIN });
    const r = planCourtStart({ now: T0, space, playType: 'singles', playerCount: 2, blocks: [], occupant, heldFor, claimingWaitId: 'w1', closeAt: null });
    expect(r.ok && r.bumpSessionId).toBe('sess-1');
  });

  it('estimates when a court comes up for each place in line', () => {
    const spaces = [court(1), court(2)];
    const sessions = [session(1, 0), session(2, 30)];
    const waits = [wait('a', 5), wait('b', 6)];
    expect(estimateCourtAt({ now: T0 + 40 * MIN, position: 1, spaces, sessions, waits, blocks: [] })).toBe(T0 + 90 * MIN);
    expect(estimateCourtAt({ now: T0 + 40 * MIN, position: 2, spaces, sessions, waits, blocks: [] })).toBe(T0 + 120 * MIN);
  });
});

describe('courts free themselves', () => {
  it('ends a session at its hard end (max length or closing)', () => {
    const r = reconcile({ now: T0 + 181 * MIN, spaces: [court(1)], sessions: [session(1, 0)], waits: [], blocks: [] });
    expect(r.endSessions).toEqual([{ id: 'sess-1', reason: 'max', at: T0 + 180 * MIN }]);
  });

  it('expires a wait nobody served for hours', () => {
    const r = reconcile({ now: T0 + 241 * MIN, spaces: [court(1)], sessions: [session(1, 200)], waits: [wait('w1', 0)], blocks: [] });
    expect(r.expiredWaits).toEqual(['w1']);
  });

  it('caps a session at club closing', () => {
    const r = planCourtStart({ now: T0, space: court(1), playType: 'doubles', playerCount: 4, blocks: [], occupant: null, heldFor: null, closeAt: T0 + 45 * MIN });
    expect(r.ok && [r.limitEndsAt, r.hardEndsAt]).toEqual([T0 + 45 * MIN, T0 + 45 * MIN]);
  });
});

describe('minimum players', () => {
  it('refuses a single player when the club requires two', () => {
    const r = planCourtStart({ now: T0, space: court(1), playType: 'singles', playerCount: 1, blocks: [], occupant: null, heldFor: null, closeAt: null });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('min_players');
  });

  it('allows one player where the court allows it (ball machine court)', () => {
    const r = planCourtStart({ now: T0, space: court(2, { minPlayers: 1 }), playType: 'other', playerCount: 1, blocks: [], occupant: null, heldFor: null, closeAt: null });
    expect(r.ok && r.limitEndsAt).toBe(T0 + 60 * MIN);
  });
});

describe('reservations block walk-on play', () => {
  const lesson = (courtN: number, fromMin: number, toMin: number): EngineBlock => ({
    courtId: `court-${courtN}`,
    startsAt: T0 + fromMin * MIN,
    endsAt: T0 + toMin * MIN,
    label: 'Lesson',
  });

  it('refuses a court held by a lesson right now', () => {
    const r = planCourtStart({ now: T0, space: court(1), playType: 'doubles', playerCount: 4, blocks: [lesson(1, -30, 30)], occupant: null, heldFor: null, closeAt: null });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('blocked');
      expect(r.until).toBe(T0 + 30 * MIN);
    }
  });

  it('shortens play to the next booking, and refuses if under 15 minutes remain', () => {
    const soon = planCourtStart({ now: T0, space: court(1), playType: 'doubles', playerCount: 4, blocks: [lesson(1, 10, 60)], occupant: null, heldFor: null, closeAt: null });
    expect(soon.ok).toBe(false);
    const later = planCourtStart({ now: T0, space: court(1), playType: 'doubles', playerCount: 4, blocks: [lesson(1, 45, 105)], occupant: null, heldFor: null, closeAt: null });
    expect(later.ok && later.limitEndsAt).toBe(T0 + 45 * MIN);
  });

  it('ends walk-on play when the booking starts, and does not offer the court', () => {
    const spaces = [court(1)];
    const r = reconcile({ now: T0 + 50 * MIN, spaces, sessions: [session(1, 0)], waits: [wait('w1', 10)], blocks: [lesson(1, 45, 105)] });
    expect(r.endSessions).toEqual([{ id: 'sess-1', reason: 'block', at: T0 + 45 * MIN }]);
    expect(r.offers).toEqual([]);
    expect(describeSpace({ now: T0 + 50 * MIN, space: spaces[0], spaces, sessions: [], waits: [], blocks: [lesson(1, 45, 105)] }).state).toBe('blocked');
  });

  it('a booking on the parent court blocks its half-courts', () => {
    const half = court(11, {}, { id: 'space-11a', courtId: 'court-11a', relatedCourtIds: ['court-11a', 'court-11'] });
    const r = planCourtStart({ now: T0, space: half, playType: 'singles', playerCount: 2, blocks: [lesson(11, -10, 50)], occupant: null, heldFor: null, closeAt: null });
    expect(r.ok).toBe(false);
  });
});

describe('pool capacity', () => {
  const pool: EngineSpace = { ...court(0), id: 'pool', kind: 'pool', name: 'Pool', courtId: null, relatedCourtIds: [], capacity: 10 };
  const visit = (id: string, people: number, guests: number): EngineSession => ({
    id, spaceId: 'pool', exclusive: false, playType: 'visit', startedAt: T0, limitEndsAt: null, hardEndsAt: T0 + 600 * MIN, playerCount: people, guestCount: guests,
  });

  it('counts members and guests against capacity', () => {
    const sessions = [visit('a', 1, 3), visit('b', 2, 2)]; // 8 in
    const ok = planVisit({ now: T0, space: pool, sessions, playerCount: 1, guestCount: 1, guestNamesGiven: 0, guestNamesRequired: false, endAt: T0 + 600 * MIN });
    expect(ok.ok && ok.headcountAfter).toBe(10);
    const tooMany = planVisit({ now: T0, space: pool, sessions, playerCount: 1, guestCount: 2, guestNamesGiven: 0, guestNamesRequired: false, endAt: T0 + 600 * MIN });
    expect(tooMany.ok).toBe(false);
    if (!tooMany.ok) expect(tooMany.message).toMatch(/Only 2 more/);
  });

  it('requires guest names when the club asks for them', () => {
    const r = planVisit({ now: T0, space: pool, sessions: [], playerCount: 1, guestCount: 2, guestNamesGiven: 1, guestNamesRequired: true, endAt: T0 + 600 * MIN });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('guest_names');
  });

  it('pool visits never take part in court offers', () => {
    const r = reconcile({ now: T0, spaces: [pool], sessions: [visit('a', 1, 0)], waits: [wait('w1', -5)], blocks: [] });
    expect(r.offers).toEqual([]);
  });
});

describe('public names', () => {
  it('shows first name and last initial only', () => {
    expect(publicName('Mary Benin')).toBe('Mary B.');
    expect(publicName('  jean  claude van damme ')).toBe('jean D.');
    expect(publicName('Cher')).toBe('Cher');
    expect(publicName('')).toBe('Player');
  });
});
