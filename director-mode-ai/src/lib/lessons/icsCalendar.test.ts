import { describe, expect, it } from 'vitest';
import { buildLessonIcs, normalizeIcsUrl, looksLikeIcsUrl, parseIcsWindows } from './icsCalendar';

const TITLE = 'Open Lesson Time';

/** A feed shaped like the ones iCloud publishes. */
const FEED = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Apple Inc.//Mac OS X 10.15//EN
CALSCALE:GREGORIAN
BEGIN:VTIMEZONE
TZID:America/Los_Angeles
BEGIN:DAYLIGHT
TZOFFSETFROM:-0800
TZOFFSETTO:-0700
DTSTART:20070311T020000
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU
TZNAME:PDT
END:DAYLIGHT
BEGIN:STANDARD
TZOFFSETFROM:-0700
TZOFFSETTO:-0800
DTSTART:20071104T020000
RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU
TZNAME:PST
END:STANDARD
END:VTIMEZONE
BEGIN:VEVENT
UID:one-off@icloud
DTSTART;TZID=America/Los_Angeles:20260903T130000
DTEND;TZID=America/Los_Angeles:20260903T170000
SUMMARY:Open Lesson Time
LOCATION:Court 5
END:VEVENT
BEGIN:VEVENT
UID:weekly@icloud
DTSTART;TZID=America/Los_Angeles:20260907T090000
DTEND;TZID=America/Los_Angeles:20260907T110000
RRULE:FREQ=WEEKLY;BYDAY=MO
SUMMARY:Open Lesson Time
END:VEVENT
BEGIN:VEVENT
UID:private-lesson@icloud
DTSTART;TZID=America/Los_Angeles:20260903T180000
DTEND;TZID=America/Los_Angeles:20260903T190000
SUMMARY:Lesson with Jamie
END:VEVENT
BEGIN:VEVENT
UID:allday@icloud
DTSTART;VALUE=DATE:20260905
DTEND;VALUE=DATE:20260906
SUMMARY:Open Lesson Time
END:VEVENT
END:VCALENDAR`;

const FROM = '2026-09-01T00:00:00.000Z';
const TO = '2026-10-01T00:00:00.000Z';

const local = (iso: string) =>
  new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/Los_Angeles',
  }).format(new Date(iso));

describe('normalizeIcsUrl', () => {
  it('turns the webcal:// link Apple hands out into something fetchable', () => {
    expect(normalizeIcsUrl('webcal://p1-caldav.icloud.com/published/2/abc')).toBe(
      'https://p1-caldav.icloud.com/published/2/abc',
    );
  });

  it('leaves an https link alone and trims stray whitespace', () => {
    expect(normalizeIcsUrl('  https://example.com/cal.ics ')).toBe('https://example.com/cal.ics');
  });

  it('rejects anything that is not a URL', () => {
    expect(looksLikeIcsUrl('my calendar')).toBe(false);
    expect(looksLikeIcsUrl('webcal://host/x')).toBe(true);
  });
});

describe('parseIcsWindows', () => {
  const windows = parseIcsWindows(FEED, TITLE, FROM, TO);

  it('reads a one-off block, in the right timezone', () => {
    const first = windows[0];
    expect(local(first.start)).toBe('Thu, Sep 3, 1:00 PM');
    expect(local(first.end)).toBe('Thu, Sep 3, 5:00 PM');
    expect(first.location).toBe('Court 5');
  });

  it('expands a weekly block into every week — the normal case, not an edge case', () => {
    const mondays = windows.filter((w) => w.eventId.startsWith('weekly@icloud'));
    expect(mondays.length).toBeGreaterThanOrEqual(4);
    expect(local(mondays[0].start)).toBe('Mon, Sep 7, 9:00 AM');
    expect(local(mondays[1].start)).toBe('Mon, Sep 14, 9:00 AM');
  });

  it('gives each occurrence its own id, so a booking sticks to the right week', () => {
    const ids = windows.filter((w) => w.eventId.startsWith('weekly@')).map((w) => w.eventId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('ignores everything not titled exactly "Open Lesson Time"', () => {
    expect(windows.some((w) => w.eventId.includes('private-lesson'))).toBe(false);
  });

  it('ignores an all-day block — that is a note to self, not eight bookable hours', () => {
    expect(windows.some((w) => w.eventId.includes('allday'))).toBe(false);
  });

  it('stays inside the requested range', () => {
    const tight = parseIcsWindows(FEED, TITLE, '2026-09-08T00:00:00Z', '2026-09-16T00:00:00Z');
    expect(tight.every((w) => w.end > '2026-09-08' && w.start < '2026-09-16')).toBe(true);
    expect(tight.some((w) => w.eventId.includes('one-off'))).toBe(false);
  });

  it('refuses a page that is not a calendar rather than returning nothing', () => {
    expect(() => parseIcsWindows('<html>nope</html>', TITLE, FROM, TO)).toThrow();
  });
});

describe('buildLessonIcs', () => {
  const ics = buildLessonIcs({
    uid: 'slot-123@clubmode.ai',
    start: '2026-09-03T20:00:00.000Z',
    end: '2026-09-03T21:00:00.000Z',
    summary: 'Lesson — Jane Smith',
    description: 'Booked through ClubMode (60 min)\njane@example.com',
    location: 'Court 5',
  });

  it('is a calendar file a phone will accept', () => {
    expect(ics.startsWith('BEGIN:VCALENDAR')).toBe(true);
    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toContain('UID:slot-123@clubmode.ai');
    expect(ics).toContain('DTSTART:20260903T200000Z');
    expect(ics).toContain('DTEND:20260903T210000Z');
    expect(ics.endsWith('END:VCALENDAR')).toBe(true);
  });

  it('uses CRLF line endings — strict clients reject anything else', () => {
    expect(ics.includes('\r\n')).toBe(true);
  });

  it('escapes commas and newlines instead of breaking the file', () => {
    expect(ics).toContain('DESCRIPTION:Booked through ClubMode (60 min)\\njane@example.com');
  });

  it('carries an hour-before alarm, because the point is not forgetting', () => {
    expect(ics).toContain('TRIGGER:-PT60M');
  });
});
