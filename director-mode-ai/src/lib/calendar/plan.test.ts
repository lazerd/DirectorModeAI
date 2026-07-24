import { describe, it, expect } from 'vitest';
import { buildYearPlan, freedom, summarizePlan } from './plan';
import { itemFromCatalog } from './promote';
import { catalogEntry } from './catalog';
import { daysApart } from './dates';
import type { CalendarConstraint, PlanItem, ScoreContext } from './types';

const YEAR = 2027;

function item(id: string, over: Partial<PlanItem> = {}): PlanItem {
  return {
    id,
    title: id,
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

/** Build a plan item straight from a catalog key, as the app does. */
function fromCatalog(key: string, id: string): PlanItem {
  const raw = itemFromCatalog(key, 'plan', 'club') as any;
  const c = catalogEntry(key)!;
  return item(id, {
    title: raw.title,
    catalog_key: key,
    department: raw.department,
    audience: raw.audience,
    anchor_rule: raw.anchor_rule,
    duration_minutes: raw.duration_minutes,
    courts_needed: raw.courts_needed,
    expected_attendance: raw.expected_attendance,
    expected_revenue_cents: raw.expected_revenue_cents,
    effort: c.effort,
    outdoor: c.outdoor,
    idealMonths: c.idealMonths,
  });
}

describe('freedom', () => {
  it('ranks an exact anchor as the most constrained', () => {
    expect(freedom(item('a', { anchor_rule: 'fixed:07-04' }), YEAR)).toBe(0);
  });

  it('ranks a windowed anchor tighter than a month preference', () => {
    const windowed = freedom(item('a', { anchor_rule: 'nearest:07-04:SAT' }), YEAR);
    const monthly = freedom(item('b', { idealMonths: [9, 10] }), YEAR);
    const floating = freedom(item('c'), YEAR);
    expect(windowed).toBeLessThan(monthly);
    expect(monthly).toBeLessThan(floating);
  });

  it('gives flagship events a head start over equally-free small ones', () => {
    expect(freedom(item('a', { effort: 'flagship' }), YEAR))
      .toBeLessThan(freedom(item('b', { effort: 'easy' }), YEAR));
  });
});

describe('buildYearPlan', () => {
  it('places every item when there is room', () => {
    const items = [item('a'), item('b'), item('c')];
    const r = buildYearPlan(items, ctx());
    expect(r.placements).toHaveLength(3);
    expect(r.unplaced).toHaveLength(0);
  });

  it('honours an exact anchor', () => {
    const items = [item('float1'), item('july4', { anchor_rule: 'fixed:07-04' }), item('float2')];
    const r = buildYearPlan(items, ctx());
    expect(r.placements.find((p) => p.itemId === 'july4')!.date).toBe('2027-07-04');
  });

  it('never double-books a date', () => {
    const items = Array.from({ length: 12 }, (_, i) => item(`e${i}`));
    const r = buildYearPlan(items, ctx());
    const dates = r.placements.map((p) => p.date);
    expect(new Set(dates).size).toBe(dates.length);
  });

  // Regression: two events anchored to the SAME holiday weekend both used to
  // land on that Saturday. The scorer only penalises a collision, and with a
  // four-day anchor window the greedy pass happily paid the penalty — so the
  // plan came back with "Pool Opening Party is already on this date" as the
  // stated reason for the second one.
  it('separates two events anchored to the same weekend', () => {
    const r = buildYearPlan(
      [
        item('pool', { title: 'Pool Opening Party', anchor_rule: 'holiday-weekend:memorial' }),
        item('kickoff', { title: 'Memorial Day Kickoff', anchor_rule: 'holiday-weekend:memorial' }),
      ],
      ctx(),
    );
    const dates = r.placements.map((p) => p.date);
    expect(r.placements).toHaveLength(2);
    expect(new Set(dates).size).toBe(2);
  });

  it('never explains a placement by pointing at a collision it caused', () => {
    const items = Array.from({ length: 16 }, (_, i) =>
      item(`e${i}`, { anchor_rule: i % 2 ? 'holiday-weekend:memorial' : 'month:5' }));
    const r = buildYearPlan(items, ctx());
    for (const p of r.placements) {
      for (const reason of p.reasons) {
        expect(reason.detail).not.toMatch(/already on this date/i);
      }
    }
  });

  it('spaces events out rather than clumping them', () => {
    const items = Array.from({ length: 8 }, (_, i) => item(`e${i}`));
    const r = buildYearPlan(items, ctx());
    const dates = r.placements.map((p) => p.date).sort();
    for (let i = 1; i < dates.length; i++) {
      expect(daysApart(dates[i - 1], dates[i])).toBeGreaterThanOrEqual(7);
    }
  });

  it('routes around a blocking constraint instead of failing', () => {
    const blocked: CalendarConstraint = {
      id: 'c', source: 'club', title: 'Golf Member-Guest',
      starts_on: '2027-09-01', ends_on: '2027-09-30', impact: 'blocking', audience_tags: [],
    };
    const items = [item('a', { idealMonths: [9, 10] })];
    const r = buildYearPlan(items, ctx({ constraints: [blocked] }));
    expect(r.unplaced).toHaveLength(0);
    expect(r.placements[0].date.slice(5, 7)).toBe('10');
  });

  it('reports an unplaceable event rather than dropping it silently', () => {
    const blockedAll: CalendarConstraint = {
      id: 'c', source: 'club', title: 'Courts under construction',
      starts_on: '2027-01-01', ends_on: '2027-12-31', impact: 'blocking', audience_tags: [],
    };
    const r = buildYearPlan([item('a')], ctx({ constraints: [blockedAll] }));
    expect(r.placements).toHaveLength(0);
    expect(r.unplaced).toHaveLength(1);
    expect(r.unplaced[0].itemId).toBe('a');
    expect(r.unplaced[0].reason).toContain('Courts under construction');
  });

  it('treats already-dated items as fixed context', () => {
    const fixed = item('fixed', { target_date: '2027-10-16' });
    const r = buildYearPlan([fixed, item('new')], ctx());
    // The fixed item is not re-placed...
    expect(r.placements.find((p) => p.itemId === 'fixed')).toBeUndefined();
    // ...but the new one respects it.
    expect(r.placements.find((p) => p.itemId === 'new')!.date).not.toBe('2027-10-16');
  });

  it('respects notBefore so a mid-year plan never schedules into the past', () => {
    const r = buildYearPlan(
      Array.from({ length: 5 }, (_, i) => item(`e${i}`)),
      ctx({ notBefore: '2027-08-01' }),
    );
    for (const p of r.placements) expect(p.date >= '2027-08-01').toBe(true);
  });

  it('is deterministic', () => {
    const mk = () => [item('a', { anchor_rule: 'nearest:07-04:SAT' }), item('b'), item('c', { idealMonths: [10] })];
    const first = buildYearPlan(mk(), ctx()).placements;
    const second = buildYearPlan(mk(), ctx()).placements;
    expect(first).toEqual(second);
  });

  it('attaches an explanation to every placement', () => {
    const r = buildYearPlan([item('a'), item('b')], ctx());
    for (const p of r.placements) {
      expect(p.reasons.length).toBeGreaterThan(0);
      expect(p.reasons.every((x) => x.detail.length > 0)).toBe(true);
    }
  });
});

// A realistic Sleepy Hollow year: a swim & tennis club in coastal California
// with a JTT season, camp weeks, and a school calendar to work around.
describe('a realistic club year', () => {
  const constraints: CalendarConstraint[] = [
    { id: 's1', source: 'school', title: 'Spring break', starts_on: '2027-03-27', ends_on: '2027-04-04', impact: 'favorable', audience_tags: ['family', 'junior'] },
    { id: 's2', source: 'school', title: 'First day of school', starts_on: '2027-08-16', ends_on: '2027-08-16', impact: 'heavy', audience_tags: ['junior', 'family'] },
    { id: 'c1', source: 'clubmode', title: 'JTT home match day', starts_on: '2027-06-12', ends_on: '2027-06-12', impact: 'blocking', audience_tags: [] },
    { id: 'c2', source: 'clubmode', title: 'JTT home match day', starts_on: '2027-06-26', ends_on: '2027-06-26', impact: 'blocking', audience_tags: [] },
    { id: 'c3', source: 'club', title: 'Junior camp week 1', starts_on: '2027-06-14', ends_on: '2027-06-18', impact: 'heavy', audience_tags: ['junior'] },
  ];

  const items = [
    fromCatalog('stars-and-stripes-rr', 'july4'),
    fromCatalog('wimbledon-mixer', 'wimbledon'),
    fromCatalog('memorial-day-kickoff', 'memorial'),
    fromCatalog('labor-day-finale', 'labor'),
    fromCatalog('calcutta', 'calcutta'),
    fromCatalog('member-guest', 'memberguest'),
    fromCatalog('parent-child-doubles', 'parentchild'),
    fromCatalog('halloween-monster-bash', 'halloween'),
    fromCatalog('turkey-shoot', 'turkey'),
    fromCatalog('ladies-day-out', 'ladies'),
    fromCatalog('cinco-de-mayo-fiesta', 'cinco'),
    fromCatalog('end-of-summer-carnival', 'carnival'),
  ];

  const result = buildYearPlan(
    items,
    ctx({
      constraints,
      climateRegion: 'california-coastal',
      goals: { events_per_month: 2, min_days_between: 10 },
    }),
  );

  it('places the whole slate', () => {
    expect(result.unplaced).toHaveLength(0);
    expect(result.placements).toHaveLength(items.length);
  });

  it('puts the July 4th event on the 4th of July weekend', () => {
    const d = result.placements.find((p) => p.itemId === 'july4')!.date;
    expect(daysApart(d, '2027-07-04')).toBeLessThanOrEqual(3);
  });

  it('keeps the seasonal events in their seasons', () => {
    const by = Object.fromEntries(result.placements.map((p) => [p.itemId, p.date]));
    expect(by.halloween.slice(5, 7)).toBe('10');
    expect(by.turkey.slice(5, 7)).toBe('11');
    expect(by.cinco.slice(5, 7)).toBe('05');
    expect(['05', '06']).toContain(by.memorial.slice(5, 7));
    expect(['08', '09']).toContain(by.labor.slice(5, 7));
  });

  it('never lands on a blocked JTT match day', () => {
    const dates = result.placements.map((p) => p.date);
    expect(dates).not.toContain('2027-06-12');
    expect(dates).not.toContain('2027-06-26');
  });

  it('does not put two flagship events on adjacent weekends', () => {
    const flagships = result.placements
      .filter((p) => items.find((i) => i.id === p.itemId)?.effort === 'flagship')
      .map((p) => p.date)
      .sort();
    for (let i = 1; i < flagships.length; i++) {
      expect(daysApart(flagships[i - 1], flagships[i])).toBeGreaterThan(10);
    }
  });

  it('spreads across the year rather than bunching in the summer', () => {
    const months = new Set(result.placements.map((p) => p.date.slice(5, 7)));
    expect(months.size).toBeGreaterThanOrEqual(6);
  });
});

describe('summarizePlan', () => {
  const items = [
    item('a', { target_date: '2027-03-20', department: 'tennis', expected_revenue_cents: 100000 }),
    item('b', { target_date: '2027-07-03', department: 'swim', expected_revenue_cents: 250000, effort: 'flagship' }),
    item('c', { target_date: '2027-07-17', department: 'tennis', expected_revenue_cents: 50000 }),
    item('d', { target_date: null }),
    item('e', { target_date: '2027-09-11', status: 'dropped' }),
  ];

  const s = summarizePlan(items);

  it('counts only dated, live items', () => {
    expect(s.total).toBe(3);
  });

  it('totals projected revenue', () => {
    expect(s.projectedRevenueCents).toBe(400000);
  });

  it('breaks down by month and department', () => {
    expect(s.byMonth[6]).toBe(2); // July
    expect(s.byMonth[2]).toBe(1); // March
    expect(s.byDepartment.tennis).toBe(2);
    expect(s.byDepartment.swim).toBe(1);
  });

  it('surfaces the empty months a director should notice', () => {
    expect(s.emptyMonths).toContain(1);
    expect(s.emptyMonths).not.toContain(7);
  });

  it('counts flagship events', () => {
    expect(s.flagshipCount).toBe(1);
  });
});
