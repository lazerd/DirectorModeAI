import { describe, expect, it } from 'vitest';
import { buildIcs, googleCalendarUrl, matchEvent, MATCH_DURATION_MIN } from './calendar';
import type { MatchInfo } from './emails';

// 9:30am club time on a PDT date. Every assertion below is really a check that
// we never hand a calendar the UTC hour by accident.
const MATCH: MatchInfo = {
  id: 'm1',
  matchAt: '2026-08-30T16:30:00.000Z',
  isHome: true,
  opponent: 'Diablo Valley',
  location: 'Sleepy Hollow Swim & Tennis, 1 Sleepy Hollow Ln, Orinda CA',
  arrivalNote: 'Arrive 15 minutes early; balls are in the shed.',
  opposingCaptainName: 'Pat Rivera',
  opposingCaptainPhone: '925-555-0134',
};

describe('matchEvent', () => {
  it('holds the full match window from the published start time', () => {
    const e = matchEvent('Fall B2/B3', MATCH, 'Doubles 2');
    expect(e.start.toISOString()).toBe('2026-08-30T16:30:00.000Z');
    expect(e.end.getTime() - e.start.getTime()).toBe(MATCH_DURATION_MIN * 60_000);
  });

  it('names the team, the opponent and home/away in the title', () => {
    const e = matchEvent('Fall B2/B3', MATCH, 'Doubles 2');
    expect(e.title).toBe('Tennis: Fall B2/B3 vs Diablo Valley (Home)');
  });

  it('puts the court, the arrival note and the opposing captain in the body', () => {
    const e = matchEvent('Fall B2/B3', MATCH, 'Doubles 2');
    expect(e.description).toContain("You're on Doubles 2.");
    expect(e.description).toContain('balls are in the shed');
    expect(e.description).toContain('Pat Rivera');
    expect(e.description).toContain('925-555-0134');
  });

  it('quotes the estimated end in CLUB time, not UTC', () => {
    const e = matchEvent('Fall B2/B3', MATCH, null);
    // 9:30am + 2h30 = 12:00 PM Pacific. UTC would say 7:00 PM.
    expect(e.description).toContain('Ends around 12:00 PM');
  });

  it('survives a match with nothing filled in but a time', () => {
    const bare: MatchInfo = { id: 'm2', matchAt: '2026-09-06T16:30:00.000Z', isHome: false };
    const e = matchEvent('Fall B2/B3', bare, null);
    expect(e.title).toBe('Tennis: Fall B2/B3 (Away)');
    expect(e.location).toBe('Away');
  });
});

describe('googleCalendarUrl', () => {
  it('encodes a TEMPLATE link with a UTC basic-format window', () => {
    const url = googleCalendarUrl(matchEvent('Fall B2/B3', MATCH, 'Doubles 2'));
    expect(url.startsWith('https://calendar.google.com/calendar/render?')).toBe(true);
    const q = new URL(url).searchParams;
    expect(q.get('action')).toBe('TEMPLATE');
    expect(q.get('dates')).toBe('20260830T163000Z/20260830T190000Z');
    expect(q.get('text')).toBe('Tennis: Fall B2/B3 vs Diablo Valley (Home)');
    expect(q.get('location')).toContain('Orinda');
  });
});

describe('buildIcs', () => {
  const ics = buildIcs(matchEvent('Fall B2/B3', MATCH, 'Doubles 2'), new Date('2026-08-23T00:00:00Z'));

  it('is a single well-formed VEVENT', () => {
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.trimEnd().endsWith('END:VCALENDAR')).toBe(true);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(ics).toContain('DTSTART:20260830T163000Z');
    expect(ics).toContain('DTEND:20260830T190000Z');
    expect(ics).toContain('DTSTAMP:20260823T000000Z');
  });

  it('uses CRLF line endings — Outlook rejects bare LF', () => {
    expect(ics.split('\n').every((l) => l === '' || l.endsWith('\r'))).toBe(true);
  });

  it('escapes the commas in an address instead of splitting the property', () => {
    const line = ics.split('\r\n').find((l) => l.startsWith('LOCATION:')) || '';
    expect(line).toContain('Tennis\\, 1 Sleepy Hollow Ln');
  });

  it('folds long lines to 75 octets with a leading space', () => {
    for (const line of ics.split('\r\n')) {
      expect(line.length).toBeLessThanOrEqual(75);
    }
    expect(ics).toContain('\r\n ');
  });

  it('carries reminders the night before and an hour out', () => {
    expect(ics).toContain('TRIGGER:-P1D');
    expect(ics).toContain('TRIGGER:-PT1H');
    expect(ics.match(/BEGIN:VALARM/g)).toHaveLength(2);
  });
});
