import { describe, expect, it } from 'vitest';
import { feeEligible } from './feeScope';

describe('feeEligible', () => {
  it('director-level titles are in scope', () => {
    for (const t of [
      'Director of Tennis',
      'Director of Racquets',
      'Director of Racquet Sports & Fitness',
      'Tennis Director',
      'Director of Pickleball',
      'Director of Golf',
      'Head of Racquets',
      'General Manager / COO',
      'Tennis Director / Head Pro',
    ]) expect(feeEligible(null, t)).toBe(true);
  });

  it('head pros who lead the program are in scope', () => {
    expect(feeEligible('head_pro', 'Head Tennis Professional')).toBe(true);
    expect(feeEligible(null, 'Head Pro')).toBe(true);
    expect(feeEligible('head_pro', 'Head Padel Professional')).toBe(true);
    expect(feeEligible('assistant', 'Head Racquets Professional')).toBe(true); // title wins over a wrong label
  });

  it('assistant, teaching and coaching roles are job board only', () => {
    for (const t of [
      'Assistant Tennis Professional',
      'Associate Director of Racquets',
      'Assistant Director of Tennis',
      'Teaching Professional',
      'Staff Pro',
      'Tennis Instructor',
      'Tennis Coach',
      'Head Coach',
      'Senior Tennis Professional',
      'Pickleball Coordinator',
      'Director of Junior Tennis',
      'Youth Program Director',
    ]) expect(feeEligible('director', t)).toBe(false);
  });

  it('falls back to role_level when the title is missing or ambiguous', () => {
    expect(feeEligible('director', 'Racquets Manager')).toBe(true);
    expect(feeEligible('assistant', 'Racquets Manager')).toBe(false);
    expect(feeEligible('gm', null)).toBe(true);
    expect(feeEligible('head_pro', '')).toBe(true);
    expect(feeEligible('assistant', null)).toBe(false);
    expect(feeEligible('other', null)).toBe(false);
  });

  it('a club-posted opening with no title or level is in scope (the form only offers director-level departments)', () => {
    expect(feeEligible(null, null)).toBe(true);
    expect(feeEligible(undefined, undefined)).toBe(true);
  });
});
