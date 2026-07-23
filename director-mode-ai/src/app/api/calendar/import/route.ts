import { NextResponse } from 'next/server';
import { requireCalendarContext, isAuthError } from '@/lib/calendar/server';
import { parseIcs } from '@/lib/calendar/ics';
import { classifyImported, widenForLongSpans } from '@/lib/calendar/classify';
import { daysApart } from '@/lib/calendar/dates';
import { commitConstraints, MAX_IMPORT_ROWS } from '@/lib/calendar/importCommit';
import type { Audience, ConstraintImpact, ConstraintSource } from '@/lib/calendar/types';

// POST /api/calendar/import — read .ics, CSV, or pasted text into constraints.
//
// Two-step by design:
//   { mode: 'parse',  kind, content }         → proposed rows, nothing written
//   { mode: 'commit', kind, rows, label }     → writes them, grouped by import
//
// The parse step never touches the database. A director sees exactly what a
// file will do before it does it, and a misread import can be undone as one
// unit through the import id rather than by hunting down forty stray rows.
export const dynamic = 'force-dynamic';

const MAX_CONTENT = 2_000_000; // ~2MB of text

export interface ProposedConstraint {
  title: string;
  starts_on: string;
  ends_on: string;
  impact: ConstraintImpact;
  audience_tags: Audience[];
  note: string;
  ignore: boolean;
}

export async function POST(req: Request) {
  const ctx = await requireCalendarContext({ requirePro: true });
  if (isAuthError(ctx)) return ctx.error;

  const body = await req.json().catch(() => null);
  const mode = String(body?.mode || 'parse');
  const kind = String(body?.kind || 'ics');

  if (mode === 'commit') return commit(ctx, body);

  const content = String(body?.content ?? '');
  if (!content.trim()) return NextResponse.json({ error: 'Nothing to read.' }, { status: 400 });
  if (content.length > MAX_CONTENT) {
    return NextResponse.json({ error: 'That file is too large — keep it under about 2 MB.' }, { status: 413 });
  }

  const source = (['school', 'club', 'usta', 'holiday', 'manual'] as const).includes(body?.source)
    ? (body.source as ConstraintSource)
    : 'school';

  let parsed: ProposedConstraint[];
  try {
    parsed = kind === 'ics' ? fromIcs(content, source) : fromDelimited(content, source);
  } catch {
    return NextResponse.json(
      { error: 'Could not read that file. An .ics export or a CSV with title and date columns works best.' },
      { status: 400 },
    );
  }

  if (parsed.length === 0) {
    return NextResponse.json(
      { error: 'No dated entries found in that file.', proposed: [] },
      { status: 400 },
    );
  }

  return NextResponse.json({
    proposed: parsed.slice(0, MAX_IMPORT_ROWS),
    truncated: parsed.length > MAX_IMPORT_ROWS,
    total: parsed.length,
  });
}

// ---------- parsing ----------

function fromIcs(content: string, source: ConstraintSource): ProposedConstraint[] {
  return parseIcs(content).map((e) => propose(e.summary, e.start, e.end, source));
}

/**
 * CSV or tab-separated, with or without a header.
 *
 * School districts hand out wildly inconsistent exports, so rather than
 * demanding a fixed column order this finds the first date-shaped column and
 * treats the longest non-date column as the title. That reads a real district
 * CSV far more often than a strict schema does.
 */
function fromDelimited(content: string, source: ConstraintSource): ProposedConstraint[] {
  const lines = content.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const out: ProposedConstraint[] = [];

  for (const line of lines) {
    const cells = splitRow(line);
    if (cells.length < 2) continue;

    const dates: string[] = [];
    let title = '';
    for (const cell of cells) {
      const d = toISO(cell);
      if (d) { dates.push(d); continue; }
      if (cell.length > title.length && !/^\d+$/.test(cell)) title = cell;
    }

    if (dates.length === 0 || !title) continue;
    dates.sort();
    out.push(propose(title, dates[0], dates[dates.length - 1], source));
  }

  return out;
}

function splitRow(line: string): string[] {
  // Respect quoted commas; fall back to tabs when there are none.
  const cells: string[] = [];
  let cur = '';
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if ((ch === ',' || ch === '\t') && !quoted) { cells.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  cells.push(cur.trim());
  return cells.map((c) => c.replace(/^"|"$/g, '').trim()).filter((c) => c.length > 0);
}

/** Accepts ISO, US, and long-form dates — the three that actually turn up. */
function toISO(cell: string): string | null {
  const s = cell.trim();

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (iso) return fmt(+iso[1], +iso[2], +iso[3]);

  const us = /^(\d{1,2})[/](\d{1,2})[/](\d{2,4})$/.exec(s);
  if (us) {
    const year = us[3].length === 2 ? 2000 + +us[3] : +us[3];
    return fmt(year, +us[1], +us[2]);
  }

  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const long = /^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(s);
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

function propose(title: string, start: string, end: string, source: ConstraintSource): ProposedConstraint {
  const clean = title.trim().slice(0, 200);
  const span = daysApart(start, end) + 1;
  const c = widenForLongSpans(classifyImported(clean, source), span);
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

// ---------- commit ----------

async function commit(ctx: any, body: any) {
  const rows: any[] = Array.isArray(body?.rows) ? body.rows : [];
  if (rows.length === 0) return NextResponse.json({ error: 'Nothing to import.' }, { status: 400 });

  const result = await commitConstraints({
    db: ctx.db,
    clubId: ctx.club.id,
    userId: ctx.user.id,
    planId: body?.planId ? String(body.planId) : null,
    kind: String(body?.kind || 'ics'),
    label: String(body?.label || 'Imported calendar'),
    filename: body?.filename ? String(body.filename).slice(0, 200) : null,
    rows,
    source: (['school', 'club', 'usta', 'holiday', 'manual'] as const).includes(body?.source)
      ? body.source
      : 'school',
  });

  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json(result);
}
