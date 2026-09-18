import { describe, it, expect } from 'vitest';
import { parseGames, resolveMeeting, type LineInput, type ShootoutInput } from './meeting';

const line = (
  lineType: 'singles' | 'doubles',
  winner: 'home' | 'away' | null,
  homeGames: number | null,
  awayGames: number | null,
): LineInput => ({ lineType, winner, homeGames, awayGames });

const tb = (kind: ShootoutInput['kind'], homePts: number, awayPts: number): ShootoutInput => ({
  kind,
  homePts,
  awayPts,
});

describe('parseGames', () => {
  it('adds up a Fast4 two-setter written with spaces', () => {
    expect(parseGames('4-2 4-1')).toEqual([8, 3]);
  });

  it('accepts commas and semicolons too', () => {
    expect(parseGames('4-2,4-1')).toEqual([8, 3]);
    expect(parseGames('4-2; 3-5; 4-2')).toEqual([11, 9]);
  });

  it('ignores a bracketed match tiebreak, which is points not games', () => {
    expect(parseGames('4-2 3-5 [10-7]')).toEqual([7, 7]);
  });

  it('returns zeros for nothing rather than throwing', () => {
    expect(parseGames('')).toEqual([0, 0]);
    expect(parseGames(null)).toEqual([0, 0]);
    expect(parseGames('walkover')).toEqual([0, 0]);
  });
});

describe('resolveMeeting', () => {
  it('waits for both lines and names the missing one', () => {
    const o = resolveMeeting([line('singles', 'home', 8, 3)]);
    expect(o.state).toBe('awaiting_lines');
    if (o.state === 'awaiting_lines') expect(o.missing).toEqual(['doubles']);
  });

  it('level 1 — one team wins both lines', () => {
    const o = resolveMeeting([line('singles', 'home', 8, 3), line('doubles', 'home', 8, 5)]);
    expect(o).toMatchObject({ state: 'decided', winner: 'home', level: 1 });
  });

  it('level 2 — a 1-1 split goes to total games', () => {
    // home 8+3 = 11, away 3+8 = 11 would tie; make it 12-10.
    const o = resolveMeeting([line('singles', 'home', 8, 2), line('doubles', 'away', 4, 8)]);
    expect(o).toMatchObject({ state: 'decided', winner: 'home', level: 2 });
    if (o.state === 'decided') {
      expect(o.homeGames).toBe(12);
      expect(o.awayGames).toBe(10);
      expect(o.because).toContain('total games');
    }
  });

  it('level 3 — games tied asks for BOTH 7-point tiebreaks instead of guessing', () => {
    const o = resolveMeeting([line('singles', 'home', 8, 3), line('doubles', 'away', 3, 8)]);
    expect(o.state).toBe('awaiting_shootout');
    if (o.state === 'awaiting_shootout') {
      expect(o.level).toBe(3);
      expect(o.needs).toEqual(['tb7_singles', 'tb7_doubles']);
    }
  });

  it('level 3 — still asks when only one tiebreak has been entered', () => {
    const o = resolveMeeting(
      [line('singles', 'home', 8, 3), line('doubles', 'away', 3, 8)],
      [tb('tb7_singles', 7, 5)],
    );
    expect(o.state).toBe('awaiting_shootout');
    if (o.state === 'awaiting_shootout') expect(o.needs).toEqual(['tb7_doubles']);
  });

  it('level 3 — winning both tiebreaks wins the meeting', () => {
    const o = resolveMeeting(
      [line('singles', 'home', 8, 3), line('doubles', 'away', 3, 8)],
      [tb('tb7_singles', 7, 5), tb('tb7_doubles', 7, 4)],
    );
    expect(o).toMatchObject({ state: 'decided', winner: 'home', level: 3 });
  });

  it('level 4 — split tiebreaks are decided on combined points, with no extra tennis', () => {
    // home 7+4 = 11, away 5+7 = 12
    const o = resolveMeeting(
      [line('singles', 'home', 8, 3), line('doubles', 'away', 3, 8)],
      [tb('tb7_singles', 7, 5), tb('tb7_doubles', 4, 7)],
    );
    expect(o).toMatchObject({ state: 'decided', winner: 'away', level: 4 });
    if (o.state === 'decided') expect(o.because).toContain('combined points 12-11');
  });

  it('level 5 — combined points level asks for the 2-of-3 point tiebreak', () => {
    // home 7+5 = 12, away 5+7 = 12
    const o = resolveMeeting(
      [line('singles', 'home', 8, 3), line('doubles', 'away', 3, 8)],
      [tb('tb7_singles', 7, 5), tb('tb7_doubles', 5, 7)],
    );
    expect(o.state).toBe('awaiting_shootout');
    if (o.state === 'awaiting_shootout') {
      expect(o.level).toBe(5);
      expect(o.needs).toEqual(['points23']);
      expect(o.because).toContain('singles');
    }
  });

  it('level 5 — the decider settles it', () => {
    const o = resolveMeeting(
      [line('singles', 'home', 8, 3), line('doubles', 'away', 3, 8)],
      [tb('tb7_singles', 7, 5), tb('tb7_doubles', 5, 7), tb('points23', 2, 1)],
    );
    expect(o).toMatchObject({ state: 'decided', winner: 'home', level: 5 });
  });

  it('level 5 — a level decider is rejected, not recorded as a tie', () => {
    const o = resolveMeeting(
      [line('singles', 'home', 8, 3), line('doubles', 'away', 3, 8)],
      [tb('tb7_singles', 7, 5), tb('tb7_doubles', 5, 7), tb('points23', 1, 1)],
    );
    expect(o.state).toBe('awaiting_shootout');
    if (o.state === 'awaiting_shootout') expect(o.because).toContain('re-enter');
  });

  it('never returns a tie — the format has no such result', () => {
    const cases: Array<[LineInput[], ShootoutInput[]]> = [
      [[line('singles', 'home', 8, 3), line('doubles', 'home', 8, 5)], []],
      [[line('singles', 'home', 8, 2), line('doubles', 'away', 4, 8)], []],
      [
        [line('singles', 'home', 8, 3), line('doubles', 'away', 3, 8)],
        [tb('tb7_singles', 7, 5), tb('tb7_doubles', 7, 4)],
      ],
      [
        [line('singles', 'home', 8, 3), line('doubles', 'away', 3, 8)],
        [tb('tb7_singles', 7, 5), tb('tb7_doubles', 4, 7)],
      ],
      [
        [line('singles', 'home', 8, 3), line('doubles', 'away', 3, 8)],
        [tb('tb7_singles', 7, 5), tb('tb7_doubles', 5, 7), tb('points23', 2, 0)],
      ],
    ];
    for (const [lines, shootouts] of cases) {
      const o = resolveMeeting(lines, shootouts);
      expect(o.state).toBe('decided');
      if (o.state === 'decided') expect(['home', 'away']).toContain(o.winner);
    }
  });

  it('walkovers still resolve at level 1 with no games recorded', () => {
    const o = resolveMeeting([line('singles', 'away', 0, 0), line('doubles', 'away', 0, 0)]);
    expect(o).toMatchObject({ state: 'decided', winner: 'away', level: 1 });
  });
});
