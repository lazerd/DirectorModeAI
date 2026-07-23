import { describe, it, expect } from 'vitest';
import { parseIcs, buildIcs } from './ics';

const wrap = (body: string) =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', body, 'END:VCALENDAR'].join('\r\n');

describe('parseIcs', () => {
  it('reads an all-day event and makes DTEND inclusive', () => {
    // ICS all-day DTEND is exclusive: this is a single day, July 4.
    const ics = wrap([
      'BEGIN:VEVENT',
      'UID:abc@school',
      'SUMMARY:Independence Day - No School',
      'DTSTART;VALUE=DATE:20270704',
      'DTEND;VALUE=DATE:20270705',
      'END:VEVENT',
    ].join('\r\n'));

    const [e] = parseIcs(ics);
    expect(e.summary).toBe('Independence Day - No School');
    expect(e.start).toBe('2027-07-04');
    expect(e.end).toBe('2027-07-04');
    expect(e.allDay).toBe(true);
  });

  it('reads a multi-day break correctly', () => {
    const ics = wrap([
      'BEGIN:VEVENT',
      'SUMMARY:Spring Break',
      'DTSTART;VALUE=DATE:20270327',
      'DTEND;VALUE=DATE:20270405',
      'END:VEVENT',
    ].join('\r\n'));

    const [e] = parseIcs(ics);
    expect(e.start).toBe('2027-03-27');
    expect(e.end).toBe('2027-04-04');
  });

  it('reads a timed event', () => {
    const ics = wrap([
      'BEGIN:VEVENT',
      'SUMMARY:Board Meeting',
      'DTSTART;TZID=America/Los_Angeles:20270915T190000',
      'DTEND;TZID=America/Los_Angeles:20270915T210000',
      'END:VEVENT',
    ].join('\r\n'));

    const [e] = parseIcs(ics);
    expect(e.start).toBe('2027-09-15');
    expect(e.allDay).toBe(false);
  });

  it('unfolds continuation lines', () => {
    const ics = wrap([
      'BEGIN:VEVENT',
      'SUMMARY:A very long event name that the exporter has',
      '  wrapped across two lines',
      'DTSTART;VALUE=DATE:20270704',
      'END:VEVENT',
    ].join('\r\n'));

    const [e] = parseIcs(ics);
    expect(e.summary).toBe('A very long event name that the exporter has wrapped across two lines');
  });

  it('unescapes text', () => {
    const ics = wrap([
      'BEGIN:VEVENT',
      'SUMMARY:Finals\\, half day',
      'DESCRIPTION:Line one\\nLine two\\; more',
      'DTSTART;VALUE=DATE:20270601',
      'END:VEVENT',
    ].join('\r\n'));

    const [e] = parseIcs(ics);
    expect(e.summary).toBe('Finals, half day');
    expect(e.description).toBe('Line one Line two; more');
  });

  it('reads several events from one file', () => {
    const ics = wrap([
      'BEGIN:VEVENT\r\nSUMMARY:A\r\nDTSTART;VALUE=DATE:20270101\r\nEND:VEVENT',
      'BEGIN:VEVENT\r\nSUMMARY:B\r\nDTSTART;VALUE=DATE:20270202\r\nEND:VEVENT',
      'BEGIN:VEVENT\r\nSUMMARY:C\r\nDTSTART;VALUE=DATE:20270303\r\nEND:VEVENT',
    ].join('\r\n'));

    expect(parseIcs(ics).map((e) => e.summary)).toEqual(['A', 'B', 'C']);
  });

  // A single malformed block in a 300-line district export shouldn't cost the
  // other 299.
  it('skips malformed events without throwing', () => {
    const ics = wrap([
      'BEGIN:VEVENT\r\nSUMMARY:No start date\r\nEND:VEVENT',
      'BEGIN:VEVENT\r\nSUMMARY:Good\r\nDTSTART;VALUE=DATE:20270704\r\nEND:VEVENT',
    ].join('\r\n'));

    const events = parseIcs(ics);
    expect(events).toHaveLength(1);
    expect(events[0].summary).toBe('Good');
  });

  it('handles CRLF, LF, and stray blank lines', () => {
    const ics = 'BEGIN:VCALENDAR\nBEGIN:VEVENT\nSUMMARY:X\nDTSTART;VALUE=DATE:20270704\nEND:VEVENT\n\nEND:VCALENDAR';
    expect(parseIcs(ics)).toHaveLength(1);
  });

  it('returns nothing for an empty or non-ICS payload', () => {
    expect(parseIcs('')).toEqual([]);
    expect(parseIcs('this is not a calendar')).toEqual([]);
  });

  describe('recurrence', () => {
    it('expands a weekly rule with COUNT', () => {
      const ics = wrap([
        'BEGIN:VEVENT',
        'SUMMARY:Weekly league night',
        'DTSTART;VALUE=DATE:20270603',
        'RRULE:FREQ=WEEKLY;COUNT=4',
        'END:VEVENT',
      ].join('\r\n'));

      const events = parseIcs(ics);
      expect(events).toHaveLength(4);
      expect(events.map((e) => e.start)).toEqual(['2027-06-03', '2027-06-10', '2027-06-17', '2027-06-24']);
    });

    it('respects UNTIL', () => {
      const ics = wrap([
        'BEGIN:VEVENT',
        'SUMMARY:Until-bounded',
        'DTSTART;VALUE=DATE:20270603',
        'RRULE:FREQ=WEEKLY;UNTIL=20270625',
        'END:VEVENT',
      ].join('\r\n'));

      const events = parseIcs(ics);
      expect(events.every((e) => e.start <= '2027-06-25')).toBe(true);
      expect(events.length).toBeGreaterThan(1);
    });

    it('expands a yearly rule within the requested horizon', () => {
      const ics = wrap([
        'BEGIN:VEVENT',
        'SUMMARY:Annual meeting',
        'DTSTART;VALUE=DATE:20270301',
        'RRULE:FREQ=YEARLY',
        'END:VEVENT',
      ].join('\r\n'));

      const events = parseIcs(ics, { expandUntil: '2029-12-31' });
      expect(events.map((e) => e.start)).toEqual(['2027-03-01', '2028-03-01', '2029-03-01']);
    });

    it('caps a runaway recurrence rather than hanging', () => {
      const ics = wrap([
        'BEGIN:VEVENT',
        'SUMMARY:Daily forever',
        'DTSTART;VALUE=DATE:20270101',
        'RRULE:FREQ=WEEKLY;INTERVAL=1',
        'END:VEVENT',
      ].join('\r\n'));

      const events = parseIcs(ics, { expandUntil: '2099-12-31' });
      expect(events.length).toBeLessThanOrEqual(400);
    });

    it('falls back to a single occurrence for an unsupported FREQ', () => {
      const ics = wrap([
        'BEGIN:VEVENT',
        'SUMMARY:Hourly nonsense',
        'DTSTART;VALUE=DATE:20270101',
        'RRULE:FREQ=HOURLY',
        'END:VEVENT',
      ].join('\r\n'));

      expect(parseIcs(ics)).toHaveLength(1);
    });
  });
});

