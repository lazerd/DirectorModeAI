/**
 * CalendarMode — turning an uploaded file into proposed constraints.
 *
 * Handles the formats directors actually have: an .ics export from a district
 * or league site, a CSV someone pasted out of a spreadsheet, or a block of text
 * off a web page. (Photos and PDFs go through the vision route, which produces
 * the same shape.)
 *
 * Lives in lib rather than beside the route so it can be tested against real
 * file samples — and because Next route files may only export handlers.
 */

import { parseIcs } from './ics';
import { classifyImported, widenForLongSpans, type CalendarKind } from './classify';
import { daysApart } from './dates';
import type { Audience, ConstraintImpact } from './types';

export interface ProposedConstraint {
  title: string;
  starts_on: string;
  ends_on: string;
  impact: ConstraintImpact;
  audience_tags: Audience[];
  note: string;
  ignore: boolean;
}

/** Parse an .ics payload into proposed constraints. */
export function parseIcsUpload(content: string, kind: CalendarKind): ProposedConstraint[] {
  return parseIcs(content).map((e) => propose(e.summary, e.start, e.end, kind));
}

/**
 * CSV, TSV, or pasted text — with or without a header, in any column order.
 *
 * Districts and league sites hand out wildly inconsistent exports, so rather
 * than demanding a fixed schema this finds the date-shaped cells and treats the
 * longest remaining cell as the title. That reads a real-world file far more
 * often than a strict parser does, and the review table catches the rest.
 */
export function parseDelimitedUpload(content: string, kind: CalendarKind): ProposedConstraint[] {
  const lines = content.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const out: ProposedConstraint[] = [];

  for (const line of lines) {
    const cells = splitRow(line);
    if (cells.length < 2) continue;

    const dates: string[] = [];
    let title = '';
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];

      const d = toISO(cell);
      if (d) { dates.push(d); continue; }

      // "Sep 12, 2028" in a comma-separated file arrives as two cells. Try
      // rejoining before giving up, or the row loses its date entirely.
      if (i + 1 < cells.length) {
        const joined = toISO(`${cell}, ${cells[i + 1]}`);
        if (joined) { dates.push(joined); i++; continue; }
      }

      // Skip pure numbers (row ids, scores) when hunting for the title.
      if (cell.length > title.length && !/^\d+$/.test(cell)) title = cell;
    }

    if (dates.length === 0 || !title) continue;
    dates.sort();
    out.push(propose(title, dates[0], dates[dates.length - 1], kind));
  }

  return out;
}

/**
 * Split one row into cells, respecting quotes.
 *
 * The delimiter is decided PER LINE: a line containing a tab is tab-separated,
 * everything else is comma-separated. Splitting on both at once looks tolerant
 * but silently destroys tab-separated rows whose dates are written long-form —
 * "Sep 12, 2028" is one cell in a TSV and must not be torn in half by its own
 * comma.
 */
export function splitRow(line: string): string[] {
  const delimiter = line.includes('\t') ? '\t' : ',';
  const cells: string[] = [];
  let cur = '';
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === delimiter && !quoted) { cells.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  cells.push(cur.trim());
  return cells.map((c) => c.replace(/^"|"$/g, '').trim()).filter((c) => c.length > 0);
}

/**
 * Accepts the date shapes that actually turn up: ISO, US slash, and long form
 * ("Sep 4, 2027"). Deliberately does NOT accept a bare "9/4" — without a year
 * it would silently guess, and guessing wrong moves a constraint twelve months.
 */
export function toISO(cell: string): string | null {
  const s = cell.trim();

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (iso) return fmt(+iso[1], +iso[2], +iso[3]);

  const us = /^(\d{1,2})[/](\d{1,2})[/](\d{2,4})$/.exec(s);
  if (us) {
    const year = us[3].length === 2 ? 2000 + +us[3] : +us[3];
    return fmt(year, +us[1], +us[2]);
  }

  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const long = /^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/.exec(s);
  if (long) {
    const m = MONTHS.indexOf(long[1].toLowerCase().slice(0, 3));
    if (m >= 0) return fmt(+long[3], m + 1, +long[2]);
  }

  return null;
}

function fmt(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 2200) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * Strip a leading date echo from an extracted title.
 *
 * Vision extraction reliably reads a grid cell like "Aug 6-7: PD Day" and hands
 * back the whole string, because on the page the date IS part of the cell.
 * Prompting against it works only sometimes; a regex works every time, and the
 * real date is already in the start/end fields. Only strips a prefix that is
 * unambiguously a date, so "March Madness Bracket" survives intact.
 */
export function stripDatePrefix(title: string): string {
  const MON = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?';
  const DAYS = '\\d{1,2}(?:\\s*[-–/]\\s*(?:' + MON + '\\s*)?\\d{1,2})?';
  // "Aug 6-7:", "Feb 12/15 -", "12/25:", "Dec 21 – Jan 1:"
  const re = new RegExp(`^\\s*(?:${MON}\\s*${DAYS}|\\d{1,2}[/-]\\d{1,2}(?:[/-]\\d{2,4})?)\\s*[:\\u2013\\u2014-]\\s*`, 'i');
  const out = title.replace(re, '').trim();
  // Never strip away the entire title — a row called "Aug 6-7" keeps its name.
  return out.length > 0 ? out : title.trim();
}

/** Classify one extracted row. Shared by every import path. */
export function propose(
  title: string,
  start: string,
  end: string,
  kind: CalendarKind,
): ProposedConstraint {
  const clean = title.trim().slice(0, 200);
  const span = daysApart(start, end) + 1;
  const c = widenForLongSpans(classifyImported(clean, kind), span);
  return {
    title: clean,
    starts_on: start,
    ends_on: end < start ? start : end,
    impact: c.impact,
    audience_tags: c.audience_tags,
    note: c.note,
    ignore: c.ignore,
  };
}
