import { describe, it, expect } from 'vitest';
import {
  classPhase,
  compareItems,
  compareLive,
  daysUntil,
  isStaleRunning,
  leaguePhase,
  livePhase,
  type Candidate,
} from './live';

/**
 * The judgement behind the "happening now" bar.
 *
 * Worth testing because the naive version is actively harmful: Sleepy Hollow
 * had NINE events flagged 'running', eight of them from two months earlier and
 * never closed out. A bar listing all of them is ten rows of which one matters,
 * and a director stops reading it on day one. The rule below is what makes the
 * bar worth glancing at.
 */

describe('livePhase', () => {
  it('keeps an event open for signups three weeks out', () => {
    // The one the director could not find: Dunkin' Quads, open, Oct 3.
    expect(livePhase({ public_status: 'open', daysAway: 21 })).toBe('signup');
  });

  it('keeps an open event with no date at all', () => {
    expect(livePhase({ public_status: 'open', daysAway: null })).toBe('signup');
  });

  it('drops an open event whose date has passed', () => {
    expect(livePhase({ public_status: 'open', daysAway: -1 })).toBeNull();
  });

  it('keeps a running event today and either side of it', () => {
    expect(livePhase({ public_status: 'running', daysAway: 0 })).toBe('live');
    expect(livePhase({ public_status: 'running', daysAway: 1 })).toBe('live');
    expect(livePhase({ public_status: 'running', daysAway: -2 })).toBe('live');
  });

  it('drops a running event two months stale', () => {
    // The eight July events that made the naive version useless.
    expect(livePhase({ public_status: 'running', daysAway: -52 })).toBeNull();
    expect(livePhase({ public_status: 'running', daysAway: -3 })).toBeNull();
  });

  it('drops a running event dated well in the future', () => {
    // Flagged running but not for a fortnight — somebody set it early.
    expect(livePhase({ public_status: 'running', daysAway: 14 })).toBeNull();
  });

  it('ignores drafts and completed events entirely', () => {
    expect(livePhase({ public_status: 'draft', daysAway: 1 })).toBeNull();
    expect(livePhase({ public_status: 'completed', daysAway: 0 })).toBeNull();
  });

  it('cuts Sleepy Hollow’s real data down to the one that matters', () => {
    // Exactly what was in the database: one open event three weeks out, and
    // nine flagged running of which eight were from July.
    const real: Candidate[] = [
      { public_status: 'open', daysAway: 21 }, // Dunkin' Quads
      { public_status: 'running', daysAway: -21 }, // SH Level 5, Aug
      { public_status: 'running', daysAway: -50 }, // Summer Slam, Jul
      { public_status: 'running', daysAway: -50 }, // Fall Member Singles
      { public_status: 'running', daysAway: -51 }, // JTT Open compass
      { public_status: 'running', daysAway: -53 }, // JTT 12U compass
      { public_status: 'running', daysAway: -53 }, // JTT 10U silver
      { public_status: 'running', daysAway: -53 }, // JTT 13&O
      { public_status: 'running', daysAway: -53 }, // JTT 10U gold
      { public_status: 'running', daysAway: -119 }, // JTCC Holidays, May
    ];
    const kept = real.map(livePhase).filter(Boolean);
    expect(kept).toEqual(['signup']);
  });
});

describe('daysUntil', () => {
  it('counts whole days either way', () => {
    expect(daysUntil('2026-10-03', '2026-09-12')).toBe(21);
    expect(daysUntil('2026-09-12', '2026-09-12')).toBe(0);
    expect(daysUntil('2026-07-24', '2026-09-12')).toBe(-50);
  });

  it('is null for an undated event, and survives junk', () => {
    expect(daysUntil(null, '2026-09-12')).toBeNull();
    expect(daysUntil('not a date', '2026-09-12')).toBeNull();
  });

  it('does not drift across a DST change', () => {
    // Both ends read at midday UTC, so the hour the clocks move cannot round
    // a day to 29 or 31.
    expect(daysUntil('2026-11-10', '2026-10-11')).toBe(30);
  });
});

describe('isStaleRunning', () => {
  it('spots the July events still flagged running', () => {
    expect(isStaleRunning({ public_status: 'running', daysAway: -50 })).toBe(true);
    expect(isStaleRunning({ public_status: 'running', daysAway: -1 })).toBe(false);
    expect(isStaleRunning({ public_status: 'open', daysAway: -50 })).toBe(false);
  });
});

describe('compareLive', () => {
  it('puts what is underway before what is upcoming', () => {
    const live = { phase: 'live' as const, daysAway: 0 };
    const soon = { phase: 'signup' as const, daysAway: 1 };
    expect([soon, live].sort(compareLive)[0]).toBe(live);
  });

  it('orders upcoming by soonest', () => {
    const a = { phase: 'signup' as const, daysAway: 21 };
    const b = { phase: 'signup' as const, daysAway: 3 };
    expect([a, b].sort(compareLive)[0]).toBe(b);
  });
});

/**
 * Leagues, and why the status column cannot be trusted here either.
 *
 * Six leagues in the database. Four were still flagged 'running' with end
 * dates in July and August; one 'open' league had also finished. Exactly one
 * was actually on. That is the ratio the bar has to survive.
 */
