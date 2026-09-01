import { describe, expect, it } from 'vitest';
import {
  bookingFits,
  candidateStarts,
  durationsThatFit,
  freeSegments,
  minutesOf,
  reconcileWindows,
  remainingAfterBooking,
  type Range,
} from './openMath';

/** 2026-09-05, club time (PDT = UTC-7). 1pm local == 20:00Z. */
const at = (h: number, m = 0) =>
  new Date(Date.UTC(2026, 8, 5, h + 7, m)).toISOString();
const range = (fromH: number, toH: number, fromM = 0, toM = 0): Range => ({
  start: at(fromH, fromM),
  end: at(toH, toM),
});
const local = (isoStr: string) =>
  new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/Los_Angeles',
  }).format(new Date(isoStr));

describe('freeSegments', () => {
  it('gives back the whole window when nothing is booked', () => {
    expect(freeSegments(range(13, 16), [])).toEqual([range(13, 16)]);
  });

  it('splits around a booking in the middle', () => {
    const free = freeSegments(range(13, 16), [range(14, 15)]);
    expect(free.map((f) => [local(f.start), local(f.end)])).toEqual([
      ['1:00 PM', '2:00 PM'],
      ['3:00 PM', '4:00 PM'],
    ]);
  });

  it('returns nothing when the window is fully booked', () => {
    expect(freeSegments(range(13, 14), [range(13, 14)])).toEqual([]);
  });

  it('merges back-to-back bookings instead of inventing a zero-length gap', () => {
    const free = freeSegments(range(13, 16), [range(13, 14), range(14, 15)]);
    expect(free).toEqual([range(15, 16)]);
  });

  it('ignores bookings that fall outside the window', () => {
    expect(freeSegments(range(13, 14), [range(9, 10), range(17, 18)])).toEqual([range(13, 14)]);
  });
});

describe('candidateStarts', () => {
  it('offers half-hour starts across a three-hour opening', () => {
    const starts = candidateStarts([range(13, 16)], 60).map(local);
    expect(starts).toEqual(['1:00 PM', '1:30 PM', '2:00 PM', '2:30 PM', '3:00 PM']);
  });

  it('never offers a start that would run past the end of the opening', () => {
    // 90 minutes in a 2-hour window: 1:00 and 1:30 fit, 2:00 does not.
    expect(candidateStarts([range(13, 15)], 90).map(local)).toEqual(['1:00 PM', '1:30 PM']);
  });

  it('keeps the grid relative to the window, so a 1:15 opening starts at 1:15', () => {
    expect(candidateStarts([{ start: at(13, 15), end: at(15, 15) }], 60).map(local)).toEqual([
      '1:15 PM',
      '1:45 PM',
      '2:15 PM',
    ]);
  });

  it('drops starts inside the notice period', () => {
    const starts = candidateStarts([range(13, 16)], 60, { notBefore: at(14, 30) }).map(local);
    expect(starts).toEqual(['2:30 PM', '3:00 PM']);
  });
});

describe('durationsThatFit — the rule Darrin asked for', () => {
  it('a 60-minute opening offers 30 and 60, never 90', () => {
    expect(durationsThatFit([range(13, 14)], [30, 60, 90])).toEqual([30, 60]);
  });

  it('a 3-hour opening offers all three', () => {
    expect(durationsThatFit([range(13, 16)], [30, 60, 90])).toEqual([30, 60, 90]);
  });

  it('a 30-minute opening offers only 30', () => {
    expect(durationsThatFit([range(13, 13, 0, 30)], [30, 60, 90])).toEqual([30]);
  });

  it('shrinks with the window as bookings land on it', () => {
    // 3 hours, an hour taken in the middle: two 1-hour gaps, so 90 is gone.
    const free = freeSegments(range(13, 16), [range(14, 15)]);
    expect(durationsThatFit(free, [30, 60, 90])).toEqual([30, 60]);
  });

  it('offers nothing once the window is full', () => {
    expect(durationsThatFit(freeSegments(range(13, 14), [range(13, 14)]), [30, 60, 90])).toEqual([]);
  });
});

describe('bookingFits — the server-side guard', () => {
  const free = freeSegments(range(13, 16), [range(14, 15)]);

  it('accepts a lesson inside a gap', () => {
    expect(bookingFits(free, range(13, 14))).toBe(true);
  });

  it('rejects one that straddles an existing booking', () => {
    expect(bookingFits(free, { start: at(13, 30), end: at(15, 30) })).toBe(false);
  });

  it('rejects one that runs past the end of the opening', () => {
    expect(bookingFits(free, { start: at(15, 30), end: at(16, 30) })).toBe(false);
  });
});

describe('remainingAfterBooking — what stays on the calendar', () => {
  it('leaves the tail when the lesson takes the front', () => {
    expect(remainingAfterBooking(range(13, 16), range(13, 14))).toEqual([range(14, 16)]);
  });

  it('leaves two blocks when the lesson takes the middle', () => {
    expect(remainingAfterBooking(range(13, 16), range(14, 15))).toEqual([
      range(13, 14),
      range(15, 16),
    ]);
  });

  it('leaves nothing when the lesson takes the lot', () => {
    expect(remainingAfterBooking(range(13, 14), range(13, 14))).toEqual([]);
  });
});

describe('reconcileWindows', () => {
  const existing = [
    { id: 'w1', google_event_id: 'ev1', start_time: at(13), end_time: at(16), location: null },
    { id: 'w2', google_event_id: 'ev2', start_time: at(9), end_time: at(10), location: null },
  ];

  it('leaves an unchanged event alone', () => {
    const plan = reconcileWindows(
      [{ eventId: 'ev1', start: at(13), end: at(16), location: null }],
      [existing[0]],
    );
    expect(plan).toMatchObject({ upserts: [], deleteIds: [], unchanged: 1 });
  });

  it('updates an event the instructor moved', () => {
    const plan = reconcileWindows(
      [{ eventId: 'ev1', start: at(14), end: at(16), location: null }],
      [existing[0]],
    );
    expect(plan.upserts).toHaveLength(1);
    expect(plan.deleteIds).toEqual([]);
  });

  it('removes a window whose event was deleted or renamed — that is how time is taken back', () => {
    const plan = reconcileWindows(
      [{ eventId: 'ev1', start: at(13), end: at(16), location: null }],
      existing,
    );
    expect(plan.deleteIds).toEqual(['w2']);
  });

  it('adds an event that was not there before', () => {
    const plan = reconcileWindows([{ eventId: 'ev9', start: at(8), end: at(9), location: 'Court 3' }], []);
    expect(plan.upserts[0]).toMatchObject({ google_event_id: 'ev9', location: 'Court 3' });
  });
});

describe('minutesOf', () => {
  it('measures a window in minutes', () => {
    expect(minutesOf(range(13, 16))).toBe(180);
    expect(minutesOf({ start: at(13), end: at(13, 30) })).toBe(30);
  });
});
