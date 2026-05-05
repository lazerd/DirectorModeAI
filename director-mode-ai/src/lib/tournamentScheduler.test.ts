import { describe, it, expect } from 'vitest';
import {
  optimizeTournamentSchedule,
  topologicallySortMatches,
  dayRange,
  timeToMinutes,
  minutesToTime,
  type SchedulerMatch,
} from './tournamentScheduler';

describe('time helpers', () => {
  it('timeToMinutes / minutesToTime round-trip', () => {
    expect(timeToMinutes('09:00')).toBe(540);
    expect(timeToMinutes('13:30')).toBe(810);
    expect(minutesToTime(540)).toBe('09:00');
    expect(minutesToTime(810)).toBe('13:30');
  });
});

describe('dayRange', () => {
  it('inclusive range of days', () => {
    expect(dayRange('2026-05-10', '2026-05-12')).toEqual([
      '2026-05-10',
      '2026-05-11',
      '2026-05-12',
    ]);
  });
  it('single day', () => {
    expect(dayRange('2026-05-10', '2026-05-10')).toEqual(['2026-05-10']);
  });
  it('empty when end before start', () => {
    expect(dayRange('2026-05-12', '2026-05-10')).toEqual([]);
  });
  it('handles month boundary', () => {
    expect(dayRange('2026-05-30', '2026-06-01')).toEqual([
      '2026-05-30',
      '2026-05-31',
      '2026-06-01',
    ]);
  });
});

describe('topologicallySortMatches', () => {
  it('orders by predecessor', () => {
    const matches: SchedulerMatch[] = [
      { id: 'final', player_ids: [null, null], predecessor_match_ids: ['sf1', 'sf2'] },
      { id: 'sf1', player_ids: [null, null], predecessor_match_ids: ['qf1', 'qf2'] },
      { id: 'sf2', player_ids: [null, null], predecessor_match_ids: ['qf3', 'qf4'] },
      { id: 'qf1', player_ids: ['a', 'b'], predecessor_match_ids: [] },
      { id: 'qf2', player_ids: ['c', 'd'], predecessor_match_ids: [] },
      { id: 'qf3', player_ids: ['e', 'f'], predecessor_match_ids: [] },
      { id: 'qf4', player_ids: ['g', 'h'], predecessor_match_ids: [] },
    ];
    const sorted = topologicallySortMatches(matches);
    const idx = (id: string) => sorted.findIndex((m) => m.id === id);
    expect(idx('qf1')).toBeLessThan(idx('sf1'));
    expect(idx('qf2')).toBeLessThan(idx('sf1'));
    expect(idx('qf3')).toBeLessThan(idx('sf2'));
    expect(idx('qf4')).toBeLessThan(idx('sf2'));
    expect(idx('sf1')).toBeLessThan(idx('final'));
    expect(idx('sf2')).toBeLessThan(idx('final'));
  });

  it('throws on cycle', () => {
    const matches: SchedulerMatch[] = [
      { id: 'a', player_ids: [], predecessor_match_ids: ['b'] },
      { id: 'b', player_ids: [], predecessor_match_ids: ['a'] },
    ];
    expect(() => topologicallySortMatches(matches)).toThrow();
  });
});

