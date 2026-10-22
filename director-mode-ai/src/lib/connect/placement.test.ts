import { describe, expect, it } from 'vitest';
import {
  PLACEMENT_FEE_CENTS,
  candidateCanMove,
  clubCanMove,
  guaranteeUntil,
  isStage,
  withinAttribution,
} from './placement';

describe('placement rules', () => {
  it('charges a flat $4,950', () => {
    expect(PLACEMENT_FEE_CENTS).toBe(495000);
  });

  it('lets the club move applicants forward but never touch invites', () => {
    expect(clubCanMove('applied', 'interviewing')).toBe(true);
    expect(clubCanMove('offer', 'hired')).toBe(true);
    expect(clubCanMove('invited', 'applied')).toBe(false);
    expect(clubCanMove('hired', 'declined')).toBe(false);
    expect(clubCanMove('withdrawn', 'interviewing')).toBe(false);
  });

  it('lets a candidate accept an invite or withdraw before hire', () => {
    expect(candidateCanMove('invited', 'applied')).toBe(true);
    expect(candidateCanMove('interviewing', 'withdrawn')).toBe(true);
    expect(candidateCanMove('hired', 'withdrawn')).toBe(false);
    expect(candidateCanMove('applied', 'hired')).toBe(false);
  });

  it('counts a hire inside 12 months of the introduction', () => {
    const intro = new Date('2026-10-22T00:00:00Z');
    expect(withinAttribution(intro, new Date('2027-03-01T00:00:00Z'))).toBe(true);
    expect(withinAttribution(intro, new Date('2027-11-01T00:00:00Z'))).toBe(false);
    expect(withinAttribution(intro, new Date('2026-10-01T00:00:00Z'))).toBe(false);
  });

  it('runs the guarantee 90 days from the start date', () => {
    expect(guaranteeUntil('2027-01-04')).toBe('2027-04-04');
  });

  it('validates stage names', () => {
    expect(isStage('offer')).toBe(true);
    expect(isStage('ghosted')).toBe(false);
  });
});
