import { describe, it, expect } from 'vitest';
import {
  generateWildCard,
  wildCardStats,
  planWildCardRound,
  wildCardRoundToRows,
  rowsToWildCardRound,
  computeWildCardStandings,
  seededRandom,
  type WildCardPlayer,
  type WildCardRound,
} from './wildCard';

function roster(men: number, women: number, unknown = 0): WildCardPlayer[] {
  const out: WildCardPlayer[] = [];
  for (let i = 0; i < men; i++) out.push({ id: `m${String(i).padStart(2, '0')}`, gender: 'male' });
  for (let i = 0; i < women; i++) out.push({ id: `w${String(i).padStart(2, '0')}`, gender: 'female' });
  for (let i = 0; i < unknown; i++) out.push({ id: `u${String(i).padStart(2, '0')}`, gender: null });
  return out;
}

const genderOf = (players: WildCardPlayer[]) => new Map(players.map((p) => [p.id, p.gender]));

function everyoneOnce(round: WildCardRound, players: WildCardPlayer[]) {
  const seen = [...round.courts.flatMap((c) => [...c.teamA, ...c.teamB]), ...round.sitOuts];
  expect(seen.length).toBe(players.length);
  expect(new Set(seen).size).toBe(players.length);
}

describe('planWildCardRound', () => {
  it('fills 6 mixed courts with 12 men + 12 women', () => {
    expect(planWildCardRound(12, 12, 6, 'mixed')).toEqual({ mixedCourts: 6, openCourts: 0, sitOuts: 0 });
  });
  it('treats courts as capacity, not a quota', () => {
    expect(planWildCardRound(11, 11, 8, 'mixed')).toEqual({ mixedCourts: 5, openCourts: 0, sitOuts: 2 });
    expect(planWildCardRound(4, 4, 8, 'open')).toEqual({ mixedCourts: 0, openCourts: 2, sitOuts: 0 });
  });
  it('puts surplus men on an open court before sitting anyone', () => {
    expect(planWildCardRound(14, 10, 6, 'mixed')).toEqual({ mixedCourts: 5, openCourts: 1, sitOuts: 0 });
  });
  it('sits the overflow when courts run out', () => {
    expect(planWildCardRound(16, 16, 6, 'mixed')).toEqual({ mixedCourts: 6, openCourts: 0, sitOuts: 8 });
  });
});

describe('generateWildCard', () => {
  it('24 players / 6 courts / 3 rounds: zero repeat partners, no sit-outs', () => {
    const players = roster(12, 12);
    const rounds = generateWildCard({ players, courts: 6, rounds: 3, mode: 'mixed', seed: 42 });
    expect(rounds).toHaveLength(3);
    rounds.forEach((r) => {
      everyoneOnce(r, players);
      expect(r.courts).toHaveLength(6);
      expect(r.sitOuts).toHaveLength(0);
    });
    const stats = wildCardStats(rounds);
    expect(stats.repeatPartners).toBe(0);
    expect(stats.repeatOpponents).toBe(0);
  });

  it('holds zero repeat partners across many seeds (12M/12W, 6 courts, 5 rounds)', () => {
    const players = roster(12, 12);
    for (let seed = 1; seed <= 25; seed++) {
      const rounds = generateWildCard({ players, courts: 6, rounds: 5, mode: 'mixed', seed });
      expect(wildCardStats(rounds).repeatPartners).toBe(0);
    }
  });

  it('mixed mode: every team is one man + one woman', () => {
    const players = roster(12, 12);
    const g = genderOf(players);
    const rounds = generateWildCard({ players, courts: 6, rounds: 4, mode: 'mixed', seed: 7 });
    for (const r of rounds) {
      for (const c of r.courts) {
        expect(c.kind).toBe('mixed');
        for (const team of [c.teamA, c.teamB]) {
          expect(team.map((id) => g.get(id)).sort()).toEqual(['female', 'male']);
        }
      }
    }
  });

  it('22 players (open) on 6 courts: 2 sit per round, spread evenly, never back-to-back', () => {
    const players = roster(11, 11);
    const rounds = generateWildCard({ players, courts: 6, rounds: 6, mode: 'open', seed: 3 });
    const stats = wildCardStats(rounds);
    rounds.forEach((r) => {
      everyoneOnce(r, players);
      expect(r.courts).toHaveLength(5);
      expect(r.sitOuts).toHaveLength(2);
    });
    expect(stats.backToBackSitOuts).toBe(0);
    expect(stats.repeatPartners).toBe(0);
    // 12 sit-outs over 22 players: nobody sits twice.
    expect(Math.max(...Object.values(stats.sitOuts))).toBe(1);
  });

  it('22 players (11M/11W mixed): one man and one woman sit, rotated fairly', () => {
    const players = roster(11, 11);
    const g = genderOf(players);
    const rounds = generateWildCard({ players, courts: 8, rounds: 3, mode: 'mixed', seed: 11 });
    const stats = wildCardStats(rounds);
    for (const r of rounds) {
      expect(r.courts).toHaveLength(5);
      expect(r.sitOuts.map((id) => g.get(id)).sort()).toEqual(['female', 'male']);
    }
    expect(Math.max(...Object.values(stats.sitOuts))).toBe(1);
    expect(stats.repeatPartners).toBe(0);
  });

  it('uneven counts (14M/10W): no one sits; the men\'s open-court spot rotates', () => {
    const players = roster(14, 10);
    const rounds = generateWildCard({ players, courts: 6, rounds: 4, mode: 'mixed', seed: 5 });
    const openCourtCounts = new Map<string, number>();
    for (const r of rounds) {
      everyoneOnce(r, players);
      expect(r.sitOuts).toHaveLength(0);
      const open = r.courts.filter((c) => c.kind === 'open');
      expect(open).toHaveLength(1);
      for (const id of [...open[0].teamA, ...open[0].teamB]) {
        openCourtCounts.set(id, (openCourtCounts.get(id) || 0) + 1);
      }
    }
    // 16 open-court spots over 14 men: nobody plays it 3 times.
    expect(Math.max(...openCourtCounts.values())).toBeLessThanOrEqual(2);
    expect(wildCardStats(rounds).repeatPartners).toBe(0);
  });

  it('non-multiple of 4 with more players than courts: sit-outs stay within one of each other', () => {
    const players = roster(19, 18);
    const rounds = generateWildCard({ players, courts: 8, rounds: 6, mode: 'open', seed: 99 });
    const stats = wildCardStats(rounds);
    const counts = players.map((p) => stats.sitOuts[p.id] || 0);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
    expect(stats.backToBackSitOuts).toBe(0);
    rounds.forEach((r) => expect(r.courts).toHaveLength(8));
  });

  it('a player with no gender fills the short side in mixed mode', () => {
    const players = roster(6, 5, 1);
    const rounds = generateWildCard({ players, courts: 3, rounds: 2, mode: 'mixed', seed: 1 });
    rounds.forEach((r) => {
      expect(r.courts).toHaveLength(3);
      expect(r.sitOuts).toHaveLength(0);
    });
  });

  it('is deterministic for a seed, and a new seed re-shuffles', () => {
    const players = roster(12, 12);
    const a = generateWildCard({ players, courts: 6, rounds: 3, mode: 'mixed', seed: 2026 });
    const b = generateWildCard({ players: [...players].reverse(), courts: 6, rounds: 3, mode: 'mixed', seed: 2026 });
    const c = generateWildCard({ players, courts: 6, rounds: 3, mode: 'mixed', seed: 2027 });
    expect(b).toEqual(a);
    expect(c).not.toEqual(a);
  });

  it('respects history: re-shuffling later rounds avoids partners from played rounds', () => {
    const players = roster(12, 12);
    const played = generateWildCard({ players, courts: 6, rounds: 2, mode: 'mixed', seed: 8 });
    const rest = generateWildCard({ players, courts: 6, rounds: 3, mode: 'mixed', seed: 9, history: played });
    expect(wildCardStats([...played, ...rest]).repeatPartners).toBe(0);
  });

  it('returns nothing for fewer than 4 players', () => {
    expect(generateWildCard({ players: roster(2, 1), courts: 2, rounds: 3, mode: 'open', seed: 1 })).toEqual([]);
  });
});

