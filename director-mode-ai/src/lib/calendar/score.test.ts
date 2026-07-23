import { describe, it, expect } from 'vitest';
import { scoreSlot, rankSlots, recommendDates } from './score';
import { generateSlots } from './slots';
import type { CalendarConstraint, PlanItem, ScoreContext, Slot } from './types';

const YEAR = 2027;

function item(over: Partial<PlanItem> = {}): PlanItem {
  return {
    id: 'i1',
    title: 'Test Event',
    catalog_key: null,
    department: 'tennis',
    audience: ['adult'],
    anchor_rule: null,
    target_date: null,
    target_end_date: null,
    duration_minutes: 180,
    courts_needed: 6,
    staff_needed: 2,
    expected_attendance: 32,
    expected_revenue_cents: 100000,
    effort: 'medium',
    outdoor: true,
    idealMonths: [],
    status: 'idea',
    ...over,
  };
}

function ctx(over: Partial<ScoreContext> = {}): ScoreContext {
  return { year: YEAR, climateRegion: null, constraints: [], placed: [], ...over };
}

function slot(date: string): Slot {
  const all = generateSlots(YEAR, { daysOfWeek: [0, 1, 2, 3, 4, 5, 6] });
  const found = all.find((s) => s.date === date);
  if (!found) throw new Error(`no slot for ${date}`);
  return found;
}

describe('day of week', () => {
  it('prefers Saturday over Sunday over a weekday', () => {
    const c = ctx();
    const sat = scoreSlot(item(), slot('2027-10-16'), c).score;
    const sun = scoreSlot(item(), slot('2027-10-17'), c).score;
    const wed = scoreSlot(item(), slot('2027-10-13'), c).score;
    expect(sat).toBeGreaterThan(sun);
    expect(sun).toBeGreaterThan(wed);
  });
});

describe('anchors', () => {
  it('rewards an exact anchor and punishes any other date', () => {
    const july4 = item({ anchor_rule: 'fixed:07-04' });
    const on = scoreSlot(july4, slot('2027-07-04'), ctx());
    const off = scoreSlot(july4, slot('2027-07-11'), ctx());
    expect(on.score).toBeGreaterThan(off.score + 50);
    expect(on.reasons.some((r) => r.code === 'anchor' && r.points > 0)).toBe(true);
  });

  it('decays a window anchor with distance rather than cliff-edging', () => {
    const it0 = item({ anchor_rule: 'nearest:07-04:SAT' });
    const exact = scoreSlot(it0, slot('2027-07-03'), ctx()).score;
    const near = scoreSlot(it0, slot('2027-07-10'), ctx()).score;
    const far = scoreSlot(it0, slot('2027-08-21'), ctx()).score;
    expect(exact).toBeGreaterThan(near);
    expect(near).toBeGreaterThan(far);
  });
});

describe('constraints', () => {
  const blocking: CalendarConstraint = {
    id: 'c1', source: 'club', title: 'Golf Member-Guest',
    starts_on: '2027-10-16', ends_on: '2027-10-17', impact: 'blocking', audience_tags: [],
  };

  it('blocks a date outright', () => {
    const r = scoreSlot(item(), slot('2027-10-16'), ctx({ constraints: [blocking] }));
    expect(r.blocked).toBe(true);
    expect(r.reasons.some((x) => x.code === 'blocked')).toBe(true);
  });

  it('leaves neighbouring dates alone', () => {
    const r = scoreSlot(item(), slot('2027-10-23'), ctx({ constraints: [blocking] }));
    expect(r.blocked).toBe(false);
  });

  it('penalises a heavy conflict harder when it competes for the same audience', () => {
    const juniorHeavy: CalendarConstraint = {
      id: 'c2', source: 'school', title: 'High school finals',
      starts_on: '2027-06-05', ends_on: '2027-06-05', impact: 'heavy', audience_tags: ['junior'],
    };
    const c = ctx({ constraints: [juniorHeavy] });
    const junior = scoreSlot(item({ audience: ['junior'] }), slot('2027-06-05'), c).score;
    const adult = scoreSlot(item({ audience: ['adult'] }), slot('2027-06-05'), c).score;
    expect(junior).toBeLessThan(adult);
  });

  // Spring break is the canonical case for signed impact: bad for junior
  // programmes, good for family events.
  it('treats a favorable constraint as a bonus for the matching audience', () => {
    const springBreak: CalendarConstraint = {
      id: 'c3', source: 'school', title: 'Spring break',
      starts_on: '2027-03-27', ends_on: '2027-04-04', impact: 'favorable', audience_tags: ['family'],
    };
    const c = ctx({ constraints: [springBreak] });
    const withBreak = scoreSlot(item({ audience: ['family'] }), slot('2027-04-03'), c).score;
    const without = scoreSlot(item({ audience: ['family'] }), slot('2027-04-03'), ctx()).score;
    expect(withBreak).toBeGreaterThan(without);
  });
});

