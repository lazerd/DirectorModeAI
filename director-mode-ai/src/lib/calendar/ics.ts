/**
 * CalendarMode — ICS (RFC 5545) reader and writer.
 *
 * READ: school districts, municipal leagues, and every calendar app on earth
 * export .ics. Parsing it directly means a director can feed the planner real
 * data in one drag-and-drop instead of retyping forty dates.
 *
 * WRITE: the published club calendar is served as an ICS feed so members
 * subscribe once and the year appears on their phone.
 *
 * This is a deliberately partial implementation. Full RFC 5545 is enormous
 * (timezone components, recurrence exceptions, alarms), and none of it matters
 * for "when is spring break". We handle date-only and datetime DTSTART/DTEND,
 * line unfolding, escaping, and simple recurrence — and ignore the rest rather
 * than pulling in a dependency to support features no school calendar uses.
 */

import { addDays, toISO } from './dates';
import type { ISODate } from './types';

export interface IcsEvent {
  uid: string | null;
  summary: string;
  description: string | null;
  location: string | null;
  /** Inclusive start date. */
  start: ISODate;
  /** Inclusive end date. ICS DTEND is exclusive for all-day; normalised here. */
  end: ISODate;
  allDay: boolean;
  /** Raw RRULE, retained so the UI can show what produced an expansion. */
  rrule: string | null;
}

/** Guard against a pathological RRULE turning one line into a million rows. */
const MAX_OCCURRENCES = 400;

/**
 * Parse an .ics payload into flat, date-normalised events.
 * Malformed blocks are skipped rather than thrown — a single bad VEVENT in a
 * 300-line district calendar should not lose the other 299.
 */
export function parseIcs(raw: string, opts: { expandUntil?: ISODate } = {}): IcsEvent[] {
  const lines = unfold(raw);
  const events: IcsEvent[] = [];

  let current: Record<string, { value: string; params: Record<string, string> }> | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === 'BEGIN:VEVENT') { current = {}; continue; }
    if (trimmed === 'END:VEVENT') {
      if (current) {
        const ev = toEvent(current);
        if (ev) {
          if (ev.rrule) events.push(...expand(ev, opts.expandUntil));
          else events.push(ev);
        }
      }
      current = null;
      continue;
    }
    if (!current) continue;

    const parsed = parseLine(trimmed);
    if (parsed) current[parsed.name] = { value: parsed.value, params: parsed.params };
  }

  return events;
}

/** RFC 5545 line unfolding: a leading space or tab continues the previous line. */
function unfold(raw: string): string[] {
  const out: string[] = [];
  for (const line of raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && out.length > 0) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out;
}

interface ParsedLine {
  name: string;
  params: Record<string, string>;
  value: string;
}

function parseLine(line: string): ParsedLine | null {
  const colon = indexOfUnquoted(line, ':');
  if (colon < 0) return null;
  const left = line.slice(0, colon);
  const value = line.slice(colon + 1);

  const parts = left.split(';');
  const name = (parts[0] || '').toUpperCase();
  const params: Record<string, string> = {};
  for (const p of parts.slice(1)) {
    const eq = p.indexOf('=');
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name, params, value };
}

/** Colons inside a quoted param value don't terminate the name section. */
function indexOfUnquoted(s: string, ch: string): number {
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '"') quoted = !quoted;
    else if (s[i] === ch && !quoted) return i;
  }
  return -1;
}

function toEvent(fields: Record<string, { value: string; params: Record<string, string> }>): IcsEvent | null {
  const dtstart = fields.DTSTART;
  if (!dtstart) return null;

  const start = toISODate(dtstart.value);
  if (!start) return null;

  const isDateOnly = dtstart.params.VALUE === 'DATE' || /^\d{8}$/.test(dtstart.value);

  let end = start;
  if (fields.DTEND) {
    const raw = toISODate(fields.DTEND.value);
    if (raw) {
      // All-day DTEND is exclusive: a one-day event ends the following morning.
      const dateOnlyEnd = fields.DTEND.params.VALUE === 'DATE' || /^\d{8}$/.test(fields.DTEND.value);
      end = dateOnlyEnd ? maxDate(start, addDays(raw, -1)) : raw;
    }
  } else if (fields.DURATION) {
    const days = durationDays(fields.DURATION.value);
    end = days > 0 ? addDays(start, days - 1) : start;
  }

  return {
    uid: fields.UID?.value ?? null,
    summary: unescapeText(fields.SUMMARY?.value ?? '(untitled)'),
    description: fields.DESCRIPTION ? unescapeText(fields.DESCRIPTION.value) : null,
    location: fields.LOCATION ? unescapeText(fields.LOCATION.value) : null,
    start,
    end,
    allDay: isDateOnly,
    rrule: fields.RRULE?.value ?? null,
  };
}

