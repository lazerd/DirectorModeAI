import { describe, it, expect } from 'vitest';
import {
  levelFact,
  levelOptions,
  levelRange,
  levelScaleFor,
  levelValue,
  isLevelValue,
  isTiered,
  optionLine,
} from './index';

/** Rossmoor Pickleball's four, as seed-rossmoor-pickleball.mjs writes them. */
const ROSSMOOR = [
  { name: 'Novice', rating: 2.0, min: 1.0, max: 2.0 },
  { name: 'Intermediate', rating: 2.8, min: 2.5, max: 3.0 },
  { name: 'Advanced Intermediate', rating: 3.3, min: 3.0, max: 3.5 },
  { name: 'Advanced', rating: 4.0, min: 4.0, max: null },
];

const tennis = levelScaleFor({ sports: ['tennis'] });
const pickle = levelScaleFor({ sports: ['pickleball'], tiers: ROSSMOOR });

describe('a tennis club is unchanged', () => {
  it('reads levels as NTRP decimals', () => {
    expect(isTiered(tennis)).toBe(false);
    expect(tennis.label).toBe('NTRP');
    expect(levelValue(tennis, 3.5)).toBe('3.5');
    expect(levelValue(tennis, 3)).toBe('3.0');
    expect(levelRange(tennis, 3, 3.5)).toBe('3.0–3.5');
    expect(levelRange(tennis, 3.5, 3.5)).toBe('3.5');
    expect(levelRange(tennis, 4, null)).toBe('4.0+');
    expect(levelRange(tennis, null, 3)).toBe('up to 3.0');
    expect(levelRange(tennis, null, null)).toBe('');
    expect(levelFact(tennis, 3, 3.5)).toBe('Level 3.0–3.5');
  });

  it('offers the NTRP ladder, and nothing off it', () => {
    expect(levelOptions(tennis).map((o) => o.label)).toEqual(['2.0', '2.5', '3.0', '3.5', '4.0', '4.5', '5.0']);
    expect(isLevelValue(tennis, 3.5)).toBe(true);
    expect(isLevelValue(tennis, 3.4)).toBe(false);
  });
});

describe('a pickleball club reads its own names', () => {
  it('never shows a member a decimal', () => {
    expect(isTiered(pickle)).toBe(true);
    expect(pickle.label).toBe('Skill level');
    expect(levelValue(pickle, 2.8)).toBe('Intermediate');
    expect(levelValue(pickle, 3.3)).toBe('Advanced Intermediate');
    expect(levelValue(pickle, 4.5)).toBe('Advanced');
    // Below the bottom band is still the bottom tier, not a gap.
    expect(levelValue(pickle, 1.5)).toBe('Novice');
    // The fact on a card is the name alone: "Level Intermediate" reads wrong.
    expect(levelFact(pickle, 2.8, 2.8)).toBe('Intermediate');
  });

  it('reads a range that spans two tiers as both of them', () => {
    expect(levelRange(pickle, 2.8, 3.3)).toBe('Intermediate to Advanced Intermediate');
    expect(levelRange(pickle, 2.8, 2.9)).toBe('Intermediate');
    expect(levelRange(pickle, 3.3, null)).toBe('Advanced Intermediate and up');
    expect(levelRange(pickle, null, 2.0)).toBe('up to Novice');
    expect(levelRange(pickle, null, null)).toBe('');
  });

  it('offers the tiers, with the band as quiet second text', () => {
    expect(levelOptions(pickle).map(optionLine)).toEqual([
      'Novice · 1.0–2.0',
      'Intermediate · 2.5–3.0',
      'Advanced Intermediate · 3.0–3.5',
      'Advanced · 4.0+',
    ]);
    // Picking a tier stores its representative number — the matching key.
    expect(levelOptions(pickle).map((o) => o.value)).toEqual([2.0, 2.8, 3.3, 4.0]);
    expect(isLevelValue(pickle, 2.8)).toBe(true);
    expect(isLevelValue(pickle, 3.5)).toBe(false);
  });

  it('asks in the club\'s own words, not the tennis staff\'s', () => {
    expect(pickle.noun).toBe('skill level');
    expect(pickle.staff).toBe('the club staff');
    expect(tennis.staff).toBe('the tennis staff');
  });

  it('has a default set for a pickleball club that has named nothing', () => {
    const plain = levelScaleFor({ sports: ['pickleball'] });
    expect(plain.tiers.map((t) => t.name)).toEqual(['Novice', 'Intermediate', 'Advanced']);
    expect(levelValue(plain, 3.0)).toBe('Intermediate');
  });
});

describe('no rating, mixed sports, unknown sports', () => {
  it('says the same thing at every club when nobody has a level', () => {
    expect(levelValue(tennis, null)).toBe('Not set yet');
    expect(levelValue(pickle, null)).toBe('Not set yet');
    expect(levelValue(pickle, undefined)).toBe('Not set yet');
    expect(levelValue(pickle, '')).toBe('Not set yet');
  });

  it('follows the primary sport at a mixed club, and the specific one when there is one', () => {
    const lafayette = ['tennis', 'pickleball'];
    expect(levelScaleFor({ sports: lafayette }).sport).toBe('tennis');
    expect(isTiered(levelScaleFor({ sports: lafayette }))).toBe(false);
    // A pickleball game at the same club.
    expect(isTiered(levelScaleFor({ sports: lafayette, sport: 'pickleball' }))).toBe(true);
  });

  it('falls back to tennis behaviour for a sport it has never heard of', () => {
    const squash = levelScaleFor({ sports: ['squash'] });
    expect(squash.label).toBe('NTRP');
    expect(isTiered(squash)).toBe(false);
    expect(levelValue(squash, 3.5)).toBe('3.5');
    expect(levelScaleFor({}).label).toBe('NTRP');
  });
});
