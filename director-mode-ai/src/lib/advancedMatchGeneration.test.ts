import { describe, it, expect } from 'vitest';
import { RoundGenerator, planMixedDoublesCourts } from './advancedMatchGeneration';

type Row = { player1_id: string | null; player2_id: string | null; player3_id: string | null; player4_id: string | null };

function roster(men: number, women: number, unknown = 0) {
  const out: { player_id: string; name: string; gender?: string }[] = [];
  for (let i = 0; i < men; i++) out.push({ player_id: `m${String(i).padStart(2, '0')}`, name: `Man ${i}`, gender: 'male' });
  for (let i = 0; i < women; i++) out.push({ player_id: `w${String(i).padStart(2, '0')}`, name: `Woman ${i}`, gender: 'female' });
  for (let i = 0; i < unknown; i++) out.push({ player_id: `u${String(i).padStart(2, '0')}`, name: `Guest ${i}` });
  return out;
}

const isBye = (r: Row) => !!r.player1_id && !r.player2_id && !r.player3_id && !r.player4_id;

/** Repeat partners / opponents / sit-outs across a whole schedule. */
function stats(rounds: Row[][]) {
  const partners = new Map<string, number>();
  const opponents = new Map<string, number>();
  const sits = new Map<string, number>();
  let backToBack = 0;
  let prev = new Set<string>();
  const key = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) || 0) + 1);
  for (const round of rounds) {
    const now = new Set<string>();
    for (const r of round) {
      if (isBye(r)) {
        bump(sits, r.player1_id!);
        now.add(r.player1_id!);
        if (prev.has(r.player1_id!)) backToBack++;
        continue;
      }
      const a = [r.player1_id, r.player3_id].filter(Boolean) as string[];
      const b = [r.player2_id, r.player4_id].filter(Boolean) as string[];
      if (a.length === 2) bump(partners, key(a[0], a[1]));
      if (b.length === 2) bump(partners, key(b[0], b[1]));
      for (const x of a) for (const y of b) bump(opponents, key(x, y));
    }
    prev = now;
  }
  const repeats = (m: Map<string, number>) => [...m.values()].reduce((s, n) => s + Math.max(0, n - 1), 0);
  return { repeatPartners: repeats(partners), repeatOpponents: repeats(opponents), sits, backToBack };
}

function everyoneOnce(round: Row[], n: number) {
  const ids = round.flatMap((r) => [r.player1_id, r.player2_id, r.player3_id, r.player4_id]).filter(Boolean);
  expect(ids.length).toBe(n);
  expect(new Set(ids).size).toBe(n);
}

function mixed(players: ReturnType<typeof roster>, courts: number, rounds: number, seed: number) {
  const g = new RoundGenerator(players, courts, 'mixed-doubles');
  g.setSeed(seed);
  return g.generateMultipleRounds(rounds);
}

describe('planMixedDoublesCourts', () => {
  it('12 men + 12 women fill 6 mixed courts', () => {
    expect(planMixedDoublesCourts(12, 12, 6)).toEqual({ mixedCourts: 6, openCourts: 0, sitOuts: 0 });
  });
  it('courts are capacity, not a quota', () => {
    expect(planMixedDoublesCourts(11, 11, 8)).toEqual({ mixedCourts: 5, openCourts: 0, sitOuts: 2 });
    expect(planMixedDoublesCourts(16, 16, 6)).toEqual({ mixedCourts: 6, openCourts: 0, sitOuts: 8 });
  });
  it('overflow men play an open court before anyone sits', () => {
    expect(planMixedDoublesCourts(14, 10, 6)).toEqual({ mixedCourts: 5, openCourts: 1, sitOuts: 0 });
  });
});

