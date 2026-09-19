import { describe, it, expect } from 'vitest';
import {
  buildDeskBoard, bucketOfTopDog, checkedInAt, expectedMinutes, observationFor, toIsoDate,
  type Assignment,
} from './desk';
import { DEFAULT_LENGTHS, type Observation } from './board';
import type { TopDogMatch } from './topdog';

const DAY = '9/19/2026';
/** Mid-morning on the Saturday, so the 8:00 wave is already out. */
const NOW = new Date(2026, 8, 19, 10, 0, 0);

let seq = 0;
function m(over: Partial<TopDogMatch> = {}): TopDogMatch {
  seq += 1;
  const base: TopDogMatch = {
    id: `m${seq}`, slot: '9:30am', slot24: '09:30', court: null,
    event: "Boys' 12 Singles", round: 'Quarters',
    playerA: `A${seq}`, playerB: `B${seq}`,
    winner: null, defaulted: false, completed: false, ready: true,
  };
  return { ...base, ...over };
}

function iso(h: number, min = 0): string {
  return new Date(2026, 8, 19, h, min, 0).toISOString();
}

describe('bucketOfTopDog', () => {
  it('reads TopDog\'s own round shorthand', () => {
    expect(bucketOfTopDog({ round: 'Quarters' })).toBe('main_early');
    expect(bucketOfTopDog({ round: 'Round 16' })).toBe('main_early');
    expect(bucketOfTopDog({ round: 'Semis' })).toBe('main_late');
    expect(bucketOfTopDog({ round: 'Finals' })).toBe('main_late');
    expect(bucketOfTopDog({ round: 'Consol Quarters' })).toBe('consolation_early');
    expect(bucketOfTopDog({ round: 'Consol Semis' })).toBe('consolation_late');
  });

  it('does not price a quarterfinal as a late round', () => {
    // "Quarters" has no "final" in it, but "Quarterfinals" does.
    expect(bucketOfTopDog({ round: 'Quarterfinals' })).toBe('main_early');
  });
});

describe('expectedMinutes', () => {
  it('keeps the director\'s figure until enough matches are timed', () => {
    const two: Observation[] = [
      { bucket: 'main_early', minutes: 40 },
      { bucket: 'main_early', minutes: 42 },
    ];
    expect(expectedMinutes(DEFAULT_LENGTHS, two).main_early).toBe(DEFAULT_LENGTHS.mainMinutes);
  });

  it('switches to today\'s median once it has three', () => {
    const three: Observation[] = [
      { bucket: 'main_early', minutes: 40 },
      { bucket: 'main_early', minutes: 50 },
      { bucket: 'main_early', minutes: 60 },
    ];
    expect(expectedMinutes(DEFAULT_LENGTHS, three).main_early).toBe(50);
  });

  it('adds the late-round allowance to the baseline', () => {
    const e = expectedMinutes(DEFAULT_LENGTHS, []);
    expect(e.main_late).toBe(e.main_early + 10);
    expect(e.consolation_late).toBe(e.consolation_early + 10);
  });
});

