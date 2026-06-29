import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@/lib/supabase/server';
import { recordAiUsage } from '@/lib/billing';

export const dynamic = 'force-dynamic';

// Reuse the same model knob the CourtSheet AI brain uses, so model choice is
// tunable in one place. Sonnet is plenty for a help/explain assistant.
const MODEL = process.env.AI_MODEL_AGENT ?? 'claude-sonnet-4-6';
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY ?? process.env.AI_API_KEY;

// Per-user rate limit (matches /api/courtsheet/ai/chat).
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 20;
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

const SYSTEM_PROMPT = `You are the ClubMode Assistant — a friendly, plain-spoken helper built into ClubMode AI, the platform clubs use to run racquet sports.

ClubMode covers: live court sheets (CourtSheet), team leagues and Junior Team Tennis (JTT), mixers and tournaments, lessons, stringing, player matching, a roster CRM, swim-team family signups, and a monthly Board Report with an NPS survey.

How to help:
- Answer the director's question directly and briefly, in everyday language. No jargon, no walls of text.
- When they ask how to do something, give short numbered steps and point them to the right area of the app by name (e.g. "Leagues tab", "CourtSheet", "Board Report").
- If a request needs an action you can't take from chat (sending a blast, generating a draw, editing a sheet), explain where in the app to do it rather than pretending you did it.
- If you don't know something specific to their club's data, say so plainly instead of guessing.
- Keep answers to a few sentences unless they ask for detail.

You are a help-and-explain assistant: you guide and answer, you do not change club data.`;

interface ClientMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * POST /api/assistant/chat
 *   body: { message: string, history?: ClientMessage[], page?: string }
 *   returns: { kind: 'message', text } | { kind: 'error', message }
 *
 * General per-page help assistant. Each successful turn is metered as one AI
 * action (plus real token usage) via recordAiUsage.
 */
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { kind: 'error', message: 'Please log in to use the assistant.' },
      { status: 401 }
    );
  }
  if (!checkRateLimit(user.id)) {
    return NextResponse.json(
      { kind: 'error', message: 'You are sending messages too fast — give it a moment.' },
      { status: 429 }
    );
  }
  if (!ANTHROPIC_KEY) {
    return NextResponse.json(
      { kind: 'error', message: 'Assistant not configured (missing ANTHROPIC_API_KEY).' },
      { status: 503 }
    );
  }

  const body = await req.json().catch(() => null);
  const message = (body?.message as string | undefined)?.trim();
  if (!message) {
    return NextResponse.json({ kind: 'error', message: 'Missing message' }, { status: 400 });
  }
  const history = (body?.history as ClientMessage[] | undefined) ?? [];
  const page = (body?.page as string | undefined)?.trim();

  const messages: Anthropic.Messages.MessageParam[] = [];
  for (const m of history.slice(-10)) {
    if (m.role === 'user' || m.role === 'assistant') {
      const text = String(m.content ?? '').slice(0, 4000);
      if (text) messages.push({ role: m.role, content: text });
    }
  }
  messages.push({ role: 'user', content: message });

  // Tell the model what page the director is on, without invalidating the
  // cached system prompt prefix (volatile context goes after it).
  const systemBlocks = [
    { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
    ...(page ? [{ type: 'text', text: `The director is currently on this page: ${page}` }] : []),
  ] as unknown as Anthropic.Messages.TextBlockParam[];

  const client = new Anthropic({ apiKey: ANTHROPIC_KEY });

  let response: Anthropic.Messages.Message;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: systemBlocks,
      messages,
    });
  } catch (err) {
    console.error('Assistant chat model call failed:', err);
    return NextResponse.json(
      { kind: 'error', message: 'The assistant had trouble responding. Please try again.' },
      { status: 502 }
    );
  }

  // Meter this turn: one AI action + real token usage. Non-fatal if it fails.
  await recordAiUsage(
    user.id,
    response.usage?.input_tokens ?? 0,
    response.usage?.output_tokens ?? 0
  );

  const text = response.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
    .map((b) => b.text.trim())
    .filter(Boolean)
    .join('\n')
    .trim();

  return NextResponse.json({
    kind: 'message',
    text: text || "I'm not sure how to help with that — try rephrasing?",
  });
}
