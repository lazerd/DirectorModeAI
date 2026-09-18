import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/email', () => ({ sendBilledEmails: vi.fn() }));

import { generateJttLineup } from './jttLineup';
import { leagueSpec, singlesFirstInLine } from './leagues';
import { lineupEmail } from './emails';
import type { Player } from './lineup';

const RULES = leagueSpec('jtt').multiLine!;

// 6 kids, strongest first. Last week A-D had singles; E and F (Sutton) played doubles only.
const kids = (singles: number[]): Player[] =>
  ['A', 'B', 'C', 'D', 'E', 'F'].map((l, i) => ({
    id: `p${i + 1}`,
    name: `Kid ${l}`,
    rating: null,
    wtn: 20 + i,
    matchesPlayed: 1,
    needsEligibility: false,
    singlesPlayed: singles[i],
  }));

const singlesOf = (players: Player[], style: 'equal_play' | 'play_to_win' = 'equal_play') =>
  generateJttLineup({
    available: players,
    rules: RULES,
    singlesCourts: 4,
    doublesCourts: 4,
    courtFormat: 3,
    captainingStyle: style,
  })
    .courts.filter((c) => c.courtType === 'singles')
    .map((c) => c.player1Id);

describe('singles rotate under equal play', () => {
  it('the two who had none last week get singles this week', () => {
    const s = singlesOf(kids([1, 1, 1, 1, 0, 0]));
    expect(s).toContain('p5');
    expect(s).toContain('p6');
  });
  it('then the strongest fill the rest, laid out strongest first', () => {
    expect(singlesOf(kids([1, 1, 1, 1, 0, 0]))).toEqual(['p1', 'p2', 'p5', 'p6']);
  });
  it('play to win ignores the count', () => {
    expect(singlesOf(kids([1, 1, 1, 1, 0, 0]), 'play_to_win')).toEqual(['p1', 'p2', 'p3', 'p4']);
  });
});

describe('first in line for singles next match', () => {
  const roster = [
    { id: 'a', name: 'Tyler' },
    { id: 'b', name: 'Sofia' },
    { id: 'c', name: 'Sutton' },
    { id: 'd', name: 'Sloane' },
  ];
  const sheet = [
    { courtType: 'singles', player1Id: 'a' },
    { courtType: 'singles', player1Id: 'b' },
    { courtType: 'doubles', player1Id: 'c' },
  ];
  it('names everyone left on the fewest singles, including kids not at this match', () => {
    expect(singlesFirstInLine(roster, {}, sheet)).toEqual(['Sutton', 'Sloane']);
  });
  it('counts earlier matches too', () => {
    expect(singlesFirstInLine(roster, { c: 1 }, sheet)).toEqual(['Sloane']);
  });
  it('says nothing when everyone is level', () => {
    expect(singlesFirstInLine(roster, { c: 1, d: 1 }, sheet)).toEqual([]);
  });
  it('lands in the lineup email', () => {
    const e = lineupEmail(
      '14U',
      { id: 'm', matchAt: '2026-09-20T23:00:00Z', isHome: false, singlesNextUp: ['Sutton Koffman', 'Josephine Disston'] },
      [{ courtNumber: 1, courtType: 'singles', names: ['Tyler Graham'], round: 1 }],
      { playerId: 'x', name: 'Sutton Koffman', email: 's@example.com', token: 't' },
      true,
    );
    expect(e.html).toContain('First in line for singles at the next match: Sutton Koffman and Josephine Disston.');
  });
});
