import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/email', () => ({ sendBilledEmails: vi.fn() }));

import { lineupEmail, openLines, stepUpAlertEmail, visitingBodyText, type MatchInfo } from './emails';

// 9/22 at Crow Canyon: four doubles lines, six players, courts 1-3 saved.
const MATCH: MatchInfo = {
  id: 'm22',
  matchAt: '2026-09-22T16:30:00.000Z',
  isHome: false,
  opponent: 'Crow Canyon',
  location: 'Crow Canyon',
  singlesCourts: 0,
  doublesCourts: 4,
};
const ROWS = [
  { courtNumber: 1, courtType: 'doubles' as const, names: ['Nikki Mains', 'Stef Cohen'] },
  { courtNumber: 2, courtType: 'doubles' as const, names: ['Dena McManis', 'Allison Weinstein'] },
  { courtNumber: 3, courtType: 'doubles' as const, names: ['Jamie Larson', 'Sarah Binder'] },
];
const STEF = { playerId: 'p1', name: 'Stef Cohen', email: 's@example.com', token: 'tokS' };
const ROBYN = { playerId: 'p2', name: 'Robyn Rogin', email: 'r@example.com', token: 'tokR' };

describe('openLines', () => {
  it('finds Doubles 4 when three of four doubles courts are filled', () => {
    expect(openLines(MATCH, ROWS)).toEqual([{ courtType: 'doubles', courtNumber: 4, label: 'Doubles 4' }]);
  });

  it('counts a saved court with nobody on it as open, keeping its number', () => {
    expect(openLines(MATCH, [...ROWS, { courtNumber: 4, courtType: 'doubles', names: ['—', '—'] }])).toEqual([
      { courtType: 'doubles', courtNumber: 4, label: 'Doubles 4' },
    ]);
  });

  it('is quiet for a full lineup, and when line counts are unknown', () => {
    expect(openLines({ singlesCourts: 0, doublesCourts: 3 }, ROWS)).toEqual([]);
    expect(openLines({}, ROWS)).toEqual([]);
  });
});

describe('lineupEmail — short a line', () => {
  it('tells the team line 4 is defaulted unless two players step up', () => {
    const e = lineupEmail('Fall B2/B3', MATCH, ROWS, ROBYN, false);
    expect(e.subject).toContain('need two more players');
    expect(e.html).toContain("We're short: Doubles 4 will be defaulted unless two more players can play.");
    expect(e.html).toContain('No players yet: defaulted unless two players step up');
    // Someone who isn't playing gets a one-tap way to say they can.
    expect(e.html).toContain('/captain/availability/tokR');
  });

  it('asks a player already in the lineup to recruit, not to re-answer', () => {
    const e = lineupEmail('Fall B2/B3', MATCH, ROWS, STEF, true);
    expect(e.html).toContain('If you know a teammate who could make it');
    expect(e.html).not.toContain('I can play after all');
  });

  it('says nothing extra for a full lineup', () => {
    const e = lineupEmail('Fall B2/B3', { ...MATCH, doublesCourts: 3 }, ROWS, ROBYN, false);
    expect(e.html).not.toContain("We're short");
    expect(e.subject).not.toContain('need');
  });
});

describe('visitingBodyText — short a line', () => {
  it('warns the other captain instead of claiming all four lines', () => {
    const text = visitingBodyText(MATCH, {
      teamName: 'Sleepy Hollow',
      opposingCaptainName: 'Colleen McClure',
      lineCount: 4,
      doublesCourts: 4,
      openLines: [{ courtType: 'doubles', courtNumber: 4, label: 'Doubles 4' }],
      playersAvailable: 6,
    });
    expect(text).toContain('we only have 6 players available, so we may need to default line 4');
    expect(text).not.toContain('fielding all 4 lines');
  });
});

describe('stepUpAlertEmail', () => {
  it('names who stepped up and what is still short', () => {
    const e = stepUpAlertEmail('d@example.com', 'Fall B2/B3', MATCH, 'Robyn Rogin', [{ courtType: 'doubles', courtNumber: 4, label: 'Doubles 4' }], 'team1');
    expect(e.subject).toContain('Robyn Rogin can play');
    expect(e.html).toContain('Doubles 4 (two more players needed)');
  });
});

describe('visitingBodyText — the away note is about THEIR club', () => {
  const opts = { teamName: 'Sleepy Hollow', opposingCaptainName: 'Colleen McClure', lineCount: 4, doublesCourts: 4 };

  it('asks about warmup courts when the host has not said', () => {
    expect(visitingBodyText(MATCH, opts)).toContain('Are there warmup courts available');
  });

  it('thanks them instead once their arrival note is on the match', () => {
    const text = visitingBodyText({ ...MATCH, arrivalNote: 'Warm-up courts at 9. Check in at the front desk.' }, opts);
    expect(text).toContain('Thanks for sending the arrival details');
    expect(text).not.toContain('Are there warmup courts available');
  });
});
