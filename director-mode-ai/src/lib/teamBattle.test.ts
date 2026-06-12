import { describe, it, expect } from 'vitest';
import { snakeSplit, globalStrengthOrder, plusSevenDays, nextWeekCode } from './teamBattle';

describe('snakeSplit', () => {
  it('deals A,B,B,A so seeds balance', () => {
    const { a, b } = snakeSplit([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(a).toEqual([1, 4, 5, 8]);
    expect(b).toEqual([2, 3, 6, 7]);
  });

  it('puts the odd extra player opposite the #1 seed (week-1 shape: 11 → 5v6)', () => {
    const { a, b } = snakeSplit([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(a).toEqual([1, 4, 5, 8, 9]);
    expect(b).toEqual([2, 3, 6, 7, 10, 11]);
    expect(a.length).toBe(5);
    expect(b.length).toBe(6);
  });

  it('handles tiny pools', () => {
    expect(snakeSplit([1])).toEqual({ a: [1], b: [] });
    expect(snakeSplit([1, 2])).toEqual({ a: [1], b: [2] });
    expect(snakeSplit([] as number[])).toEqual({ a: [], b: [] });
  });
});

describe('globalStrengthOrder', () => {
  it('renumbers 1..N preserving relative order, nulls last', () => {
    const players = [
      { name: 'c', strength_order: 7 },
      { name: 'a', strength_order: 0 },
      { name: 'new', strength_order: null },
      { name: 'b', strength_order: 3 },
    ];
    const out = globalStrengthOrder(players);
    expect(out.map(x => x.player.name)).toEqual(['a', 'b', 'c', 'new']);
    expect(out.map(x => x.order)).toEqual([1, 2, 3, 4]);
  });
});

describe('weekly clone helpers', () => {
  it('plusSevenDays crosses month boundaries', () => {
    expect(plusSevenDays('2026-06-11')).toBe('2026-06-18');
    expect(plusSevenDays('2026-06-25')).toBe('2026-07-02');
  });

  it('nextWeekCode builds SLAM + day', () => {
    expect(nextWeekCode('SLAM', new Date('2026-06-18T12:00:00'))).toBe('SLAM18');
    expect(nextWeekCode('SLAM', new Date('2026-07-02T12:00:00'))).toBe('SLAM02');
  });
});
