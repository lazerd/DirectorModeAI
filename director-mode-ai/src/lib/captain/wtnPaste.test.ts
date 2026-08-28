import { describe, it, expect } from 'vitest';
import {
  parseWtnLine,
  parseWtnBlock,
  resolveWtn,
  rankByWtn,
  doublesWtnOf,
} from './wtnPaste';

const roster = [
  { id: 'a', name: 'Leena Elias', wtn: null, wtn_doubles: null },
  { id: 'b', name: 'Shannon Moore', wtn: 16.2, wtn_doubles: null },
  { id: 'c', name: 'Paula Garcia', wtn: null, wtn_doubles: null },
];

describe('parseWtnLine', () => {
  it('reads a name and a single WTN', () => {
    const r = parseWtnLine('Leena Elias\t18.4');
    expect(r).toEqual({ kind: 'parsed', value: { name: 'Leena Elias', wtn: 18.4, wtnDoubles: null } });
  });

  it('reads two numbers as singles then doubles', () => {
    const r = parseWtnLine('Leena Elias\t18.4\t17.9');
    expect(r).toEqual({
      kind: 'parsed',
      value: { name: 'Leena Elias', wtn: 18.4, wtnDoubles: 17.9 },
    });
  });

  it('handles "Last, First"', () => {
    const r = parseWtnLine('Moore, Shannon  16.2');
    expect(r.kind).toBe('parsed');
    if (r.kind === 'parsed') expect(r.value.name).toBe('Moore, Shannon');
  });

  it('accepts a whole number', () => {
    const r = parseWtnLine('Paula Garcia 19');
    expect(r.kind).toBe('parsed');
    if (r.kind === 'parsed') expect(r.value.wtn).toBe(19);
  });

  it('ignores a parenthetical tag when hunting for the number', () => {
    const r = parseWtnLine('Paula Garcia (3.5C)  19.7  19.1');
    expect(r.kind).toBe('parsed');
    if (r.kind === 'parsed') {
      expect(r.value.name).toBe('Paula Garcia');
      expect(r.value.wtn).toBe(19.7);
      expect(r.value.wtnDoubles).toBe(19.1);
    }
  });

  it('refuses a line whose only numbers look like NTRP ratings', () => {
    // The trap this exists for: pasting a TennisRecord block into the WTN box.
    // Writing 3.42 as a WTN would rank her near-professional and invert the
    // whole line order, so the line is reported instead of imported.
    expect(parseWtnLine('Paula Garcia\t3.42\t8-4').kind).toBe('ntrp');
    expect(parseWtnLine('Moore, Shannon\t3.5').kind).toBe('ntrp');
  });

  it('ignores a line with no name or no number', () => {
    expect(parseWtnLine('World Tennis Number').kind).toBe('ignored');
    expect(parseWtnLine('18.4').kind).toBe('ignored');
    expect(parseWtnLine('').kind).toBe('ignored');
  });

  it('ignores a one-word name — it cannot be matched with confidence', () => {
    expect(parseWtnLine('Leena 18.4').kind).toBe('ignored');
  });

  it('skips a number outside the published 1–40 band', () => {
    // A match count or a year is not a WTN.
    const r = parseWtnLine('Leena Elias\t2026\t18.4');
    expect(r.kind).toBe('parsed');
    if (r.kind === 'parsed') {
      expect(r.value.wtn).toBe(18.4);
      expect(r.value.wtnDoubles).toBeNull();
    }
  });
});

describe('parseWtnBlock', () => {
  it('separates parsed, ignored and NTRP-looking lines', () => {
    const { parsed, ignored, ntrpLooking } = parseWtnBlock(
      ['Leena Elias\t18.4', 'Player  Rating', 'Paula Garcia\t3.42'].join('\n'),
    );
    expect(parsed).toHaveLength(1);
    expect(ignored).toEqual(['Player  Rating']);
    expect(ntrpLooking).toEqual(['Paula Garcia\t3.42']);
  });
});

describe('resolveWtn', () => {
  it('matches on an exact name and reports the previous value', () => {
    const { parsed } = parseWtnBlock('Shannon Moore\t15.8\t15.1');
    const res = resolveWtn(parsed, roster);
    expect(res.matched).toHaveLength(1);
    expect(res.matched[0]).toMatchObject({
      playerId: 'b',
      wtn: 15.8,
      wtnDoubles: 15.1,
      previousWtn: 16.2,
      matchedOn: 'exact',
    });
  });

  it('matches a reversed name', () => {
    const { parsed } = parseWtnBlock('Elias, Leena\t18.4');
    const res = resolveWtn(parsed, roster);
    expect(res.matched[0].playerId).toBe('a');
  });

  it('reports a name that is not on the roster instead of guessing', () => {
    const { parsed } = parseWtnBlock('Someone Else\t12.0');
    const res = resolveWtn(parsed, roster);
    expect(res.matched).toHaveLength(0);
    expect(res.unmatched.map((u) => u.name)).toEqual(['Someone Else']);
  });

  it('never gives two roster players the same pasted number', () => {
    const twoSmiths = [
      { id: 'x', name: 'Jane Smith', wtn: null, wtn_doubles: null },
      { id: 'y', name: 'Julie Smith', wtn: null, wtn_doubles: null },
    ];
    const { parsed } = parseWtnBlock('J. Smith\t14.0');
    const res = resolveWtn(parsed, twoSmiths);
    expect(res.matched).toHaveLength(0);
    expect(res.ambiguous).toHaveLength(1);
    expect(res.ambiguous[0].candidates.sort()).toEqual(['Jane Smith', 'Julie Smith']);
  });
});

describe('doublesWtnOf', () => {
  it('prefers the doubles number', () => {
    expect(doublesWtnOf({ wtn: 18.4, wtnDoubles: 17.9 })).toBe(17.9);
  });
  it('falls back to singles', () => {
    expect(doublesWtnOf({ wtn: 18.4, wtnDoubles: null })).toBe(18.4);
  });
  it('is null when there is neither', () => {
    expect(doublesWtnOf({ wtn: null, wtnDoubles: null })).toBeNull();
  });
});

describe('rankByWtn', () => {
  it('puts the LOWEST number first — the scale is inverted against NTRP', () => {
    const order = rankByWtn([
      { id: 'weak', name: 'Weak', wtn: 22.0 },
      { id: 'strong', name: 'Strong', wtn: 11.5 },
      { id: 'mid', name: 'Mid', wtn: 17.0 },
    ]);
    expect(order).toEqual(['strong', 'mid', 'weak']);
  });

  it('uses the doubles number when there is one', () => {
    const order = rankByWtn([
      { id: 'a', name: 'A', wtn: 12.0, wtnDoubles: 19.0 },
      { id: 'b', name: 'B', wtn: 18.0, wtnDoubles: 15.0 },
    ]);
    expect(order).toEqual(['b', 'a']);
  });

  it('sinks players with no WTN to the bottom rather than treating them as a 0', () => {
    // A 0 on this scale would be stronger than a professional.
    const order = rankByWtn([
      { id: 'none', name: 'Nonumber', wtn: null },
      { id: 'has', name: 'Hasnumber', wtn: 25.0 },
    ]);
    expect(order).toEqual(['has', 'none']);
  });

  it('keeps an existing hand-set rank when two players tie', () => {
    const order = rankByWtn([
      { id: 'second', name: 'B', wtn: 15.0, sort_order: 2 },
      { id: 'first', name: 'A', wtn: 15.0, sort_order: 1 },
    ]);
    expect(order).toEqual(['first', 'second']);
  });
});
