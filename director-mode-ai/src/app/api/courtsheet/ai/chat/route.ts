import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { requireStaffForClub } from '@/lib/courtsheet/routeAuth';
import { CourtSheetEngine } from '@/lib/courtsheet/engine';
import { SYSTEM_PROMPT } from '@/lib/courtsheet/ai/systemPrompt';
import { tools as buildTools } from '@/lib/courtsheet/ai/tools';
import { dispatch, type DispatchResult, type ToolName } from '@/lib/courtsheet/ai/dispatch';
import { utcToLocalDate } from '@/lib/courtsheet/timezones';

export const dynamic = 'force-dynamic';

const MODEL = process.env.AI_MODEL_AGENT ?? 'claude-sonnet-4-6';
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY ?? process.env.AI_API_KEY;

// Per-user rate limit (matches the existing /api/mixer/recommend pattern).
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 12;
const rateBuckets = new Map<string, { count: number; resetAt: number }>();
function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const b = rateBuckets.get(key);
  if (!b || b.resetAt < now) {
    rateBuckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (b.count >= RATE_LIMIT_MAX) return false;
  b.count++;
  return true;
}

interface ClientMessage {
  role: 'user' | 'assistant';
  content: string;
  /** Optional past tool calls + results for multi-turn continuity. */
  tool_calls?: Array<{ id: string; name: string; input: unknown }>;
  tool_results?: Array<{ tool_use_id: string; content: string }>;
}

/**
 * POST /api/courtsheet/ai/chat
 *   body: { message: string, history?: ClientMessage[] }
 *
 * Returns one of:
 *   { kind: 'message', text }          — clarifying question or status
 *   { kind: 'plan', plan, summary }    — preview ready; client opens modal
 *   { kind: 'slots', slots }           — availability response
 *   { kind: 'context', context }       — usually internal; surfaced for debug
 *   { kind: 'error', message }
 */
