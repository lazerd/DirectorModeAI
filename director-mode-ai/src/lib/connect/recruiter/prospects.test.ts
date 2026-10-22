import { describe, it, expect } from 'vitest';
import { rankProspects, people990, type CandidateRow, type Person990 } from './prospects';
import { policyEvaluation } from './evaluate';

// Bethesda, MD area (Congressional CC).
const JOB = { club_name: 'Congressional Country Club', club_ein: '11-1111111', club_revenue: 30_000_000, role_level: 'director', lat: 39.0, lng: -77.15 };
const profile = policyEvaluation({ dept: 'Tennis/Racquets', role_level: 'director', comp_max: 250_000, comp_min: null, est_comp: null });

const p = (o: Partial<Person990>): Person990 => ({
  club: 'Chevy Chase Club', ein: '22-2222222', state: 'MD', dept: 'Tennis/Racquets', title: 'Director of Tennis', name: 'Alex Pro',
  total: 180_000, revenue: 12_000_000, year: '2024', recent: true, lat: 38.97, lng: -77.08, ...o,
});
const cand = (o: Partial<CandidateRow>): CandidateRow => ({
  id: 'cand-1', full_name: 'Sam Open', email: 's@x.com', dept: 'Tennis/Racquets', headline: 'Director of Racquets', current_comp: 190_000,
  min_comp: null, home_lat: 39.05, home_lng: -77.1, radius_miles: 100, claimed_ein: null, open_to_work: true, ...o,
});

describe('rankProspects', () => {
  it('ranks step-up locals first and excludes the job’s own club (incumbent)', () => {
    const people = [
      p({}),
      p({ name: 'Far Away', ein: '33', club: 'Some Club', lat: 41.5, lng: -74.0 }), // ~240 mi
      p({ name: 'Incumbent', ein: '11-1111111', club: 'Congressional Country Club' }),
      p({ name: 'Too Rich', ein: '44', club: 'Big Club', total: 320_000 }),
    ];
    const r = rankProspects(JOB, profile, [], people);
    expect(r.map((x) => x.prospect_name)).toEqual(['Alex Pro', 'Far Away']);
    expect(r[0].tier).toBe('step_up');
    expect(r[0].fit_reason).toMatch(/72% of \$250k: a raise/);
    expect(r[0].fit_reason).toMatch(/stepping up from a smaller club/);
  });

  it('includes opted-in candidates and drops their own 990 duplicate', () => {
    const r = rankProspects(JOB, profile, [cand({ claimed_ein: '22-2222222', full_name: 'Alex Pro' })], [p({})]);
    expect(r).toHaveLength(1);
    expect(r[0].candidate_id).toBe('cand-1');
  });

  it('skips candidates who are not open to work or in another dept', () => {
    expect(rankProspects(JOB, profile, [cand({ open_to_work: false }), cand({ id: '2', dept: 'Golf' })], [])).toHaveLength(0);
  });

  it('caps at the limit', () => {
    const many = Array.from({ length: 40 }, (_, i) => p({ name: `P${i}`, ein: `e${i}`, club: `Club ${i}` }));
    expect(rankProspects(JOB, profile, [], many, 25)).toHaveLength(25);
  });
});

describe('people990', () => {
  it('keeps each person’s latest filing and drops old ones', () => {
    const rows = [p({ year: '2021', total: 150_000 }), p({ year: '2024', total: 175_000 }), p({ name: 'Old', ein: '9', year: '2019' })];
    const out = people990('Tennis/Racquets', 2022, rows);
    expect(out).toHaveLength(1);
    expect(out[0].total).toBe(175_000);
  });
});
