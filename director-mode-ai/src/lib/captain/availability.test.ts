import { describe, it, expect } from 'vitest';
import { matchWeekday, resolveAvailability, isDayCode, DAYS } from './availability';

const p = (id: string, name: string, days?: string[]) => ({
  id,
  name,
  unavailable_days: days ?? [],
});

describe('matchWeekday', () => {
  it('uses club-local time, not UTC, for an evening match', () => {
    // 7pm Monday 2026-09-14 in Los Angeles is 02:00 Tuesday UTC. Matching on
    // UTC would blackout Tuesday for every Monday evening match.
    expect(matchWeekday('2026-09-15T02:00:00Z')).toBe('Mon');
  });

  it('handles a morning match', () => {
    expect(matchWeekday('2026-09-16T16:00:00Z')).toBe('Wed');
  });

  it('is correct either side of the DST change', () => {
    // PDT (UTC-7): 6pm Thu Oct 29 2026 -> 01:00 Fri UTC
    expect(matchWeekday('2026-10-30T01:00:00Z')).toBe('Thu');
    // PST (UTC-8): 6pm Thu Nov 12 2026 -> 02:00 Fri UTC
    expect(matchWeekday('2026-11-13T02:00:00Z')).toBe('Thu');
  });

  it('returns codes that match what the intake form writes', () => {
    for (let i = 0; i < 7; i++) {
      const iso = new Date(Date.UTC(2026, 8, 14 + i, 19, 0, 0)).toISOString();
      expect(DAYS).toContain(matchWeekday(iso));
    }
  });
});

describe('isDayCode', () => {
  it('accepts the seven codes and nothing else', () => {
    expect(isDayCode('Mon')).toBe(true);
    expect(isDayCode('Sun')).toBe(true);
    expect(isDayCode('Monday')).toBe(false);
    expect(isDayCode('')).toBe(false);
    expect(isDayCode(3)).toBe(false);
  });
});

describe('resolveAvailability', () => {
  const monday = '2026-09-15T02:00:00Z'; // Mon 7pm LA

  it('an explicit yes makes a player available', () => {
    const r = resolveAvailability({
      roster: [p('a', 'Ann')],
      answers: [{ player_id: 'a', status: 'yes' }],
      matchAt: monday,
    });
    expect(r.available.map((x) => x.id)).toEqual(['a']);
    expect(r.warnings).toEqual([]);
  });

  it('excludes a blacked-out player who never answered, and says why', () => {
    const r = resolveAvailability({
      roster: [p('a', 'Ann', ['Mon']), p('b', 'Bea')],
      answers: [{ player_id: 'b', status: 'yes' }],
      matchAt: monday,
    });
    expect(r.available.map((x) => x.id)).toEqual(['b']);
    expect(r.blockedByDay.map((x) => x.id)).toEqual(['a']);
    expect(r.awaiting).toEqual([]); // blacked out, so not worth nudging
    expect(r.warnings.join(' ')).toContain('Ann');
    expect(r.warnings.join(' ')).toContain('Mon');
  });

  it('an explicit yes overrides a standing blackout, but is flagged', () => {
    const r = resolveAvailability({
      roster: [p('a', 'Ann', ['Mon'])],
      answers: [{ player_id: 'a', status: 'yes' }],
      matchAt: monday,
    });
    expect(r.available.map((x) => x.id)).toEqual(['a']);
    expect(r.dayOverrides.map((x) => x.id)).toEqual(['a']);
    expect(r.warnings.join(' ')).toContain('said yes');
  });

  it('a blackout on another day does not exclude anyone', () => {
    const r = resolveAvailability({
      roster: [p('a', 'Ann', ['Thu', 'Fri'])],
      answers: [{ player_id: 'a', status: 'yes' }],
      matchAt: monday,
    });
    expect(r.available.map((x) => x.id)).toEqual(['a']);
    expect(r.warnings).toEqual([]);
  });

  it('treats maybe and no alike — neither is available nor awaiting', () => {
    const r = resolveAvailability({
      roster: [p('a', 'Ann'), p('b', 'Bea')],
      answers: [
        { player_id: 'a', status: 'maybe' },
        { player_id: 'b', status: 'no' },
      ],
      matchAt: monday,
    });
    expect(r.available).toEqual([]);
    expect(r.awaiting).toEqual([]);
  });

  it('non-responders with no blackout are the nudge list', () => {
    const r = resolveAvailability({
      roster: [p('a', 'Ann'), p('b', 'Bea', ['Mon']), p('c', 'Cal')],
      answers: [{ player_id: 'c', status: 'yes' }],
      matchAt: monday,
    });
    expect(r.awaiting.map((x) => x.id)).toEqual(['a']);
    expect(r.blockedByDay.map((x) => x.id)).toEqual(['b']);
  });

  it('a no from a blacked-out player is not double-reported', () => {
    const r = resolveAvailability({
      roster: [p('a', 'Ann', ['Mon'])],
      answers: [{ player_id: 'a', status: 'no' }],
      matchAt: monday,
    });
    expect(r.blockedByDay).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it('names in warnings are sorted so the message is stable', () => {
    const r = resolveAvailability({
      roster: [p('z', 'Zoe', ['Mon']), p('a', 'Ann', ['Mon'])],
      answers: [],
      matchAt: monday,
    });
    expect(r.warnings[0]).toContain('Ann, Zoe');
  });

  it('handles an empty roster', () => {
    const r = resolveAvailability({ roster: [], answers: [], matchAt: monday });
    expect(r.available).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it('tolerates a null unavailable_days', () => {
    const r = resolveAvailability({
      roster: [{ id: 'a', name: 'Ann', unavailable_days: null }],
      answers: [{ player_id: 'a', status: 'yes' }],
      matchAt: monday,
    });
    expect(r.available.map((x) => x.id)).toEqual(['a']);
  });
});
