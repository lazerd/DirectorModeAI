import { describe, it, expect } from 'vitest';
import { computeIndividualStandings, isRotatingPartnerFormat } from './mixerBoard';

const people = [
  { id: 'a', name: 'Ann' },
  { id: 'b', name: 'Bill' },
  { id: 'c', name: 'Carol' },
  { id: 'd', name: 'Dan' },
  { id: 'e', name: 'Eve' },
];
const match = (p1: string, p3: string, p2: string, p4: string, s1: number, s2: number, tb: 1 | 2 = 1) => ({
  player1_id: p1, player3_id: p3, player2_id: p2, player4_id: p4,
  team1_score: s1, team2_score: s2, winner_team: s1 > s2 ? 1 : s2 > s1 ? 2 : tb,
});

describe('isRotatingPartnerFormat', () => {
  it('covers the rotating mixers only', () => {
    expect(isRotatingPartnerFormat('doubles')).toBe(true);
    expect(isRotatingPartnerFormat('mixed-doubles')).toBe(true);
    expect(isRotatingPartnerFormat('maximize-courts')).toBe(true);
    expect(isRotatingPartnerFormat('team-battle')).toBe(false);
    expect(isRotatingPartnerFormat('king-of-court')).toBe(false);
    expect(isRotatingPartnerFormat(null)).toBe(false);
  });
});

describe('computeIndividualStandings', () => {
  it('ranks by win %, then game difference', () => {
    const table = computeIndividualStandings(people, [
      match('a', 'b', 'c', 'd', 6, 2),
      match('a', 'c', 'b', 'd', 5, 3),
      { player1_id: 'e', player2_id: null, player3_id: null, player4_id: null, team1_score: 0, team2_score: 0, winner_team: null },
    ]);
    expect(table.map((r) => r.name)).toEqual(['Ann', 'Bill', 'Carol', 'Eve', 'Dan']);
    expect(table[0]).toMatchObject({ wins: 2, played: 2, gamesWon: 11, rank: '1' });
    expect(table[3]).toMatchObject({ name: 'Eve', played: 0 });
  });

  it('marks true ties and breaks others head-to-head', () => {
    const tie = computeIndividualStandings(people.slice(0, 4), [match('a', 'b', 'c', 'd', 3, 3, 1), match('c', 'd', 'a', 'b', 3, 3, 1)]);
    expect(tie.every((r) => r.rank === 'T-1')).toBe(true);
  });

  it('ignores matches with no winner yet', () => {
    const table = computeIndividualStandings(people.slice(0, 4), [{ ...match('a', 'b', 'c', 'd', 0, 0), winner_team: null }]);
    expect(table.every((r) => r.played === 0)).toBe(true);
  });
});
