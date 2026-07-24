import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { requireCalendarContext, isAuthError } from '@/lib/calendar/server';
import { recordAiUsage } from '@/lib/billing';
import { classifyImported, widenForLongSpans, CALENDAR_KINDS, type CalendarKind } from '@/lib/calendar/classify';
import { daysApart } from '@/lib/calendar/dates';
import { buildVisionPrompt, VISION_TOOL, DEFAULT_LABEL } from '@/lib/calendar/visionPrompt';
import { stripDatePrefix } from '@/lib/calendar/importParse';

// POST /api/calendar/import/vision — read a calendar PDF or photo.
//
// The common case CalendarMode has to handle: the district publishes a
// one-page PDF poster, the swim team hands out a meet schedule, the league
// mails a grid — or the director just photographs whichever one is on the
// fridge. Claude reads it into dated rows; the rule-based classifier then
// decides what each row MEANS for the club, and the director reviews before
// anything is written.
//
// The prompt adapts to the declared calendar kind: telling the model it is
// looking at a swim meet schedule rather than "a calendar" is the difference
// between extracting "Divisionals" and skipping it as decoration.
//
// Extraction only — the commit goes through /api/calendar/import, so both
// upload paths share one write path and one undo.
//
// Follows the same shape as /api/stringing/import-receipt.
export const dynamic = 'force-dynamic';

const MODEL = process.env.AI_MODEL_VISION ?? 'claude-opus-4-8';
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY ?? process.env.AI_API_KEY;

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const MAX_BYTES = 12 * 1024 * 1024;

// Vision calls cost real tokens — cap them per user.
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 6;
const buckets = new Map<string, { count: number; resetAt: number }>();
function rateOk(key: string): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt < now) { buckets.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS }); return true; }
  if (b.count >= RATE_MAX) return false;
  b.count++; return true;
}

export async function POST(req: Request) {
  const ctx = await requireCalendarContext({ requirePro: true });
  if (isAuthError(ctx)) return ctx.error;

  if (!rateOk(ctx.user.id)) {
    return NextResponse.json({ error: 'Too many uploads — give it a moment.' }, { status: 429 });
  }
  if (!ANTHROPIC_KEY) {
    return NextResponse.json(
      { error: 'Calendar reading is not configured (missing ANTHROPIC_API_KEY).' },
      { status: 503 },
    );
  }

  const body = await req.json().catch(() => null);
  const mediaType = String(body?.mediaType || '');
  const data = String(body?.data || ''); // base64, no data: prefix
  const year = Number(body?.year) || new Date().getUTCFullYear();
  const kind: CalendarKind = CALENDAR_KINDS.some((k) => k.value === body?.kind)
    ? (body.kind as CalendarKind)
    : 'school';

  if (!data) return NextResponse.json({ error: 'No file uploaded.' }, { status: 400 });

  const isPdf = mediaType === 'application/pdf';
  if (!isPdf && !IMAGE_TYPES.has(mediaType)) {
    return NextResponse.json({ error: 'Upload a photo (JPG/PNG/WebP) or a PDF.' }, { status: 400 });
  }
  if (Math.ceil((data.length * 3) / 4) > MAX_BYTES) {
    return NextResponse.json({ error: 'File is too large — keep it under about 9 MB.' }, { status: 413 });
  }

  const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY });
  const source = { type: 'base64', media_type: isPdf ? 'application/pdf' : mediaType, data };
  const fileBlock = isPdf ? { type: 'document', source } : { type: 'image', source };

  const content: any[] = [
    fileBlock,
    {
      type: 'text',
      text: buildVisionPrompt(kind, year),
    },
  ];

  const tools: any[] = [VISION_TOOL];

  let msg: any;
  try {
    msg = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 8192,
      tools,
      tool_choice: { type: 'tool', name: 'record_calendar' } as any,
      messages: [{ role: 'user', content }],
    } as any);
  } catch (e: any) {
    const status = e?.status ?? 500;
    return NextResponse.json(
      {
        error: status === 400
          ? 'Could not read that file — try a clearer photo, or the PDF version.'
          : 'The calendar reader is unavailable right now, please try again.',
      },
      { status: status === 400 ? 400 : 502 },
    );
  }

  const block = (msg.content || []).find((b: any) => b.type === 'tool_use' && b.name === 'record_calendar');
  const raw: any[] = Array.isArray(block?.input?.entries) ? block.input.entries : [];

  const proposed = raw
    .map((r) => {
      // Grid cells carry their own date ("Aug 6-7: PD Day"); the real dates
      // are already in start/end, so drop the echo.
      const title = stripDatePrefix(String(r?.title ?? '')).slice(0, 200);
      const start = normalizeDate(r?.start);
      const end = normalizeDate(r?.end) ?? start;
      if (!title || !start || !end) return null;
      const [a, b] = start <= end ? [start, end] : [end, start];
      const c = widenForLongSpans(classifyImported(title, kind), daysApart(a, b) + 1);
      return {
        title,
        starts_on: a,
        ends_on: b,
        impact: c.impact,
        audience_tags: c.audience_tags,
        note: c.note,
        ignore: c.ignore,
      };
    })
    .filter(Boolean)
    .slice(0, 500);

  // Best-effort usage tracking; never blocks the response.
  recordAiUsage(ctx.user.id, msg?.usage?.input_tokens ?? 0, msg?.usage?.output_tokens ?? 0).catch(() => {});

  return NextResponse.json({
    proposed,
    label: String(block?.input?.documentLabel ?? '').slice(0, 120) || DEFAULT_LABEL[kind],
    kind,
    total: proposed.length,
  });
}

function normalizeDate(v: unknown): string | null {
  const s = String(v ?? '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}
