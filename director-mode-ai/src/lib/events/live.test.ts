import { describe, it, expect } from 'vitest';
import { compareLive, daysUntil, isStaleRunning, livePhase, type Candidate } from './live';

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
