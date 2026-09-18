import { describe, it, expect } from 'vitest';
import {
  computePtlStandings,
  proposeMovements,
  type PtlMeetingRow,
  type PtlStandingRow,
  type PtlTeamRef,
} from './standings';

const teams: PtlTeamRef[] = [
  { id: 'a', name: 'Aces', shortCode: 'ACE' },
  { id: 'b', name: 'Breakers', shortCode: 'BRK' },
  { id: 'c', name: 'Clay', shortCode: 'CLY' },
  { id: 'd', name: 'Drop Shots', shortCode: 'DRP' },
];

const meet = (
  home: string,
  away: string,
  result: PtlMeetingRow['result'],
  homeGames = 12,
  awayGames = 10,
): PtlMeetingRow => ({ homeTeamId: home, awayTeamId: away, result, homeGames, awayGames });

const byId = (rows: PtlStandingRow[]) => new Map(rows.map((r) => [r.teamId, r]));

describe('computePtlStandings', () => {
  it('counts wins, losses and games from decided meetings', () => {
    const rows = computePtlStandings(teams, [
      meet('a', 'b', 'home', 14, 9),
      meet('c', 'd', 'away', 8, 15),
    ]);
    const m = byId(rows);
    expect(m.get('a')).toMatchObject({ played: 1, won: 1, lost: 0, gamesFor: 14, gamesAgainst: 9 });
    expect(m.get('b')).toMatchObject({ played: 1, won: 0, lost: 1, gamesFor: 9, gamesAgainst: 14 });
    expect(m.get('d')).toMatchObject({ played: 1, won: 1, lost: 0, gamesFor: 15, gamesAgainst: 8 });
  });

  it('ignores meetings that have not been played', () => {
    const rows = computePtlStandings(teams, [meet('a', 'b', 'pending')]);
    expect(rows.every((r) => r.played === 0)).toBe(true);
  });

  it('orders by meetings won first', () => {
    const rows = computePtlStandings(teams, [
      meet('a', 'b', 'home'),
      meet('a', 'c', 'home'),
      meet('b', 'c', 'home'),
    ]);
    expect(rows.map((r) => r.teamId).slice(0, 3)).toEqual(['a', 'b', 'c']);
  });

  it('breaks a two-way tie on head-to-head, not on games', () => {
    // A and B both finish 1-1. B lost the head-to-head but piled up games
    // elsewhere — head-to-head must still win, so A finishes above B.
    const rows = computePtlStandings(teams, [
      meet('a', 'b', 'home', 10, 9), //  A beats B
      meet('b', 'c', 'home', 30, 1), //  B beats C by a mile
      meet('a', 'd', 'away', 9, 10), //  A loses to D
    ]);
    const order = rows.map((r) => r.teamId);
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'));
  });

  it('resolves a three-way tie as a mini-league rather than pairwise', () => {
    // Rock-paper-scissors: A beat B, B beat C, C beat A. All three 1-1 overall
    // and all three 1-1 inside the group, so it falls through to games won.
    const rows = computePtlStandings(
      [teams[0], teams[1], teams[2]],
      [
        meet('a', 'b', 'home', 12, 10),
        meet('b', 'c', 'home', 20, 10),
        meet('c', 'a', 'home', 12, 11),
      ],
    );
    // No crash, no cycle, every team ranked exactly once.
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((r) => r.teamId)).size).toBe(3);
    // B won the most games across the tied group, so B leads on step 3.
    expect(rows[0].teamId).toBe('b');
  });

  it('falls through head-to-head to total games won', () => {
    const rows = computePtlStandings(
      [teams[0], teams[1]],
      [meet('a', 'b', 'home', 20, 5), meet('b', 'a', 'home', 12, 11)],
    );
    // Both 1-1, head-to-head 1-1, A won 31 games to B's 17.
    expect(rows[0].teamId).toBe('a');
  });

  it('marks genuine ties with a T- label', () => {
    const rows = computePtlStandings([teams[0], teams[1]], []);
    expect(rows.every((r) => r.rankLabel.startsWith('T-'))).toBe(true);
    expect(rows.every((r) => r.rank === 1)).toBe(true);
  });

  it('gives a clean rank when nothing is tied', () => {
    const rows = computePtlStandings(
      [teams[0], teams[1]],
      [meet('a', 'b', 'home', 14, 9)],
    );
    expect(rows.map((r) => r.rankLabel)).toEqual(['1', '2']);
  });

  it('skips meetings involving a team outside the division', () => {
    const rows = computePtlStandings([teams[0], teams[1]], [meet('a', 'zz', 'home')]);
    expect(rows.every((r) => r.played === 0)).toBe(true);
  });
});

describe('proposeMovements', () => {
  const divisions = [
    { id: 'prem', name: 'Premier', tier: 1 },
    { id: 'chmp', name: 'Championship', tier: 2 },
    { id: 'chal', name: 'Challenger', tier: 3 },
  ];

  const table = (ids: string[]): PtlStandingRow[] =>
    ids.map((id, i) => ({
      teamId: id,
      name: id.toUpperCase(),
      shortCode: id.toUpperCase(),
      played: 3,
      won: 3 - i,
      lost: i,
      gamesFor: 40 - i,
      gamesAgainst: 30,
      gameDiff: 10 - i,
      rank: i + 1,
      rankLabel: String(i + 1),
    }));

  it('drops the bottom of each division and lifts the top of each below', () => {
    const moves = proposeMovements(
      divisions,
      new Map([
        ['prem', table(['p1', 'p2', 'p3', 'p4'])],
        ['chmp', table(['c1', 'c2', 'c3', 'c4'])],
        ['chal', table(['h1', 'h2', 'h3', 'h4'])],
      ]),
    );
    expect(moves).toContainEqual(
      expect.objectContaining({ teamId: 'p4', direction: 'relegated', toDivisionId: 'chmp' }),
    );
    expect(moves).toContainEqual(
      expect.objectContaining({ teamId: 'c1', direction: 'promoted', toDivisionId: 'prem' }),
    );
    expect(moves).toContainEqual(
      expect.objectContaining({ teamId: 'c4', direction: 'relegated', toDivisionId: 'chal' }),
    );
    expect(moves).toContainEqual(
      expect.objectContaining({ teamId: 'h1', direction: 'promoted', toDivisionId: 'chmp' }),
    );
  });

  it('never promotes out of the top tier or relegates out of the entry tier', () => {
    const moves = proposeMovements(
      divisions,
      new Map([
        ['prem', table(['p1', 'p2'])],
        ['chmp', table(['c1', 'c2'])],
        ['chal', table(['h1', 'h2'])],
      ]),
    );
    expect(moves.some((m) => m.teamId === 'p1' && m.direction === 'promoted')).toBe(false);
    expect(moves.some((m) => m.teamId === 'h2' && m.direction === 'relegated')).toBe(false);
  });

  it('leaves a division alone when it has fewer than two teams', () => {
    const moves = proposeMovements(
      divisions,
      new Map([['prem', table(['p1'])], ['chmp', []], ['chal', []]]),
    );
    expect(moves).toEqual([]);
  });
});
