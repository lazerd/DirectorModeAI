import Anthropic from '@anthropic-ai/sdk';
import { google } from 'googleapis';
import { addUsage, emptyUsage, type TokenUsage } from '@/lib/assistant/meter';
import { parseCsv, type LessonKind, type LessonLine } from './charges';

/*
 * Reading the pros' lesson sheets. Every pro keeps theirs a little differently (columns,
 * date formats, "paid" notes, two students on one row), so a small model turns each
 * sheet's rows into clean lesson lines for the date range. It never invents a name or a
 * price: a row it can't read goes to `skipped` with the reason, for the director.
 */

export const EXTRACT_MODEL = process.env.AI_MODEL_LEDGER ?? 'claude-haiku-4-5';
const KINDS: LessonKind[] = ['private', 'semi', 'group', 'clinic', 'other'];

/** Pull a spreadsheet id from a Google Sheets URL (or accept a bare id). */
export const sheetIdOf = (urlOrId: string) => (String(urlOrId).match(/\/d\/([a-zA-Z0-9-_]{20,})/)?.[1] ?? (/^[a-zA-Z0-9-_]{20,}$/.test(urlOrId) ? urlOrId : null));

/** The service account address a pro shares their sheet with (view only). */
export function serviceAccountEmail(): string | null {
  try { return JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '').client_email || null; } catch { return null; }
}

/** Read every tab of a sheet the service account can see, as rows. */
export async function readSheet(urlOrId: string): Promise<{ title: string; tabs: { name: string; rows: string[][] }[] }> {
  const id = sheetIdOf(urlOrId);
  if (!id) throw new Error('That is not a Google Sheets link.');
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}');
  if (!creds.client_email) throw new Error('Google sheet reading is not set up on this server.');
  const auth = new google.auth.JWT({ email: creds.client_email, key: creds.private_key, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  const sheets = google.sheets({ version: 'v4', auth });
  let meta;
  try { meta = await sheets.spreadsheets.get({ spreadsheetId: id }); }
  catch { throw new Error(`Can't open that sheet. Share it (view only) with ${creds.client_email}.`); }
  const tabs: { name: string; rows: string[][] }[] = [];
  for (const s of meta.data.sheets ?? []) {
    const name = s.properties?.title ?? 'Sheet1';
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: id, range: `'${name.replace(/'/g, "''")}'`, valueRenderOption: 'FORMATTED_VALUE' });
    tabs.push({ name, rows: ((res.data.values as string[][] | undefined) ?? []).map((r) => r.map((c) => String(c ?? ''))) });
  }
  return { title: meta.data.properties?.title ?? 'Sheet', tabs };
}

export interface Extracted { lines: LessonLine[]; skipped: { row: string; reason: string }[]; usage: TokenUsage }

const TOOL: Anthropic.Messages.Tool = {
  name: 'lessons',
  description: 'Return every billable lesson line in the date range, and every row you could not use.',
  input_schema: {
    type: 'object',
    properties: {
      lines: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            row: { type: 'integer', description: 'Row number shown at the start of the line.' },
            date: { type: 'string', description: 'YYYY-MM-DD' },
            student: { type: 'string', description: 'One student, exactly as written. Split shared lessons into one line per student.' },
            pro: { type: 'string', description: 'The pro, if the row names one; else empty.' },
            kind: { type: 'string', enum: KINDS },
            minutes: { type: ['integer', 'null'] },
            price: { type: 'number', description: 'What THIS student is charged, in dollars. For a shared lesson use the per-student amount if the sheet gives it.' },
            note: { type: ['string', 'null'] },
          },
          required: ['row', 'date', 'student', 'kind', 'price'],
        },
      },
      skipped: {
        type: 'array',
        items: { type: 'object', properties: { row: { type: 'integer' }, reason: { type: 'string' } }, required: ['row', 'reason'] },
      },
    },
    required: ['lines', 'skipped'],
  },
};