describe('buildDeskBoard', () => {
  const base = {
    courts: ['1', '2'],
    completedIds: [] as string[],
    boardDate: DAY,
    now: NOW,
    lengths: DEFAULT_LENGTHS,
  };

  it('shows what is on court, with the time it went on', () => {
    const match = m();
    const assignments: Assignment[] = [{ court: '1', matchId: match.id, startedAt: iso(9, 30) }];
    const board = buildDeskBoard({ ...base, matches: [match], assignments });

    expect(board.onCourt).toHaveLength(1);
    expect(board.onCourt[0]).toMatchObject({
      court: '1', playerA: match.playerA, startedAt: '09:30', elapsedMin: 30,
    });
  });

  it('takes a match on court out of the queue', () => {
    const out = m();
    const waiting = m();
    const board = buildDeskBoard({
      ...base,
      matches: [out, waiting],
      assignments: [{ court: '1', matchId: out.id, startedAt: iso(9, 30) }],
    });
    expect(board.waiting.map((w) => w.id)).toEqual([waiting.id]);
  });

  it('leaves out matches whose players are not decided yet', () => {
    const tbd = m({ playerA: '', playerB: '', ready: false });
    const board = buildDeskBoard({ ...base, matches: [tbd], assignments: [] });
    expect(board.waiting).toEqual([]);
  });

  it('drops a match the desk has scored in', () => {
    const scored = m();
    const board = buildDeskBoard({
      ...base, matches: [scored], assignments: [], completedIds: [scored.id],
    });
    expect(board.waiting).toEqual([]);
    expect(board.onCourt).toEqual([]);
  });

  it('puts the first waiting match straight on when a court is free', () => {
    const match = m({ slot24: '09:30' }); // published time already passed
    const board = buildDeskBoard({ ...base, matches: [match], assignments: [] });
    expect(board.waiting[0].ahead).toBe(0);
    expect(board.waiting[0].etaLowMin).toBe(0);
    expect(board.waiting[0].isNext).toBe(true);
  });

  it('never starts a match before the time it is published for', () => {
    const later = m({ slot: '2:00pm', slot24: '14:00' });
    const board = buildDeskBoard({ ...base, matches: [later], assignments: [] });
    expect(board.waiting[0].estimatedStart).toBe('14:00');
    expect(board.waiting[0].onSchedule).toBe(true);
    expect(board.waiting[0].delayMin).toBe(0);
  });

  it('queues behind the courts that are busy', () => {
    // Both courts went on at 09:30; a 90-minute main draw frees them at 11:00.
    const a = m(), b = m(), next = m();
    const board = buildDeskBoard({
      ...base,
      matches: [a, b, next],
      assignments: [
        { court: '1', matchId: a.id, startedAt: iso(9, 30) },
        { court: '2', matchId: b.id, startedAt: iso(9, 30) },
      ],
    });
    expect(board.waiting[0].estimatedStart).toBe('11:00');
    expect(board.waiting[0].delayMin).toBe(90);
    expect(board.waiting[0].onSchedule).toBe(false);
  });

  it('counts how many are ahead on the same court', () => {
    const one = m(), two = m(), three = m();
    const board = buildDeskBoard({ ...base, matches: [one, two, three], assignments: [] });
    // Two courts, three matches: the third is second in line on court 1.
    expect(board.waiting.map((w) => w.ahead)).toEqual([0, 0, 1]);
  });

  it('treats an overrunning court as nearly free, not free in the past', () => {
    // On at 07:00, expected 90 min, so it "should" have finished at 08:30.
    const running = m(), next = m();
    const board = buildDeskBoard({
      ...base,
      courts: ['1'],
      matches: [running, next],
      assignments: [{ court: '1', matchId: running.id, startedAt: iso(7, 0) }],
    });
    expect(board.waiting[0].estimatedStart).toBe('10:02');
  });

  it('works through the sheet in published-time order', () => {
    const afternoon = m({ slot: '2:00pm', slot24: '14:00' });
    const morning = m({ slot: '9:30am', slot24: '09:30' });
    const board = buildDeskBoard({ ...base, matches: [afternoon, morning], assignments: [] });
    expect(board.waiting.map((w) => w.id)).toEqual([morning.id, afternoon.id]);
  });

  it('falls back to the published sheet when no courts are set', () => {
    const match = m({ slot: '2:00pm', slot24: '14:00' });
    const board = buildDeskBoard({ ...base, courts: [], matches: [match], assignments: [] });
    expect(board.courtCount).toBe(0);
    expect(board.waiting[0].estimatedStart).toBe('14:00');
  });

  it('ignores an assignment for a match that has left the sheet', () => {
    const board = buildDeskBoard({
      ...base,
      matches: [],
      assignments: [{ court: '1', matchId: 'gone', startedAt: iso(9, 30) }],
    });
    expect(board.onCourt).toEqual([]);
  });

  it('marks the board provisional until it has timed some matches', () => {
    const board = buildDeskBoard({ ...base, matches: [m()], assignments: [] });
    expect(board.provisional).toBe(true);
    expect(board.boardDate).toBe('2026-09-19');
    expect(board.isFutureDate).toBe(false);
  });
});

describe('observationFor', () => {
  it('times a finished match', () => {
    const match = m({ round: 'Quarters' });
    const obs = observationFor(match, iso(9, 0), new Date(2026, 8, 19, 10, 5));
    expect(obs).toEqual({ bucket: 'main_early', minutes: 65 });
  });

  it('throws away a court freed by a mis-tap', () => {
    const match = m();
    expect(observationFor(match, iso(9, 58), new Date(2026, 8, 19, 10, 0))).toBeNull();
  });

  it('throws away a court nobody cleared until the next day', () => {
    const match = m();
    expect(observationFor(match, iso(9, 0), new Date(2026, 8, 20, 9, 0))).toBeNull();
  });
});

describe('toIsoDate', () => {
  it('converts TopDog\'s date format', () => {
    expect(toIsoDate('9/19/2026')).toBe('2026-09-19');
    expect(toIsoDate('12/1/2026')).toBe('2026-12-01');
    expect(toIsoDate('nonsense')).toBeNull();
  });
});

describe('check-in', () => {
  const base = {
    courts: ['1', '2'],
    completedIds: [] as string[],
    boardDate: DAY,
    now: NOW,
    lengths: DEFAULT_LENGTHS,
    assignments: [] as Assignment[],
  };

  it('is complete only when both players are in, at the later time', () => {
    expect(checkedInAt(undefined)).toBeNull();
    expect(checkedInAt({ a: iso(9, 0) })).toBeNull();
    expect(checkedInAt({ a: iso(9, 5), b: iso(9, 1) })).toBe(iso(9, 5));
  });

  it('puts checked-in pairs first, in the order they completed', () => {
    const early = m({ slot24: '09:30' });
    const second = m({ slot24: '09:30' });
    const first = m({ slot24: '09:30' });
    const board = buildDeskBoard({
      ...base,
      matches: [early, second, first],
      checkIns: {
        [first.id]: { a: iso(9, 1), b: iso(9, 2) },
        [second.id]: { a: iso(9, 0), b: iso(9, 10) },
        [early.id]: { a: iso(8, 50) }, // only one of them here
      },
    });
    expect(board.waiting.map((w) => w.id)).toEqual([first.id, second.id, early.id]);
    expect(board.waiting[0].checkedIn).toBe(true);
    expect(board.waiting[2].checkedIn).toBe(false);
  });

  it('lets a checked-in match take an open court before its slot', () => {
    const later = m({ slot: '2:00pm', slot24: '14:00' });
    const board = buildDeskBoard({
      ...base,
      matches: [later],
      checkIns: { [later.id]: { a: iso(9, 50), b: iso(9, 55) } },
    });
    expect(board.waiting[0].estimatedStart).toBe('10:00');
  });
});
