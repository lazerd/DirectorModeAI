import { describe, it, expect } from 'vitest';
import { findClubOpportunities } from './clubOpportunities';

const NYC = { lat: 40.75, lng: -73.99 };

describe('findClubOpportunities', () => {
  it('only returns clubs with real upside over the director’s comp, nearest first', () => {
    const res = findClubOpportunities({
      dept: 'Golf', currentComp: 120_000, lat: NYC.lat, lng: NYC.lng, radiusMiles: 150,
    });
    expect(res.length).toBeGreaterThan(0);
    for (const c of res) {
      expect(c.sizeExpected).toBeGreaterThanOrEqual(120_000 * 1.1);
      expect(c.upside).toBe(c.sizeExpected - 120_000);
      expect(c.distanceMiles!).toBeLessThanOrEqual(150);
    }
    for (let i = 1; i < res.length; i++) {
      expect(res[i].distanceMiles!).toBeGreaterThanOrEqual(res[i - 1].distanceMiles!);
    }
  });

  it('returns nothing when the director already out-earns nearby clubs’ size expectation', () => {
    const res = findClubOpportunities({
      dept: 'Golf', currentComp: 5_000_000, lat: NYC.lat, lng: NYC.lng, radiusMiles: 150,
    });
    expect(res.length).toBe(0);
  });

  it('respects the cap', () => {
    const res = findClubOpportunities({
      dept: 'GM', currentComp: 50_000, lat: NYC.lat, lng: NYC.lng, radiusMiles: 500, limit: 8,
    });
    expect(res.length).toBeLessThanOrEqual(8);
  });
});