describe('RoundGenerator mixed-doubles', () => {
  it('12M/12W on 6 courts over 3 rounds: 0 repeat partners, everyone plays, one man + one woman per team', () => {
    const players = roster(12, 12);
    const gender = new Map(players.map((p) => [p.player_id, p.gender]));
    const rounds = mixed(players, 6, 3, 42);
    for (const round of rounds) {
      everyoneOnce(round, 24);
      expect(round.filter(isBye)).toHaveLength(0);
      expect(round).toHaveLength(6);
      for (const r of round) {
        expect([gender.get(r.player1_id!), gender.get(r.player3_id!)].sort()).toEqual(['female', 'male']);
        expect([gender.get(r.player2_id!), gender.get(r.player4_id!)].sort()).toEqual(['female', 'male']);
      }
    }
    const s = stats(rounds);
    expect(s.repeatPartners).toBe(0);
    expect(s.repeatOpponents).toBe(0);
  });

  it('holds 0 repeat partners across 25 seeds (5 rounds)', () => {
    const players = roster(12, 12);
    for (let seed = 1; seed <= 25; seed++) {
      expect(stats(mixed(players, 6, 5, seed)).repeatPartners).toBe(0);
    }
  });

  it('14M/10W is fair: nobody sits, the overflow court rotates, no repeat partners', () => {
    const players = roster(14, 10);
    const rounds = mixed(players, 6, 4, 5);
    const onOpenCourt = new Map<string, number>();
    const gender = new Map(players.map((p) => [p.player_id, p.gender]));
    for (const round of rounds) {
      everyoneOnce(round, 24);
      expect(round.filter(isBye)).toHaveLength(0);
      const open = round.filter((r) => [r.player1_id, r.player2_id, r.player3_id, r.player4_id].every((id) => gender.get(id!) === 'male'));
      expect(open).toHaveLength(1);
      for (const id of [open[0].player1_id, open[0].player2_id, open[0].player3_id, open[0].player4_id]) {
        onOpenCourt.set(id!, (onOpenCourt.get(id!) || 0) + 1);
      }
    }
    // 16 open-court seats over 14 men: nobody plays it three times.
    expect(Math.max(...onOpenCourt.values())).toBeLessThanOrEqual(2);
    expect(stats(rounds).repeatPartners).toBe(0);
  });

  it('11M/11W on 8 courts: one man and one woman sit, never twice, never back-to-back', () => {
    const players = roster(11, 11);
    const gender = new Map(players.map((p) => [p.player_id, p.gender]));
    const rounds = mixed(players, 8, 5, 11);
    for (const round of rounds) {
      everyoneOnce(round, 22);
      expect(round.filter(isBye).map((r) => gender.get(r.player1_id!)).sort()).toEqual(['female', 'male']);
    }
    const s = stats(rounds);
    expect(Math.max(...s.sits.values())).toBe(1);
    expect(s.backToBack).toBe(0);
    expect(s.repeatPartners).toBe(0);
  });

  it('a player with no gender fills the short side', () => {
    const rounds = mixed(roster(6, 5, 1), 3, 2, 1);
    for (const round of rounds) {
      expect(round.filter(isBye)).toHaveLength(0);
      expect(round).toHaveLength(3);
    }
  });

  it('is repeatable for a seed', () => {
    const players = roster(12, 12);
    expect(mixed(players, 6, 3, 2026)).toEqual(mixed(players, 6, 3, 2026));
    expect(mixed(players, 6, 3, 2027)).not.toEqual(mixed(players, 6, 3, 2026));
  });

  it('seeded history: new rounds avoid played partners and last round\'s sit-outs', () => {
    const players = roster(11, 11);
    const played = mixed(players, 6, 2, 8);
    const rows = played.flatMap((round, i) => round.map((r) => ({ ...r, round_number: i + 1 })));
    const g = new RoundGenerator(players, 6, 'mixed-doubles');
    g.setSeed(9);
    g.seedMatchHistory(rows);
    const next = g.generateMultipleRounds(2);
    const s = stats([...played, ...next]);
    expect(s.repeatPartners).toBe(0);
    expect(s.backToBack).toBe(0);
    expect(Math.max(...s.sits.values())).toBe(1);
  });
});

describe('RoundGenerator doubles (unchanged behaviour)', () => {
  it('still hard-avoids repeat partners for 16 players on 4 courts', () => {
    const players = roster(8, 8);
    const g = new RoundGenerator(players, 4, 'doubles');
    const rounds = g.generateMultipleRounds(3);
    rounds.forEach((round) => everyoneOnce(round, 16));
    expect(stats(rounds).repeatPartners).toBe(0);
  });

  it('seeded bye rows now count, so the same players are not sat again', () => {
    const players = roster(9, 0);
    const g1 = new RoundGenerator(players, 2, 'doubles');
    const first = g1.generateMultipleRounds(1)[0];
    const firstByes = first.filter(isBye).map((r) => r.player1_id);
    const g2 = new RoundGenerator(players, 2, 'doubles');
    g2.seedMatchHistory(first.map((r) => ({ ...r, round_number: 1 })));
    const second = g2.generateMultipleRounds(1)[0];
    expect(second.filter(isBye).map((r) => r.player1_id).some((id) => firstByes.includes(id))).toBe(false);
  });
});