describe('holiday travel', () => {
  it('penalises Thanksgiving weekend for an unanchored event', () => {
    const c = ctx();
    const thanksgivingSat = scoreSlot(item(), slot('2027-11-27'), c);
    const ordinarySat = scoreSlot(item(), slot('2027-11-13'), c);
    expect(thanksgivingSat.score).toBeLessThan(ordinarySat.score);
    expect(thanksgivingSat.reasons.some((r) => r.code === 'holiday' && r.points < 0)).toBe(true);
  });

  it('does not penalise an event that anchored there deliberately', () => {
    const anchored = item({ anchor_rule: 'holiday-weekend:memorial' });
    const r = scoreSlot(anchored, slot('2027-05-29'), ctx());
    expect(r.reasons.some((x) => x.code === 'holiday' && x.points < 0)).toBe(false);
  });
});

describe('cadence and audience fatigue', () => {
  it('refuses to stack two events on the same date', () => {
    const other = item({ id: 'other', title: 'Ladies Day', target_date: '2027-10-16' });
    const r = scoreSlot(item(), slot('2027-10-16'), ctx({ placed: [other] }));
    expect(r.reasons.some((x) => x.code === 'cadence' && x.points <= -40)).toBe(true);
  });

  it('penalises events crowded within the minimum gap', () => {
    const other = item({ id: 'other', title: 'Ladies Day', target_date: '2027-10-16' });
    const c = ctx({ placed: [other] });
    const close = scoreSlot(item(), slot('2027-10-20'), c).score;
    const spaced = scoreSlot(item(), slot('2027-11-13'), c).score;
    expect(close).toBeLessThan(spaced);
  });

  it('flags asking the same audience twice inside three weeks', () => {
    const ladies = item({ id: 'l', title: 'Ladies Day', audience: ['ladies'], target_date: '2027-10-02' });
    const r = scoreSlot(item({ audience: ['ladies'] }), slot('2027-10-16'), ctx({ placed: [ladies] }));
    expect(r.reasons.some((x) => x.code === 'audience' && x.points < 0)).toBe(true);
  });

  it('does not flag a different audience', () => {
    const ladies = item({ id: 'l', title: 'Ladies Day', audience: ['ladies'], target_date: '2027-10-02' });
    const r = scoreSlot(item({ audience: ['men'] }), slot('2027-10-16'), ctx({ placed: [ladies] }));
    expect(r.reasons.some((x) => x.code === 'audience')).toBe(false);
  });
});

describe('staff load', () => {
  it('warns when two flagship events land on adjacent weekends', () => {
    const big = item({ id: 'b', title: 'Member-Guest', effort: 'flagship', target_date: '2027-09-11' });
    const r = scoreSlot(item({ effort: 'flagship' }), slot('2027-09-18'), ctx({ placed: [big] }));
    expect(r.reasons.some((x) => x.code === 'staff' && x.points < 0)).toBe(true);
  });

  it('leaves small events alone', () => {
    const big = item({ id: 'b', title: 'Member-Guest', effort: 'flagship', target_date: '2027-09-11' });
    const r = scoreSlot(item({ effort: 'easy' }), slot('2027-09-18'), ctx({ placed: [big] }));
    expect(r.reasons.some((x) => x.code === 'staff')).toBe(false);
  });
});

describe('courts', () => {
  it('blocks when every court is taken', () => {
    const c = ctx({ courtLoad: { '2027-10-16': { total: 8, busy: 8 } } });
    expect(scoreSlot(item({ courts_needed: 6 }), slot('2027-10-16'), c).blocked).toBe(true);
  });

  it('penalises when there are not enough free courts', () => {
    const c = ctx({ courtLoad: { '2027-10-16': { total: 8, busy: 5 } } });
    const r = scoreSlot(item({ courts_needed: 6 }), slot('2027-10-16'), c);
    expect(r.blocked).toBe(false);
    expect(r.reasons.some((x) => x.code === 'courts' && x.points < 0)).toBe(true);
  });
});