describe('buildIcs', () => {
  it('produces a well-formed calendar', () => {
    const out = buildIcs(
      [{ uid: 'a@clubmode', summary: 'Stars & Stripes RR', start: '2027-07-03' }],
      { calendarName: 'Sleepy Hollow 2027', timezone: 'America/Los_Angeles' },
    );

    expect(out.startsWith('BEGIN:VCALENDAR')).toBe(true);
    expect(out.trimEnd().endsWith('END:VCALENDAR')).toBe(true);
    expect(out).toContain('X-WR-CALNAME:Sleepy Hollow 2027');
    expect(out).toContain('X-WR-TIMEZONE:America/Los_Angeles');
    expect(out).toContain('UID:a@clubmode');
    expect(out).toContain('\r\n');
  });

  it('writes an all-day event with an exclusive DTEND', () => {
    const out = buildIcs([{ uid: 'a', summary: 'One day', start: '2027-07-04' }], { calendarName: 'X' });
    expect(out).toContain('DTSTART;VALUE=DATE:20270704');
    expect(out).toContain('DTEND;VALUE=DATE:20270705');
  });

  it('writes a timed event with a computed end', () => {
    const out = buildIcs(
      [{ uid: 'a', summary: 'Evening social', start: '2027-07-04', startTime: '18:30', durationMinutes: 150 }],
      { calendarName: 'X' },
    );
    expect(out).toContain('DTSTART:20270704T183000');
    expect(out).toContain('DTEND:20270704T210000');
  });

  it('escapes special characters', () => {
    const out = buildIcs(
      [{ uid: 'a', summary: 'Wine, Cheese; and Nine', start: '2027-07-04' }],
      { calendarName: 'X' },
    );
    expect(out).toContain('SUMMARY:Wine\\, Cheese\\; and Nine');
  });

  it('round-trips through the parser', () => {
    const out = buildIcs(
      [
        { uid: 'a', summary: 'Stars & Stripes', start: '2027-07-03' },
        { uid: 'b', summary: 'Member-Guest', start: '2027-09-11', end: '2027-09-12' },
      ],
      { calendarName: 'Club Year' },
    );

    const parsed = parseIcs(out);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].summary).toBe('Stars & Stripes');
    expect(parsed[0].start).toBe('2027-07-03');
    expect(parsed[1].start).toBe('2027-09-11');
    expect(parsed[1].end).toBe('2027-09-12');
  });

  it('is stable across regenerations so subscribers see no phantom updates', () => {
    const ev = [{ uid: 'a', summary: 'X', start: '2027-07-04' }];
    expect(buildIcs(ev, { calendarName: 'Y' })).toBe(buildIcs(ev, { calendarName: 'Y' }));
  });
});
