import { describe, it, expect } from 'vitest';
import { computeBoard, formatEta, formatAhead, bumpedPosition, type QueueRow } from './engine';

const NOW = new Date('2026-08-23T10:00:00-07:00');
const iso = (minsAgo: number) => new Date(NOW.getTime() - minsAgo * 60_000).toISOString();

function row(p: Partial<QueueRow> & { id: string }): QueueRow {
  return {
    division: 'BG12',
    round_label: 'R1',
    player_a: 'A',
    player_b: 'B',
    court: null,
    status: 'waiting',
    queue_position: 0,
    called_at: null,
    court_assigned_at: null,
    started_at: null,
    completed_at: null,
    bumped_count: 0,
    ...p,
  };
}

const COURTS = ['1', '2', '3', '4'];
const opts = { courts: COURTS, defaultMatchMinutes: 80, now: NOW };

describe('computeBoard', () => {
  it('falls back to the configured default until enough matches finish', () => {
    const b = computeBoard([row({ id: 'a' })], opts);
    expect(b.provisional).toBe(true);
    expect(b.medianMin).toBe(80);
    expect(b.sampleSize).toBe(0);
  });

  it('switches to observed pace once three matches have finished', () => {
    const done = [50, 60, 55].map((d, i) =>
      row({ id: `d${i}`, status: 'completed', started_at: iso(d + 10), completed_at: iso(10) })
    );
    const b = computeBoard(done, opts);
    expect(b.provisional).toBe(false);
    expect(b.sampleSize).toBe(3);
    expect(b.medianMin).toBe(55);
  });

  it('ignores impossible durations from a mis-tapped Start', () => {
    const rows = [
      row({ id: 'ok1', status: 'completed', started_at: iso(70), completed_at: iso(10) }),
      row({ id: 'ok2', status: 'completed', started_at: iso(75), completed_at: iso(15) }),
      // Started and finished 1 minute apart — someone fat-fingered Done.
      row({ id: 'bad', status: 'completed', started_at: iso(31), completed_at: iso(30) }),
    ];
    const b = computeBoard(rows, opts);
    expect(b.sampleSize).toBe(2);
  });

  it('counts everyone genuinely ahead of you', () => {
    const rows = [
      row({ id: 'c1', status: 'on_court', court: '1', started_at: iso(20) }),
      row({ id: 'd1', status: 'on_deck', court: '2', queue_position: 10 }),
      row({ id: 'w1', status: 'waiting', queue_position: 20 }),
      row({ id: 'w2', status: 'waiting', queue_position: 30 }),
    ];
    const b = computeBoard(rows, opts);
    expect(b.waiting.map((r) => r.aheadCount)).toEqual([1, 2]);
    expect(b.onCourt[0].elapsedMin).toBe(20);
  });

  it('sends the first waiting match to an idle court immediately', () => {
    // One court busy, three idle -> no reason to wait.
    const rows = [
      row({ id: 'c1', status: 'on_court', court: '1', started_at: iso(5) }),
      row({ id: 'w1', status: 'waiting', queue_position: 10 }),
    ];
    const b = computeBoard(rows, opts);
    expect(b.waiting[0].etaLowMin).toBe(0);
    expect(b.waiting[0].etaHighMin).toBeLessThanOrEqual(5);
  });

  it('queues behind the earliest-freeing court when every court is busy', () => {
    const rows = COURTS.map((c, i) =>
      row({ id: `c${i}`, status: 'on_court', court: c, started_at: iso(70 - i * 10) })
    );
    // Court 1 started 70 min ago, so with an 80 min median it frees soonest.
    rows.push(row({ id: 'w1', status: 'waiting', queue_position: 10 }));
    const b = computeBoard(rows, opts);
    const w = b.waiting[0];
    expect(w.predictedCourt).toBe('1');
    expect(w.etaLowMin!).toBeGreaterThan(0);
    expect(w.etaHighMin!).toBeGreaterThanOrEqual(w.etaLowMin!);
  });

  it('never predicts a court frees in the past', () => {
    // Match has run 3x the median; it must still read as "about to finish".
    const rows = [
      ...COURTS.map((c, i) => row({ id: `c${i}`, status: 'on_court', court: c, started_at: iso(240) })),
      row({ id: 'w1', status: 'waiting', queue_position: 10 }),
    ];
    const b = computeBoard(rows, opts);
    expect(b.waiting[0].etaLowMin!).toBeGreaterThanOrEqual(0);
    expect(b.waiting[0].etaHighMin!).toBeGreaterThan(0);
  });

  it('stacks waits down the line rather than quoting everyone the same', () => {
    const rows = [
      ...COURTS.map((c, i) => row({ id: `c${i}`, status: 'on_court', court: c, started_at: iso(10) })),
      ...[10, 20, 30, 40, 50].map((p, i) => row({ id: `w${i}`, status: 'waiting', queue_position: p })),
    ];
    const b = computeBoard(rows, opts);
    const highs = b.waiting.map((r) => r.etaHighMin!);
    expect(highs[0]).toBeLessThan(highs[4]);
    expect(b.waiting[4].aheadCount).toBe(4);
  });
});

describe('formatting', () => {
  it('reads like a person wrote it', () => {
    expect(formatAhead(0)).toBe("You're next");
    expect(formatAhead(1)).toBe('1 match ahead');
    expect(formatAhead(4)).toBe('4 matches ahead');
    expect(formatEta(0, 5)).toBe('Next up');
    expect(formatEta(45, 70)).toBe('~45–70 min');
  });
});

describe('bumpedPosition', () => {
  it('drops a missing kid two spots, not to the back of the draw', () => {
    const waiting = [10, 20, 30, 40, 50].map((queue_position) => ({ queue_position }));
    const p = bumpedPosition(waiting, 10, 2);
    expect(p).toBeGreaterThan(20);
    expect(p).toBeLessThan(40);
  });

  it('handles being last in line', () => {
    const waiting = [10, 20].map((queue_position) => ({ queue_position }));
    expect(bumpedPosition(waiting, 20, 2)).toBeGreaterThan(20);
  });
});