describe('climate', () => {
  it('prefers October to January for an outdoor event in the Northeast', () => {
    const c = ctx({ climateRegion: 'northeast' });
    const oct = scoreSlot(item(), slot('2027-10-16'), c).score;
    const jan = scoreSlot(item(), slot('2027-01-16'), c).score;
    expect(oct).toBeGreaterThan(jan);
  });

  it('ignores weather entirely for an indoor event', () => {
    const c = ctx({ climateRegion: 'northeast' });
    const r = scoreSlot(item({ outdoor: false }), slot('2027-01-16'), c);
    expect(r.reasons.some((x) => x.code === 'climate')).toBe(false);
  });

  it('inverts for the desert — January beats July', () => {
    const c = ctx({ climateRegion: 'southwest-desert' });
    const jan = scoreSlot(item(), slot('2027-01-16'), c).score;
    const jul = scoreSlot(item(), slot('2027-07-17'), c).score;
    expect(jan).toBeGreaterThan(jul);
  });
});

describe('season windows', () => {
  it('penalises dates outside the club season', () => {
    const c = ctx({ seasonWindows: [{ label: 'Outdoor season', start: '04-01', end: '10-31' }] });
    const inSeason = scoreSlot(item(), slot('2027-06-19'), c).score;
    const out = scoreSlot(item(), slot('2027-12-18'), c).score;
    expect(out).toBeLessThan(inSeason);
  });

  it('handles a window that wraps the new year', () => {
    const c = ctx({ seasonWindows: [{ label: 'Indoor', start: '11-01', end: '03-31' }] });
    const r = scoreSlot(item(), slot('2027-01-16'), c);
    expect(r.reasons.some((x) => x.code === 'season' && x.points < 0)).toBe(false);
  });
});

describe('ranking', () => {
  const slots = generateSlots(YEAR);

  it('sorts blocked slots to the bottom', () => {
    const blocked: CalendarConstraint = {
      id: 'c', source: 'club', title: 'Course closed',
      starts_on: '2027-01-01', ends_on: '2027-06-30', impact: 'blocking', audience_tags: [],
    };
    const ranked = rankSlots(item(), slots, ctx({ constraints: [blocked] }));
    const firstBlocked = ranked.findIndex((r) => r.blocked);
    const lastOpen = ranked.map((r) => r.blocked).lastIndexOf(false);
    expect(lastOpen).toBeLessThan(firstBlocked);
  });

  it('recommends the anchor date first for an anchored event', () => {
    const july4 = item({ anchor_rule: 'nearest:07-04:SAT' });
    const [best] = recommendDates(july4, slots, ctx(), 3);
    expect(best.date).toBe('2027-07-03');
  });

  it('always returns something to explain, even when everything is blocked', () => {
    const blocked: CalendarConstraint = {
      id: 'c', source: 'club', title: 'Closed all year',
      starts_on: '2027-01-01', ends_on: '2027-12-31', impact: 'blocking', audience_tags: [],
    };
    const recs = recommendDates(item(), slots, ctx({ constraints: [blocked] }), 3);
    expect(recs.length).toBe(3);
    expect(recs.every((r) => r.blocked)).toBe(true);
  });

  it('is deterministic — the same inputs give the same answer', () => {
    const a = recommendDates(item(), slots, ctx(), 5).map((r) => r.date);
    const b = recommendDates(item(), slots, ctx(), 5).map((r) => r.date);
    expect(a).toEqual(b);
  });
});

describe('explanations', () => {
  it('always attaches at least one reason', () => {
    const r = scoreSlot(item(), slot('2027-10-16'), ctx());
    expect(r.reasons.length).toBeGreaterThan(0);
    expect(r.reasons.every((x) => typeof x.detail === 'string' && x.detail.length > 0)).toBe(true);
  });

  it('orders reasons by magnitude so the headline comes first', () => {
    const r = scoreSlot(item({ anchor_rule: 'fixed:07-04' }), slot('2027-07-04'), ctx());
    const mags = r.reasons.map((x) => Math.abs(x.points));
    expect([...mags].sort((a, b) => b - a)).toEqual(mags);
  });
});
