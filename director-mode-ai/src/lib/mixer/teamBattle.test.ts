import { describe, it, expect } from 'vitest';
import { generateRound, newMixer, teamScore, cannotGenerate, type GuestMixer } from '@/lib/mixer/guestMixer';
describe('team battle (guest)', () => {
  it('puts each team on its own side of every court and scores by courts won', () => {
    const players = Array.from({ length: 10 }, (_, i) => ({ id: 'p' + i, name: 'P' + i, team: (i < 5 ? 'A' : 'B') as 'A' | 'B' }));
    const m: GuestMixer = { ...newMixer(), format: 'team-battle', courts: 3, players, rounds: [] };
    const r = generateRound(m);
    const team = (id: string) => players.find((p) => p.id === id)!.team;
    expect(r.matches.length).toBeGreaterThan(0);
    for (const x of r.matches) {
      expect(new Set(x.teamA.map(team)).size).toBe(1);
      expect(new Set(x.teamB.map(team)).size).toBe(1);
      expect(team(x.teamA[0])).not.toBe(team(x.teamB[0]));
    }
    r.matches.forEach((x, i) => { x.scoreA = i === 0 ? 2 : 6; x.scoreB = i === 0 ? 6 : 4; });
    m.rounds = [r];
    const sc = teamScore(m);
    expect(sc.A + sc.B).toBe(r.matches.length);
  });
  it('asks for teams first', () => {
    const m: GuestMixer = { ...newMixer(), format: 'team-battle', courts: 2, players: [{ id: 'a', name: 'A', team: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C', team: 'B' }, { id: 'd', name: 'D', team: 'B' }], rounds: [] };
    expect(cannotGenerate(m)).toMatch(/team/i);
  });
});
