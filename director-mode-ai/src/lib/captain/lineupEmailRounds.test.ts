import { describe, it, expect, vi } from 'vitest';

// emails.ts pulls in lib/email, which builds a Resend client at import and
// throws without a key. Same stub as the other email tests.
vi.mock('@/lib/email', () => ({ sendBilledEmails: vi.fn() }));

import { lineupEmail, type LineupRow } from './emails';

const match = {
  id: 'm1',
  matchAt: '2026-09-13T23:00:00.000Z',
  isHome: false,
  opponent: 'Orinda Country Club',
  location: 'Orinda Country Club',
};
const gavin = { playerId: 'g', name: 'Gavin Cohen', email: 'parent@example.com', token: 't' };

// 3-court format: S1+S2+D5 | S3+S4+D6 | D7+D8 — listed here in court order,
// the way the lineup table stores them.
const jtt: LineupRow[] = [
  { courtNumber: 1, courtType: 'singles', names: ['Miles Peter'], round: 1 },
  { courtNumber: 2, courtType: 'singles', names: ['Gavin Cohen'], round: 1 },
  { courtNumber: 3, courtType: 'singles', names: ['Noelle Boone'], round: 2 },
  { courtNumber: 4, courtType: 'singles', names: ['Paloma Branson'], round: 2 },
  { courtNumber: 5, courtType: 'doubles', names: ['Paloma Branson', 'Noelle Boone'], round: 1 },
  { courtNumber: 6, courtType: 'doubles', names: ['Gavin Cohen', 'Miles Peter'], round: 2 },
  { courtNumber: 7, courtType: 'doubles', names: ['Noelle Boone', 'Miles Peter'], round: 3 },
  { courtNumber: 8, courtType: 'doubles', names: ['Paloma Branson', 'Gavin Cohen'], round: 3 },
];

describe('the lineup email, for a JTT sheet', () => {
  const { html } = lineupEmail('10U Green Ball', match, jtt, gavin, true);

  it('groups the lines under a heading per round, in playing order', () => {
    const at = (s: string) => html.indexOf(s);
    expect(at('Round 1')).toBeGreaterThan(-1);
    expect(at('Round 1')).toBeLessThan(at('Singles 1'));
    expect(at('Doubles 5')).toBeLessThan(at('Round 2'));
    expect(at('Round 2')).toBeLessThan(at('Singles 3'));
    expect(at('Doubles 6')).toBeLessThan(at('Round 3'));
    expect(at('Round 3')).toBeLessThan(at('Doubles 7'));
  });

  it("names every one of the child's lines, with its round", () => {
    expect(html).toContain('Singles 2 (round 1), Doubles 6 (round 2), Doubles 8 (round 3)');
  });
});

describe('the lineup email, for an adult sheet', () => {
  it('keeps the plain court list — no round headings', () => {
    const adult = jtt.map(({ round: _round, ...row }) => row);
    const { html } = lineupEmail('Fall B2/B3', match, adult, gavin, true);
    expect(html).not.toContain('Round 1');
    expect(html).not.toContain('(round');
  });
});