/**
 * Turn one sheet's rows into lesson lines for [from, to]. Rows are numbered so every
 * line points back to where it came from.
 */
export async function extractLessons(
  client: Anthropic,
  opts: { pro: string; sheetName: string; rows: string[][]; from: string; to: string; year: number; prices?: string },
): Promise<Extracted> {
  const numbered = opts.rows.slice(0, 600).map((r, i) => `${i + 1}: ${r.map((c) => c.replace(/\s+/g, ' ').trim()).join(' | ')}`).join('\n');
  if (!numbered.trim()) return { lines: [], skipped: [], usage: emptyUsage() };
  const prompt = `This is ${opts.pro}'s lesson log ("${opts.sheetName}"), a tennis pro at a private club. Find every lesson dated ${opts.from} to ${opts.to} (inclusive) that should be billed to a member.

Rules:
- One line per student per lesson. A semi-private or group lesson with 2+ names becomes one line per name.
- SHARED LESSON PRICES: if a shared lesson's row shows one amount for the whole lesson (or says "split"), divide it equally: "120, split" between 2 students is 60 each. Only use the amount as-is per student when the sheet clearly says it is per person ("each", "pp", "per person"). Never charge each student the full shared amount.
- Use only names and prices that are on the sheet. Never invent or fix a name.
- If a row has no price but the sheet clearly shows a rate for that lesson type, use it; otherwise skip the row with reason "no price".
- Skip rows marked paid, cancelled, no-show-no-charge, comp, free, or "no charge", and say why.
- Skip rows outside the date range silently (do not list them).
- EVERY row dated inside the range must end up in either lines or skipped. Never drop one silently.
- minutes: the lesson length in minutes as a number ("1 hr" = 60, "90" = 90, "1.5" hours = 90), or null if not shown.
- Dates without a year are in ${opts.year}. Return YYYY-MM-DD.
- kind: private (1 student), semi (2 students sharing), group (3+), clinic, or other.${opts.prices ? `\n- The club's standard prices: ${opts.prices}` : ''}

Rows:
${numbered}`;
  const res = await client.messages.create({
    model: EXTRACT_MODEL,
    max_tokens: 8000,
    tools: [TOOL],
    tool_choice: { type: 'tool', name: 'lessons' },
    messages: [{ role: 'user', content: prompt }],
  });
  const usage = addUsage(emptyUsage(), res.usage);
  const out = res.content.find((b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use')?.input as any;
  const src = (row: number) => `${opts.pro}'s sheet, ${opts.sheetName} row ${row}`;
  const lines: LessonLine[] = [];
  const skipped: { row: string; reason: string }[] = [];
  for (const l of out?.lines ?? []) {
    const date = String(l.date || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < opts.from || date > opts.to) continue;
    const student = String(l.student || '').trim();
    const price = Number(l.price);
    if (!student || !Number.isFinite(price)) { skipped.push({ row: src(l.row), reason: 'unreadable' }); continue; }
    lines.push({
      date, student, pro: String(l.pro || '').trim() || opts.pro,
      kind: KINDS.includes(l.kind) ? l.kind : 'other',
      minutes: toMinutes(l.minutes), qty: 1, price, note: l.note ?? null, source: src(l.row),
    });
  }
  for (const s of out?.skipped ?? []) skipped.push({ row: src(s.row), reason: String(s.reason || '') });
  return { lines, skipped, usage };
}

/** 60, "60", "1 hr", "1.5 hours", "90 min" -> minutes; anything else -> null. */
export function toMinutes(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return Math.round(v);
  const t = String(v ?? '').toLowerCase().trim();
  const n = parseFloat(t);
  if (!Number.isFinite(n) || n <= 0) return null;
  return /h/.test(t) || n <= 4 ? Math.round(n * 60) : Math.round(n);
}

/** CSV text uploaded by hand (when a sheet isn't shared) → rows. */
export const rowsFromCsv = (csv: string) => parseCsv(csv);
