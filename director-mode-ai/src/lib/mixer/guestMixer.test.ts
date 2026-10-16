import { describe, it, expect } from 'vitest';
import {
  newMixer, parsePlayerList, generateRound, standings, cannotGenerate, parseSaved,
  type GuestMixer,
} from './guestMixer';

function mixerWith(names: string[], patch: Partial<GuestMixer> = {}): GuestMixer {
  return {
    ...newMixer(),
    players: names.map((n, i) => ({ id: `p${i}`, name: n })),
    ...patch,
  };
}

const everyone = (m: GuestMixer, r: ReturnType<typeof generateRound>) =>
  [...r.matches.flatMap((x) => [...x.teamA, ...x.teamB]), ...r.sittingOut].sort();

describe('parsePlayerList', () => {
  it('reads lines, commas, numbering and gender tags; drops duplicates', () => {
    const out = parsePlayerList('1. Jane Doe (W)\n2) Bob - M\nsam, jane doe, Ann (F), Kim B\n\n• Lee');
    expect(out).toEqual([
      { name: 'Jane Doe', gender: 'female' },
      { name: 'Bob', gender: 'male' },
      { name: 'sam' },
      { name: 'Ann', gender: 'female' },
      { name: 'Kim B' },
      { name: 'Lee' },
    ]);
  });
  it('skips names already on the roster', () => {
    expect(parsePlayerList('Ann\nBen', ['ann'])).toEqual([{ name: 'Ben' }]);
  });
});

describe('generateRound', () => {
  it('doubles: 10 players on 2 courts — 8 play, 2 sit, everyone placed once', () => {
    const m = mixerWith(Array.from({ length: 10 }, (_, i) => `P${i}`), { courts: 2 });
    const r = generateRound(m, { seed: 1 });
    expect(r.number).toBe(1);
    expect(r.matches).toHaveLength(2);
    r.matches.forEach((x) => { expect(x.teamA).toHaveLength(2); expect(x.teamB).toHaveLength(2); });
    expect(r.sittingOut).toHaveLength(2);
    expect(everyone(m, r)).toEqual(m.players.map((p) => p.id).sort());
  });

  it('rotates sit-outs: nobody sits two rounds running', () => {
    let m = mixerWith(Array.from({ length: 10 }, (_, i) => `P${i}`), { courts: 2 });
    for (let i = 0; i < 4; i++) {
      const r = generateRound(m, { seed: i + 7 });
      const prev = m.rounds.at(-1)?.sittingOut ?? [];
      r.sittingOut.forEach((id) => expect(prev).not.toContain(id));
      m = { ...m, rounds: [...m.rounds, r] };
    }
  });

  it('singles pairs one against one', () => {
    const m = mixerWith(['A', 'B', 'C', 'D', 'E'], { courts: 3, format: 'singles' });
    const r = generateRound(m);
    expect(r.matches).toHaveLength(2);
    r.matches.forEach((x) => { expect(x.teamA).toHaveLength(1); expect(x.teamB).toHaveLength(1); });
    expect(r.sittingOut).toHaveLength(1);
  });

  it('mixed doubles puts one man and one woman on each team', () => {
    const players = [
      ...['M1', 'M2', 'M3', 'M4'].map((n, i) => ({ id: `m${i}`, name: n, gender: 'male' as const })),
      ...['W1', 'W2', 'W3', 'W4'].map((n, i) => ({ id: `w${i}`, name: n, gender: 'female' as const })),
    ];
    const m: GuestMixer = { ...newMixer(), format: 'mixed-doubles', courts: 2, players };
    const r = generateRound(m, { seed: 3 });
    expect(r.matches).toHaveLength(2);
    for (const x of r.matches) {
      for (const team of [x.teamA, x.teamB]) {
        expect(team.map((id) => id[0]).sort()).toEqual(['m', 'w']);
      }
    }
  });

  it('players who left are not scheduled', () => {
    const m = mixerWith(['A', 'B', 'C', 'D', 'E'], { courts: 1 });
    m.players[4].out = true;
    const r = generateRound(m);
    expect(everyone(m, r)).toEqual(['p0', 'p1', 'p2', 'p3']);
  });

  it('replaceLast reshuffles the latest round without adding one', () => {
    let m = mixerWith(['A', 'B', 'C', 'D'], { courts: 1 });
    m = { ...m, rounds: [generateRound(m)] };
    expect(generateRound(m, { replaceLast: true }).number).toBe(1);
  });
});

describe('cannotGenerate', () => {
  it('explains what is missing', () => {
    expect(cannotGenerate(mixerWith(['A', 'B']))).toMatch(/at least 4/);
    expect(cannotGenerate(mixerWith(['A', 'B', 'C', 'D'], { format: 'mixed-doubles' }))).toMatch(/M or W/);
    expect(cannotGenerate(mixerWith(['A', 'B', 'C', 'D']))).toBeNull();
  });
});

describe('standings', () => {
  it('credits each player on the winning side and sorts by wins then game diff', () => {
    const m = mixerWith(['A', 'B', 'C', 'D']);
    m.rounds = [{
      number: 1, sittingOut: [],
      matches: [{ court: 1, teamA: ['p0', 'p1'], teamB: ['p2', 'p3'], scoreA: 6, scoreB: 2 }],
    }];
    const s = standings(m);
    expect(s.map((x) => [x.name, x.wins, x.losses])).toEqual([
      ['A', 1, 0], ['B', 1, 0], ['C', 0, 1], ['D', 0, 1],
    ]);
  });
});

describe('parseSaved', () => {
  it('rejects junk and accepts a saved mixer', () => {
    expect(parseSaved(null)).toBeNull();
    expect(parseSaved('{bad')).toBeNull();
    expect(parseSaved('{"version":2}')).toBeNull();
    expect(parseSaved(JSON.stringify(newMixer()))?.format).toBe('doubles');
  });
});
