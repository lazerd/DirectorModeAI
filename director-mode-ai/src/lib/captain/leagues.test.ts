import { describe, it, expect } from 'vitest';
import { leagueSpec, defaultCourts, rosterWindow, linesPerPlayer } from './leagues';

const JTT = leagueSpec('jtt');
const jttCourts = { singles: JTT.singlesCourts, doubles: JTT.doublesCourts };

describe('the JTT sheet', () => {
  it('is 4 singles and 4 doubles, from the scorecard', () => {
    expect(jttCourts).toEqual({ singles: 4, doubles: 4 });
  });

  it('has twelve player slots, not eight', () => {
    // 4 singles x 1 player + 4 doubles x 2. This is the number that makes JTT
    // impossible to seat with distinct players.
    expect(rosterWindow(jttCourts, JTT.multiLine).slots).toBe(12);
  });

  it('lets a child play one singles and two doubles, and no more', () => {
    expect(JTT.multiLine).toEqual({
      maxSingles: 1,
      maxDoubles: 2,
      maxTotal: 3,
      minToPlay: 3,
    });
  });
});

describe('rosterWindow', () => {
  it('takes four to cover every line and six before someone plays once', () => {
    const w = rosterWindow(jttCourts, JTT.multiLine);
    expect(w.fillsSheet).toBe(4);
    expect(w.idealMax).toBe(6);
    expect(w.minToPlay).toBe(3);
  });

  it('leaves adult leagues alone — one line each, no window', () => {
    const adult = leagueSpec('usta_adult');
    const w = rosterWindow(
      { singles: adult.singlesCourts, doubles: adult.doublesCourts },
      adult.multiLine,
    );
    expect(w.maxTotal).toBe(1);
    expect(w.slots).toBe(8);
    expect(w.fillsSheet).toBe(8);
    expect(w.minToPlay).toBe(1);
  });
});

describe('linesPerPlayer', () => {
  const at = (n: number) => linesPerPlayer(n, jttCourts, JTT.multiLine);

  it('two players cannot play the match', () => {
    expect(at(2).canPlay).toBe(false);
  });

  it('three players play, defaulting the lines they cannot cover', () => {
    const r = at(3);
    expect(r.canPlay).toBe(true);
    // 3 singles + 2 doubles are coverable, so singles #4 and two doubles are
    // conceded — three LINES on the scorecard, which is how a captain counts.
    expect(r.defaulted).toBe(3);
    expect(r.lines).toBe(8);
  });

  it('four players fill the whole sheet, three lines each', () => {
    const r = at(4);
    expect(r.defaulted).toBe(0);
    expect(r.each).toBe(3);
    expect(r.some).toBe(3);
  });

  it('six players is the sweet spot — everybody plays exactly two', () => {
    const r = at(6);
    expect(r.defaulted).toBe(0);
    expect(r.each).toBe(2);
    expect(r.some).toBe(2);
  });

  it('seven players is where somebody starts playing only once', () => {
    const r = at(7);
    expect(r.each).toBe(1);
    expect(r.some).toBe(2);
    expect(r.idealMax).toBe(6);
  });

  it('never promises a child more than three lines', () => {
    for (const n of [3, 4, 5, 6, 8, 12, 20]) {
      expect(at(n).some).toBeLessThanOrEqual(3);
    }
  });
});

describe('defaultCourts', () => {
  it("prefers the team's own numbers over the league's", () => {
    expect(
      defaultCourts({ league_type: 'jtt', default_singles_courts: 3, default_doubles_courts: 3 }),
    ).toEqual({ singles: 3, doubles: 3 });
  });

  it('falls back to the league when the team has never said', () => {
    expect(defaultCourts({ league_type: 'jtt' })).toEqual({ singles: 4, doubles: 4 });
  });

  it('treats an unknown league as flex rather than throwing', () => {
    expect(defaultCourts({ league_type: 'pickleball?' })).toEqual({ singles: 2, doubles: 3 });
  });
});
