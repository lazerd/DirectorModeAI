/**
 * Each instructor's own Google Calendar, read and written by the app.
 *
 * Auth is the service account whose key is in GOOGLE_SERVICE_ACCOUNT_JSON (the
 * same one the JTT availability sheet uses) — no OAuth screen, no refresh
 * tokens to lose, and an instructor connects in one step by sharing their
 * calendar with that address. serviceAccountEmail() is surfaced in the UI for
 * exactly that reason: the one thing that breaks this integration is a calendar
 * that was never shared.
 *
 * Read AND write on purpose. Reading alone would make the app a second place to
 * look; writing back means a booked hour becomes "Lesson — Jane Smith" on the
 * instructor's phone within seconds, and the leftover time stays bookable.
 */
import { google, type calendar_v3 } from 'googleapis';

const SCOPES = ['https://www.googleapis.com/auth/calendar'];

/**
 * The exact event title that means "bookable".
 *
 * EXACT, not a prefix. "Open Lesson Time" is unambiguous and easy to say out
 * loud to an instructor; a prefix match would turn "Open house" and "Open court
 * 3 for juniors" into bookable lessons, which is the kind of bug that puts a
 * stranger on someone's calendar.
 */
export const OPEN_LESSON_TITLE = 'Open Lesson Time';

type Creds = { client_email: string; private_key: string };

/**
 * Calendar gets its OWN key when one is configured.
 *
 * GOOGLE_SERVICE_ACCOUNT_JSON is the long-standing sheets credential
 * (topdog-booker@...), and it is load-bearing elsewhere — the JTT availability
 * form reader depends on that exact account having access to that exact sheet.
 * Swapping it for a ClubMode-branded account would silently break that, so the
 * calendar integration reads GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON first and
 * only falls back to the old one. Moving to a branded account is then just
 * adding the new variable; nothing else changes and nothing else breaks.
 */
function creds(): Creds {
  const raw =
    process.env.GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error(
      'Google Calendar is not configured on the server (set GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON).',
    );
  }
  try {
    return JSON.parse(raw) as Creds;
  } catch {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON.');
  }
}

/** The address an instructor must share their calendar with. Shown in the UI. */
export function serviceAccountEmail(): string | null {
  try {
    return creds().client_email || null;
  } catch {
    return null;
  }
}

export function calendarClient(): calendar_v3.Calendar {
  const c = creds();
  const auth = new google.auth.JWT({
    email: c.client_email,
    key: c.private_key,
    scopes: SCOPES,
  });
  return google.calendar({ version: 'v3', auth });
}

/** Title match: exact, trimmed, case-insensitive. Nothing else counts. */
export function isOpenTitle(title: string | null | undefined, expected: string): boolean {
  return (title || '').trim().toLowerCase() === (expected || OPEN_LESSON_TITLE).trim().toLowerCase();
}

export type CalendarWindow = {
  eventId: string;
  start: string;
  end: string;
  location: string | null;
};

/**
 * The instructor's availability windows in a date range.
 *
 * Timed events only — an all-day "Open Lesson Time" is a note to self, and
 * turning one into a bookable eight-hour block would be worse than ignoring it.
 */
export async function listOpenWindows(
  calendarId: string,
  title: string,
  fromISO: string,
  toISO: string,
): Promise<CalendarWindow[]> {
  const cal = calendarClient();
  const res = await cal.events.list({
    calendarId,
    timeMin: fromISO,
    timeMax: toISO,
    singleEvents: true, // expands a weekly "Open Lesson Time" into real dates
    orderBy: 'startTime',
    maxResults: 250,
    showDeleted: false,
  });

  const out: CalendarWindow[] = [];
  for (const e of res.data.items || []) {
    if (e.status === 'cancelled') continue;
    const start = e.start?.dateTime;
    const end = e.end?.dateTime;
    if (!start || !end || !e.id) continue;
    if (!isOpenTitle(e.summary, title)) continue;
    out.push({
      eventId: e.id,
      start: new Date(start).toISOString(),
      end: new Date(end).toISOString(),
      location: e.location || null,
    });
  }
  return out;
}

export async function createEvent(
  calendarId: string,
  ev: { summary: string; description?: string | null; start: string; end: string; location?: string | null },
): Promise<string | null> {
  const cal = calendarClient();
  const res = await cal.events.insert({
    calendarId,
    requestBody: {
      summary: ev.summary,
      description: ev.description || undefined,
      location: ev.location || undefined,
      start: { dateTime: ev.start },
      end: { dateTime: ev.end },
    },
  });
  return res.data.id || null;
}

export async function setEventTimes(
  calendarId: string,
  eventId: string,
  start: string,
  end: string,
): Promise<void> {
  const cal = calendarClient();
  await cal.events.patch({
    calendarId,
    eventId,
    requestBody: { start: { dateTime: start }, end: { dateTime: end } },
  });
}

export async function deleteEvent(calendarId: string, eventId: string): Promise<void> {
  const cal = calendarClient();
  await cal.events.delete({ calendarId, eventId });
}

/**
 * Turn a raw Google error into something an instructor can act on. "Not Found"
 * from this API almost always means "you haven't shared the calendar", and
 * saying so directly is the difference between a working integration and a
 * support message.
 */
export function calendarErrorMessage(e: unknown, calendarId: string): string {
  const err = e as { code?: number; status?: number; message?: string };
  const code = err?.code ?? err?.status;
  const msg = err?.message || '';
  const email = serviceAccountEmail();

  /**
   * The 403 that is NOT about sharing.
   *
   * A Google Cloud project has to have the Calendar API switched on before any
   * key in it can read a calendar, and the failure arrives as a 403 that reads
   * exactly like a permissions problem. Telling an instructor to re-share a
   * calendar they already shared, when the real fix is one click in a console
   * they have never opened, is the worst possible answer — so it gets its own
   * branch and the real link.
   */
  if (/has not been used in project|accessNotConfigured|is disabled/i.test(msg)) {
    const project = msg.match(/project (\d+)/)?.[1];
    return (
      "Google Calendar API is switched off for this app's Google Cloud project — nothing to do with your sharing. " +
      'Enable it here, give it a minute, then check again: ' +
      `https://console.cloud.google.com/apis/library/calendar-json.googleapis.com${project ? `?project=${project}` : ''}`
    );
  }

  if (code === 404) {
    return `Google can't find a calendar called "${calendarId}". Check the address, then share that calendar with ${email ?? 'the booking service account'} and give it "Make changes to events".`;
  }
  if (code === 403) {
    return `That calendar exists but hasn't been shared with ${email ?? 'the booking service account'} — share it and choose "Make changes to events".`;
  }
  return err?.message || 'Google Calendar did not respond. Try again in a moment.';
}
