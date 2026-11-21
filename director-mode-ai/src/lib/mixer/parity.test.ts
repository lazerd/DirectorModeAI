import { describe, expect, it } from 'vitest';
import { generateRound, newMixer, standings, winnerOf, isScored, roundComplete, courtLabel, teamScore, type GuestMixer, type GuestPlayer } from '@/lib/mixer/guestMixer';

/** MixerMode -> Racquets IRL parity (11/21/26): tiebreaks, MixerMode ranking, level-balanced pairing, court labels. */
const players = (n: number, level?: (i: number) => number): GuestPlayer[] =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `P${i + 1}`, ...(level ? { level: level(i) } : {}) }));

describe('scores and winners', () => {
  it('a tie has no winner until the tiebreak is set', () => {
    const x = { court: 1, teamA: ['a'], teamB: ['b'], scoreA: 6, scoreB: 6 };
    expect(winnerOf(x)).toBeNull();
    expect(isScored(x)).toBe(false);
    expect(winnerOf({ ...x, tiebreak: 'B' })).toBe('B');
    expect(winnerOf({ ...x, scoreA: 7 })).toBe('A');
  });

  it('roundComplete needs every court decided', () => {
    expect(roundComplete({ number: 1, sittingOut: [], matches: [{ court: 1, teamA: ['a'], teamB: ['b'], scoreA: 4, scoreB: 4 }] })).toBe(false);
    expect(roundComplete({ number: 1, sittingOut: [], matches: [{ court: 1, teamA: ['a'], teamB: ['b'], scoreA: 4, scoreB: 4, tiebreak: 'A' }] })).toBe(true);
  });

  it('team battle counts a tiebreak court for the right team', () => {
    const m: GuestMixer = { ...newMixer(), format: 'team-battle', players: [{ id: 'a', name: 'A', team: 'A' }, { id: 'b', name: 'B', team: 'B' }],
      rounds: [{ number: 1, sittingOut: [], matches: [{ court: 1, teamA: ['a'], teamB: ['b'], scoreA: 5, scoreB: 5, tiebreak: 'B' }] }] };
    expect(teamScore(m)).toMatchObject({ A: 0, B: 1 });
  });
});

describe('standings rank like MixerMode', () => {
  it('ranks by win %, not raw wins (sit-outs are not punished)', () => {
    // X: 1-0 in one round (sat the other). Y: 1-1 over two rounds. X must be ahead.
    const m: GuestMixer = { ...newMixer(), format: 'singles', players: [{ id: 'x', name: 'X' }, { id: 'y', name: 'Y' }, { id: 'z', name: 'Z' }],
      rounds: [
        { number: 1, sittingOut: ['z'], matches: [{ court: 1, teamA: ['y'], teamB: ['x'], scoreA: 2, scoreB: 6 }] },
        { number: 2, sittingOut: ['x'], matches: [{ court: 1, teamA: ['y'], teamB: ['z'], scoreA: 6, scoreB: 0 }] },
      ] };
    const st = standings(m);
    expect(st.map((s) => s.name)).toEqual(['X', 'Y', 'Z']);
    expect(st[0].rank).toBe('1');
  });

  it('shares a place ("T-1") when everything is level', () => {
    const m: GuestMixer = { ...newMixer(), format: 'singles', players: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }, { id: 'd', name: 'D' }],
      rounds: [{ number: 1, sittingOut: [], matches: [
        { court: 1, teamA: ['a'], teamB: ['b'], scoreA: 6, scoreB: 3 },
        { court: 2, teamA: ['c'], teamB: ['d'], scoreA: 6, scoreB: 3 },
      ] }] };
    const st = standings(m);
    expect(st[0].rank).toBe('T-1');
    expect(st[1].rank).toBe('T-1');
  });
});

describe('ranks ignore players who have not played', () => {
  it('a 0-1 player ranks right after the winners, not behind people who have not played', () => {
    const m: GuestMixer = { ...newMixer(), format: 'singles', players: players(11),
      rounds: [{ number: 1, sittingOut: [], matches: [
        { court: 1, teamA: ['p1'], teamB: ['p2'], scoreA: 6, scoreB: 2 },
        { court: 2, teamA: ['p3'], teamB: ['p4'], scoreA: 6, scoreB: 4 },
      ] }] };
    const st = standings(m);
    expect(st.map((s) => s.id)).toEqual(['p1', 'p3', 'p4', 'p2']);
    expect(st.map((s) => s.rank)).toEqual(['1', '2', '3', '4']);
  });
});

describe('smart pairing (MixerMode policy)', () => {
  it('round 1 puts a strong and a weaker player on every doubles court when levels are known', () => {
    const lv = [5, 4.5, 4.5, 4, 3.5, 3, 3, 2.5];
    const m: GuestMixer = { ...newMixer(), format: 'doubles', courts: 2, pairing: 'smart', players: players(8, (i) => lv[i]) };
    const r = generateRound(m, { seed: 7 });
    expect(r.matches).toHaveLength(2);
    const level = new Map(m.players.map((p) => [p.id, p.level!]));
    for (const x of r.matches) {
      const lvls = [...x.teamA, ...x.teamB].map((id) => level.get(id)!);
      // balanced snake: each court mixes the top half and the bottom half
      expect(Math.max(...lvls)).toBeGreaterThanOrEqual(4);
      expect(Math.min(...lvls)).toBeLessThanOrEqual(3.5);
    }
  });

  it('later rounds still avoid a repeat partner', () => {
    let m: GuestMixer = { ...newMixer(), format: 'doubles', courts: 2, pairing: 'smart', players: players(8, (i) => 5 - i * 0.25) };
    const pairs = new Set<string>();
    for (let n = 0; n < 3; n++) {
      const r = generateRound(m, { seed: 11 + n });
      for (const x of r.matches) for (const t of [x.teamA, x.teamB]) {
        const k = [...t].sort().join('|');
        expect(pairs.has(k)).toBe(false);
        pairs.add(k);
        x.scoreA = 6; x.scoreB = 3;
      }
      m = { ...m, rounds: [...m.rounds, r] };
    }
  });

  it('unset pairing (the free /try mixer) still works as before', () => {
    const m: GuestMixer = { ...newMixer(), format: 'maximize-courts', courts: 3, players: players(10) };
    const r = generateRound(m, { seed: 3 });
    const placed = r.matches.flatMap((x) => [...x.teamA, ...x.teamB]).length + r.sittingOut.length;
    expect(placed).toBe(10);
  });

  it('team battle honours the host court split', () => {
    const ps: GuestPlayer[] = [...players(6).map((p) => ({ ...p, team: 'A' as const })), ...players(6).map((p) => ({ ...p, id: p.id + 'b', team: 'B' as const }))];
    const m: GuestMixer = { ...newMixer(), format: 'team-battle', courts: 3, players: ps, teamSplit: { doubles: 1, singles: 2 } };
    const r = generateRound(m, { seed: 1 });
    const singles = r.matches.filter((x) => x.teamA.length === 1).length, doubles = r.matches.filter((x) => x.teamA.length === 2).length;
    expect({ singles, doubles }).toEqual({ singles: 2, doubles: 1 });
  });
});

describe('court labels', () => {
  it('uses the club numbers when set', () => {
    expect(courtLabel({ courtLabels: ['5', '6'] }, 1)).toBe('5');
    expect(courtLabel({ courtLabels: ['5', '6'] }, 3)).toBe('3');
    expect(courtLabel({ courtLabels: null }, 2)).toBe('2');
  });
});
