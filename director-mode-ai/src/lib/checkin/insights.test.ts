import { describe, expect, it } from 'vitest';
import { courtsLabel, findings, type InsightSession, type InsightWait } from './insights';

const TZ = 'America/Los_Angeles';
// Tue Sep 15 2026, 3 PM Pacific.
const NOW = Date.parse('2026-09-15T22:00:00Z');
const H = 3600_000;

/** An instant at a club-local wall time, N days before NOW's date. PDT is UTC-7 in September. */
const at = (daysAgo: number, hh: number, mm = 0) => Date.parse(`2026-09-${String(15 - daysAgo).padStart(2, '0')}T${String(hh + 7).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00Z`);

const courts = Array.from({ length: 8 }, (_, i) => ({ id: `c${i + 1}`, name: `Court ${i + 1}` }));

describe('courtsLabel', () => {
  it('compresses consecutive courts and lists the rest', () => {
    expect(courtsLabel(['Court 1', 'Court 2', 'Court 3', 'Court 4'])).toBe('Courts 1–4');
    expect(courtsLabel(['Court 7', 'Court 2', 'Court 5'])).toBe('Courts 2, 5 and 7');
    expect(courtsLabel(['Court 3'])).toBe('Court 3');
  });
});

describe('findings', () => {
  it('names the full courts and the empty ones in prime time, in club time', () => {
    const sessions: InsightSession[] = [];
    for (let d = 1; d <= 7; d += 1) {
      for (let c = 1; c <= 4; c += 1) {
        // 7:00–10:45 local on courts 1–4: 3.75 of 4 prime hours.
        sessions.push({ spaceId: `c${c}`, kind: 'court', startedAt: at(d, 7), endedAt: at(d, 10, 45), playType: 'doubles', playerCount: 4, guestCount: 0, endReason: 'done' });
      }
    }
    const f = findings({ now: NOW, timezone: TZ, primeStart: '07:00', primeEnd: '11:00', courts, sessions, waits: [] });
    expect(f[0].key).toBe('prime');
    expect(f[0].headline).toBe('Courts 1–4 were full 94% of prime time last week; Courts 5–8 sat empty 100% of it.');
  });

  it('stays quiet below the sample floor', () => {
    const sessions: InsightSession[] = [
      { spaceId: 'c1', kind: 'court', startedAt: at(1, 8), endedAt: at(1, 9), playType: 'singles', playerCount: 2, guestCount: 0, endReason: 'done' },
    ];
    expect(findings({ now: NOW, timezone: TZ, primeStart: '07:00', primeEnd: '11:00', courts, sessions, waits: [] })).toEqual([]);
  });

  it('finds the worst hour to be waiting, by club-local day and hour', () => {
    const waits: InsightWait[] = [];
    // Saturday Sep 12, 9 AM local: three groups waited 15, 18, 21 minutes.
    for (const m of [15, 18, 21]) waits.push({ joinedAt: at(3, 9, 5), offeredAt: at(3, 9, 5) + m * 60_000, status: 'playing' });
    // Two short waits elsewhere.
    for (const m of [2, 4]) waits.push({ joinedAt: at(2, 14), offeredAt: at(2, 14) + m * 60_000, status: 'playing' });
    const f = findings({ now: NOW, timezone: TZ, primeStart: '07:00', primeEnd: '11:00', courts, sessions: [], waits });
    expect(f.find((x) => x.key === 'wait')?.headline).toBe('Average wait on Saturday 9 AM: 18 min.');
  });

  it('counts pool guest visits for the last complete month', () => {
    const sessions: InsightSession[] = [];
    for (let i = 0; i < 6; i += 1) {
      const start = Date.parse(`2026-08-${String(10 + i).padStart(2, '0')}T20:00:00Z`);
      sessions.push({ spaceId: 'pool', kind: 'pool', startedAt: start, endedAt: start + 2 * H, playType: 'visit', playerCount: 1, guestCount: i + 1, endReason: 'checkout' });
    }
    const f = findings({ now: NOW, timezone: TZ, primeStart: '07:00', primeEnd: '11:00', courts, sessions, waits: [] });
    expect(f.find((x) => x.key === 'guests')?.headline).toBe('Pool: 21 guest visits in August.');
  });
});
