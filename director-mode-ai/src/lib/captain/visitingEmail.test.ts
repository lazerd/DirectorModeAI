import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/email', () => ({ sendBilledEmails: vi.fn() }));

import { visitingBodyText, defaultVisitingSubject, type MatchInfo } from './emails';

/** Fall B2/B3 away at Orinda — Thu Sep 10, 9:30am club time. */
const AWAY: MatchInfo = {
  id: 'm1',
  matchAt: '2026-09-10T16:30:00.000Z',
  isHome: false,
  opponent: 'Orinda Country Club W3.25A',
  location: 'Orinda Country Club',
};

const base = {
  teamName: 'Fall B2/B3',
  venue: 'Orinda Country Club',
  lineCount: 4,
  singlesCourts: 0,
  doublesCourts: 4,
  fromName: 'Darrin Cohen',
};

describe('visitingBodyText', () => {
  it('confirms the date and time in club time, not UTC', () => {
    // The stored 16:30Z is 9:30am at the club. Rendering 4:30 PM here is the
    // bug that has come back twice.
    const t = visitingBodyText(AWAY, base);
    expect(t).toContain('Thu, Sep 10, 9:30 AM');
    expect(t).not.toContain('4:30');
  });

  it('says how many lines we are fielding, so they can plan courts', () => {
    expect(visitingBodyText(AWAY, base)).toContain("We're fielding all 4 lines");
  });

  it('asks about warmup courts and what time to arrive', () => {
    const t = visitingBodyText(AWAY, base);
    expect(t).toMatch(/warmup courts/i);
    expect(t).toMatch(/what time/i);
  });

  it('names the venue', () => {
    expect(visitingBodyText(AWAY, base)).toContain('at Orinda Country Club');
  });

  it('greets the opposing captain by first name when the league listed one', () => {
    const t = visitingBodyText(AWAY, { ...base, opposingCaptainName: 'Jessica L Fairbourn' });
    expect(t.startsWith('Hi Jessica,')).toBe(true);
  });

  it('falls back to a neutral greeting when there is no name', () => {
    expect(visitingBodyText(AWAY, base).startsWith('Hi there,')).toBe(true);
  });

  it('breaks the line count down when the league plays singles too', () => {
    const t = visitingBodyText(AWAY, { ...base, lineCount: 5, singlesCourts: 2, doublesCourts: 3 });
    expect(t).toContain('(2 singles, 3 doubles)');
  });

  it('omits the line sentence rather than claiming zero', () => {
    const t = visitingBodyText(AWAY, { ...base, lineCount: 0 });
    expect(t).not.toMatch(/fielding/);
    expect(t).toMatch(/warmup courts/i);
  });

  it('signs off with a real person', () => {
    expect(visitingBodyText(AWAY, base).trimEnd().endsWith('Darrin Cohen')).toBe(true);
  });

  it('carries the captain’s standing away note through', () => {
    const t = visitingBodyText(AWAY, { ...base, notes: 'We usually park on the street side.' });
    expect(t).toContain('We usually park on the street side.');
  });
});

describe('defaultVisitingSubject', () => {
  it('names the team and the date', () => {
    expect(defaultVisitingSubject('Fall B2/B3', AWAY)).toBe(
      'Fall B2/B3 — confirming Thu, Sep 10, 9:30 AM',
    );
  });
});
