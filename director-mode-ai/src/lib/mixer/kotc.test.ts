import { describe, it, expect } from 'vitest';
import { generateRound, newMixer, type GuestMixer } from '@/lib/mixer/guestMixer';
describe('king of the court', () => {
  it('moves winners up and losers down, splitting partners', () => {
    const players = Array.from({ length: 12 }, (_, i) => ({ id: 'p' + i, name: 'P' + i }));
    const m: GuestMixer = { ...newMixer(), format: 'king-of-court', courts: 3, players, rounds: [] };
    const r1 = generateRound(m, { seed: 1 });
    expect(r1.matches.length).toBe(3);
    r1.matches.forEach((x) => { x.scoreA = 6; x.scoreB = 2; });
    m.rounds = [r1];
    const r2 = generateRound(m);
    const c = (n: number) => [...r2.matches[n - 1].teamA, ...r2.matches[n - 1].teamB].sort();
    expect(c(1)).toEqual([...r1.matches[0].teamA, ...r1.matches[1].teamA].sort()); // court1 winners stay, court2 winners up
    expect(c(2)).toEqual([...r1.matches[0].teamB, ...r1.matches[2].teamA].sort());
    expect(c(3)).toEqual([...r1.matches[1].teamB, ...r1.matches[2].teamB].sort());
    for (const x of r2.matches) for (const t of [x.teamA, x.teamB]) // nobody keeps a partner
      for (const y of r1.matches) for (const u of [y.teamA, y.teamB]) expect(t.every((id) => u.includes(id))).toBe(false);
  });
  it('rotates sitters in on the bottom court', () => {
    const players = Array.from({ length: 10 }, (_, i) => ({ id: 'p' + i, name: 'P' + i }));
    const m: GuestMixer = { ...newMixer(), format: 'king-of-court', courts: 2, players, rounds: [] };
    const r1 = generateRound(m, { seed: 2 }); r1.matches.forEach((x) => { x.scoreA = 6; x.scoreB = 3; }); m.rounds = [r1];
    const r2 = generateRound(m);
    expect(r2.sittingOut.sort()).toEqual([...r1.matches[1].teamB].sort());
    for (const id of r1.sittingOut) expect([...r2.matches[1].teamA, ...r2.matches[1].teamB]).toContain(id);
  });
});
