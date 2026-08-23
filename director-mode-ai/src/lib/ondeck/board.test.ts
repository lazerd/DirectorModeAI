import { describe, it, expect } from 'vitest';
import { computeWaitBoard, formatWait, formatAhead, findPlayer, bucketOf, prettyRound, BASELINE_MINUTES } from './board';
import type { NormalisedMatch } from './servetennis';

const NOW = new Date('2026-08-23T10:00:00-07:00');
const DATE = '2026-08-23';

function m(p: Partial<NormalisedMatch> & { id: string }): NormalisedMatch {
  return {
    event: "Girls' 14 & under singles", round: 'Quarterfinals', structure: 'Main',
    court: '1', courtRaw: 'SHSTC 1', status: 'TO_BE_PLAYED',
    startTime: null, scheduledTime: '09:00', scheduledDate: DATE,
    playerA: 'A One', playerB: 'B Two', allCheckedIn: true, ...p,
  };
}

const COURTS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
const opts = { observations: [], courts: COURTS, today: DATE, now: NOW };
const observed = opts; // baselines drive the estimates until a bucket is learned

describe('computeWaitBoard', () => {
  it('starts from the baselines for each kind of match', () => {
    const b = computeWaitBoard([m({ id: 'a' })], opts);
    expect(b.provisional).toBe(true);
    expect(b.expectedMinutes).toEqual(BASELINE_MINUTES);
  });

  it('learns a bucket once three of that kind have been timed', () => {
    const b = computeWaitBoard([m({ id: 'a' })], {
      ...opts,
      observations: [
        { bucket: 'main_early' as const, minutes: 70 },
        { bucket: 'main_early' as const, minutes: 80 },
        { bucket: 'main_early' as const, minutes: 75 },
      ],
    });
    expect(b.expectedMinutes.main_early).toBe(75);
    // Untouched buckets keep their baseline.
    expect(b.expectedMinutes.consolation_early).toBe(55);
    expect(b.expectedMinutes.main_late).toBe(100);
  });

  it('will not learn a bucket from one or two matches', () => {
    const b = computeWaitBoard([m({ id: 'a' })], {
      ...opts,
      observations: [{ bucket: 'main_early' as const, minutes: 20 }],
    });
    expect(b.expectedMinutes.main_early).toBe(95);
  });

  it('queues a waiting match behind the one on its own court', () => {
    const live = [
      m({ id: 'playing', court: '1', status: 'IN_PROGRESS', startTime: '09:30' }),
      m({ id: 'next', court: '1', scheduledTime: '09:00' }),
    ];
    const b = computeWaitBoard(live, observed);
    expect(b.onCourt).toHaveLength(1);
    expect(b.waiting[0].ahead).toBe(1);
    // Started 09:30, ~68 min median -> frees ~10:38, i.e. ~38 min away.
    expect(b.waiting[0].etaHighMin).toBeGreaterThan(20);
    expect(b.waiting[0].etaLowMin).toBeGreaterThan(0);
  });

  it('does not make one court wait for a different busy court', () => {
    const live = [
      m({ id: 'busy', court: '1', status: 'IN_PROGRESS', startTime: '09:55' }),
      m({ id: 'free', court: '7', scheduledTime: '09:00' }),
    ];
    const b = computeWaitBoard(live, observed);
    const onSeven = b.waiting.find((r) => r.court === '7')!;
    expect(onSeven.ahead).toBe(0);
    expect(onSeven.etaHighMin).toBeLessThanOrEqual(5);
  });

  it('stacks a court queue so the third match waits longer than the first', () => {
    const live = [
      m({ id: 'p', court: '3', status: 'IN_PROGRESS', startTime: '09:50' }),
      m({ id: 'w1', court: '3', scheduledTime: '09:00' }),
      m({ id: 'w2', court: '3', scheduledTime: '09:10' }),
      m({ id: 'w3', court: '3', scheduledTime: '09:20' }),
    ];
    const b = computeWaitBoard(live, observed);
    const [w1, w2, w3] = b.waiting;
    expect([w1.ahead, w2.ahead, w3.ahead]).toEqual([1, 2, 3]);
    expect(w1.etaHighMin).toBeLessThan(w2.etaHighMin);
    expect(w2.etaHighMin).toBeLessThan(w3.etaHighMin);
  });

  it('never promises a court before the published start time', () => {
    // Court is free, but the match is not scheduled until 14:00.
    const live = [m({ id: 'later', court: '2', scheduledTime: '14:00' })];
    const b = computeWaitBoard(live, observed);
    expect(b.waiting[0].etaLowMin).toBeGreaterThan(120);
  });

  it('treats a match running well past the median as imminent, not overdue', () => {
    const live = [
      m({ id: 'long', court: '1', status: 'IN_PROGRESS', startTime: '06:00' }),
      m({ id: 'next', court: '1', scheduledTime: '09:00' }),
    ];
    const b = computeWaitBoard(live, observed);
    expect(b.waiting[0].etaLowMin).toBeGreaterThanOrEqual(0);
    expect(b.waiting[0].etaHighMin).toBeGreaterThan(0);
    expect(b.waiting[0].etaHighMin).toBeLessThan(20);
  });

  it("shows today's matches, not a later day's", () => {
    const live = [m({ id: 'today' }), m({ id: 'tomorrow', scheduledDate: '2026-08-24' })];
    const b = computeWaitBoard(live, opts);
    expect(b.waiting.map((r) => r.id)).toEqual(['today']);
    expect(b.boardDate).toBe(DATE);
    expect(b.isFutureDate).toBe(false);
  });

  it("rolls on to tomorrow once today's play is done", () => {
    // The evening of day one: nothing left today, day two already scheduled.
    const live = [m({ id: 'tomorrow', scheduledDate: '2026-08-24', scheduledTime: '08:00' })];
    const b = computeWaitBoard(live, opts);
    expect(b.boardDate).toBe('2026-08-24');
    expect(b.isFutureDate).toBe(true);
    expect(b.waiting).toHaveLength(1);
  });

  it("does not let a match still on court hide tomorrow's order of play", () => {
    const live = [
      m({ id: 'grinding', court: '1', status: 'IN_PROGRESS', startTime: '09:00' }),
      m({ id: 'tomorrow', scheduledDate: '2026-08-24', scheduledTime: '08:00' }),
    ];
    const b = computeWaitBoard(live, opts);
    expect(b.onCourt).toHaveLength(1);
    expect(b.boardDate).toBe('2026-08-24');
    expect(b.waiting.map((r) => r.id)).toEqual(['tomorrow']);
  });

  it('gives no countdown for a future day, since the scheduled time is the answer', () => {
    const live = [m({ id: 'tomorrow', scheduledDate: '2026-08-24', scheduledTime: '08:00' })];
    const b = computeWaitBoard(live, opts);
    expect(b.waiting[0].etaLowMin).toBe(0);
    expect(b.waiting[0].scheduledTime).toBe('08:00');
  });

  it('spreads court-less matches across the whole venue, not one imaginary court', () => {
    // The real failure on tournament morning: the desk assigns courts only
    // as it calls matches, so all 34 upcoming matches had court === null.
    // They queued single-file and the board quoted a 37-hour wait.
    const live = [
      ...COURTS.slice(0, 8).map((c, i) =>
        m({ id: `p${i}`, court: c, status: 'IN_PROGRESS', startTime: '09:30' })
      ),
      ...Array.from({ length: 34 }, (_, i) =>
        m({ id: `w${i}`, court: null, courtRaw: null, scheduledTime: '09:00' })
      ),
    ];
    const b = computeWaitBoard(live, observed);

    // Court 9 is idle, so the first waiting match goes on immediately.
    expect(b.waiting[0].etaHighMin).toBeLessThanOrEqual(5);
    expect(b.waiting[0].predictedCourt).toBeTruthy();

    // Nothing may read as a multi-day wait. Nine courts, 95 min a match,
    // 34 matches -> roughly four rounds deep, so well under eight hours.
    const worst = Math.max(...b.waiting.map((r) => r.etaHighMin));
    expect(worst).toBeLessThan(8 * 60);

    // And they must actually be distributed.
    const used = new Set(b.waiting.map((r) => r.predictedCourt));
    expect(used.size).toBeGreaterThanOrEqual(9);
  });

  it('takes longer when fewer courts are in play', () => {
    const live = Array.from({ length: 18 }, (_, i) =>
      m({ id: `w${i}`, court: null, courtRaw: null, scheduledTime: '09:00' })
    );
    const wide = computeWaitBoard(live, { ...observed, courts: COURTS });
    const narrow = computeWaitBoard(live, { ...observed, courts: ['1', '2'] });
    const lastOf = (b: ReturnType<typeof computeWaitBoard>) =>
      b.waiting[b.waiting.length - 1].etaHighMin;
    expect(lastOf(narrow)).toBeGreaterThan(lastOf(wide));
  });

  it('gives every waiting match an estimated clock time', () => {
    const live = [
      m({ id: 'p', court: '1', status: 'IN_PROGRESS', startTime: '09:30' }),
      m({ id: 'w', court: null, courtRaw: null, scheduledTime: '09:00' }),
    ];
    const b = computeWaitBoard(live, observed);
    expect(b.waiting[0].estimatedStart).toMatch(/^\d{2}:\d{2}$/);
  });

  it('reports elapsed time for matches on court', () => {
    const live = [m({ id: 'p', court: '4', status: 'IN_PROGRESS', startTime: '09:15' })];
    expect(computeWaitBoard(live, observed).onCourt[0].elapsedMin).toBe(45);
  });
});

