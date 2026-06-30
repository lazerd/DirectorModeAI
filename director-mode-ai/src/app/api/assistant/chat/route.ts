import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@/lib/supabase/server';
import { recordAiUsage } from '@/lib/billing';
import {
  JTT_TOOLS, resolveJttContext, jttToolsAvailable, executeJttTool, type JttContext,
} from '@/lib/assistant/jttTools';

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

// Appended only when the user directs a league, so the model knows it can act.
const ACTIONS_PROMPT = `You can take real JTT match-day actions for THIS director's own league using your tools: check players in/out for today's matches, add a new player to a roster, or remove one.

Acting rules:
- When in doubt about names, clubs, or who's already checked in, call list_today first.
- "Clubs" are by short code (e.g. SH = Sleepy Hollow, MCC, OCC). Age groups are numbers (10, 12, 13).
- Do exactly what's asked, then report what you did in one short line (e.g. "Checked in Brooke McGuire for MCC 13s.").
- Before remove_player (or removing several at once), confirm with the user unless they were explicit.
- If a tool returns ok:false, tell the user the reason plainly — don't pretend it worked.
- For non-JTT requests, just help and explain as usual.`;

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

  // Figure out which league (if any) this director may act on.
  let ctx: JttContext = { userId: user.id, leagueId: null, matchupId: null };
  try { ctx = await resolveJttContext(user.id, page); } catch { /* help-only mode */ }
  const canAct = jttToolsAvailable(ctx);

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
    ...(canAct ? [{ type: 'text', text: ACTIONS_PROMPT }] : []),
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
        ...(canAct ? { tools: JTT_TOOLS } : {}),
      });
      await recordAiUsage(user.id, response.usage?.input_tokens ?? 0, response.usage?.output_tokens ?? 0);

      if (response.stop_reason === 'tool_use') {
        const toolUses = response.content.filter(
          (b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use'
        );
        const results: Anthropic.Messages.ToolResultBlockParam[] = [];
        for (const tu of toolUses) {
          let result: any;
          try { result = await executeJttTool(tu.name, tu.input, ctx); }
          catch (e: any) { result = { ok: false, error: e?.message || 'tool failed' }; }
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
