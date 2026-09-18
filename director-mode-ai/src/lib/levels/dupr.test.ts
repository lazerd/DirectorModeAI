import { describe, it, expect } from 'vitest';
import { levelScaleFor } from './index';
import { duprOf, duprToRating, fetchDuprRating, personLevel, usesDupr } from './dupr';

/** Rossmoor Pickleball's four, as their seed writes them. */
const ROSSMOOR = [
  { name: 'Novice', rating: 2.0, min: 1.0, max: 2.0 },
  { name: 'Intermediate', rating: 2.8, min: 2.5, max: 3.0 },
  { name: 'Advanced Intermediate', rating: 3.3, min: 3.0, max: 3.5 },
  { name: 'Advanced', rating: 4.0, min: 4.0, max: null },
];

const tennis = levelScaleFor({ sports: ['tennis'] });
const pickle = levelScaleFor({ sports: ['pickleball'], tiers: ROSSMOOR });

describe('which number a person reads as', () => {
  it('shows a DUPR where there is one, because it is the real answer', () => {
    expect(personLevel(pickle, { ntrp: 2.8, dupr_doubles: 3.412 })).toBe('DUPR 3.412');
    // Doubles first — club pickleball is doubles — singles when that is all there is.
    expect(personLevel(pickle, { ntrp: 2.8, dupr_singles: 3.1, dupr_doubles: 3.586 })).toBe('DUPR 3.586');
    expect(personLevel(pickle, { ntrp: null, dupr_singles: 4 })).toBe('DUPR 4.000');
  });

  it('falls back to the club\'s own tier when nobody has a DUPR', () => {
    // Rossmoor Pickleball: 600 members, four tiers, no DUPR. This is their case.
    expect(personLevel(pickle, { ntrp: 2.8 })).toBe('Intermediate');
    expect(personLevel(pickle, { ntrp: 3.3, dupr_doubles: null })).toBe('Advanced Intermediate');
    expect(personLevel(pickle, { ntrp: null })).toBe('Not set yet');
    expect(personLevel(pickle, null)).toBe('Not set yet');
  });

  it('leaves a tennis club alone, DUPR or not', () => {
    expect(usesDupr(tennis)).toBe(false);
    expect(personLevel(tennis, { ntrp: 3.5 })).toBe('3.5');
    // A stray pickleball rating on a tennis club's roster changes nothing.
    expect(personLevel(tennis, { ntrp: 3.5, dupr_doubles: 3.412 })).toBe('3.5');
  });

  it('ignores a number outside DUPR\'s band rather than showing a mis-parse', () => {
    expect(duprOf({ dupr_doubles: 9.5 })).toBeNull();
    expect(duprOf({ dupr_doubles: 1 })).toBeNull();
    expect(duprOf({})).toBeNull();
    expect(personLevel(pickle, { ntrp: 2.8, dupr_doubles: 12 })).toBe('Intermediate');
  });
});

describe('matching stays on one number', () => {
  it('folds a DUPR onto the club\'s tier bands', () => {
    expect(duprToRating(pickle, 3.412)).toBe(3.3); // Advanced Intermediate
    expect(duprToRating(pickle, 2.6)).toBe(2.8); // Intermediate
    expect(duprToRating(pickle, 5.2)).toBe(4.0); // Advanced
    expect(duprToRating(pickle, null)).toBeNull();
  });

  it('has nothing to fold onto at a club with no tiers', () => {
    expect(duprToRating(tennis, 3.412)).toBeNull();
  });
});

describe('the sync', () => {
  it('refuses to run without partner credentials', async () => {
    const had = process.env.DUPR_API_KEY;
    delete process.env.DUPR_API_KEY;
    await expect(fetchDuprRating('whoever')).rejects.toThrow('DUPR partner access not configured');
    if (had !== undefined) process.env.DUPR_API_KEY = had;
  });
});
