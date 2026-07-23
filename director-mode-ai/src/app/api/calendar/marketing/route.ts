import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import {
  requireCalendarContext, isAuthError, ITEM_COLUMNS, type CalendarItemRow,
} from '@/lib/calendar/server';
import { recordAiUsage } from '@/lib/billing';
import { catalogEntry } from '@/lib/calendar/catalog';
import { addDays, shortLabel } from '@/lib/calendar/dates';

// POST /api/calendar/marketing — the per-event marketing kit.
//
// Writes the promo blurb, the announcement email, and flyer text, and computes
// when to announce and when to open registration (working backwards from the
// event date, which is the part directors most often leave too late).
//
// Saved onto calendar_items.marketing so it's generated once, not on every
// page view. The copy is a starting point the director edits — it is never
// sent from here; sending goes through the campaigns engine.
export const dynamic = 'force-dynamic';

const MODEL = process.env.AI_MODEL_AGENT ?? 'claude-sonnet-4-6';
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY ?? process.env.AI_API_KEY;

const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 10;
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
    return NextResponse.json({ error: 'Too many at once — give it a moment.' }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const itemId = String(body?.itemId || '');
  if (!itemId) return NextResponse.json({ error: 'Missing itemId.' }, { status: 400 });

  const { data: row } = await ctx.db
    .from('calendar_items')
    .select(ITEM_COLUMNS)
    .eq('id', itemId)
    .eq('club_id', ctx.club.id)
    .maybeSingle();

  if (!row) return NextResponse.json({ error: 'Event not found.' }, { status: 404 });
  const item = row as unknown as CalendarItemRow;

  const cat = catalogEntry(item.catalog_key);
  const effort = cat?.effort ?? 'medium';

  // Lead time scales with the size of the ask. A flagship weekend people book
  // travel around needs two months' notice; a Friday social needs ten days.
  const leadDays = effort === 'flagship' ? 56 : effort === 'heavy' ? 35 : effort === 'medium' ? 21 : 10;
  const schedule = item.target_date
    ? {
        announce_on: addDays(item.target_date, -leadDays),
        registration_opens_on: addDays(item.target_date, -Math.round(leadDays * 0.75)),
        reminder_on: addDays(item.target_date, -3),
        last_call_on: addDays(item.target_date, -1),
        note:
          `Announce ${shortLabel(addDays(item.target_date, -leadDays))}, open signups ` +
          `${shortLabel(addDays(item.target_date, -Math.round(leadDays * 0.75)))}, ` +
          `remind ${shortLabel(addDays(item.target_date, -3))}.`,
      }
    : null;

  let copy: Record<string, unknown> = {};
  let usage: any = null;

  if (ANTHROPIC_KEY) {
    const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY });
    try {
      const msg = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 2048,
        tools: [
          {
            name: 'write_marketing',
            description: 'Write the promotional copy for a club event.',
            input_schema: {
              type: 'object',
              properties: {
                blurb: { type: 'string', description: 'One or two sentences for the club newsletter or website.' },
                email_subject: { type: 'string', description: 'Subject line. Specific, not clever.' },
                email_body: { type: 'string', description: 'Short announcement email, plain text, 100-180 words. No greeting placeholder like [Name].' },
                flyer_headline: { type: 'string', description: 'Five words or fewer, for a poster.' },
                flyer_lines: { type: 'array', items: { type: 'string' }, description: '3-5 short poster lines: what, when, who, cost, how to sign up.' },
                social_post: { type: 'string', description: 'A short post for the club social account.' },
              },
              required: ['blurb', 'email_subject', 'email_body', 'flyer_headline', 'flyer_lines'],
            },
          },
        ],
        tool_choice: { type: 'tool', name: 'write_marketing' } as any,
        messages: [{
          role: 'user',
          content:
            `Write promotional copy for an event at ${ctx.club.name}, a racquets and swim club.\n\n` +
            `EVENT: ${item.title}\n` +
            (item.target_date ? `DATE: ${shortLabel(item.target_date)}${item.start_time ? ` at ${String(item.start_time).slice(0, 5)}` : ''}\n` : '') +
            `FOR: ${(item.audience ?? []).join(', ') || 'all members'}\n` +
            (item.entry_fee_cents ? `COST: $${(item.entry_fee_cents / 100).toFixed(0)} per player\n` : 'COST: free to members\n') +
            (item.description ? `ABOUT: ${item.description}\n` : cat ? `ABOUT: ${cat.description}\n` : '') +
            (cat?.fb ? `FOOD: ${cat.fb}\n` : '') +
            (cat?.prize ? `PRIZES: ${cat.prize}\n` : '') +
            `\nWrite for members of a private club — warm and specific, not corporate. ` +
            `Do not invent details that were not given: no made-up prices, times, sponsors, or guest names. ` +
            `If the date is missing, write around it rather than guessing. Call write_marketing once.`,
        }],
      } as any);

      const block: any = (msg.content || []).find((b: any) => b.type === 'tool_use');
      copy = (block?.input as Record<string, unknown>) ?? {};
      usage = msg?.usage;
    } catch {
      return NextResponse.json(
        { error: 'The copywriter is unavailable right now — try again in a moment.' },
        { status: 502 },
      );
    }
  } else {
    return NextResponse.json(
      { error: 'Marketing copy is not configured (missing ANTHROPIC_API_KEY).' },
      { status: 503 },
    );
  }

  const marketing = { ...copy, schedule, generated_for_date: item.target_date };

  await ctx.db
    .from('calendar_items')
    .update({ marketing })
    .eq('id', itemId)
    .eq('club_id', ctx.club.id);

  if (usage) {
    recordAiUsage(ctx.user.id, usage.input_tokens ?? 0, usage.output_tokens ?? 0).catch(() => {});
  }

  return NextResponse.json({ marketing });
}
