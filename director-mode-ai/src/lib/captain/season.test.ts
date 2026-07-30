/**
 * Whole-season simulation.
 *
 * The per-match unit tests in lineup.test.ts prove each lineup is legal. They
 * can't prove the thing a captain actually promised the team: that by the end
 * of the season everyone has played roughly the same amount. Fairness is an
 * emergent property of nine decisions in a row, so it needs a season to test.
 *
 * Shaped like the real Fall B2/B3 team: 23 players, 9 matches, 4 doubles
 * courts and no singles — 8 slots a match, 72 slots total. 72/23 = 3.13, so a
 * perfect split is three players on 4 matches and twenty on 3.
 */
import { describe, it, expect } from 'vitest';
import { generateLineup, type Player, type CaptainingStyle } from './lineup';

const MATCHES = 9;
const DOUBLES_COURTS = 4;
const SLOTS = DOUBLES_COURTS * 2;

/** A roster where ratings repeat heavily, as they do on a real B2/B3 team. */
function roster(n: number): Player[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    name: `Player ${String(i).padStart(2, '0')}`,
    rating: [3.5, 3.0, 3.0, 2.5][i % 4],
    matchesPlayed: 0,
    needsEligibility: false,
  }));
}

function playSeason(players: Player[], captainingStyle: CaptainingStyle) {
  const played: Record<string, number> = Object.fromEntries(players.map((p) => [p.id, 0]));

  for (let week = 0; week < MATCHES; week++) {
    const result = generateLineup({
      available: players.map((p) => ({ ...p, matchesPlayed: played[p.id] })),
      singlesCourts: 0,
      doublesCourts: DOUBLES_COURTS,
      leagueType: 'flex',
      captainingStyle,
    });

    const seated = result.courts.flatMap((c) => [c.player1Id, c.player2Id]).filter(Boolean) as string[];
    expect(seated.length).toBe(SLOTS); // every court filled, every week
    for (const id of seated) played[id] += 1;
  }

  const counts = Object.values(played);
  return {
    played,
    min: Math.min(...counts),
    max: Math.max(...counts),
    total: counts.reduce((a, b) => a + b, 0),
  };
}

describe('a full season under equal_play', () => {
  it('keeps every player within one match of every other (23 players)', () => {
    const season = playSeason(roster(23), 'equal_play');

    expect(season.total).toBe(MATCHES * SLOTS); // 72 slots, all used
    expect(season.max - season.min).toBeLessThanOrEqual(1);
    // 72/23 = 3.13 — the only fair split is three on 4 and twenty on 3.
    expect(season.min).toBe(3);
    expect(season.max).toBe(4);
    expect(Object.values(season.played).filter((n) => n === 4)).toHaveLength(3);
  });

  it('splits perfectly when the roster divides evenly (18 players, 4 each)', () => {
    const season = playSeason(roster(18), 'equal_play');
    expect(season.max - season.min).toBe(0);
    expect(season.min).toBe(4);
  });

  it('holds the spread across a range of roster sizes', () => {
    for (const n of [16, 19, 20, 23, 26]) {
      const season = playSeason(roster(n), 'equal_play');
      expect(
        season.max - season.min,
        `roster of ${n} drifted to ${season.min}-${season.max}`,
      ).toBeLessThanOrEqual(1);
    }
  });
});

describe('why equal_play is a gate and not a weight', () => {
  /**
   * Strong mutual preferences among the first eight players. This is the
   * realistic case — a roster where a few pairs always want each other — and
   * it's the pressure that fairness-as-a-weight loses to.
   */
  const clique = (players: Player[]) =>
    [0, 2, 4, 6].flatMap((i) => [
      { playerId: `p${i}`, preferredPlayerId: `p${i + 1}`, rank: 1 },
      { playerId: `p${i + 1}`, preferredPlayerId: `p${i}`, rank: 1 },
    ]).filter((pref) => players.some((p) => p.id === pref.playerId));

  function seasonWithPrefs(style: CaptainingStyle) {
    const players = roster(23);
    const prefs = clique(players);
    const played: Record<string, number> = Object.fromEntries(players.map((p) => [p.id, 0]));

    for (let week = 0; week < MATCHES; week++) {
      const result = generateLineup({
        available: players.map((p) => ({ ...p, matchesPlayed: played[p.id] })),
        partnerPrefs: prefs,
        singlesCourts: 0,
        doublesCourts: DOUBLES_COURTS,
        leagueType: 'flex',
        captainingStyle: style,
      });
      for (const id of result.courts
        .flatMap((c) => [c.player1Id, c.player2Id])
        .filter(Boolean) as string[]) {
        played[id] += 1;
      }
    }
    const counts = Object.values(played);
    return { min: Math.min(...counts), max: Math.max(...counts), played };
  }

  it('play_to_win lets preference points bury the fairness weight', () => {
    const s = seasonWithPrefs('play_to_win');
    // W_PREF_MUTUAL (100) dwarfs W_FAIRNESS (8/match), so the favoured pairs
    // keep winning the slot — someone ends up on 9 while a teammate sits on 1.
    expect(s.max - s.min).toBeGreaterThan(1);
  });

  it('equal_play holds the spread under exactly the same pressure', () => {
    const s = seasonWithPrefs('equal_play');
    // The tier gate decides WHO is eligible before preference decides who
    // pairs with whom, so the same prefs can no longer distort playing time.
    expect(s.max - s.min).toBeLessThanOrEqual(1);
  });
});
