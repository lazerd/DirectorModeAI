/**
 * Open Lesson Time for instructors who do not live in Google Calendar.
 *
 * Apple's iCloud cannot be read by a Google service account, and getting write
 * access to it means asking an instructor for an Apple ID app-specific password
 * and storing it — a credential we have no business holding. So the second path
 * is the one every calendar already speaks: a published .ics feed.
 *
 * The trade is honest and worth stating in the UI, because it changes what the
 * instructor should expect:
 *   READ  — we see "Open Lesson Time" blocks exactly as Google's path does.
 *   WRITE — we cannot put the lesson on their calendar. The booking is held
 *           here and emailed to them as a one-tap Add-to-calendar invite.
 *   LAG   — Apple regenerates a published feed on its own schedule (usually
 *           within 15 minutes), so a block added seconds ago may not appear
 *           instantly. Google's path is live.
 *
 * Works for iCloud, Outlook/Microsoft 365, Fastmail, Yahoo — anything that can
 * publish a calendar link.
 */
import ICAL from 'ical.js';
import { isOpenTitle, type CalendarWindow } from './googleCalendar';

/** Hard stop on recurrence expansion so an unbounded RRULE cannot hang a request. */
const MAX_OCCURRENCES = 400;

/**
 * Apple hands out `webcal://` links, which no HTTP client understands. Same
 * URL, different scheme — swapping it is the entire fix, and an instructor
 * pasting exactly what Apple gave them must just work.
 */
export function normalizeIcsUrl(url: string): string {
  const u = (url || '').trim();
  if (!u) return '';
  if (u.startsWith('webcal://')) return `https://${u.slice('webcal://'.length)}`;
  if (u.startsWith('webcals://')) return `https://${u.slice('webcals://'.length)}`;
  return u;
}

export function looksLikeIcsUrl(url: string): boolean {
  const u = normalizeIcsUrl(url);
  return /^https?:\/\/.+/i.test(u);
}

/**
 * The "Open Lesson Time" blocks in a published calendar, in a date range.
 *
 * Pure so the parsing rules — recurrence expansion, all-day rejection, exact
 * title matching — can be tested against a fixture rather than against Apple.
 */
export function parseIcsWindows(
  icsText: string,
  title: string,
  fromISO: string,
  toISO: string,
): CalendarWindow[] {
  const from = new Date(fromISO).getTime();
  const to = new Date(toISO).getTime();

  let comp: ICAL.Component;
  try {
    comp = new ICAL.Component(ICAL.parse(icsText));
  } catch {
    throw new Error('That link did not return a calendar file we could read.');
  }

  const out: CalendarWindow[] = [];

  for (const ve of comp.getAllSubcomponents('vevent')) {
    let event: ICAL.Event;
    try {
      event = new ICAL.Event(ve);
    } catch {
      continue; // a malformed VEVENT is not worth failing the whole feed over
    }
    if (!isOpenTitle(event.summary, title)) continue;
    // An all-day "Open Lesson Time" is a note to self, not eight bookable hours.
    if (event.startDate?.isDate) continue;

    const location = (ve.getFirstPropertyValue('location') as string | null) || null;
    const uid = event.uid || ve.getFirstPropertyValue('uid') || '';

    if (!event.isRecurring()) {
      const start = event.startDate.toJSDate().getTime();
      const end = event.endDate.toJSDate().getTime();
      if (end <= from || start >= to) continue;
      out.push({
        eventId: String(uid),
        start: new Date(start).toISOString(),
        end: new Date(end).toISOString(),
        location,
      });
      continue;
    }

    /**
     * A weekly "Open Lesson Time" is the normal case, not an edge case — an
     * instructor blocks Thursday afternoons once and expects every Thursday to
     * be bookable. Each occurrence becomes its own window, keyed by the
     * recurrence id so bookings stay attached to the right week.
     */
    const it = event.iterator();
    for (let n = 0; n < MAX_OCCURRENCES; n++) {
      const next = it.next();
      if (!next) break;
      const occ = event.getOccurrenceDetails(next);
      const start = occ.startDate.toJSDate().getTime();
      const end = occ.endDate.toJSDate().getTime();
      if (start >= to) break; // iterator is chronological; nothing after this fits
      if (end <= from) continue;
      out.push({
        eventId: `${uid}::${occ.recurrenceId.toString()}`,
        start: new Date(start).toISOString(),
        end: new Date(end).toISOString(),
        location,
      });
    }
  }

  return out.sort((a, b) => a.start.localeCompare(b.start));
}

/** Fetch a published calendar and read its open blocks. */
export async function fetchIcsWindows(
  url: string,
  title: string,
  fromISO: string,
  toISO: string,
): Promise<CalendarWindow[]> {
  const target = normalizeIcsUrl(url);
  if (!looksLikeIcsUrl(target)) {
    throw new Error('That calendar link does not look like a URL. Paste the whole thing, starting with webcal:// or https://.');
  }

  let res: Response;
  try {
    res = await fetch(target, {
      // A published feed is public by definition; no credentials to send.
      redirect: 'follow',
      cache: 'no-store',
      headers: { Accept: 'text/calendar, text/plain;q=0.9, */*;q=0.8' },
    });
  } catch {
    throw new Error('Could not reach that calendar link. Check it opens in a browser.');
  }

  if (!res.ok) {
    throw new Error(
      res.status === 404
        ? 'That calendar link returned "not found" — re-copy the public link from your calendar app.'
        : `That calendar link returned an error (${res.status}). Make sure the calendar is published publicly.`,
    );
  }

  const text = await res.text();
  if (!/BEGIN:VCALENDAR/i.test(text)) {
    throw new Error(
      'That link did not return a calendar. In Apple Calendar use the PUBLIC link (it starts with webcal://), not the invitation link.',
    );
  }

  return parseIcsWindows(text, title, fromISO, toISO);
}

/**
 * The booking, as a calendar file the instructor taps once to add.
 *
 * This is the compensation for not being able to write to their calendar: the
 * confirmation email carries the lesson itself, not just a description of it.
 */
export function buildLessonIcs(ev: {
  uid: string;
  start: string;
  end: string;
  summary: string;
  description?: string | null;
  location?: string | null;
  organizerEmail?: string | null;
}): string {
  const stamp = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const esc = (s: string) =>
    s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ClubMode//Open Lesson Time//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${ev.uid}`,
    `DTSTAMP:${stamp(new Date().toISOString())}`,
    `DTSTART:${stamp(ev.start)}`,
    `DTEND:${stamp(ev.end)}`,
    `SUMMARY:${esc(ev.summary)}`,
    ev.description ? `DESCRIPTION:${esc(ev.description)}` : null,
    ev.location ? `LOCATION:${esc(ev.location)}` : null,
    ev.organizerEmail ? `ORGANIZER:mailto:${ev.organizerEmail}` : null,
    'BEGIN:VALARM',
    'TRIGGER:-PT60M',
    'ACTION:DISPLAY',
    'DESCRIPTION:Lesson in an hour',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean) as string[];

  // RFC 5545 wants CRLF line endings; some clients are strict about it.
  return lines.join('\r\n');
}