export async function POST(req: Request) {
  const ctx = await requireStaffForClub({ requireWrite: true });
  if ('error' in ctx) return ctx.error;
  if (!checkRateLimit(ctx.user.id)) {
    return NextResponse.json({ kind: 'error', message: 'Too many requests' }, { status: 429 });
  }
  if (!ANTHROPIC_KEY) {
    return NextResponse.json(
      { kind: 'error', message: 'AI not configured (missing ANTHROPIC_API_KEY)' },
      { status: 503 }
    );
  }

  const body = await req.json().catch(() => null);
  const message = (body?.message as string | undefined)?.trim();
  if (!message) {
    return NextResponse.json({ kind: 'error', message: 'Missing message' }, { status: 400 });
  }
  const history = (body?.history as ClientMessage[] | undefined) ?? [];

  const engine = await CourtSheetEngine.load({ db: ctx.db, club_id: ctx.club.id });
  const todayISO = utcToLocalDate(new Date(), ctx.club.timezone);

  const client = new Anthropic({ apiKey: ANTHROPIC_KEY });

  // Build the Messages-API conversation. We re-play prior turns from
  // history; the model's last tool_use + tool_result pair give it
  // continuity ("actually make it 8 to 1").
  const messages: Anthropic.Messages.MessageParam[] = [];
  for (const m of history.slice(-8)) {
    if (m.role === 'user') {
      messages.push({ role: 'user', content: m.content });
    } else {
      const content: any[] = [{ type: 'text', text: m.content }];
      if (m.tool_calls) {
        for (const tc of m.tool_calls) {
          content.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.name,
            input: tc.input as Record<string, unknown>,
          });
        }
      }
      messages.push({ role: 'assistant', content });
      if (m.tool_results) {
        messages.push({
          role: 'user',
          content: m.tool_results.map((tr) => ({
            type: 'tool_result' as const,
            tool_use_id: tr.tool_use_id,
            content: tr.content,
          })),
        });
      }
    }
  }
  messages.push({ role: 'user', content: message });

  // Prompt-cache the system prompt + tool list (re-used across turns).
  // ephemeral cache has a ~5m TTL, plenty for multi-turn sessions.
  // SDK v0.30 typings lack cache_control; the field is honored by the API.
  const systemBlocks = [
    {
      type: 'text',
      text: SYSTEM_PROMPT,
      cache_control: { type: 'ephemeral' },
    },
  ] as unknown as Anthropic.Messages.TextBlockParam[];

  const toolList = buildTools();

  // First model call.
  let response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: systemBlocks,
    tools: toolList,
    messages,
  });

  // Tool-use loop: if the model called a tool, run it and feed results back.
  // We allow up to 4 hops so the model can call get_context first, then a
  // booking tool, etc.
  let hops = 0;
  const TURN_LIMIT = 4;
  const dispatchCtx = { engine, todayISO };
  const accumulatedToolCalls: Array<{ id: string; name: string; input: unknown }> = [];
  const accumulatedToolResults: Array<{ tool_use_id: string; content: string }> = [];
  let lastPlanResult: Extract<DispatchResult, { kind: 'plan' }> | null = null;
  let lastSlotsResult: Extract<DispatchResult, { kind: 'slots' }> | null = null;

  while (response.stop_reason === 'tool_use' && hops < TURN_LIMIT) {
    hops++;
    const toolUseBlocks = response.content.filter(
      (b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use'
    );
    if (toolUseBlocks.length === 0) break;

    const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];
    for (const block of toolUseBlocks) {
      accumulatedToolCalls.push({ id: block.id, name: block.name, input: block.input });
      const result = await dispatch(block.name as ToolName, block.input, dispatchCtx);
      const serialized = serializeForModel(result);
      toolResults.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: serialized,
      });
      accumulatedToolResults.push({ tool_use_id: block.id, content: serialized });

      if (result.kind === 'plan') {
        lastPlanResult = result;
        // Don't keep cycling — return the plan to the user.
        break;
      }
      if (result.kind === 'slots') {
        lastSlotsResult = result;
      }
    }

    // Push the assistant turn + the tool_result turn into the conversation.
    messages.push({ role: 'assistant', content: response.content });
    messages.push({ role: 'user', content: toolResults });

    if (lastPlanResult) break;

    response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: systemBlocks,
      tools: toolList,
      messages,
    });
  }

  // Pull any text the model emitted alongside or after tool use.
  const textBlocks = response.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
    .map((b) => b.text.trim())
    .filter(Boolean);
  const aiText = textBlocks.join('\n').trim();

  if (lastPlanResult) {
    return NextResponse.json({
      kind: 'plan',
      plan: lastPlanResult.plan,
      summary: lastPlanResult.intent_summary,
      ai_message: aiText || null,
      tool_calls: accumulatedToolCalls,
      tool_results: accumulatedToolResults,
    });
  }
  if (lastSlotsResult) {
    return NextResponse.json({
      kind: 'slots',
      slots: lastSlotsResult.slots,
      ai_message: aiText || null,
      tool_calls: accumulatedToolCalls,
      tool_results: accumulatedToolResults,
    });
  }

  // No actionable plan — model emitted text (clarifying question or status).
  return NextResponse.json({
    kind: 'message',
    text: aiText || 'I need more details to help.',
    tool_calls: accumulatedToolCalls,
    tool_results: accumulatedToolResults,
  });
}

function serializeForModel(result: DispatchResult): string {
  switch (result.kind) {
    case 'context':
      return JSON.stringify(result.context);
    case 'slots':
      return JSON.stringify({
        slots: result.slots,
        count: result.slots.length,
      });
    case 'plan':
      return JSON.stringify({
        plan_id: result.plan.plan_id,
        summary: result.plan.summary,
        conflicts_count: result.plan.conflicts.length,
        toCreate_count: result.plan.toCreate.length,
        toModify_count: result.plan.toModify.length,
        toCancel_count: result.plan.toCancel.length,
        intent_summary: result.intent_summary,
      });
    case 'error':
      return JSON.stringify({ error: result.message });
  }
}