/** '20270704' or '20270704T090000Z' → '2027-07-04'. */
function toISODate(v: string): ISODate | null {
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(v.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return toISO(year, month, day);
}

function maxDate(a: ISODate, b: ISODate): ISODate {
  return a > b ? a : b;
}

/** Only the day component of an ISO 8601 duration matters at this resolution. */
function durationDays(v: string): number {
  const m = /^P(?:(\d+)W)?(?:(\d+)D)?/.exec(v.trim());
  if (!m) return 0;
  return (Number(m[1] || 0) * 7) + Number(m[2] || 0);
}

function unescapeText(v: string): string {
  return v
    .replace(/\\n/gi, ' ')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
    .trim();
}

/**
 * Expand a recurring event. Supports the three FREQ values that show up in
 * real school and league calendars — WEEKLY, MONTHLY (by date), YEARLY — plus
 * INTERVAL, COUNT and UNTIL. BYDAY is honoured for WEEKLY.
 * Anything else yields just the first occurrence, which is a safe degradation.
 */
function expand(ev: IcsEvent, expandUntil?: ISODate): IcsEvent[] {
  const rule: Record<string, string> = {};
  for (const part of (ev.rrule || '').split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0) rule[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1);
  }

  const freq = (rule.FREQ || '').toUpperCase();
  if (!['WEEKLY', 'MONTHLY', 'YEARLY'].includes(freq)) return [ev];

  const interval = Math.max(1, Number(rule.INTERVAL || 1));
  const count = rule.COUNT ? Number(rule.COUNT) : null;
  const until = rule.UNTIL ? toISODate(rule.UNTIL) : null;
  const hardStop = expandUntil ?? until ?? addDays(ev.start, 366 * 2);

  const span = daysSpan(ev.start, ev.end);
  const out: IcsEvent[] = [];
  let cursor = ev.start;

  // WEEKLY with BYDAY generates several days per interval week.
  const byDays = freq === 'WEEKLY' && rule.BYDAY
    ? rule.BYDAY.split(',').map((d) => d.trim().toUpperCase().slice(-2))
    : null;
  const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

  while (out.length < MAX_OCCURRENCES) {
    if (cursor > hardStop) break;
    if (until && cursor > until) break;

    if (byDays) {
      const weekStart = addDays(cursor, -dow(cursor));
      for (const code of byDays) {
        const idx = DAY_CODES.indexOf(code);
        if (idx < 0) continue;
        const d = addDays(weekStart, idx);
        if (d < ev.start || d > hardStop || (until && d > until)) continue;
        out.push({ ...ev, start: d, end: addDays(d, span), rrule: ev.rrule });
        if (count && out.length >= count) break;
      }
    } else {
      out.push({ ...ev, start: cursor, end: addDays(cursor, span), rrule: ev.rrule });
    }

    if (count && out.length >= count) break;

    if (freq === 'WEEKLY') cursor = addDays(cursor, 7 * interval);
    else if (freq === 'MONTHLY') cursor = shiftMonths(cursor, interval);
    else cursor = shiftMonths(cursor, 12 * interval);
  }

  const trimmed = count ? out.slice(0, count) : out;
  return trimmed.length > 0 ? trimmed : [ev];
}

function daysSpan(start: ISODate, end: ISODate): number {
  return Math.max(0, Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000));
}

function dow(iso: ISODate): number {
  return new Date(`${iso}T00:00:00Z`).getUTCDay();
}

function shiftMonths(iso: ISODate, months: number): ISODate {
  const [y, m, d] = iso.split('-').map(Number);
  const total = (y * 12) + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return toISO(ny, nm, Math.min(d, last));
}

// ============================================================
// Writing
// ============================================================

export interface IcsWriteEvent {
  uid: string;
  summary: string;
  description?: string | null;
  location?: string | null;
  start: ISODate;
  end?: ISODate | null;
  /** 'HH:MM' club-local. Omit for an all-day entry. */
  startTime?: string | null;
  durationMinutes?: number | null;
  url?: string | null;
}

/**
 * Build a VCALENDAR document.
 *
 * Timed events are written as floating local times (no TZID, no Z suffix),
 * which is what we want here: a 9am club event is 9am at the club, and a
 * member who subscribes from another timezone should still see the time the
 * club published rather than a converted one.
 */
export function buildIcs(
  events: IcsWriteEvent[],
  opts: { calendarName: string; timezone?: string },
): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ClubMode//CalendarMode//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(opts.calendarName)}`,
  ];
  if (opts.timezone) lines.push(`X-WR-TIMEZONE:${opts.timezone}`);

  for (const e of events) {
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${e.uid}`);
    // DTSTAMP is required. Use the event's own start so the output is stable
    // across regenerations — a changing timestamp makes every feed poll look
    // like an update to subscribing clients.
    lines.push(`DTSTAMP:${compact(e.start)}T000000Z`);

    if (e.startTime) {
      const [h, min] = e.startTime.split(':');
      lines.push(`DTSTART:${compact(e.start)}T${pad2(h)}${pad2(min)}00`);
      const mins = e.durationMinutes ?? 120;
      lines.push(`DTEND:${compact(e.start)}T${endStamp(h, min, mins)}`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${compact(e.start)}`);
      // All-day DTEND is exclusive — add a day back on.
      lines.push(`DTEND;VALUE=DATE:${compact(addDays(e.end || e.start, 1))}`);
    }

    lines.push(`SUMMARY:${escapeText(e.summary)}`);
    if (e.description) lines.push(foldLine(`DESCRIPTION:${escapeText(e.description)}`));
    if (e.location) lines.push(`LOCATION:${escapeText(e.location)}`);
    if (e.url) lines.push(`URL:${e.url}`);
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

function compact(iso: ISODate): string {
  return iso.replace(/-/g, '');
}

function pad2(v: string): string {
  return String(Number(v)).padStart(2, '0');
}

/** Add `mins` to HH:MM and render as an ICS time, clamped inside the day. */
function endStamp(h: string, min: string, mins: number): string {
  const total = Math.min(23 * 60 + 59, Number(h) * 60 + Number(min) + mins);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}${String(total % 60).padStart(2, '0')}00`;
}

function escapeText(v: string): string {
  return v
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** RFC 5545 caps content lines at 75 octets; continuations start with a space. */
function foldLine(line: string): string {
  if (line.length <= 73) return line;
  const chunks: string[] = [line.slice(0, 73)];
  for (let i = 73; i < line.length; i += 72) chunks.push(' ' + line.slice(i, i + 72));
  return chunks.join('\r\n');
}