describe('bucketOf', () => {
  // Round/structure combinations that actually occur in the live draws.
  it('separates consolation from main', () => {
    expect(bucketOf({ structure: 'Main', round: 'Quarterfinals' })).toBe('main_early');
    expect(bucketOf({ structure: 'Consolation', round: 'C-Quarterfinals-Q' })).toBe('consolation_early');
  });

  it('treats semifinals and finals as the longer late rounds', () => {
    expect(bucketOf({ structure: 'Main', round: 'Semifinals' })).toBe('main_late');
    expect(bucketOf({ structure: 'Main', round: 'Final' })).toBe('main_late');
    expect(bucketOf({ structure: 'Consolation', round: 'C-Semifinals' })).toBe('consolation_late');
    expect(bucketOf({ structure: 'Consolation', round: 'C-Final' })).toBe('consolation_late');
  });

  it('falls back to the C- prefix when the structure name is missing', () => {
    expect(bucketOf({ structure: '', round: 'C-Quarterfinals' })).toBe('consolation_early');
  });

  it('counts R16 as an early round', () => {
    expect(bucketOf({ structure: 'Main', round: 'R16' })).toBe('main_early');
  });

  it('puts the 3-4 playoff final in the main late bucket', () => {
    expect(bucketOf({ structure: 'Playoff 3-4', round: 'PL-Final' })).toBe('main_late');
  });
});

