import { describe, it, expect } from 'vitest';
import {
  needsEvaluation,
  planClubTouch,
  radiusFor,
  scoreProspect,
  shouldPitchClub,
  sizeRelation,
  targetBands,
  targetCompFor,
  tierFor,
  EVALUATION_VERSION,
  MAX_TOUCHES,
  MIN_CONFIRMED_FOR_PITCH,
  type FollowUpInput,
} from './policy';

describe('targetBands', () => {
  it("Darrin's example: a $250k job looks for ~$180k directors (step-up band)", () => {
    const b = targetBands(250_000);
    expect(b.step_up).toEqual({ min: 150_000, max: 225_000 });
    expect(b.lateral).toEqual({ min: 225_000, max: 275_000 });
    expect(b.stretch).toEqual({ min: 112_500, max: 150_000 });
    expect(tierFor(180_000, b)).toBe('step_up');
    expect(b.maxRadiusMiles).toBe(250);
    expect(b.preferredMiles).toBe(50);
  });

  it('band edges: 60% is step-up, 90% is lateral, 110% lateral, above is out, below 45% is out', () => {
    const b = targetBands(100_000);
    expect(tierFor(60_000, b)).toBe('step_up');
    expect(tierFor(89_999, b)).toBe('step_up');
    expect(tierFor(90_000, b)).toBe('lateral');
    expect(tierFor(110_000, b)).toBe('lateral');
    expect(tierFor(110_001, b)).toBeNull();
    expect(tierFor(45_000, b)).toBe('stretch');
    expect(tierFor(44_999, b)).toBeNull();
  });

  it('radius scales with pay: 50 / 100 / 250 / national', () => {
    expect(radiusFor(95_000)).toBe(50);
    expect(radiusFor(119_999)).toBe(50);
    expect(radiusFor(120_000)).toBe(100);
    expect(radiusFor(179_999)).toBe(100);
    expect(radiusFor(180_000)).toBe(250);
    expect(radiusFor(299_999)).toBe(250);
    expect(radiusFor(300_000)).toBeNull();
    expect(targetBands(400_000).preferredMiles).toBe(50);
  });

  it('assistant roles stay local whatever the pay', () => {
    expect(radiusFor(400_000, 'assistant')).toBe(50);
    expect(radiusFor(150_000, 'assistant')).toBe(50);
  });

  it('target comp: posted max, then 990 estimate, then posted floor +20%', () => {
    expect(targetCompFor({ comp_max: 150_000, est_comp: 200_000 })).toEqual({ comp: 150_000, source: 'posted' });
    expect(targetCompFor({ comp_max: null, est_comp: 200_000 })).toEqual({ comp: 200_000, source: 'estimated' });
    expect(targetCompFor({ comp_min: 100_000 })).toEqual({ comp: 120_000, source: 'posted' });
    expect(targetCompFor({})).toEqual({ comp: null, source: 'none' });
  });
});

describe('scoreProspect', () => {
  const b = targetBands(250_000);
  const job = { revenue: 20_000_000, roleLevel: 'director' };
  const base = { comp: 180_000, distanceMiles: 20, revenue: 8_000_000, title: 'Director of Tennis', optedIn: false };

  it('the ideal prospect (step-up, local, smaller club, same title) scores high', () => {
    const s = scoreProspect(base, b, job)!;
    expect(s.tier).toBe('step_up');
    expect(s.size).toBe('smaller');
    expect(s.role).toBe('exact');
    expect(s.score).toBe(40 + 30 + 15 + 10);
  });

  it('step-up beats lateral beats stretch, all else equal', () => {
    const up = scoreProspect(base, b, job)!.score;
    const lat = scoreProspect({ ...base, comp: 250_000 }, b, job)!.score;
    const st = scoreProspect({ ...base, comp: 130_000 }, b, job)!.score;
    expect(up).toBeGreaterThan(lat);
    expect(lat).toBeGreaterThan(st);
  });

  it('distance decays past 50 miles and cuts off at the radius', () => {
    const near = scoreProspect(base, b, job)!.score;
    const far = scoreProspect({ ...base, distanceMiles: 200 }, b, job)!.score;
    expect(far).toBeLessThan(near);
    expect(scoreProspect({ ...base, distanceMiles: 251 }, b, job)).toBeNull();
  });

  it('out-of-band comp is not a prospect', () => {
    expect(scoreProspect({ ...base, comp: 300_000 }, b, job)).toBeNull();
    expect(scoreProspect({ ...base, comp: 90_000 }, b, job)).toBeNull();
  });

  it("respects an opted-in candidate's own radius and floor", () => {
    expect(scoreProspect({ ...base, optedIn: true, distanceMiles: 80, candidateRadius: 50 }, b, job)).toBeNull();
    expect(scoreProspect({ ...base, optedIn: true, candidateMinComp: 260_000 }, b, job)).toBeNull();
    const ok = scoreProspect({ ...base, optedIn: true, candidateRadius: 100 }, b, job)!;
    expect(ok.score).toBe(scoreProspect(base, b, job)!.score + 5);
  });

  it('club size relation', () => {
    expect(sizeRelation(8e6, 20e6)).toBe('smaller');
    expect(sizeRelation(20e6, 20e6)).toBe('peer');
    expect(sizeRelation(40e6, 20e6)).toBe('bigger');
    expect(sizeRelation(2e6, 20e6)).toBe('much_smaller');
    expect(sizeRelation(null, 20e6)).toBe('unknown');
  });
});

