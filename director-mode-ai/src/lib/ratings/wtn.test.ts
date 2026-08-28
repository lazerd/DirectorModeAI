import { describe, it, expect } from 'vitest';
import {
  isValidWtn,
  doublesWtn,
  singlesWtn,
  formatWtn,
  byWtnStrongestFirst,
  pairWtn,
  MIN_WTN,
  MAX_WTN,
} from './wtn';

describe('isValidWtn', () => {
  it('accepts the published band', () => {
    expect(isValidWtn(MIN_WTN)).toBe(true);
    expect(isValidWtn(MAX_WTN)).toBe(true);
    expect(isValidWtn(18.4)).toBe(true);
  });

  it('rejects anything outside it', () => {
    // 0 is the dangerous one: on an inverted scale it reads as better than a
    // professional, so a missing number treated as 0 tops every list.
    expect(isValidWtn(0)).toBe(false);
    expect(isValidWtn(40.1)).toBe(false);
    expect(isValidWtn(-5)).toBe(false);
  });

  it('rejects what a bad parse produces', () => {
    expect(isValidWtn(NaN)).toBe(false);
    expect(isValidWtn(Infinity)).toBe(false);
    expect(isValidWtn(null)).toBe(false);
    expect(isValidWtn(undefined)).toBe(false);
    expect(isValidWtn('18.4')).toBe(false);
  });
});

describe('doublesWtn / singlesWtn', () => {
  it('prefers the doubles number on a doubles surface', () => {
    expect(doublesWtn({ wtn: 18.4, wtn_doubles: 17.9 })).toBe(17.9);
  });

  it('reads either spelling of the column', () => {
    expect(doublesWtn({ wtn: 18.4, wtnDoubles: 16.2 })).toBe(16.2);
  });

  it('falls back to singles when there is no doubles number', () => {
    expect(doublesWtn({ wtn: 18.4, wtn_doubles: null })).toBe(18.4);
  });

  it('ignores an out-of-band doubles number rather than trusting it', () => {
    expect(doublesWtn({ wtn: 18.4, wtn_doubles: 0 })).toBe(18.4);
  });

  it('is null when there is nothing usable', () => {
    expect(doublesWtn({ wtn: null, wtn_doubles: null })).toBeNull();
    expect(doublesWtn(null)).toBeNull();
    expect(singlesWtn({ wtn: null })).toBeNull();
  });

  it('singles never borrows the doubles number', () => {
    expect(singlesWtn({ wtn: null, wtn_doubles: 12.0 })).toBeNull();
  });
});

describe('formatWtn', () => {
  it('shows one decimal', () => {
    expect(formatWtn(18)).toBe('18.0');
    expect(formatWtn(17.94)).toBe('17.9');
  });
  it('shows a dash rather than a misleading zero', () => {
    expect(formatWtn(null)).toBe('—');
    expect(formatWtn(0)).toBe('—');
  });
});

describe('byWtnStrongestFirst', () => {
  const sort = <T extends { name: string; wtn: number | null }>(rows: T[]) =>
    [...rows].sort((a, b) => byWtnStrongestFirst(a, b)).map((r) => r.name);

  it('puts the LOWEST number first', () => {
    expect(
      sort([
        { name: 'Weak', wtn: 22 },
        { name: 'Strong', wtn: 11.5 },
        { name: 'Mid', wtn: 17 },
      ]),
    ).toEqual(['Strong', 'Mid', 'Weak']);
  });

  it('sinks players with no number to the bottom', () => {
    expect(
      sort([
        { name: 'Nonumber', wtn: null },
        { name: 'Has', wtn: 25 },
      ]),
    ).toEqual(['Has', 'Nonumber']);
  });

  it('is stable by name when two players tie', () => {
    expect(
      sort([
        { name: 'Beth', wtn: 15 },
        { name: 'Annie', wtn: 15 },
      ]),
    ).toEqual(['Annie', 'Beth']);
  });

  it('orders unnumbered players by name rather than arbitrarily', () => {
    expect(
      sort([
        { name: 'Zoe', wtn: null },
        { name: 'Adam', wtn: null },
      ]),
    ).toEqual(['Adam', 'Zoe']);
  });
});

describe('pairWtn', () => {
  it('averages the pair — how a doubles line gets its court', () => {
    expect(pairWtn({ wtn: 16 }, { wtn: 18 })).toBe(17);
  });

  it('uses each player&apos;s doubles number when they have one', () => {
    expect(pairWtn({ wtn: 20, wtn_doubles: 16 }, { wtn: 20, wtn_doubles: 18 })).toBe(17);
  });

  it('is null when either player has no number', () => {
    // Averaging against a blank would quietly promote whichever pair is missing
    // one, so a pair is either fully rankable or not rankable at all.
    expect(pairWtn({ wtn: 16 }, { wtn: null })).toBeNull();
    expect(pairWtn(null, { wtn: 16 })).toBeNull();
  });
});
