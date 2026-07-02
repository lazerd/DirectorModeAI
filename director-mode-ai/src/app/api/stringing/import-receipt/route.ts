import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@/lib/supabase/server';
import { recordAiUsage } from '@/lib/billing';

// POST /api/stringing/import-receipt — read a photo or PDF of a string order/
// receipt with Claude vision and return the line items so the stringer can
// review them before they land in the catalog. Extraction only; the client
// does the confirmed insert.
export const dynamic = 'force-dynamic';

const MODEL = process.env.AI_MODEL_VISION ?? 'claude-opus-4-8';
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY ?? process.env.AI_API_KEY;

const STRING_TYPES = ['poly', 'multi', 'synthetic_gut', 'natural_gut', 'hybrid', 'other'] as const;
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const MAX_BYTES = 12 * 1024 * 1024; // ~12MB decoded

// Per-user rate limit — vision calls cost real tokens.
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 8;
const buckets = new Map<string, { count: number; resetAt: number }>();
function rateOk(key: string): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt < now) { buckets.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS }); return true; }
  if (b.count >= RATE_MAX) return false;
  b.count++; return true;
}

// Nudge free-text type words onto the catalog's enum.
function normalizeType(v: unknown): (typeof STRING_TYPES)[number] {
  const s = String(v ?? '').toLowerCase();
  if (STRING_TYPES.includes(s as any)) return s as any;
  if (/\bhybrid\b/.test(s)) return 'hybrid';
  if (/natural|\bgut\b/.test(s) && !/synthetic|syn/.test(s)) return 'natural_gut';
  if (/synthetic|syn[\s.-]*gut/.test(s)) return 'synthetic_gut';
  if (/multi|filament/.test(s)) return 'multi';
  if (/poly|co-?poly|polyester/.test(s)) return 'poly';
  return 'other';
}

const GAUGES = ['15', '15L', '16', '16L', '17', '18'];
function normalizeGauge(v: unknown): string {
  const s = String(v ?? '').trim().toUpperCase().replace(/\s|GAUGE|GA\.?/gi, '');
  const direct = GAUGES.find((g) => g.toUpperCase() === s || s === g.toUpperCase() + 'G');
  if (direct) return direct;
  // mm → gauge (approx, standard tennis mapping)
  const mm = s.match(/1\.?(\d{1,2})\s*MM/);
  if (mm) {
    const n = Number('1.' + mm[1]);
    const table: [number, string][] = [[1.35, '15'], [1.30, '15L'], [1.28, '16'], [1.25, '16L'], [1.20, '17'], [1.10, '18']];
    let best = '16', bd = Infinity;
    for (const [val, g] of table) { const d = Math.abs(val - n); if (d < bd) { bd = d; best = g; } }
    return best;
  }
  const bare = s.match(/^(\d{2})L?$/);
  if (bare && GAUGES.includes(s)) return s;
  return s || '';
}

function num(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(String(v).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Please log in.' }, { status: 401 });
  if (!rateOk(user.id)) return NextResponse.json({ error: 'Too many uploads — give it a moment.' }, { status: 429 });
  if (!ANTHROPIC_KEY) return NextResponse.json({ error: 'Receipt import is not configured (missing ANTHROPIC_API_KEY).' }, { status: 503 });

  const body = await req.json().catch(() => null);
  const mediaType = String(body?.mediaType || '');
  const data = String(body?.data || ''); // base64, no data: prefix
  if (!data) return NextResponse.json({ error: 'No file uploaded.' }, { status: 400 });
  const isPdf = mediaType === 'application/pdf';
  if (!isPdf && !IMAGE_TYPES.has(mediaType)) {
    return NextResponse.json({ error: 'Upload a photo (JPG/PNG/WebP) or a PDF.' }, { status: 400 });
  }
  if (Math.ceil((data.length * 3) / 4) > MAX_BYTES) {
    return NextResponse.json({ error: 'File is too large — keep it under ~9 MB.' }, { status: 413 });
  }

  const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY });

  const source = isPdf
    ? { type: 'base64', media_type: 'application/pdf', data }
    : { type: 'base64', media_type: mediaType, data };
  // The 0.30 SDK's content-block types predate the document block, so build the
  // array loosely and let the API validate the shape.
  const fileBlock = isPdf ? { type: 'document', source } : { type: 'image', source };
  const content: any[] = [
    fileBlock,
    {
      type: 'text',
      text:
        'This is a receipt, invoice, or order confirmation for tennis/racquet STRING bought for a stringing shop. ' +
        'Extract every distinct string product as a line item. Include only actual string (reels, sets, packages of tennis/squash/badminton string) — ignore shipping, tax, discounts, grips, tools, and any non-string items. ' +
        'For each item give: brand, product name, string type, gauge, unit price (per set/reel if shown), and quantity. Use null for anything not clearly visible. ' +
        'Call the record_strings tool exactly once with all the items. If there are no string products, call it with an empty list.',
    },
  ];

  const tools: any[] = [
    {
      name: 'record_strings',
      description: 'Record the string products found on the receipt.',
      input_schema: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                brand: { type: 'string', description: 'Manufacturer, e.g. Luxilon, Babolat, Solinco' },
                name: { type: 'string', description: 'Product name, e.g. ALU Power, RPM Blast, Hyper-G' },
                string_type: { type: 'string', enum: STRING_TYPES as unknown as string[] },
                gauge: { type: 'string', description: 'e.g. 16, 16L, 17, or a mm value like 1.25mm' },
                unit_price: { type: ['number', 'null'], description: 'Price per set/reel in dollars' },
                quantity: { type: ['integer', 'null'] },
              },
              required: ['brand', 'name'],
            },
          },
        },
        required: ['items'],
      },
    },
  ];

  let msg: any;
  try {
    msg = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4096,
      tools,
      tool_choice: { type: 'tool', name: 'record_strings' } as any,
      messages: [{ role: 'user', content }],
    } as any);
  } catch (e: any) {
    const status = e?.status ?? 500;
    return NextResponse.json(
      { error: status === 400 ? 'Couldn’t read that file — try a clearer photo or a PDF.' : 'Vision service error, please try again.' },
      { status: status === 400 ? 400 : 502 },
    );
  }

  const toolBlock = (msg.content || []).find((b: any) => b.type === 'tool_use' && b.name === 'record_strings');
  const rawItems: any[] = Array.isArray(toolBlock?.input?.items) ? toolBlock.input.items : [];

  const items = rawItems
    .map((r) => ({
      brand: String(r?.brand ?? '').trim(),
      name: String(r?.name ?? '').trim(),
      string_type: normalizeType(r?.string_type),
      gauge: normalizeGauge(r?.gauge),
      price: num(r?.unit_price),
      quantity: Number.isFinite(Number(r?.quantity)) && Number(r?.quantity) > 0 ? Math.round(Number(r.quantity)) : null,
    }))
    .filter((r) => r.brand || r.name);

  // Best-effort usage tracking (never blocks the response).
  recordAiUsage(user.id, msg?.usage?.input_tokens ?? 0, msg?.usage?.output_tokens ?? 0).catch(() => {});

  return NextResponse.json({ items });
}
