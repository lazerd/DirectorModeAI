import { describe, expect, it } from 'vitest';
import { clubNameScore, estimateComp, matchClub990, type Row990 } from './match990';

const row = (o: Partial<Row990>): Row990 => ({ club: 'X', ein: '1', state: 'NY', dept: 'Tennis/Racquets', total: 100000, revenue: 10_000_000, recent: true, year: '2024', ...o });

describe('clubNameScore', () => {
  it('matches 990 legal names to posting names', () => {
    expect(clubNameScore('Waccabuc Country Club', 'WACCABUC COUNTRY CLUB INC')).toBeGreaterThan(0.9);
    expect(clubNameScore('Cascades CC', 'The Cascades Country Club')).toBeGreaterThan(0.85);
    expect(clubNameScore('Jupiter Ocean & Racquet Club', 'Jupiter Ocean and Racquet Club Inc')).toBeGreaterThan(0.85);
  });
  it('rejects near-misses seen in real data', () => {
    expect(clubNameScore('Madison Racquet & Swim Club', 'MADISON COUNTRY CLUB INC')).toBeLessThan(0.72);
    expect(clubNameScore('Epping Forest Yacht and Country Club', 'THE FOREST COUNTRY CLUB INC')).toBe(0);
    expect(clubNameScore('Coveleigh Beach and Tennis Club', 'COVELEIGH CLUB INC')).toBeGreaterThanOrEqual(0.72);
    expect(clubNameScore('Waccabuc Country Club', 'WACCABUC COUNTRY CLUB COMPANY')).toBeGreaterThan(0.9);
  });
  it('needs a distinctive shared word', () => {
    expect(clubNameScore('Oak Hills Country Club', 'Pine Hills Country Club')).toBeLessThan(0.72);
    expect(clubNameScore('Country Club', 'The Country Club')).toBe(0);
  });
});

describe('matchClub990', () => {
  const rows = [
    row({ club: 'WACCABUC COUNTRY CLUB INC', ein: '11', state: 'NY', revenue: 8_000_000, year: '2023' }),
    row({ club: 'WACCABUC COUNTRY CLUB INC', ein: '11', state: 'NY', revenue: 9_000_000, year: '2024' }),
    row({ club: 'Waccabuc Country Club', ein: '22', state: 'CT' }),
  ];
  it('same state only, latest filing revenue', () => {
    const m = matchClub990(rows, 'Waccabuc Country Club', 'NY');
    expect(m?.ein).toBe('11');
    expect(m?.revenue).toBe(9_000_000);
    expect(matchClub990(rows, 'Waccabuc Country Club', 'FL')).toBeNull();
  });
});

describe('estimateComp', () => {
  const peers = [80, 90, 100, 110, 120, 130].map((k, i) => row({ ein: String(i), total: k * 1000, revenue: 10_000_000 }));
  const big = [200, 210, 220, 230, 240].map((k, i) => row({ ein: `b${i}`, total: k * 1000, revenue: 60_000_000 }));
  const rows = [...peers, ...big, row({ dept: 'GM', total: 999000 })];
  it('median of similar-revenue Tennis/Racquets peers', () => {
    expect(estimateComp(rows, { revenue: 12_000_000, state: null, roleLevel: 'director' })).toBe(110000);
    expect(estimateComp(rows, { revenue: 50_000_000, state: null, roleLevel: 'director' })).toBe(220000);
  });
  it('directors only — none for head pros, assistants or GMs', () => {
    expect(estimateComp(rows, { revenue: 12_000_000, state: null, roleLevel: 'assistant' })).toBeNull();
    expect(estimateComp(rows, { revenue: 12_000_000, state: null, roleLevel: 'head_pro' })).toBeNull();
    expect(estimateComp(rows, { revenue: 12_000_000, state: null, roleLevel: 'gm' })).toBeNull();
  });
  it('falls back to national median without revenue; null with no data', () => {
    expect(estimateComp(rows, { revenue: null, state: 'ZZ', roleLevel: 'director' })).toBe(130000);
    expect(estimateComp([], { revenue: null, state: null, roleLevel: 'director' })).toBeNull();
  });
});