describe('optimizeTournamentSchedule — basic', () => {
  it('places single-day RR matches into available slots', () => {
    // 4-player RR: 6 matches, no dependencies
    const matches: SchedulerMatch[] = [
      { id: 'm1', player_ids: ['a', 'b'], predecessor_match_ids: [] },
      { id: 'm2', player_ids: ['c', 'd'], predecessor_match_ids: [] },
      { id: 'm3', player_ids: ['a', 'c'], predecessor_match_ids: [] },
      { id: 'm4', player_ids: ['b', 'd'], predecessor_match_ids: [] },
      { id: 'm5', player_ids: ['a', 'd'], predecessor_match_ids: [] },
      { id: 'm6', player_ids: ['b', 'c'], predecessor_match_ids: [] },
    ];
    const out = optimizeTournamentSchedule({
      matches,
      courts: ['1', '2'],
      startDate: '2026-05-10',
      endDate: '2026-05-10',
      dailyStartTime: '09:00',
      dailyEndTime: '18:00',
      matchLengthMinutes: 90,
      playerRestMinutes: 60,
      matchBufferMinutes: 30,
    });
    expect(out.unscheduled).toEqual([]);
    expect(out.assignments.size).toBe(6);
    // All on the same day
    for (const a of out.assignments.values()) {
      expect(a.scheduled_date).toBe('2026-05-10');
    }
  });

  it('respects player rest — same player matches dont overlap or chain too tightly', () => {
    const matches: SchedulerMatch[] = [
      { id: 'm1', player_ids: ['a', 'b'], predecessor_match_ids: [] },
      { id: 'm2', player_ids: ['a', 'c'], predecessor_match_ids: [] },
    ];
    const out = optimizeTournamentSchedule({
      matches,
      courts: ['1', '2'],
      startDate: '2026-05-10',
      endDate: '2026-05-10',
      dailyStartTime: '09:00',
      dailyEndTime: '18:00',
      matchLengthMinutes: 60,
      playerRestMinutes: 60, // a needs 60 min between m1 and m2
      matchBufferMinutes: 30,
    });
    expect(out.unscheduled).toEqual([]);
    const m1 = out.assignments.get('m1')!;
    const m2 = out.assignments.get('m2')!;
    const m1End = timeToMinutes(m1.scheduled_at) + 60;
    const m2Start = timeToMinutes(m2.scheduled_at);
    // a is in both — m2 must start at least 60 min after m1 ends
    expect(m2Start).toBeGreaterThanOrEqual(m1End + 60);
  });

  it('respects bracket dependencies (winner of QF can play SF only after both QFs end)', () => {
    const matches: SchedulerMatch[] = [
      { id: 'qf1', player_ids: ['a', 'b'], predecessor_match_ids: [] },
      { id: 'qf2', player_ids: ['c', 'd'], predecessor_match_ids: [] },
      { id: 'sf', player_ids: [null, null], predecessor_match_ids: ['qf1', 'qf2'] },
    ];
    const out = optimizeTournamentSchedule({
      matches,
      courts: ['1', '2'],
      startDate: '2026-05-10',
      endDate: '2026-05-10',
      dailyStartTime: '09:00',
      dailyEndTime: '18:00',
      matchLengthMinutes: 90,
      playerRestMinutes: 0,
      matchBufferMinutes: 30,
    });
    const qf1 = out.assignments.get('qf1')!;
    const qf2 = out.assignments.get('qf2')!;
    const sf = out.assignments.get('sf')!;
    const sfStart = timeToMinutes(sf.scheduled_at);
    const qf1End = timeToMinutes(qf1.scheduled_at) + 90;
    const qf2End = timeToMinutes(qf2.scheduled_at) + 90;
    expect(sfStart).toBeGreaterThanOrEqual(qf1End + 30);
    expect(sfStart).toBeGreaterThanOrEqual(qf2End + 30);
  });

  it('rolls into next day when matches dont fit in window', () => {
    // Window: 9 to 11 = only 120 min per day. Match length 90 → only one slot per court per day.
    // 4 matches with 1 court → needs 4 days
    const matches: SchedulerMatch[] = [
      { id: 'm1', player_ids: ['a', 'b'], predecessor_match_ids: [] },
      { id: 'm2', player_ids: ['c', 'd'], predecessor_match_ids: [] },
      { id: 'm3', player_ids: ['e', 'f'], predecessor_match_ids: [] },
      { id: 'm4', player_ids: ['g', 'h'], predecessor_match_ids: [] },
    ];
    const out = optimizeTournamentSchedule({
      matches,
      courts: ['1'],
      startDate: '2026-05-10',
      endDate: '2026-05-13', // 4 days
      dailyStartTime: '09:00',
      dailyEndTime: '11:00',
      matchLengthMinutes: 90,
      playerRestMinutes: 0,
      matchBufferMinutes: 0,
    });
    expect(out.unscheduled).toEqual([]);
    const days = new Set(Array.from(out.assignments.values()).map((a) => a.scheduled_date));
    expect(days.size).toBe(4);
  });

  it('reports unscheduled when window cant fit all matches', () => {
    const matches: SchedulerMatch[] = [
      { id: 'm1', player_ids: ['a', 'b'], predecessor_match_ids: [] },
      { id: 'm2', player_ids: ['c', 'd'], predecessor_match_ids: [] },
    ];
    const out = optimizeTournamentSchedule({
      matches,
      courts: ['1'],
      startDate: '2026-05-10',
      endDate: '2026-05-10',
      dailyStartTime: '09:00',
      dailyEndTime: '10:00',
      matchLengthMinutes: 90, // can't fit even one
      playerRestMinutes: 0,
      matchBufferMinutes: 0,
    });
    expect(out.unscheduled.length).toBe(2);
  });

  it('court fairness: distributes matches across courts (not all on court 1)', () => {
    // 8 totally independent matches, 4 courts, single day, plenty of time
    const matches: SchedulerMatch[] = Array.from({ length: 8 }, (_, i) => ({
      id: `m${i + 1}`,
      player_ids: [`p${i * 2 + 1}`, `p${i * 2 + 2}`], // unique players in each match
      predecessor_match_ids: [],
    }));
    const out = optimizeTournamentSchedule({
      matches,
      courts: ['1', '2', '3', '4'],
      startDate: '2026-05-10',
      endDate: '2026-05-10',
      dailyStartTime: '09:00',
      dailyEndTime: '18:00',
      matchLengthMinutes: 90,
      playerRestMinutes: 0,
      matchBufferMinutes: 0,
    });
    const byCourt = new Map<string, number>();
    for (const a of out.assignments.values()) {
      byCourt.set(a.court, (byCourt.get(a.court) ?? 0) + 1);
    }
    // 8 / 4 = 2 each (perfect distribution)
    for (const c of ['1', '2', '3', '4']) {
      expect(byCourt.get(c)).toBe(2);
    }
  });

  it('multi-event player conflict: a player in singles AND doubles cant overlap', () => {
    // Player 'a' is in two unrelated matches simultaneously eligible
    const matches: SchedulerMatch[] = [
      { id: 'singles_a', player_ids: ['a', 'b'], predecessor_match_ids: [] },
      { id: 'doubles_a', player_ids: ['a', 'c', 'd', 'e'], predecessor_match_ids: [] },
    ];
    const out = optimizeTournamentSchedule({
      matches,
      courts: ['1', '2'],
      startDate: '2026-05-10',
      endDate: '2026-05-10',
      dailyStartTime: '09:00',
      dailyEndTime: '18:00',
      matchLengthMinutes: 60,
      playerRestMinutes: 0, // even with no rest, they can't overlap
      matchBufferMinutes: 0,
    });
    const m1 = out.assignments.get('singles_a')!;
    const m2 = out.assignments.get('doubles_a')!;
    const m1Start = timeToMinutes(m1.scheduled_at);
    const m1End = m1Start + 60;
    const m2Start = timeToMinutes(m2.scheduled_at);
    const m2End = m2Start + 60;
    // One must be entirely before the other (no overlap)
    const noOverlap = m1End <= m2Start || m2End <= m1Start;
    expect(noOverlap).toBe(true);
  });
});
