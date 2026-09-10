import { describe, it, expect } from 'vitest';
import { seasonRecord, setsFromScore, tallyCourts, topdogPoints } from './recap';

// Fall B2/B3 vs Orinda CC, 2026-09-10 — exactly as saved in captain_results.
const orinda = [
  { won: false, score: '6-4, 5-6 RET', defaulted: false },
  { won: true, score: '6-2, 6-0', defaulted: false },
  { won: false, score: '6-4, 4-6, 0-1', defaulted: false },
  { won: true, score: '6-2, 6-2', defaulted: false },
];

describe('reading sets off a score', () => {
  it('counts a match tiebreak as a set', () => {
    expect(setsFromScore('6-4, 4-6, 0-1')).toEqual({ ours: 1, theirs: 2 });
  });
  it('gives an unfinished set at a retirement to whoever led it', () => {
    expect(setsFromScore('6-4, 5-6 RET')).toEqual({ ours: 1, theirs: 1 });
  });
  it('ignores a tiebreak count in brackets', () => {
    expect(setsFromScore('7-6(5), 6-3')).toEqual({ ours: 2, theirs: 0 });
  });
});

describe('TopDog points per court', () => {
  it('3-0 for a straight-set win, 2-1 when the loser took a set', () => {
    expect(topdogPoints({ won: true, score: '6-2, 6-0' })).toEqual({ ours: 3, theirs: 0 });
    expect(topdogPoints({ won: true, score: '4-6, 6-3, 10-7' })).toEqual({ ours: 2, theirs: 1 });
    expect(topdogPoints({ won: false, score: '6-4, 4-6, 0-1' })).toEqual({ ours: 1, theirs: 2 });
    expect(topdogPoints({ won: false, score: '2-6, 1-6' })).toEqual({ ours: 0, theirs: 3 });
  });
  it('a default is 3-0 whatever is written', () => {
    expect(topdogPoints({ won: true, score: null, defaulted: true })).toEqual({ ours: 3, theirs: 0 });
  });
  it('an undecided court scores nothing', () => {
    expect(topdogPoints({ won: null, score: '6-4' })).toBeNull();
  });
});

describe('the Orinda match', () => {
  it('is a 2-2 tie on courts', () => {
    expect(tallyCourts(orinda)).toMatchObject({ outcome: 'tie', scoreline: '2-2', points: null });
  });
  it('is an 8-4 WIN on TopDog points — the recap Darrin wanted to send', () => {
    expect(tallyCourts(orinda, 'topdog')).toMatchObject({
      won: 2,
      lost: 2,
      points: { ours: 8, theirs: 4 },
      outcome: 'win',
      scoreline: '8-4',
    });
  });
  it('counts as a win in the season record too', () => {
    expect(seasonRecord([{ matchId: 'orinda', courts: orinda }], 'topdog').label).toBe('1-0');
    expect(seasonRecord([{ matchId: 'orinda', courts: orinda }]).label).toBe('0-0-1');
  });
});
