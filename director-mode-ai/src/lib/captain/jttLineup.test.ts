import { describe, it, expect } from 'vitest';
import { generateJttLineup, linesByPlayer } from './jttLineup';
import { leagueSpec } from './leagues';
import type { Player } from './lineup';

const RULES = leagueSpec('jtt').multiLine!;
const SHEET = { singlesCourts: 4, doublesCourts: 4 };

/** Kids, strongest first, with a WTN so court order is deterministic. */
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

const run = (available: Player[], extra: Partial<Parameters<typeof generateJttLineup>[0]> = {}) =>
  generateJttLineup({ available, rules: RULES, ...SHEET, ...extra });

/** Which round each court belongs to, read off the generated notes. */
const roundOf = (notes: string[]) => Number(notes.join(' ').match(/round (\d)/)?.[1] ?? 0);

describe('the shape of the sheet', () => {
  it('always lays out 8 lines: 4 singles then 4 doubles', () => {
    const r = run(kids(6));
    expect(r.courts).toHaveLength(8);
    expect(r.courts.filter((c) => c.courtType === 'singles')).toHaveLength(4);
    expect(r.courts.filter((c) => c.courtType === 'doubles')).toHaveLength(4);
    expect(r.courts.map((c) => c.courtNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('puts the doubles into two rounds of two', () => {
    const doubles = run(kids(6)).courts.filter((c) => c.courtType === 'doubles');
    expect(doubles.map((c) => roundOf(c.notes))).toEqual([2, 2, 3, 3]);
  });
});

describe('four players — the minimum that fills the sheet', () => {
  const r = run(kids(4));

  it('seats every line with nobody missing', () => {
    expect(r.courts.every((c) => c.player1Id)).toBe(true);
    expect(r.unassigned).toEqual([]);
  });

  it('gives all four kids three lines each', () => {
    expect(linesByPlayer(r.courts)).toEqual({ p1: 3, p2: 3, p3: 3, p4: 3 });
  });

  it('gives each kid exactly one singles', () => {
    const singles = r.courts.filter((c) => c.courtType === 'singles').map((c) => c.player1Id);
    expect(new Set(singles).size).toBe(4);
  });

  it('never puts the same kid on two lines in one round', () => {
    for (const round of [1, 2, 3]) {
      const inRound = r.courts
        .filter((c) => roundOf(c.notes) === round)
        .flatMap((c) => [c.player1Id, c.player2Id])
        .filter(Boolean);
      expect(new Set(inRound).size).toBe(inRound.length);
    }
  });

  it('never repeats a doubles partnership within the match', () => {
    const pairs = r.courts
      .filter((c) => c.courtType === 'doubles' && c.player1Id && c.player2Id)
      .map((c) => [c.player1Id, c.player2Id].sort().join('|'));
    expect(new Set(pairs).size).toBe(pairs.length);
  });
});

describe('six players — the sweet spot', () => {
  const r = run(kids(6));

  it('fills all eight lines', () => {
    expect(r.courts.every((c) => c.player1Id)).toBe(true);
  });

  it('gives everybody exactly two lines', () => {
    expect(Object.values(linesByPlayer(r.courts))).toEqual([2, 2, 2, 2, 2, 2]);
  });

  it('warns about nothing — this is the turnout the format wants', () => {
    expect(r.warnings).toEqual([]);
  });
});

describe('three players — playable, with defaults', () => {
  const r = run(kids(3));

  it('is allowed to play', () => {
    expect(r.warnings.some((w) => w.includes('cannot be played'))).toBe(false);
  });

  it('leaves the uncoverable lines empty rather than inventing players', () => {
    const empty = r.courts.filter((c) => !c.player1Id);
    expect(empty).toHaveLength(3);
    expect(empty.every((c) => c.notes.join(' ').includes('default'))).toBe(true);
  });

  it('says how many lines get defaulted, and what would fix it', () => {
    expect(r.warnings.join(' ')).toMatch(/3 of the 8 lines/);
    expect(r.warnings.join(' ')).toMatch(/4 players covers the whole sheet/);
  });

  it('still refuses to double-book a round', () => {
    for (const round of [1, 2, 3]) {
      const inRound = r.courts
        .filter((c) => roundOf(c.notes) === round)
        .flatMap((c) => [c.player1Id, c.player2Id])
        .filter(Boolean);
      expect(new Set(inRound).size).toBe(inRound.length);
    }
  });
});

describe('two players — not a match', () => {
  const r = run(kids(2));

  it('produces no lineup at all', () => {
    expect(r.courts).toEqual([]);
  });

  it('says so plainly, and says what to do instead', () => {
    expect(r.warnings[0]).toMatch(/at least 3/);
    expect(r.warnings[0]).toMatch(/conceded or rescheduled/);
  });
});

describe('more than six', () => {
  it('warns that someone is only getting one line', () => {
    const r = run(kids(8));
    expect(r.warnings.join(' ')).toMatch(/some players only get one line/);
  });

  it('still never gives anyone more than three, or fewer than one', () => {
    for (const n of [7, 8, 10, 12]) {
      const counts = Object.values(linesByPlayer(run(kids(n)).courts));
      expect(Math.max(...counts)).toBeLessThanOrEqual(3);
      expect(Math.min(...counts)).toBeGreaterThanOrEqual(1);
    }
  });

  it('names anyone who came and got no line at all', () => {
    const r = run(kids(13));
    expect(r.unassigned).toHaveLength(1);
    expect(r.warnings.join(' ')).toMatch(/No line for Kid M/);
  });

  it('keeps the within-match spread to a single line', () => {
    for (const n of [5, 7, 8, 9, 11]) {
      const counts = Object.values(linesByPlayer(run(kids(n)).courts));
      expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
    }
  });
});

describe('hard constraints still hold', () => {
  it('honours never-pair across both doubles rounds', () => {
    const r = run(kids(6), { neverPairs: [{ playerAId: 'p1', playerBId: 'p2' }] });
    const together = r.courts.some(
      (c) =>
        (c.player1Id === 'p1' && c.player2Id === 'p2') ||
        (c.player1Id === 'p2' && c.player2Id === 'p1'),
    );
    expect(together).toBe(false);
  });

  it('keeps a doubles-only kid off the singles lines', () => {
    const roster = kids(6);
    roster[0].courtLimit = 'doubles_only';
    const r = run(roster);
    const singles = r.courts.filter((c) => c.courtType === 'singles').map((c) => c.player1Id);
    expect(singles).not.toContain('p1');
  });

  it('keeps a singles-only kid off the doubles lines', () => {
    const roster = kids(6);
    roster[0].courtLimit = 'singles_only';
    const r = run(roster);
    const doubles = r.courts
      .filter((c) => c.courtType === 'doubles')
      .flatMap((c) => [c.player1Id, c.player2Id]);
    expect(doubles).not.toContain('p1');
  });
});

describe('equal play looks at the season, not just the sheet', () => {
  it('hands the spare line to whoever has played least', () => {
    // 5 kids, 12 slots: 2 kids get 3 lines, 3 get 2. Kid E is the weakest but
    // has played nothing all season, so equal_play must seat her for the extra.
    const roster = kids(5);
    roster.forEach((p, i) => (p.matchesPlayed = i === 4 ? 0 : 4));
    const counts = linesByPlayer(run(roster, { captainingStyle: 'equal_play' }).courts);
    expect(counts.p5).toBe(3);
  });

  it('play_to_win gives it to the strongest instead', () => {
    const roster = kids(5);
    roster.forEach((p, i) => (p.matchesPlayed = i === 4 ? 0 : 4));
    const counts = linesByPlayer(run(roster, { captainingStyle: 'play_to_win' }).courts);
    expect(counts.p1).toBe(3);
  });
});

describe('determinism', () => {
  it('produces the identical sheet from identical input', () => {
    const a = run(kids(6));
    const b = run(kids(6));
    expect(a.courts).toEqual(b.courts);
  });
});