describe('needsEvaluation', () => {
  const now = new Date('2026-10-22T12:00:00Z');
  const fresh = { evaluation: { version: EVALUATION_VERSION, target_comp: 150_000 }, evaluated_at: '2026-10-20T00:00:00Z', comp_max: 150_000 };
  it('fresh → no; missing, stale, version bump, or comp changed → yes', () => {
    expect(needsEvaluation(fresh, now)).toBe(false);
    expect(needsEvaluation({ ...fresh, evaluation: null }, now)).toBe(true);
    expect(needsEvaluation({ ...fresh, evaluated_at: '2026-08-01T00:00:00Z' }, now)).toBe(true);
    expect(needsEvaluation({ ...fresh, evaluation: { version: 0, target_comp: 150_000 } }, now)).toBe(true);
    expect(needsEvaluation({ ...fresh, comp_max: 170_000 }, now)).toBe(true);
  });
});

describe('club pitch threshold', () => {
  it(`needs ${MIN_CONFIRMED_FOR_PITCH}+ confirmed interests`, () => {
    expect(MIN_CONFIRMED_FOR_PITCH).toBe(2);
    expect(shouldPitchClub(0)).toBe(false);
    expect(shouldPitchClub(1)).toBe(false);
    expect(shouldPitchClub(2)).toBe(true);
  });
});

describe('planClubTouch (weekly follow-ups, never a reminder)', () => {
  const now = new Date('2026-10-22T12:00:00Z');
  const base: FollowUpInput = {
    touchesSoFar: 0, lastContactedAt: null, now, doNotContact: false, replied: false, jobOpen: true,
    confirmedInterested: 2, newConfirmedSinceLast: 0, hasMemo: false, usedOffers: [],
  };
  const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();

  it('first touch is the intro', () => {
    expect(planClubTouch(base)).toEqual({ eligible: true, touch: 1, offers: ['intro'] });
  });
  it('no touch at all below the confirmed-interest threshold', () => {
    expect(planClubTouch({ ...base, confirmedInterested: 1 }).eligible).toBe(false);
  });
  it('stops on do-not-contact, reply, closed job, or max touches', () => {
    expect(planClubTouch({ ...base, doNotContact: true }).eligible).toBe(false);
    expect(planClubTouch({ ...base, replied: true }).eligible).toBe(false);
    expect(planClubTouch({ ...base, jobOpen: false }).eligible).toBe(false);
    expect(planClubTouch({ ...base, touchesSoFar: MAX_TOUCHES, newConfirmedSinceLast: 3 }).eligible).toBe(false);
  });
  it('waits 7+ days between touches', () => {
    expect(planClubTouch({ ...base, touchesSoFar: 1, lastContactedAt: daysAgo(6), newConfirmedSinceLast: 2 }).eligible).toBe(false);
    expect(planClubTouch({ ...base, touchesSoFar: 1, lastContactedAt: daysAgo(7), newConfirmedSinceLast: 2 })).toEqual({ eligible: true, touch: 2, offers: ['new_candidates'] });
  });
  it('with nothing new to offer, no follow-up is sent', () => {
    const p = planClubTouch({ ...base, touchesSoFar: 1, lastContactedAt: daysAgo(10) });
    expect(p.eligible).toBe(false);
  });
  it('the free comp memo is a one-time bigger offer', () => {
    expect(planClubTouch({ ...base, touchesSoFar: 1, lastContactedAt: daysAgo(10), hasMemo: true })).toEqual({ eligible: true, touch: 2, offers: ['comp_memo'] });
    expect(planClubTouch({ ...base, touchesSoFar: 2, lastContactedAt: daysAgo(10), hasMemo: true, usedOffers: ['intro', 'comp_memo'] }).eligible).toBe(false);
  });
});
