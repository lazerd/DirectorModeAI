import { describe, it, expect } from 'vitest';
import {
  CADENCE_PRESETS, presetByKey, defaultCadence, matchPreset, resolveSchedule,
  dueToday, describeRule, summarizeCadence, reminderCopy, sanitizeCadence,
  dayOfWord, time12, GRACE_DAYS, type ReminderRule,
} from './reminders';

const EVENT = '2027-07-03';
const DEADLINE = '2027-06-26';
const anchors = { eventDate: EVENT, deadline: DEADLINE };

function rule(over: Partial<ReminderRule> = {}): ReminderRule {
  return { id: 'r1', offsetDays: 30, anchor: 'event', tone: 'save-the-date', enabled: true, ...over };
}

describe('presets', () => {
  it('has the cadence Darrin described as the default', () => {
    const std = presetByKey('standard')!;
    // 30 out, 15 out, night before the DEADLINE, and a same-day note.
    expect(std.rules).toHaveLength(4);
    expect(std.rules[0]).toMatchObject({ offsetDays: 30, anchor: 'event' });
    expect(std.rules[1]).toMatchObject({ offsetDays: 15, anchor: 'event' });
    expect(std.rules[2]).toMatchObject({ offsetDays: 1, anchor: 'deadline', tone: 'last-call' });
    expect(std.rules[3]).toMatchObject({ offsetDays: 0, anchor: 'event', tone: 'day-of' });
  });

  it('gives every preset unique rule ids', () => {
    for (const p of CADENCE_PRESETS) {
      const ids = p.rules.map((r) => r.id);
      expect(new Set(ids).size, p.key).toBe(ids.length);
    }
  });

  it('scales the default cadence to the size of the event', () => {
    expect(defaultCadence('flagship').length).toBeGreaterThan(defaultCadence('easy').length);
    expect(defaultCadence('easy').length).toBeGreaterThan(0);
  });

  it('recognises a preset it produced', () => {
    expect(matchPreset(presetByKey('standard')!.rules)).toBe('standard');
    expect(matchPreset(presetByKey('social')!.rules)).toBe('social');
    expect(matchPreset([])).toBe('none');
  });

  it('reports a hand-edited cadence as custom', () => {
    const edited = [...presetByKey('standard')!.rules, rule({ id: 'extra', offsetDays: 3 })];
    expect(matchPreset(edited)).toBeNull();
  });
});

describe('resolveSchedule', () => {
  it('counts offsets back from the event', () => {
    const [res] = resolveSchedule([rule({ offsetDays: 30, anchor: 'event' })], anchors);
    expect(res.sendOn).toBe('2027-06-03');
  });

  // The whole reason anchors exist: these two rules produce different dates.
  it('counts a deadline offset from the deadline, not the event', () => {
    const [res] = resolveSchedule([rule({ id: 'd', offsetDays: 1, anchor: 'deadline' })], anchors);
    expect(res.sendOn).toBe('2027-06-25');

    const [ev] = resolveSchedule([rule({ id: 'e', offsetDays: 1, anchor: 'event' })], anchors);
    expect(ev.sendOn).toBe('2027-07-02');
  });

  it('falls back to the event date when no deadline is set', () => {
    const [res] = resolveSchedule(
      [rule({ offsetDays: 1, anchor: 'deadline' })],
      { eventDate: EVENT, deadline: null },
    );
    expect(res.sendOn).toBe('2027-07-02');
  });

  it('puts a zero offset on the anchor day itself', () => {
    const [res] = resolveSchedule([rule({ offsetDays: 0, anchor: 'event', tone: 'day-of' })], anchors);
    expect(res.sendOn).toBe(EVENT);
  });

  it('returns them in send order', () => {
    const dates = resolveSchedule(presetByKey('standard')!.rules, anchors).map((r) => r.sendOn);
    expect(dates).toEqual([...dates].sort());
  });

  it('marks a rule unanchored when the event has no date', () => {
    const [res] = resolveSchedule([rule()], { eventDate: null, deadline: null });
    expect(res.sendOn).toBeNull();
    expect(res.status).toBe('unanchored');
  });

  it('marks past and disabled rules', () => {
    const res = resolveSchedule(
      [rule({ id: 'a', offsetDays: 30 }), rule({ id: 'b', offsetDays: 1, enabled: false })],
      anchors,
      '2027-07-01',
    );
    expect(res.find((x) => x.rule.id === 'a')!.status).toBe('past');
    expect(res.find((x) => x.rule.id === 'b')!.status).toBe('disabled');
  });
});

