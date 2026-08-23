import { describe, it, expect } from 'vitest';
import {
  computeWaitBoard, formatWait, formatAhead, findPlayer, bucketOf, prettyRound,
  formatClock, waitHeadline,
} from './board';
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

// Nine courts running, Darrin's figures: main 90 min, consolation 60.
const opts = { observations: [], courtCount: 9, today: DATE, now: NOW };
const observed = opts;

describe('computeWaitBoard', () => {
  it("starts from the director's figures", () => {
    const b = computeWaitBoard([m({ id: 'a' })], opts);
    expect(b.provisional).toBe(true);
    expect(b.expectedMinutes.main_early).toBe(90);
    expect(b.expectedMinutes.consolation_early).toBe(60);
    // Semis and finals run longer in both draws.
    expect(b.expectedMinutes.main_late).toBe(100);
    expect(b.expectedMinutes.consolation_late).toBe(70);
  });

  it('honours match lengths the director changes', () => {
    const b = computeWaitBoard([m({ id: 'a' })], {
      ...opts,
      lengths: { mainMinutes: 75, consolationMinutes: 45 },
    });
    expect(b.expectedMinutes.main_early).toBe(75);
    expect(b.expectedMinutes.consolation_early).toBe(45);
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
    // Untouched buckets keep the director's figure.
    expect(b.expectedMinutes.consolation_early).toBe(60);
    expect(b.expectedMinutes.main_late).toBe(100);
  });

  it('will not learn a bucket from one or two matches', () => {
    const b = computeWaitBoard([m({ id: 'a' })], {
      ...opts,
      observations: [{ bucket: 'main_early' as const, minutes: 20 }],
    });
    expect(b.expectedMinutes.main_early).toBe(90);
  });

  it('does not make a match wait when eight of nine courts are busy', () => {
    // The old per-court model queued behind the match on "your" court even
    // with courts standing empty. Capacity is what matters, not court names.
    const live = [
      m({ id: 'playing', court: '1', status: 'IN_PROGRESS', startTime: '09:30' }),
      m({ id: 'next', court: null, courtRaw: null, scheduledTime: '09:00' }),
    ];
    const b = computeWaitBoard(live, observed);
    expect(b.onCourt).toHaveLength(1);
    expect(b.waiting[0].ahead).toBe(0);
    expect(b.waiting[0].etaHighMin).toBeLessThanOrEqual(5);
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

  it('stacks the queue once capacity runs out', () => {
    // Two courts, four matches: the third and fourth must wait for the first
    // two to finish, and the later one waits longer.
    const live = [
      m({ id: 'w1', court: null, courtRaw: null, scheduledTime: '09:00' }),
      m({ id: 'w2', court: null, courtRaw: null, scheduledTime: '09:00' }),
      m({ id: 'w3', court: null, courtRaw: null, scheduledTime: '09:00' }),
      m({ id: 'w4', court: null, courtRaw: null, scheduledTime: '09:00' }),
    ];
    const b = computeWaitBoard(live, { ...observed, courtCount: 2 });
    const [w1, w2, w3, w4] = b.waiting;
    expect([w1.ahead, w2.ahead, w3.ahead, w4.ahead]).toEqual([0, 0, 1, 1]);
    expect(w3.etaHighMin).toBeGreaterThan(w1.etaHighMin);
    expect(w4.etaHighMin).toBeGreaterThan(w2.etaHighMin);
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

  it('starts a 9am match at 9am when a court is free', () => {
    // Nine courts, nothing on them, one match scheduled for 09:00.
    const nine = new Date('2026-08-23T08:30:00-07:00');
    const live = [m({ id: 'w', court: null, courtRaw: null, scheduledTime: '09:00' })];
    const b = computeWaitBoard(live, { ...opts, now: nine });
    expect(b.waiting[0].estimatedStart).toBe('09:00');
    expect(b.waiting[0].onSchedule).toBe(true);
    expect(waitHeadline(b.waiting[0])).toBe('9:00 AM');
  });

  it('pushes past the scheduled time only when every court is busy', () => {
    const live = [
      // All nine courts went out at 09:30 with 90-minute main-draw matches.
      ...Array.from({ length: 9 }, (_, i) =>
        m({ id: `p${i}`, court: String(i + 1), status: 'IN_PROGRESS', startTime: '09:30' })
      ),
      m({ id: 'w', court: null, courtRaw: null, scheduledTime: '09:00' }),
    ];
    const b = computeWaitBoard(live, observed);
    // 09:30 + 90 = 11:00, so it cannot go on at its scheduled 09:00.
    expect(b.waiting[0].onSchedule).toBe(false);
    expect(b.waiting[0].estimatedStart).toBe('11:00');
    expect(b.waiting[0].ahead).toBe(1);
  });

  it('spreads court-less matches across the courts in use', () => {
    // The real failure on tournament morning: the desk assigns courts only
    // as it calls matches, so all 34 upcoming matches had court === null.
    // They queued single-file and the board quoted a 37-hour wait.
    const live = [
      ...Array.from({ length: 8 }, (_, i) =>
        m({ id: `p${i}`, court: String(i + 1), status: 'IN_PROGRESS', startTime: '09:30' })
      ),
      ...Array.from({ length: 34 }, (_, i) =>
        m({ id: `w${i}`, court: null, courtRaw: null, scheduledTime: '09:00' })
      ),
    ];
    const b = computeWaitBoard(live, observed);

    // The ninth court is idle, so the first waiting match goes straight on.
    expect(b.waiting[0].etaHighMin).toBeLessThanOrEqual(5);

    // Nothing may read as a multi-day wait. Nine courts, 34 matches, roughly
    // four deep per court — well under eight hours, never 37.
    const worst = Math.max(...b.waiting.map((r) => r.etaHighMin));
    expect(worst).toBeLessThan(8 * 60);

    // Nine courts means nine matches can be waiting on an empty slot.
    expect(b.waiting.filter((r) => r.ahead === 0).length).toBeGreaterThan(0);
  });

  it('takes longer when fewer courts are in play', () => {
    const live = Array.from({ length: 18 }, (_, i) =>
      m({ id: `w${i}`, court: null, courtRaw: null, scheduledTime: '09:00' })
    );
    const wide = computeWaitBoard(live, { ...observed, courtCount: 9 });
    const narrow = computeWaitBoard(live, { ...observed, courtCount: 2 });
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
  it('renders clock times, not 24-hour codes', () => {
    expect(formatClock('09:00')).toBe('9:00 AM');
    expect(formatClock('13:05')).toBe('1:05 PM');
    expect(formatClock('00:30')).toBe('12:30 AM');
  });

  it('says something a parent can act on', () => {
    expect(formatWait(0, 5)).toBe('Next up');
    expect(formatWait(45, 70)).toBe('~45–70 min');
    expect(formatAhead(0)).toBe('On next');
    expect(formatAhead(1)).toBe('1 match ahead');
    expect(formatAhead(3)).toBe('3 matches ahead');
  });
});

describe('waitHeadline', () => {
  // A snapshot published by a browser tab running older code can be missing
  // fields the board expects. It rendered a bare "~" to waiting parents.
  it('never renders a bare tilde when the estimate is missing', () => {
    const out = waitHeadline({ etaLowMin: 0, etaHighMin: 0, estimatedStart: null, scheduledTime: '09:30' });
    expect(out).not.toBe('~');
    expect(out).toBe('9:30 AM');
  });

  it('falls back to a dash when it truly knows nothing', () => {
    expect(waitHeadline({})).toBe('—');
  });

  it('gives the scheduled time back when a court is free and waiting on the clock', () => {
    expect(waitHeadline({ onSchedule: true, scheduledTime: '09:00', etaLowMin: 0, etaHighMin: 0 })).toBe('9:00 AM');
  });

  it('uses minutes close in and a clock time further out', () => {
    expect(waitHeadline({ etaLowMin: 20, etaHighMin: 35, estimatedStart: '10:00' })).toBe('~20–35 min');
    expect(waitHeadline({ etaLowMin: 180, etaHighMin: 220, estimatedStart: '13:00' })).toBe('~1:00 PM');
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
