import { describe, it, expect } from 'vitest';
import { resolveAnchor } from './anchors';
import { dayOfWeek } from './dates';

describe('resolveAnchor', () => {
  it('returns null for floating events and unparseable rules', () => {
    expect(resolveAnchor(null, 2027)).toBeNull();
    expect(resolveAnchor('', 2027)).toBeNull();
    expect(resolveAnchor('nonsense:whatever', 2027)).toBeNull();
    expect(resolveAnchor('fixed:99-99', 2027)).toBeNull();
    expect(resolveAnchor('nth:3:6:NOPE', 2027)).toBeNull();
  });

  describe('fixed', () => {
    it('pins to an exact date with no window', () => {
      const a = resolveAnchor('fixed:07-04', 2027)!;
      expect(a.date).toBe('2027-07-04');
      expect(a.start).toBe('2027-07-04');
      expect(a.end).toBe('2027-07-04');
      expect(a.strength).toBe('exact');
      expect(a.label).toBe('July 4');
    });
  });

  describe('nearest', () => {
    it('finds the requested weekday nearest the date', () => {
      // July 4 2027 is a Sunday, so the nearest Saturday is the 3rd.
      const a = resolveAnchor('nearest:07-04:SAT', 2027)!;
      expect(a.date).toBe('2027-07-03');
      expect(a.strength).toBe('window');
      expect(dayOfWeek(a.date)).toBe(6);
    });

    it('allows a week either side', () => {
      const a = resolveAnchor('nearest:07-04:SAT', 2027)!;
      expect(a.start).toBe('2027-06-26');
      expect(a.end).toBe('2027-07-10');
    });
  });

  describe('nth', () => {
    it('resolves the nth weekday and opens the window to the month', () => {
      const a = resolveAnchor('nth:3:6:SAT', 2027)!;
      expect(a.date).toBe('2027-06-19');
      expect(a.start).toBe('2027-06-01');
      expect(a.end).toBe('2027-06-30');
      expect(a.label).toBe('3rd Saturday of June');
    });

    it('supports last-of-month', () => {
      const a = resolveAnchor('nth:-1:5:SAT', 2027)!;
      expect(a.date).toBe('2027-05-29');
      expect(a.label).toBe('last Saturday of May');
    });
  });

  describe('holiday', () => {
    it('pins exactly to the holiday', () => {
      const a = resolveAnchor('holiday:new-years-day', 2027)!;
      expect(a.date).toBe('2027-01-01');
      expect(a.strength).toBe('exact');
      expect(a.label).toBe("New Year's Day");
    });

    it('returns null for an unknown holiday key', () => {
      expect(resolveAnchor('holiday:not-a-holiday', 2027)).toBeNull();
    });
  });

  describe('holiday-weekend', () => {
    it('anchors a Monday holiday to the Saturday that opens the weekend', () => {
      // Memorial Day 2027 is Monday May 31, so the weekend opens Saturday May 29.
      const a = resolveAnchor('holiday-weekend:memorial', 2027)!;
      expect(a.date).toBe('2027-05-29');
      expect(dayOfWeek(a.date)).toBe(6);
      expect(a.strength).toBe('window');
      expect(a.label).toBe('Memorial Day weekend');
    });

    it('covers the whole long weekend in its window', () => {
      const a = resolveAnchor('holiday-weekend:memorial', 2027)!;
      expect(a.start).toBe('2027-05-28'); // Friday
      expect(a.end).toBe('2027-05-31');   // Monday
    });
  });

  describe('grand-slam', () => {
    it('lands on a Saturday inside the fortnight', () => {
      const a = resolveAnchor('grand-slam:wimbledon', 2027)!;
      expect(dayOfWeek(a.date)).toBe(6);
      expect(a.date >= a.start && a.date <= a.end).toBe(true);
      expect(a.label).toBe('Wimbledon fortnight');
    });

    it('resolves all four slams', () => {
      for (const k of ['australian', 'roland-garros', 'wimbledon', 'us-open']) {
        expect(resolveAnchor(`grand-slam:${k}`, 2027)).not.toBeNull();
      }
    });
  });

  describe('month', () => {
    it('opens the window to the whole month', () => {
      const a = resolveAnchor('month:10', 2027)!;
      expect(a.start).toBe('2027-10-01');
      expect(a.end).toBe('2027-10-31');
      expect(dayOfWeek(a.date)).toBe(6);
      expect(a.label).toBe('October');
    });

    it('rejects an out-of-range month', () => {
      expect(resolveAnchor('month:13', 2027)).toBeNull();
    });
  });

  it('moves with the year', () => {
    const a = resolveAnchor('nearest:07-04:SAT', 2028)!;
    expect(a.date.startsWith('2028-')).toBe(true);
    // July 4 2028 is a Tuesday → nearest Saturday is July 1.
    expect(a.date).toBe('2028-07-01');
  });
});
