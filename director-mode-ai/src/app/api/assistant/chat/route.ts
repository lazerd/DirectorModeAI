import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@/lib/supabase/server';
import { recordAiUsage } from '@/lib/billing';
import { resolvePacks } from '@/lib/assistant/registry';

export const dynamic = 'force-dynamic';

const MODEL = process.env.AI_MODEL_AGENT ?? 'claude-sonnet-4-6';
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY ?? process.env.AI_API_KEY;

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 20;
const rateBuckets = new Map<string, { count: number; resetAt: number }>();
function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const b = rateBuckets.get(key);
  if (!b || b.resetAt < now) { rateBuckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS }); return true; }
  if (b.count >= RATE_LIMIT_MAX) return false;
  b.count++; return true;
}

const SYSTEM_PROMPT = `You are the ClubMode Assistant — a friendly, plain-spoken helper built into ClubMode AI, the platform clubs use to run racquet sports.

ClubMode covers: live court sheets (CourtSheet), team leagues and Junior Team Tennis (JTT), mixers and tournaments, lessons, stringing, player matching, a roster CRM, swim-team family signups, and a monthly Board Report.

How to help:
- Answer directly and briefly, in everyday language. No jargon, no walls of text.
- For how-to questions, give short numbered steps and name the right area of the app.
- Keep answers to a few sentences unless asked for detail.`;

// Appended whenever the user has at least one active tool pack. Domain-specific
// guidance is supplied per pack; this covers the rules common to all actions.
const ACTIONS_PREAMBLE = `You can take real actions in ClubMode using your tools. Rules for every action:
- PREVIEW BEFORE CHANGING: for any tool that changes, deletes, sends, or charges, first call it WITHOUT confirm to get a preview, tell the user exactly what will happen (names, counts, amounts), and only call it again with confirm:true after they clearly say yes. If a tool result includes "needsConfirm", you are seeing a preview — do not claim it happened.
- Safe reads and lookups you can just do, then report the answer.
- Do exactly what's asked, then report what you did in one short line.
- If a tool returns ok:false, tell the user the reason plainly — don't pretend it worked.
- For anything your tools don't cover, just help and explain as usual.`;

interface ClientMessage { role: 'user' | 'assistant'; content: string }

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ kind: 'error', message: 'Please log in to use the assistant.' }, { status: 401 });
  if (!checkRateLimit(user.id)) return NextResponse.json({ kind: 'error', message: 'You are sending messages too fast — give it a moment.' }, { status: 429 });
  if (!ANTHROPIC_KEY) return NextResponse.json({ kind: 'error', message: 'Assistant not configured (missing ANTHROPIC_API_KEY).' }, { status: 503 });

  const body = await req.json().catch(() => null);
  const message = (body?.message as string | undefined)?.trim();
  if (!message) return NextResponse.json({ kind: 'error', message: 'Missing message' }, { status: 400 });
  const history = (body?.history as ClientMessage[] | undefined) ?? [];
  const page = (body?.page as string | undefined)?.trim();

  // Resolve which domain packs are available for this user on this page. Each
  // pack carries its own tools, guidance, and executor (bound to its context).
  const packs = await resolvePacks(user.id, page);
  const canAct = packs.length > 0;
  const tools = packs.flatMap((p) => p.toolSchemas);
  const dispatch = new Map<string, (typeof packs)[number]>();
  for (const p of packs) for (const s of p.toolSchemas) dispatch.set(s.name, p);

  const messages: Anthropic.Messages.MessageParam[] = [];
  for (const m of history.slice(-10)) {
    if (m.role === 'user' || m.role === 'assistant') {
      const text = String(m.content ?? '').slice(0, 4000);
      if (text) messages.push({ role: m.role, content: text });
    }
  }
  messages.push({ role: 'user', content: message });

  const systemBlocks = [
    { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
    ...(canAct ? [{ type: 'text', text: ACTIONS_PREAMBLE }] : []),
    ...packs.map((p) => ({ type: 'text', text: p.actionsPrompt })),
    ...(page ? [{ type: 'text', text: `The director is currently on this page: ${page}` }] : []),
  ] as unknown as Anthropic.Messages.TextBlockParam[];

  const client = new Anthropic({ apiKey: ANTHROPIC_KEY });

  // Tool-use loop: let the model call JTT tools, execute them, feed results back,
  // until it produces a final text answer. Capped so a loop can't run away.
  let finalText = '';
  try {
    for (let round = 0; round < 6; round++) {
      const response: Anthropic.Messages.Message = await client.messages.create({
        model: MODEL,
        max_tokens: 1024,
        system: systemBlocks,
        messages,
        ...(tools.length ? { tools } : {}),
      });
      await recordAiUsage(user.id, response.usage?.input_tokens ?? 0, response.usage?.output_tokens ?? 0);

      if (response.stop_reason === 'tool_use') {
        const toolUses = response.content.filter(
          (b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use'
        );
        const results: Anthropic.Messages.ToolResultBlockParam[] = [];
        for (const tu of toolUses) {
          let result: any;
          try {
            const pack = dispatch.get(tu.name);
            result = pack ? await pack.execute(tu.name, tu.input) : { ok: false, error: `Unknown tool ${tu.name}` };
          } catch (e: any) { result = { ok: false, error: e?.message || 'tool failed' }; }
          results.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(result) });
        }
        messages.push({ role: 'assistant', content: response.content });
        messages.push({ role: 'user', content: results });
        continue;
      }

      finalText = response.content
        .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
        .map((b) => b.text.trim()).filter(Boolean).join('\n').trim();
      break;
    }
  } catch (err) {
    console.error('Assistant chat model call failed:', err);
    return NextResponse.json({ kind: 'error', message: 'The assistant had trouble responding. Please try again.' }, { status: 502 });
  }

  return NextResponse.json({ kind: 'message', text: finalText || "Done." });
}
