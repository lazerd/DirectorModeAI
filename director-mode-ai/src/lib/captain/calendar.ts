/**
 * Calendar handoff for a league match.
 *
 * Two shapes, because the two ecosystems want different things:
 *   - Google reads a `render?action=TEMPLATE` URL (no download, opens straight
 *     into "Save" on desktop and in the Google Calendar app on Android).
 *   - Apple Calendar / Outlook want a `.ics` file. iOS Safari hands a served
 *     text/calendar body to Calendar with an "Add All" sheet.
 * One button each in the email — sniffing the user agent from an email client
 * is not possible, so we let the player pick.
 */
import type { MatchInfo } from './emails';
import { CLUB_TZ } from './clubTime';

/**
 * Leagues never publish an end time. A women's flex doubles match is ~2h and
 * runs long often enough that a 2.5h block is the honest thing to put on
 * somebody's calendar — better a slightly wide hold than a double-booking.
 */
export const MATCH_DURATION_MIN = 150;

/** iCalendar / Google both want UTC basic format: 20260830T163000Z */
function stamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

export type CalendarEvent = {
  uid: string;
  title: string;
  description: string;
  location: string;
  start: Date;
  end: Date;
};

export function matchEvent(
  teamName: string,
  m: MatchInfo,
  court: string | null,
  opts?: { playing?: boolean },
): CalendarEvent {
  const start = new Date(m.matchAt);
  const end = new Date(start.getTime() + MATCH_DURATION_MIN * 60_000);

  const title = [
    'Tennis:',
    teamName,
    m.opponent ? `vs ${m.opponent}` : null,
    m.isHome ? '(Home)' : '(Away)',
  ]
    .filter(Boolean)
    .join(' ');

  const lines = [
    court && opts?.playing !== false ? `You're on ${court}.` : null,
    m.opponent ? `Opponent: ${m.opponent}` : null,
    `${m.isHome ? 'Home' : 'Away'} match${m.location ? ` at ${m.location}` : ''}`,
    m.arrivalNote || null,
    m.opposingCaptainName
      ? `Opposing captain: ${m.opposingCaptainName}${m.opposingCaptainPhone ? ` (${m.opposingCaptainPhone})` : ''}`
      : null,
    '',
    // Match length is our assumption, not the league's — say so rather than let
    // a player think the club published a 2.5-hour block.
    `Ends around ${new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: CLUB_TZ,
    }).format(end)} — estimated, not an official end time.`,
    'Added from your ClubMode lineup email.',
  ].filter((l) => l !== null) as string[];

  return {
    // Stable per player+match, so re-adding updates the same event in clients
    // that honour UID rather than piling up duplicates.
    uid: `captain-${m.id}-${court ? court.replace(/\s+/g, '') : 'team'}@clubmode`,
    title,
    description: lines.join('\n'),
    location: m.location || (m.isHome ? 'Home courts' : 'Away'),
    start,
    end,
  };
}

export function googleCalendarUrl(e: CalendarEvent): string {
  const q = new URLSearchParams({
    action: 'TEMPLATE',
    text: e.title,
    dates: `${stamp(e.start)}/${stamp(e.end)}`,
    details: e.description,
    location: e.location,
  });
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}

/** RFC 5545: escape, then fold at 75 octets. Outlook is the strict one. */
function icsEscape(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

function fold(line: string): string {
  if (line.length <= 74) return line;
  const out: string[] = [];
  let rest = line;
  out.push(rest.slice(0, 74));
  rest = rest.slice(74);
  while (rest.length) {
    out.push(' ' + rest.slice(0, 73));
    rest = rest.slice(73);
  }
  return out.join('\r\n');
}

export function buildIcs(e: CalendarEvent, now: Date = new Date()): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ClubMode//CaptainMode//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${e.uid}`,
    `DTSTAMP:${stamp(now)}`,
    `DTSTART:${stamp(e.start)}`,
    `DTEND:${stamp(e.end)}`,
    `SUMMARY:${icsEscape(e.title)}`,
    `DESCRIPTION:${icsEscape(e.description)}`,
    `LOCATION:${icsEscape(e.location)}`,
    'STATUS:CONFIRMED',
    'TRANSP:OPAQUE',
    // Two alarms: the night before (pack a bag) and an hour out (leave now).
    'BEGIN:VALARM',
    'TRIGGER:-P1D',
    'ACTION:DISPLAY',
    `DESCRIPTION:${icsEscape(`Tomorrow: ${e.title}`)}`,
    'END:VALARM',
    'BEGIN:VALARM',
    'TRIGGER:-PT1H',
    'ACTION:DISPLAY',
    `DESCRIPTION:${icsEscape(e.title)}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(fold).join('\r\n') + '\r\n';
}