describe('dueToday', () => {
  const std = presetByKey('standard')!.rules;
  const none = new Set<string>();

  it('fires a rule on its exact date', () => {
    const due = dueToday({ rules: std, anchors, today: '2027-06-03', alreadySent: none });
    expect(due.map((d) => d.rule.id)).toEqual(['t30']);
  });

  it('fires nothing on a quiet day', () => {
    expect(dueToday({ rules: std, anchors, today: '2027-06-10', alreadySent: none })).toHaveLength(0);
  });

  it('fires the day-of note on the morning of the event', () => {
    const due = dueToday({ rules: std, anchors, today: EVENT, alreadySent: none });
    expect(due.map((d) => d.rule.id)).toEqual(['day0']);
    expect(due[0].rule.tone).toBe('day-of');
  });

  it('fires the last call the night before the deadline', () => {
    const due = dueToday({ rules: std, anchors, today: '2027-06-25', alreadySent: none });
    expect(due.map((d) => d.rule.id)).toEqual(['d1']);
  });

  // The duplicate-send guard, mirrored from the DB's unique constraint.
  it('never re-sends a rule that already went out', () => {
    const sent = new Set(['t30']);
    expect(dueToday({ rules: std, anchors, today: '2027-06-03', alreadySent: sent })).toHaveLength(0);
  });

  it('catches up a reminder the cron missed by a day', () => {
    // t30 was due Jun 3; the cron didn't run until Jun 5.
    const due = dueToday({ rules: std, anchors, today: '2027-06-05', alreadySent: none });
    expect(due.map((d) => d.rule.id)).toEqual(['t30']);
  });

  it('gives up on a save-the-date once it is stale', () => {
    const due = dueToday({ rules: std, anchors, today: '2027-06-08', alreadySent: none });
    expect(due).toHaveLength(0);
  });

  // "See you at 7 tonight" the morning after is worse than not sending at all.
  it('never sends a day-of note late', () => {
    expect(GRACE_DAYS['day-of']).toBe(0);
    const due = dueToday({ rules: std, anchors, today: '2027-07-04', alreadySent: none });
    expect(due).toHaveLength(0);
  });

  it('never sends a last call after the deadline has passed', () => {
    expect(GRACE_DAYS['last-call']).toBe(0);
    const due = dueToday({ rules: std, anchors, today: '2027-06-27', alreadySent: none });
    expect(due.map((d) => d.rule.id)).not.toContain('d1');
  });

  // Otherwise, adding a cadence to a past event would blast four emails at once.
  it('fires nothing for an event that has already happened', () => {
    const due = dueToday({ rules: std, anchors, today: '2027-07-10', alreadySent: none });
    expect(due).toHaveLength(0);
  });

  it('ignores disabled rules', () => {
    const off = std.map((r) => ({ ...r, enabled: false }));
    expect(dueToday({ rules: off, anchors, today: '2027-06-03', alreadySent: none })).toHaveLength(0);
  });

  it('fires nothing when the event has no date', () => {
    const due = dueToday({
      rules: std, anchors: { eventDate: null, deadline: null },
      today: '2027-06-03', alreadySent: none,
    });
    expect(due).toHaveLength(0);
  });

  it('walks the whole standard cadence exactly once each', () => {
    const sent = new Set<string>();
    const fired: string[] = [];
    let day = '2027-05-01';
    for (let i = 0; i < 100; i++) {
      for (const d of dueToday({ rules: std, anchors, today: day, alreadySent: sent })) {
        fired.push(d.rule.id);
        sent.add(d.rule.id);
      }
      const dt = new Date(`${day}T00:00:00Z`);
      dt.setUTCDate(dt.getUTCDate() + 1);
      day = dt.toISOString().slice(0, 10);
    }
    expect(fired).toEqual(['t30', 't15', 'd1', 'day0']);
  });
});