describe('leaguePhase', () => {
  const base = {
    status: 'open',
    startsIn: null,
    endsIn: null,
    registrationOpensIn: null,
    registrationClosesIn: null,
  };

  it('calls an underway league live', () => {
    // Fall Ladies Interclub: started three weeks ago, ends in November.
    expect(leaguePhase({ ...base, status: 'open', startsIn: -20, endsIn: 61 })).toBe('live');
  });

  it('drops a league that finished, whatever the status says', () => {
    expect(leaguePhase({ ...base, status: 'running', startsIn: -95, endsIn: -43 })).toBeNull();
    expect(leaguePhase({ ...base, status: 'open', startsIn: -96, endsIn: -34 })).toBeNull();
  });

  it('keeps a league inside the grace window after its last date', () => {
    // Finals moved a day; the league is still the thing on court.
    expect(leaguePhase({ ...base, status: 'running', startsIn: -60, endsIn: -2 })).toBe('live');
  });

  it('shows an upcoming league while it is taking entries', () => {
    expect(
      leaguePhase({ ...base, status: 'open', startsIn: 14, registrationOpensIn: -7 }),
    ).toBe('signup');
  });

  it('treats a null open date on an open league as already taking entries', () => {
    // How the flex leagues are actually set up — no open date, status 'open'.
    expect(leaguePhase({ ...base, status: 'open', startsIn: 14 })).toBe('signup');
  });

  it('stays quiet about an upcoming league whose entries have not opened', () => {
    expect(
      leaguePhase({ ...base, status: 'open', startsIn: 40, registrationOpensIn: 10 }),
    ).toBeNull();
  });

  it('stays quiet once entries have closed and play has not begun', () => {
    expect(
      leaguePhase({
        ...base,
        status: 'open',
        startsIn: 3,
        registrationOpensIn: -30,
        registrationClosesIn: -1,
      }),
    ).toBeNull();
  });

  it('cuts the real six leagues down to the one that is on', () => {
    // The database as it stood on 2026-09-12, dates in days from that day.
    const real = [
      // Lamorinda Clubs Summer 2026 — 'running', ended Jul 31
      { ...base, status: 'running', startsIn: -103, endsIn: -43, registrationOpensIn: -155, registrationClosesIn: -108 },
      // Lamorinda Summer Compass 2026 — 'open', ended Aug 9
      { ...base, status: 'open', startsIn: -96, endsIn: -34, registrationClosesIn: -100 },
      // Lamorinda JTT Summer 2026 — 'running', ended Jul 21
      { ...base, status: 'running', startsIn: -95, endsIn: -53, registrationOpensIn: -142 },
      // Wednesday Night Mixed 7.0 — 'running', ended Aug 14
      { ...base, status: 'running', startsIn: -64, endsIn: -29, registrationOpensIn: -50 },
      // Summer Flex Singles League — 'running', ended Aug 28
      { ...base, status: 'running', startsIn: -57, endsIn: -15, registrationOpensIn: -50 },
      // Fall Ladies Interclub — 'open', Aug 23 → Nov 12. The live one.
      { ...base, status: 'open', startsIn: -20, endsIn: 61, registrationOpensIn: -50 },
    ];
    expect(real.map(leaguePhase).filter(Boolean)).toEqual(['live']);
  });
});

/**
 * A class earns a row ONLY while people can still join it.
 *
 * A club with ten after-school classes running would otherwise fill the bar
 * with ten things needing no attention, which is the same failure as the stale
 * events — just arrived at from the other direction.
 */
describe('classPhase', () => {
  const base = {
    status: 'published',
    registrationMode: 'online',
    startsIn: 10,
    endsIn: 80,
    registrationOpensIn: null,
    registrationClosesIn: null,
  };

  it('shows a published class taking online sign-ups', () => {
    expect(classPhase(base)).toBe('signup');
  });

  it('ignores a draft, however open it looks', () => {
    expect(classPhase({ ...base, status: 'draft' })).toBeNull();
  });

  it('ignores a class that takes sign-ups by email or not at all', () => {
    // Lafayette's Pee-Wee listing says to email the coach — there is nothing
    // for the bar to link to.
    expect(classPhase({ ...base, registrationMode: 'email' })).toBeNull();
    expect(classPhase({ ...base, registrationMode: 'closed' })).toBeNull();
  });

  it('stops showing a class once it has begun', () => {
    // Deliberate: an already-running class is not news to its director.
    expect(classPhase({ ...base, startsIn: -1 })).toBeNull();
  });

  it('ignores a finished class', () => {
    expect(classPhase({ ...base, startsIn: -60, endsIn: -3 })).toBeNull();
  });

  it('respects a sign-up window that has not opened or has closed', () => {
    expect(classPhase({ ...base, registrationOpensIn: 5 })).toBeNull();
    expect(classPhase({ ...base, registrationClosesIn: -1 })).toBeNull();
    expect(classPhase({ ...base, registrationOpensIn: 0 })).toBe('signup');
  });
});

describe('compareItems', () => {
  const row = (
    phase: 'live' | 'signup',
    daysAway: number | null,
    kind: 'event' | 'league' | 'class',
  ) => ({ phase, daysAway, kind });

  it('puts what is underway before what is upcoming', () => {
    const live = row('live', 0, 'league');
    const soon = row('signup', 1, 'event');
    expect([soon, live].sort(compareItems)[0]).toBe(live);
  });

  it('sinks classes below events and leagues in the same phase', () => {
    // A sign-up window open for six weeks is never the most urgent row.
    const klass = row('signup', 2, 'class');
    const event = row('signup', 21, 'event');
    expect([klass, event].sort(compareItems)[0]).toBe(event);
  });

  it('orders like-for-like by soonest', () => {
    const far = row('signup', 21, 'event');
    const near = row('signup', 3, 'event');
    expect([far, near].sort(compareItems)[0]).toBe(near);
  });
});
