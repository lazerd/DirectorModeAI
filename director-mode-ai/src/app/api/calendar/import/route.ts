import { NextResponse } from 'next/server';
import { requireCalendarContext, isAuthError } from '@/lib/calendar/server';
import { CALENDAR_KINDS, type CalendarKind } from '@/lib/calendar/classify';
import {
  parseIcsUpload, parseDelimitedUpload, type ProposedConstraint,
} from '@/lib/calendar/importParse';
import { commitConstraints, MAX_IMPORT_ROWS } from '@/lib/calendar/importCommit';

// POST /api/calendar/import — read .ics, CSV, or pasted text into constraints.
//
// Two-step by design:
//   { mode: 'parse',  kind, content, source }  → proposed rows, nothing written
//   { mode: 'commit', kind, rows, label }      → writes them, grouped by import
//
// `kind` is the FILE format (ics / csv); `source` is what KIND OF CALENDAR it
// is (school / swim / usta / club / facility), which decides the vocabulary the
// classifier reads it with. Getting that second one right is the difference
// between "Divisionals" landing as a club-wide blackout and landing as a note.
//
// The parse step never touches the database. A director sees exactly what a
// file will do before it does it, and a misread import can be undone as one
// unit through the import id rather than by hunting down forty stray rows.
export const dynamic = 'force-dynamic';

const MAX_CONTENT = 2_000_000; // ~2MB of text

export type { ProposedConstraint };

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

  const source = toKind(body?.source);

  let parsed: ProposedConstraint[];
  try {
    parsed = kind === 'ics' ? parseIcsUpload(content, source) : parseDelimitedUpload(content, source);
  } catch {
    return NextResponse.json(
      { error: 'Could not read that file. An .ics export or a CSV with a title and a date column works best.' },
      { status: 400 },
    );
  }

  if (parsed.length === 0) {
    return NextResponse.json(
      {
        error: "No dated entries found in that file. If it's a picture or a PDF, upload it as one — we'll read it.",
        proposed: [],
      },
      { status: 400 },
    );
  }

  return NextResponse.json({
    proposed: parsed.slice(0, MAX_IMPORT_ROWS),
    truncated: parsed.length > MAX_IMPORT_ROWS,
    total: parsed.length,
    source,
  });
}

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
    source: toKind(body?.source),
  });

  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json(result);
}

/** Only a calendar kind the classifier actually knows. */
function toKind(v: unknown): CalendarKind {
  const s = String(v ?? '');
  return CALENDAR_KINDS.some((k) => k.value === s) ? (s as CalendarKind) : 'school';
}