describe('prettyRound', () => {
  it('never shows draw-sheet codes to a parent', () => {
    expect(prettyRound('C-Quarterfinals-Q')).toBe('Consolation QF');
    expect(prettyRound('C-Final')).toBe('Consolation Final');
    expect(prettyRound('Quarterfinals')).toBe('QF');
    expect(prettyRound('Semifinals')).toBe('SF');
    expect(prettyRound('R16')).toBe('Round of 16');
    expect(prettyRound('PL-Final')).toBe('Playoff Final');
  });
});

describe('wording', () => {
  it('says something a parent can act on', () => {
    expect(formatWait(0, 5)).toBe('Next up');
    expect(formatWait(45, 70)).toBe('~45–70 min');
    expect(formatAhead(0)).toBe('On next');
    expect(formatAhead(1)).toBe('1 match ahead');
    expect(formatAhead(3)).toBe('3 matches ahead');
  });
});

describe('findPlayer', () => {
  const board = computeWaitBoard([
    m({ id: 'p', court: '5', status: 'IN_PROGRESS', startTime: '09:30', playerA: 'Sloane Hrdlicka', playerB: 'Astraea Browei' }),
    m({ id: 'w', court: '2', playerA: 'Camille Kunkel', playerB: 'Anisha Mehta' }),
  ], observed);

  it('finds a player who is already on court', () => {
    const r = findPlayer(board, 'sloane');
    expect(r?.kind).toBe('on_court');
  });

  it('finds a waiting player by surname', () => {
    const r = findPlayer(board, 'mehta');
    expect(r?.kind).toBe('waiting');
  });

  it('does not guess from a single letter', () => {
    expect(findPlayer(board, 'a')).toBeNull();
  });

  it('says so when there is no match', () => {
    expect(findPlayer(board, 'zzzz')?.kind).toBe('not_found');
  });
});
