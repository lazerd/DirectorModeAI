import { describe, it, expect } from 'vitest';
import { flipScore, resultFromCircle } from './scorecardRead';

describe('flipScore', () => {
  it('swaps every set and keeps tiebreak points and notes', () => {
    expect(flipScore('6-1, 7-6(5), 10-8 RET')).toBe('1-6, 6-7(5), 8-10 RET');
  });
});

describe('resultFromCircle', () => {
  it('9/16 court 1: Diablo circled, "6-1, 6-2" written — a loss, 1-6 2-6', () => {
    expect(resultFromCircle('theirs', '6-1, 6-2')).toEqual({ won: false, score: '1-6, 2-6' });
  });

  it('us circled, winner-first — kept as written', () => {
    expect(resultFromCircle('ours', '6-4, 6-4')).toEqual({ won: true, score: '6-4, 6-4' });
    expect(resultFromCircle('ours', '2-6, 6-3, 10-7')).toEqual({ won: true, score: '2-6, 6-3, 10-7' });
  });

  it('a score already written from our side is not flipped twice', () => {
    expect(resultFromCircle('theirs', '1-6, 2-6')).toEqual({ won: false, score: '1-6, 2-6' });
    expect(resultFromCircle('ours', '1-6, 6-4, 6-10')).toEqual({ won: true, score: '6-1, 4-6, 10-6' });
  });

  it('a retirement at a set apiece is read winner-first', () => {
    expect(resultFromCircle('theirs', '4-6, 6-5 RET')).toEqual({ won: false, score: '6-4, 5-6 RET' });
  });

  it('a circle with no readable score still gives the winner', () => {
    expect(resultFromCircle('theirs', null)).toEqual({ won: false, score: null });
  });

  it('no circle leaves the line to the model', () => {
    expect(resultFromCircle('none', '6-1, 6-2')).toBeNull();
    expect(resultFromCircle('unclear', '6-1, 6-2')).toBeNull();
  });
});
