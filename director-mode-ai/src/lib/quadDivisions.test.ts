import { describe, it, expect } from 'vitest';
import {
  parseDivisions,
  ageOnDate,
  isEligibleForDivision,
  eligibleDivisions,
  planQuadAllocation,
  formatDeadline,
  computeQuadCapacity,
  waveForQuadIndex,
  quadsWaitlistCouldFill,
  playersNeededForNextQuad,
  type QuadDivision,
} from './quadDivisions';

const DIVISIONS: QuadDivision[] = [
  { id: '10u', label: '10 & Under', age_max: 10, sort: 0 },
  { id: '12u', label: '12 & Under', age_max: 12, sort: 1 },
  { id: '13o', label: '13 & Over', age_min: 13, sort: 2 },
];

describe('parseDivisions', () => {
  it('returns [] for legacy events with no divisions', () => {
    expect(parseDivisions(null)).toEqual([]);
    expect(parseDivisions(undefined)).toEqual([]);
    expect(parseDivisions('nope')).toEqual([]);
  });
  it('sorts by the sort key and drops malformed rows', () => {
    const out = parseDivisions([
      { id: 'b', label: 'B', sort: 1 },
      { id: 'a', label: 'A', sort: 0 },
      { label: 'no id', sort: 2 },
    ]);
    expect(out.map((d) => d.id)).toEqual(['a', 'b']);
  });
});

describe('ageOnDate', () => {
  it('counts whole years', () => {
    expect(ageOnDate(new Date('2014-05-01'), new Date('2026-10-03'))).toBe(12);
  });
  it('does not round up before the birthday', () => {
    expect(ageOnDate(new Date('2014-11-01'), new Date('2026-10-03'))).toBe(11);
  });
  it('counts the birthday itself', () => {
    expect(ageOnDate(new Date('2014-10-03'), new Date('2026-10-03'))).toBe(12);
  });
});

describe('isEligibleForDivision', () => {
  const [u10, u12, o13] = DIVISIONS;
  it('enforces the age ceiling', () => {
    expect(isEligibleForDivision(10, u10)).toBe(true);
    expect(isEligibleForDivision(11, u10)).toBe(false);
  });
  it('enforces the age floor', () => {
    expect(isEligibleForDivision(13, o13)).toBe(true);
    expect(isEligibleForDivision(12, o13)).toBe(false);
  });
  it('lets a young player play up', () => {
    expect(isEligibleForDivision(9, u12)).toBe(true);
  });
  it('offers a 9-year-old both junior divisions but not 13&O', () => {
    expect(eligibleDivisions(9, DIVISIONS).map((d) => d.id)).toEqual(['10u', '12u']);
  });
  it('offers an 11-year-old only 12U', () => {
    expect(eligibleDivisions(11, DIVISIONS).map((d) => d.id)).toEqual(['12u']);
  });
  it('offers every division when the age is unknown', () => {
    expect(eligibleDivisions(null, DIVISIONS)).toHaveLength(3);
  });
});

// --- allocation ------------------------------------------------------------

let clock = 0;
function entriesFor(division: string, n: number, prefix = division) {
  return Array.from({ length: n }, (_, i) => ({
    id: `${prefix}-${i + 1}`,
    division,
    registered_at: new Date(Date.UTC(2026, 8, 1, 0, 0, clock++)).toISOString(),
  }));
}

