import { describe, expect, it } from 'vitest';
import { generateJttLineup } from './jttLineup';
import { leagueSpec } from './leagues';

const rules = leagueSpec('jtt').multiLine!;

const kid = (id: string, name: string, rating: number, maxLines?: number) => ({
  id,
  name,
  rating,
  matchesPlayed: 0,
  needsEligibility: false,
  maxLines: maxLines ?? null,
});

// The real 9/20 squad: five children over four singles and four doubles.
const squad = [
  kid('noelle', 'Noelle Boone', 3),
  kid('gavin', 'Gavin Cohen', 2.9),
  kid('shaelyn', 'Shaelyn Kelley', 2.8),
  kid('paloma', 'Paloma Branson', 2.6),
  kid('aidan', 'Aidan Akhtar-Fan', 2.5, 2),
];

const linesFor = (courts: { player1Id: string | null; player2Id: string | null }[], id: string) =>
  courts.filter((c) => c.player1Id === id || c.player2Id === id).length;

describe('a capped player', () => {
  const out = generateJttLineup({
    available: squad,
    singlesCourts: 4,
    doublesCourts: 4,
    rules,
    courtFormat: 2,
    captainingStyle: 'equal_play',
  });

  it('never takes more lines than their cap', () => {
    expect(linesFor(out.courts, 'aidan')).toBeLessThanOrEqual(2);
  });

  it('gives the lines they gave up to someone else, not to the default column', () => {
    const filled = out.courts.filter((c) => c.player1Id).length;
    // Without redistribution the sheet comes up a line short.
    expect(filled).toBe(8);
  });

  it('leaves an uncapped squad alone', () => {
    const free = generateJttLineup({
      available: squad.map((p) => ({ ...p, maxLines: null })),
      singlesCourts: 4,
      doublesCourts: 4,
      rules,
      courtFormat: 2,
      captainingStyle: 'equal_play',
    });
    expect(free.courts.filter((c) => c.player1Id).length).toBe(8);
    expect(linesFor(free.courts, 'aidan')).toBeGreaterThanOrEqual(2);
  });
});
