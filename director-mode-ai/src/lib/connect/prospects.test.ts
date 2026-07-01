import { describe, it, expect } from 'vitest';
import { findProspects, bandInsight } from './prospects';

// Manhattan-ish origin; there are plenty of Northeast clubs in the 990 set.
const NYC = { lat: 40.75, lng: -73.99 };

describe('findProspects', () => {
  it('only returns in-radius, in-budget directors of the right dept, nearest first', () => {
    const res = findProspects({
      dept: 'Golf',
      lat: NYC.lat,
      lng: NYC.lng,
      compMin: 120_000,
      compMax: 200_000,
      radiusMiles: 100,
    });
    expect(res.length).toBeGreaterThan(0);
    // budget: nobody above band top + 15% stretch
    for (const p of res) expect(p.comp).toBeLessThanOrEqual(200_000 * 1.15);
    // radius respected
    for (const p of res) expect(p.distanceMiles!).toBeLessThanOrEqual(100);
    // sorted by distance ascending
    for (let i = 1; i < res.length; i++) {
      expect(res[i].distanceMiles!).toBeGreaterThanOrEqual(res[i - 1].distanceMiles!);
    }
    // fit tags line up with the band
    for (const p of res) {
      if (p.comp <= 120_000) expect(p.fit).toBe('raise');
      else if (p.comp <= 200_000) expect(p.fit).toBe('in_band');
      else expect(p.fit).toBe('stretch');
    }
  });

  it('dedupes a person to a single (most-recent) row', () => {
    const res = findProspects({
      dept: 'GM', lat: NYC.lat, lng: NYC.lng, compMin: null, compMax: 500_000, radiusMiles: 500,
    });
    const keys = res.map((p) => `${p.name}|${p.club}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('respects the result cap', () => {
    const res = findProspects({
      dept: 'GM', lat: NYC.lat, lng: NYC.lng, compMin: null, compMax: 10_000_000, radiusMiles: 5000, limit: 10,
    });
    expect(res.length).toBeLessThanOrEqual(10);
  });
});

describe('bandInsight', () => {
  it('flags a very high band as top-of-market', () => {
    const i = bandInsight({ dept: 'Tennis/Racquets', region: 'Northeast', compMin: 200_000, compMax: 400_000, prospectCount: 5 });
    expect(i.verdict).toBe('strong');
    expect(i.median).toBeGreaterThan(0);
  });

  it('flags a low band as below market', () => {
    const i = bandInsight({ dept: 'Tennis/Racquets', region: null, compMin: 40_000, compMax: 60_000, prospectCount: 0 });
    expect(i.verdict).toBe('below');
    expect(i.detail).toMatch(/median/i);
  });
});