describe('planQuadAllocation', () => {
  it('gives each viable division one quad when all three fill', () => {
    clock = 0;
    const plan = planQuadAllocation({
      divisions: DIVISIONS,
      entries: [...entriesFor('10u', 4), ...entriesFor('12u', 4), ...entriesFor('13o', 4)],
      totalQuads: 3,
    });
    expect(plan.perDivision.map((d) => d.quads)).toEqual([1, 1, 1]);
    expect(plan.perDivision.every((d) => d.acceptedIds.length === 4)).toBe(true);
    expect(plan.unusedQuads).toBe(0);
  });

  it("reallocates a dead division's block — Darrin's 8/3 example", () => {
    clock = 0;
    const plan = planQuadAllocation({
      divisions: DIVISIONS,
      entries: [...entriesFor('10u', 8), ...entriesFor('12u', 3), ...entriesFor('13o', 4)],
      totalQuads: 3,
    });
    const byId = Object.fromEntries(plan.perDivision.map((d) => [d.divisionId, d]));
    expect(byId['10u'].quads).toBe(2);
    expect(byId['10u'].acceptedIds).toHaveLength(8);
    expect(byId['12u'].quads).toBe(0);
    expect(byId['12u'].viable).toBe(false);
    expect(byId['12u'].waitlistIds).toHaveLength(3);
    expect(byId['13o'].quads).toBe(1);
    expect(plan.unusedQuads).toBe(0);
  });

  it('waitlists the overflow in signup order', () => {
    clock = 0;
    const plan = planQuadAllocation({
      divisions: DIVISIONS,
      entries: [...entriesFor('10u', 7), ...entriesFor('12u', 4), ...entriesFor('13o', 4)],
      totalQuads: 3,
    });
    const u10 = plan.perDivision.find((d) => d.divisionId === '10u')!;
    // Only one 10U quad — the block is spoken for by 12U and 13&O.
    expect(u10.quads).toBe(1);
    expect(u10.acceptedIds).toEqual(['10u-1', '10u-2', '10u-3', '10u-4']);
    expect(u10.waitlistIds).toEqual(['10u-5', '10u-6', '10u-7']);
  });

  it('never seats a division that cannot field four', () => {
    clock = 0;
    const plan = planQuadAllocation({
      divisions: DIVISIONS,
      entries: [...entriesFor('10u', 3), ...entriesFor('12u', 2), ...entriesFor('13o', 1)],
      totalQuads: 3,
    });
    expect(plan.perDivision.every((d) => d.quads === 0)).toBe(true);
    expect(plan.perDivision.every((d) => d.acceptedIds.length === 0)).toBe(true);
    expect(plan.unusedQuads).toBe(3);
  });

  it('can hand every block to one division', () => {
    clock = 0;
    const plan = planQuadAllocation({
      divisions: DIVISIONS,
      entries: entriesFor('10u', 14),
      totalQuads: 3,
    });
    const u10 = plan.perDivision.find((d) => d.divisionId === '10u')!;
    expect(u10.quads).toBe(3);
    expect(u10.acceptedIds).toHaveLength(12);
    expect(u10.waitlistIds).toHaveLength(2);
    expect(plan.unusedQuads).toBe(0);
  });

  it('gives a spare block to whichever division has more waiting', () => {
    clock = 0;
    // 12U signs up first but 10U has more waiting once everyone is seated.
    const plan = planQuadAllocation({
      divisions: DIVISIONS,
      entries: [...entriesFor('12u', 9), ...entriesFor('10u', 12)],
      totalQuads: 3,
    });
    const byId = Object.fromEntries(plan.perDivision.map((d) => [d.divisionId, d]));
    // Step 1: 10u and 12u each take one. Spare: 10u has 8 waiting vs 12u's 5.
    expect(byId['10u'].quads).toBe(2);
    expect(byId['12u'].quads).toBe(1);
  });

  it('flags entries whose division is not on the event', () => {
    clock = 0;
    const plan = planQuadAllocation({
      divisions: DIVISIONS,
      entries: [
        ...entriesFor('10u', 4),
        { id: 'ghost', division: '18u', registered_at: new Date().toISOString() },
        { id: 'blank', division: null, registered_at: new Date().toISOString() },
      ],
      totalQuads: 3,
    });
    expect(plan.orphanIds.sort()).toEqual(['blank', 'ghost']);
  });

  it('respects a totalQuads of 0', () => {
    clock = 0;
    const plan = planQuadAllocation({
      divisions: DIVISIONS,
      entries: entriesFor('10u', 8),
      totalQuads: 0,
    });
    expect(plan.perDivision.every((d) => d.quads === 0)).toBe(true);
  });
});

describe('formatDeadline', () => {
  it('renders in Pacific time, not UTC', () => {
    // 2026-10-04T02:30:00Z is 7:30 PM Pacific on Oct 3.
    const out = formatDeadline('2026-10-04T02:30:00.000Z');
    expect(out).toContain('Oct 3');
    expect(out).toContain('7:30');
    expect(out).toContain('PDT');
  });
});

// --- stretch capacity + waves ----------------------------------------------

describe('computeQuadCapacity', () => {
  it('caps the ceiling at one wave when there is no second wave', () => {
    const c = computeQuadCapacity({ totalQuads: 3, maxTotalQuads: 6, numCourts: 6, hasWave2: false });
    expect(c.quadsPerWave).toBe(3);
    expect(c.maxQuads).toBe(3); // 6 can't fit without a second wave
    expect(c.canGrow).toBe(false);
    expect(c.wavesNeeded).toBe(1);
  });

  it('allows the full ceiling once a second wave exists', () => {
    const c = computeQuadCapacity({ totalQuads: 3, maxTotalQuads: 6, numCourts: 6, hasWave2: true });
    expect(c.maxQuads).toBe(6);
    expect(c.openSpots).toBe(12);
    expect(c.maxSpots).toBe(24);
    expect(c.canGrow).toBe(true);
    expect(c.wavesNeeded).toBe(2);
  });

  it('derives quads per wave from courts, two per quad', () => {
    expect(computeQuadCapacity({ totalQuads: 1, numCourts: 4, hasWave2: false }).quadsPerWave).toBe(2);
    expect(computeQuadCapacity({ totalQuads: 1, numCourts: 10, hasWave2: false }).quadsPerWave).toBe(5);
  });

  it('never reports a ceiling below what is already open', () => {
    const c = computeQuadCapacity({ totalQuads: 4, maxTotalQuads: 2, numCourts: 6, hasWave2: true });
    expect(c.maxQuads).toBe(4);
    expect(c.canGrow).toBe(false);
  });

  it('handles a missing ceiling as "no room to grow"', () => {
    const c = computeQuadCapacity({ totalQuads: 2, maxTotalQuads: null, numCourts: 4, hasWave2: false });
    expect(c.maxQuads).toBe(2);
    expect(c.canGrow).toBe(false);
  });
});

describe('waveForQuadIndex', () => {
  it('fills wave 1 before spilling into wave 2', () => {
    expect([0, 1, 2, 3, 4, 5].map((i) => waveForQuadIndex(i, 3))).toEqual([1, 1, 1, 2, 2, 2]);
  });
});

describe('waitlist -> extra quads', () => {
  it('counts only whole groups of four', () => {
    expect(quadsWaitlistCouldFill(0)).toBe(0);
    expect(quadsWaitlistCouldFill(3)).toBe(0);
    expect(quadsWaitlistCouldFill(4)).toBe(1);
    expect(quadsWaitlistCouldFill(9)).toBe(2);
  });
  it('says how many more players unlock the next quad', () => {
    expect(playersNeededForNextQuad(0)).toBe(4);
    expect(playersNeededForNextQuad(1)).toBe(3);
    expect(playersNeededForNextQuad(3)).toBe(1);
    expect(playersNeededForNextQuad(4)).toBe(0);
    expect(playersNeededForNextQuad(5)).toBe(3);
  });
});
