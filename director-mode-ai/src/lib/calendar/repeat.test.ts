import { describe, it, expect } from 'vitest';
import {
  looksLikeJunk, seriesKey, seriesTitle, mapToYear, buildRepeatCandidates, type PastEvent,
} from './repeat';
import { dayOfWeek, monthOf } from './dates';

// The fixture is Sleepy Hollow's real 2026 events table, verbatim — including
// the junk rows, the five differently-named Summer Slams, and the four Flex
// League divisions that share a date.
const REAL_2026: PastEvent[] = [
  { id: '1', name: 'Luck of the Draw St Patricks Day Social', event_date: '2026-03-22', match_format: 'maximize-courts', entry_fee_cents: 0 },
  { id: '2', name: 'dsfdsf', event_date: '2026-04-03', match_format: 'mixed-doubles', entry_fee_cents: 0 },
  { id: '3', name: 'Test', event_date: '2026-04-03', match_format: 'maximize-courts', entry_fee_cents: 0 },
  { id: '4', name: 'test', event_date: '2026-04-05', match_format: 'maximize-courts', entry_fee_cents: 0 },
  { id: '5', name: 'Spring Swing Sleepy Hollow Tennis Social', event_date: '2026-04-17', match_format: 'maximize-courts', entry_fee_cents: 0 },
  { id: '6', name: '10U Quads Coed', event_date: '2026-04-30', match_format: 'quads', entry_fee_cents: 0 },
  { id: '7', name: 'JTCC Holidays', event_date: '2026-05-16', match_format: 'single-elim-doubles', entry_fee_cents: 13523 },
  { id: '8', name: 'Summer Slam 2026', event_date: '2026-06-11', match_format: 'team-battle', entry_fee_cents: 0 },
  { id: '9', name: 'Summer Slam 2026', event_date: '2026-06-18', match_format: 'team-battle', entry_fee_cents: 0 },
  { id: '10', name: "Women's Singles — Summer Flex League", event_date: '2026-06-22', match_format: 'rr-singles', entry_fee_cents: 0 },
  { id: '11', name: "Men's Singles — Summer Flex League", event_date: '2026-06-22', match_format: 'rr-singles', entry_fee_cents: 0 },
  { id: '12', name: "Men's Doubles — Summer Flex League", event_date: '2026-06-22', match_format: 'rr-doubles', entry_fee_cents: 0 },
  { id: '13', name: "Women's Doubles — Summer Flex League", event_date: '2026-06-22', match_format: 'rr-doubles', entry_fee_cents: 0 },
  { id: '14', name: 'Summer Slam #4', event_date: '2026-07-03', match_format: 'team-battle', entry_fee_cents: 0 },
  { id: '15', name: 'Wimbledon Social 2026', event_date: '2026-07-11', match_format: 'maximize-courts', entry_fee_cents: 0 },
  { id: '16', name: 'July 16 Summer Slam', event_date: '2026-07-16', match_format: 'team-battle', entry_fee_cents: 0 },
  { id: '17', name: 'JTT 10U Season-End — Gold · Sleepy Hollow', event_date: '2026-07-21', match_format: 'rr-singles', entry_fee_cents: 2500 },
  { id: '18', name: 'Summer Slam July 23', event_date: '2026-07-24', match_format: 'team-battle', entry_fee_cents: 0 },
];

describe('looksLikeJunk', () => {
  it('catches the placeholders actually in the table', () => {
    expect(looksLikeJunk('Test')).toBe(true);
    expect(looksLikeJunk('test')).toBe(true);
    expect(looksLikeJunk('dsfdsf')).toBe(true);
  });

  it('catches other common placeholders', () => {
    for (const t of ['testing', 'demo', 'asdf', 'qwerty', 'Untitled', 'New Event', 'Copy of Something', 'tmp', 'x']) {
      expect(looksLikeJunk(t), t).toBe(true);
    }
  });

  // A false positive hides a real event, which is the worse failure.
  it('leaves real event names alone', () => {
    for (const t of [
      'Summer Slam 2026', 'Wimbledon Social 2026', '10U Quads Coed', 'JTCC Holidays',
      'Luck of the Draw St Patricks Day Social', "Men's Doubles — Summer Flex League",
      'JTT 10U Season-End — Gold · Sleepy Hollow', 'BBQ', 'Calcutta',
    ]) {
      expect(looksLikeJunk(t), t).toBe(false);
    }
  });

  it('does not mistake a real short name for mash', () => {
    // Has a vowel, so it survives the keyboard-mash rule.
    expect(looksLikeJunk('Quads')).toBe(false);
    expect(looksLikeJunk('BBQ')).toBe(false);
  });
});

describe('seriesKey', () => {
  it('collapses the four ways one club named the same weekly event', () => {
    const keys = ['Summer Slam 2026', 'Summer Slam #4', 'July 16 Summer Slam', 'Summer Slam July 23']
      .map(seriesKey);
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toBe('summer slam');
  });

  it('keeps genuinely different events apart', () => {
    expect(seriesKey("Men's Singles — Summer Flex League"))
      .not.toBe(seriesKey("Women's Singles — Summer Flex League"));
    expect(seriesKey('Summer Slam')).not.toBe(seriesKey('Spring Swing'));
  });

  it('strips years, numbers and month words', () => {
    expect(seriesKey('Wimbledon Social 2026')).toBe('wimbledon social');
    expect(seriesKey('Week 3 Ladies Day')).toBe('ladies day');
  });
});