describe('copy', () => {
  it('says something different for every tone', () => {
    const subjects = (['save-the-date', 'signups-open', 'last-call', 'reminder', 'day-of'] as const)
      .map((tone) => reminderCopy({ tone, title: 'Stars & Stripes', whenLabel: 'Sat, Jul 3', startTime: '19:00' }).subject);
    expect(new Set(subjects).size).toBe(subjects.length);
  });

  it('writes the day-of note the way a person would', () => {
    const c = reminderCopy({ tone: 'day-of', title: 'Friday Social', whenLabel: null, startTime: '19:00' });
    expect(c.subject).toBe('Tonight: Friday Social');
    expect(c.lead).toContain('7pm tonight');
  });

  it('says Today rather than Tonight for a morning event', () => {
    const c = reminderCopy({ tone: 'day-of', title: 'Junior Camp', whenLabel: null, startTime: '09:00' });
    expect(c.subject).toBe('Today: Junior Camp');
    expect(c.lead).toContain('9am today');
    expect(c.lead).not.toContain('tonight');
  });

  it('picks the right word from the start time', () => {
    expect(dayOfWord('19:00')).toBe('Tonight');
    expect(dayOfWord('16:00')).toBe('Tonight');
    expect(dayOfWord('09:00')).toBe('Today');
    expect(dayOfWord(null)).toBe('Today');
  });

  it('mentions the deadline in the last call', () => {
    const c = reminderCopy({ tone: 'last-call', title: 'Calcutta', whenLabel: null, startTime: null });
    expect(c.subject.toLowerCase()).toContain('last call');
    expect(c.lead.toLowerCase()).toContain('close');
  });

  it('formats times the way people write them', () => {
    expect(time12('19:00')).toBe('7pm');
    expect(time12('19:30')).toBe('7:30pm');
    expect(time12('09:00')).toBe('9am');
    expect(time12('12:00')).toBe('12pm');
    expect(time12('00:30')).toBe('12:30am');
  });

  it('handles an event with no date gracefully', () => {
    const c = reminderCopy({ tone: 'save-the-date', title: 'Something', whenLabel: null, startTime: null });
    expect(c.subject).toContain('Something');
    expect(c.lead).not.toContain('null');
    expect(c.lead).not.toContain('undefined');
  });
});

describe('describeRule + summarizeCadence', () => {
  it('describes rules in plain English', () => {
    expect(describeRule(rule({ offsetDays: 30, anchor: 'event' }))).toBe('30 days before the event');
    expect(describeRule(rule({ offsetDays: 1, anchor: 'deadline' }))).toBe('The night before the deadline');
    expect(describeRule(rule({ offsetDays: 1, anchor: 'event' }))).toBe('The day before');
    expect(describeRule(rule({ offsetDays: 0, anchor: 'event' }))).toBe('Morning of the event');
    expect(describeRule(rule({ offsetDays: 0, anchor: 'deadline' }))).toBe('On the deadline');
  });

  it('summarises a cadence for the drawer', () => {
    const s = summarizeCadence(presetByKey('standard')!.rules, anchors);
    expect(s).toContain('4 reminders');
    expect(s).toContain('Jun 3');
  });

  it('says so when there are none', () => {
    expect(summarizeCadence([], anchors)).toBe('No reminders');
  });
});

describe('sanitizeCadence', () => {
  it('keeps well-formed rules', () => {
    const clean = sanitizeCadence([{ id: 'a', offsetDays: 30, anchor: 'event', tone: 'reminder', enabled: true }]);
    expect(clean).toHaveLength(1);
    expect(clean[0].offsetDays).toBe(30);
  });

  it('rejects junk', () => {
    expect(sanitizeCadence(null)).toEqual([]);
    expect(sanitizeCadence('nope' as any)).toEqual([]);
    expect(sanitizeCadence([null, 5, 'x'])).toEqual([]);
    expect(sanitizeCadence([{ id: '', offsetDays: 5 }])).toEqual([]);
    expect(sanitizeCadence([{ id: 'a', offsetDays: -3 }])).toEqual([]);
    expect(sanitizeCadence([{ id: 'a', offsetDays: 4000 }])).toEqual([]);
  });

  // A duplicate id would mean the second rule silently never fires, because
  // the id is the dedupe key.
  it('drops duplicate ids rather than keeping both', () => {
    const clean = sanitizeCadence([
      { id: 'a', offsetDays: 30, anchor: 'event', tone: 'reminder' },
      { id: 'a', offsetDays: 10, anchor: 'event', tone: 'reminder' },
    ]);
    expect(clean).toHaveLength(1);
    expect(clean[0].offsetDays).toBe(30);
  });

  it('defaults unknown anchors and tones instead of failing', () => {
    const [c] = sanitizeCadence([{ id: 'a', offsetDays: 5, anchor: 'moon', tone: 'shouty' }]);
    expect(c.anchor).toBe('event');
    expect(c.tone).toBe('reminder');
  });

  it('treats enabled as true unless explicitly false', () => {
    expect(sanitizeCadence([{ id: 'a', offsetDays: 5 }])[0].enabled).toBe(true);
    expect(sanitizeCadence([{ id: 'a', offsetDays: 5, enabled: false }])[0].enabled).toBe(false);
  });

  it('caps the number of rules', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ id: `r${i}`, offsetDays: i, anchor: 'event', tone: 'reminder' }));
    expect(sanitizeCadence(many).length).toBeLessThanOrEqual(12);
  });

  it('round-trips every preset unchanged', () => {
    for (const p of CADENCE_PRESETS) {
      expect(sanitizeCadence(p.rules), p.key).toEqual(p.rules);
    }
  });
});