describe('storage mapping', () => {
  it('round-trips through match rows', () => {
    const players = roster(11, 11);
    const [round] = generateWildCard({ players, courts: 6, rounds: 1, mode: 'mixed', seed: 4 });
    const rows = wildCardRoundToRows(round, (slot) => slot + 3);
    expect(rows).toHaveLength(round.courts.length + round.sitOuts.length);
    expect(rows[0].court_number).toBe(3);
    const back = rowsToWildCardRound(rows);
    expect(back.sitOuts.sort()).toEqual([...round.sitOuts].sort());
    expect(back.courts.map((c) => [c.teamA, c.teamB])).toEqual(round.courts.map((c) => [c.teamA, c.teamB]));
  });
});

describe('computeWildCardStandings', () => {
  const people = [
    { id: 'a', name: 'Ann' },
    { id: 'b', name: 'Bill' },
    { id: 'c', name: 'Carol' },
    { id: 'd', name: 'Dan' },
    { id: 'e', name: 'Eve' },
  ];
  const match = (p1: string, p3: string, p2: string, p4: string, s1: number, s2: number) => ({
    court_number: 1, player1_id: p1, player3_id: p3, player2_id: p2, player4_id: p4,
    team1_score: s1, team2_score: s2, winner_team: s1 > s2 ? 1 : s2 > s1 ? 2 : null,
  });

  it('ranks individuals by games won, then rounds won', () => {
    const table = computeWildCardStandings(people, [
      match('a', 'b', 'c', 'd', 6, 2),
      match('a', 'c', 'b', 'd', 5, 3),
      { court_number: 9, player1_id: 'e', player2_id: null, player3_id: null, player4_id: null, team1_score: 0, team2_score: 0, winner_team: null },
    ]);
    expect(table.map((r) => r.name)).toEqual(['Ann', 'Bill', 'Carol', 'Dan', 'Eve']);
    expect(table[0]).toMatchObject({ gamesWon: 11, wins: 2, played: 2, rank: '1' });
    expect(table[4]).toMatchObject({ played: 0, gamesWon: 0 });
  });

  it('marks true ties', () => {
    const table = computeWildCardStandings(people.slice(0, 4), [match('a', 'b', 'c', 'd', 3, 3)]);
    expect(table.every((r) => r.rank === 'T-1')).toBe(true);
  });

  it('ignores unscored matches', () => {
    const table = computeWildCardStandings(people.slice(0, 4), [match('a', 'b', 'c', 'd', 0, 0)]);
    expect(table.every((r) => r.played === 0)).toBe(true);
  });
});

describe('seededRandom', () => {
  it('repeats for a seed', () => {
    const a = seededRandom(123);
    const b = seededRandom(123);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});
