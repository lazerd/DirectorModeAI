import { describe, expect, it } from 'vitest';
import { TIME_UP_TEXT, clockLeft, clockText, crossedZero, joinNames, pollMs, roundAnnouncement } from './tv';

const players = ['Ann', 'Bo', 'Cy', 'Di', 'Ed', 'Flo', 'Gus', 'Hal'].map((name, i) => ({ id: `p${i}`, name }));

describe('roundAnnouncement', () => {
  it('reads every court with the club court labels and the sit-outs', () => {
    const txt = roundAnnouncement({ players, courtLabels: ['5', '6'] }, {
      number: 3,
      matches: [
        { court: 2, teamA: ['p4'], teamB: ['p5'] },
        { court: 1, teamA: ['p0', 'p1'], teamB: ['p2', 'p3'] },
      ],
      sittingOut: ['p6', 'p7'],
    });
    expect(txt).toBe('Round 3. Court 5: Ann and Bo versus Cy and Di. Court 6: Ed versus Flo. Sitting out: Gus and Hal.');
  });

  it('falls back to court numbers and leaves out an empty sit-out list', () => {
    const txt = roundAnnouncement({ players, courtLabels: null }, { number: 1, matches: [{ court: 1, teamA: ['p0', 'p1'], teamB: ['p2', 'p3'] }], sittingOut: [] });
    expect(txt).toBe('Round 1. Court 1: Ann and Bo versus Cy and Di.');
  });
});

describe('helpers', () => {
  it('joins names naturally', () => {
    expect(joinNames([])).toBe('');
    expect(joinNames(['A'])).toBe('A');
    expect(joinNames(['A', 'B', 'C'])).toBe('A, B and C');
  });

  it('formats the clock and says Time! at zero', () => {
    expect(clockText(null)).toBe('');
    expect(clockText(0)).toBe('Time!');
    expect(clockText(-5000)).toBe('Time!');
    expect(clockText(9_000)).toBe('0:09');
    expect(clockText(725_000)).toBe('12:05');
    expect(clockText(500)).toBe('0:01');
  });

  it('holds a paused clock still', () => {
    const start = '2026-11-21T18:00:00.000Z';
    const paused = '2026-11-21T18:05:00.000Z';
    const later = Date.parse('2026-11-21T18:30:00.000Z');
    expect(clockLeft(start, 20, paused, later)).toBe(15 * 60e3);
    expect(clockLeft(start, 20, null, later)).toBe(-10 * 60e3);
    expect(clockLeft(null, 20, null, later)).toBeNull();
  });

  it('calls time only when a running clock crosses zero', () => {
    expect(crossedZero(1000, 0, false)).toBe(true);
    expect(crossedZero(1000, -200, true)).toBe(false);
    expect(crossedZero(null, -200, false)).toBe(false);
    expect(crossedZero(-100, -1100, false)).toBe(false);
    expect(TIME_UP_TEXT).toMatch(/^Time\./);
  });

  it('polls faster while live', () => {
    expect(pollMs('live')).toBe(5000);
    expect(pollMs('open')).toBe(15000);
    expect(pollMs('done')).toBe(15000);
  });
});