describe('seriesTitle', () => {
  it('picks the clean name, not a dated variant', () => {
    expect(seriesTitle(['Summer Slam 2026', 'Summer Slam #4', 'July 16 Summer Slam'])).toBe('Summer Slam');
  });

  it('drops a trailing year', () => {
    expect(seriesTitle(['Wimbledon Social 2026'])).toBe('Wimbledon Social');
  });
});

describe('mapToYear', () => {
  // Annual events recur by position, not by date.
  it('keeps the same nth weekday of the month', () => {
    // 2026-06-11 is the 2nd Thursday of June.
    const mapped = mapToYear('2026-06-11', 2027);
    expect(dayOfWeek(mapped)).toBe(dayOfWeek('2026-06-11'));
    expect(monthOf(mapped)).toBe(6);
    expect(mapped).toBe('2027-06-10'); // 2nd Thursday of June 2027
  });

  it('maps a Saturday to a Saturday', () => {
    const mapped = mapToYear('2026-03-22', 2027);
    expect(dayOfWeek(mapped)).toBe(dayOfWeek('2026-03-22'));
    expect(monthOf(mapped)).toBe(3);
  });

  it('lands in the target year', () => {
    for (const d of ['2026-01-03', '2026-07-04', '2026-12-31']) {
      expect(mapToYear(d, 2027).startsWith('2027-')).toBe(true);
    }
  });

  it('falls back to the last occurrence when a 5th weekday does not exist', () => {
    // 2026-05-30 is the 5th Saturday of May.
    const mapped = mapToYear('2026-05-30', 2027);
    expect(monthOf(mapped)).toBe(5);
    expect(dayOfWeek(mapped)).toBe(6);
    expect(mapped.startsWith('2027-05')).toBe(true);
  });

  it('is stable — mapping twice gives the same answer', () => {
    expect(mapToYear('2026-06-11', 2027)).toBe(mapToYear('2026-06-11', 2027));
  });
});

describe('buildRepeatCandidates on the real 2026 table', () => {
  const candidates = buildRepeatCandidates(REAL_2026, 2027);
  const byTitle = (t: string) => candidates.find((c) => c.title === t);

  it('drops every junk row', () => {
    const titles = candidates.map((c) => c.title.toLowerCase());
    expect(titles).not.toContain('test');
    expect(titles).not.toContain('dsfdsf');
  });

  it('collapses five Summer Slams into one series', () => {
    const slam = byTitle('Summer Slam')!;
    expect(slam).toBeDefined();
    expect(slam.occurrences).toBe(5);
    expect(slam.isSeries).toBe(true);
    expect(slam.note).toContain('5 times');
    expect(slam.note).toContain('Jun');
  });

  it('proposes a date for every occurrence of a series', () => {
    const slam = byTitle('Summer Slam')!;
    expect(slam.proposedDates).toHaveLength(5);
    expect(slam.proposedDates.every((d) => d.startsWith('2027-'))).toBe(true);
    // Weekly cadence preserved: still all the same weekday.
    expect(new Set(slam.proposedDates.map(dayOfWeek)).size).toBe(1);
  });

  it('keeps the four Flex League divisions separate', () => {
    const flex = candidates.filter((c) => c.title.includes('Flex League'));
    expect(flex).toHaveLength(4);
    expect(flex.every((c) => c.occurrences === 1)).toBe(true);
  });

  it('keeps the one-offs as one-offs', () => {
    expect(byTitle('Wimbledon Social')!.occurrences).toBe(1);
    expect(byTitle('Wimbledon Social')!.isSeries).toBe(false);
    expect(byTitle('10U Quads Coed')!.occurrences).toBe(1);
  });

  it('carries logistics forward', () => {
    const jtcc = candidates.find((c) => c.title.includes('JTCC'))!;
    expect(jtcc.entry_fee_cents).toBe(13523);
    expect(jtcc.match_format).toBe('single-elim-doubles');
  });

  it('puts series first', () => {
    const firstNonSeries = candidates.findIndex((c) => !c.isSeries);
    const lastSeries = candidates.map((c) => c.isSeries).lastIndexOf(true);
    expect(lastSeries).toBeLessThan(firstNonSeries);
  });

  it('produces a sane number of rows from 18 messy events', () => {
    // 18 rows → 3 junk dropped, 5 slams collapsed to 1 = 11 candidates.
    expect(candidates.length).toBe(11);
  });

  it('gives every candidate a title, a note and at least one date', () => {
    for (const c of candidates) {
      expect(c.title.length).toBeGreaterThan(2);
      expect(c.note.length).toBeGreaterThan(3);
      expect(c.proposedDates.length).toBeGreaterThan(0);
    }
  });

  it('handles an empty table', () => {
    expect(buildRepeatCandidates([], 2027)).toEqual([]);
  });

  it('handles a table of nothing but junk', () => {
    expect(buildRepeatCandidates(
      [{ id: '1', name: 'test', event_date: '2026-01-01' }],
      2027,
    )).toEqual([]);
  });
});
