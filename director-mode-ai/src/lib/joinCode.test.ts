import { describe, expect, it } from 'vitest';
import { normalizeJoinCode, randomJoinCode, validateJoinCode } from './joinCode';

const CLUB = 'Sleepy Hollow Swim & Tennis Club';
const SLUG = 'sleepy-hollow';

describe('validateJoinCode', () => {
  it('accepts a branded code with something unguessable in it', () => {
    expect(validateJoinCode('SHTENNIS26', CLUB, SLUG)).toEqual({ ok: true, code: 'SHTENNIS26' });
  });

  it('uppercases and strips spaces', () => {
    expect(validateJoinCode(' sh tennis 26 ', CLUB, SLUG)).toEqual({ ok: true, code: 'SHTENNIS26' });
  });

  it('REFUSES the club name — the whole point', () => {
    const r = validateJoinCode('SleepyHollow', CLUB, SLUG);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/anyone could guess/i);
  });

  it('refuses a fragment of the club name too', () => {
    expect(validateJoinCode('SLEEPY', CLUB, SLUG).ok).toBe(false);
    expect(validateJoinCode('HOLLOWSWIM', CLUB, SLUG).ok).toBe(false);
  });

  it('suggests a fix rather than just saying no', () => {
    const r = validateJoinCode('SLEEPYHOLLOW', CLUB, SLUG);
    if (!r.ok) expect(r.error).toMatch(/26/); // current year suffix
  });

  it('allows the club name once it carries a couple of digits — what a poster wants', () => {
    expect(validateJoinCode('SLEEPYHOLLOW26', CLUB, SLUG).ok).toBe(true);
  });

  it('still refuses the club name with a single digit — that is a coin toss to guess', () => {
    expect(validateJoinCode('SLEEPY7', CLUB, SLUG).ok).toBe(false);
  });

  it('rejects punctuation and too-short codes', () => {
    expect(validateJoinCode('SH!', CLUB, SLUG).ok).toBe(false);
    expect(validateJoinCode('SH 26', CLUB, SLUG).ok).toBe(false); // becomes SH26, too short
    expect(validateJoinCode('', CLUB, SLUG).ok).toBe(false);
  });

  it('keeps dashes, which read well in a link', () => {
    expect(validateJoinCode('SH-TENNIS-26', CLUB, SLUG)).toEqual({ ok: true, code: 'SH-TENNIS-26' });
  });
});

describe('normalizeJoinCode', () => {
  it('is what the lookup compares against', () => {
    expect(normalizeJoinCode(' shtennis26 ')).toBe('SHTENNIS26');
  });
});

describe('randomJoinCode', () => {
  it('avoids characters people misread down the phone', () => {
    for (let i = 0; i < 40; i++) expect(randomJoinCode()).not.toMatch(/[IO01]/);
  });

  it('is the length asked for', () => {
    expect(randomJoinCode(8)).toHaveLength(8);
  });
});
