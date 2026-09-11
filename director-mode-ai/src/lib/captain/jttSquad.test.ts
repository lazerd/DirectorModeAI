import { describe, it, expect } from 'vitest';
import { generateJttLineup, linesByPlayer } from './jttLineup';
import { leagueSpec } from './leagues';
import type { Player } from './lineup';

const RULES = leagueSpec('jtt').multiLine!;

/** Kids strongest first; p7 is the one who "signed up last" by default. */
function kids(n: number): Player[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i + 1}`,
    name: `Kid ${String.fromCharCode(65 + i)}`,
    rating: null,
    wtn: 20 + i,
    matchesPlayed: 0,
    needsEligibility: false,
  }));
}
const joinedAt = (n: number) =>
  Object.fromEntries(Array.from({ length: n }, (_, i) => [`p${i + 1}`, `2026-09-0${i + 1}T00:00:00Z`]));

const run = (available: Player[], squad: Parameters<typeof generateJttLineup>[0]['squad'], style: 'equal_play' | 'play_to_win' = 'equal_play') =>
  generateJttLineup({
    available,
    rules: RULES,
    singlesCourts: 4,
    doublesCourts: 4,
    courtFormat: 3,
    captainingStyle: style,
    squad,
  });

describe('more say yes than the team brings', () => {
  it('brings 6 of 7, and all six play exactly two lines', () => {
    const r = run(kids(7), { max: 6, joinedAt: joinedAt(7) });
    expect(r.sitting).toHaveLength(1);
    const counts = linesByPlayer(r.courts);
    expect(Object.keys(counts)).toHaveLength(6);
    expect(Object.values(counts)).toEqual([2, 2, 2, 2, 2, 2]);
    expect(r.courts.every((c) => c.player1Id)).toBe(true);
  });

  it('sits the child who can make the most other dates', () => {
    // Everyone on 0 matches; Kid B can come to every other Sunday.
    const r = run(kids(7), {
      max: 6,
      otherYes: { p1: 3, p2: 6, p3: 3, p4: 3, p5: 3, p6: 3, p7: 3 },
      joinedAt: joinedAt(7),
    });
    expect(r.sitting!.map((s) => s.id)).toEqual(['p2']);
    expect(r.sitting![0].reason).toMatch(/can make 6 other dates/);
  });

  it('plays whoever is behind on matches first, whatever their availability', () => {
    const roster = kids(7);
    roster.forEach((p, i) => (p.matchesPlayed = i === 0 ? 3 : 1));
    const r = run(roster, { max: 6, otherYes: { p1: 0 }, joinedAt: joinedAt(7) });
    expect(r.sitting!.map((s) => s.id)).toEqual(['p1']);
  });

  it('breaks a full tie by signup — last to sign up sits', () => {
    const r = run(kids(7), { max: 6, joinedAt: joinedAt(7) });
    expect(r.sitting!.map((s) => s.id)).toEqual(['p7']);
  });

  it('under play_to_win the strongest six go', () => {
    const r = run(kids(7), { max: 6, joinedAt: joinedAt(7) }, 'play_to_win');
    expect(r.sitting!.map((s) => s.id)).toEqual(['p7']);
    expect(r.sitting![0].reason).toMatch(/strongest 6/);
  });

  it('says who is sitting and how to change it', () => {
    const r = run(kids(7), { max: 6, joinedAt: joinedAt(7) });
    expect(r.warnings.join(' ')).toMatch(/7 said yes — bringing 6/);
    expect(r.warnings.join(' ')).toMatch(/mark them Out and Regenerate/);
  });

  it('never double-books a round with the trimmed squad', () => {
    const r = run(kids(9), { max: 6, joinedAt: joinedAt(9) });
    const roundOf = (n: string[]) => Number(n.join(' ').match(/round (\d)/)?.[1] ?? 0);
    for (const round of [1, 2, 3]) {
      const ids = r.courts
        .filter((c) => roundOf(c.notes) === round)
        .flatMap((c) => [c.player1Id, c.player2Id])
        .filter(Boolean);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});

describe('at or under the cap', () => {
  it('sits nobody', () => {
    expect(run(kids(6), { max: 6 }).sitting).toEqual([]);
    expect(run(kids(4), { max: 6 }).sitting).toEqual([]);
  });

  it('with no cap at all, seats everyone as before', () => {
    const r = run(kids(7), null);
    expect(r.sitting).toEqual([]);
    expect(Object.keys(linesByPlayer(r.courts))).toHaveLength(7);
  });
});
