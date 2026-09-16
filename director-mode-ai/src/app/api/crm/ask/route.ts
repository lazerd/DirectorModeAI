/**
 * POST /api/crm/ask — "Ask your pipeline".
 *
 *   { message, history?: [{role, content}], org_id? }
 *
 * Answers in one of two shapes:
 *
 *   { kind: 'message',  text }
 *   { kind: 'proposal', text, proposal }   ← the page draws Confirm / Cancel
 *
 * The model reads through the tools in lib/crm/ask/tools.ts and cannot write:
 * every action tool returns a proposal. Applying one is a different route
 * (./confirm) reached by a click, so "never applied straight from the model"
 * is a property of the wiring rather than of the model's obedience.
 *
 * A caller who is not a rep gets the CRM's usual 404 with nothing in it.
 */

import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { isCrmAuthError, requireCrm } from '@/lib/crm/server';
import { crmSystemPrompt } from '@/lib/crm/ask/prompt';
import { CRM_TOOL_SCHEMAS, proposalOf, runCrmTool, type CrmAskContext, type Proposal } from '@/lib/crm/ask/tools';

export const dynamic = 'force-dynamic';

/** The model this app runs its agents on. One constant, set in the env. */
const MODEL = process.env.AI_MODEL_AGENT ?? 'claude-sonnet-4-6';
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY ?? process.env.AI_API_KEY;

// Two reps, so this is a runaway guard rather than a business rule.
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 20;
const buckets = new Map<string, { count: number; resetAt: number }>();
function underLimit(key: string): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (b.count >= MAX_PER_WINDOW) return false;
  b.count++;
  return true;
}

interface ClientMessage {
  role: 'user' | 'assistant';
  content: string;
}

export async function POST(req: Request) {
  const ctx = await requireCrm();
  if (isCrmAuthError(ctx)) return ctx.error;
  if (!underLimit(ctx.repEmail)) {
    return NextResponse.json({ kind: 'error', message: 'Give it a second.' }, { status: 429 });
  }
  if (!ANTHROPIC_KEY) {
    return NextResponse.json(
      { kind: 'error', message: 'The ask box needs ANTHROPIC_API_KEY set.' },
      { status: 503 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const message = typeof body.message === 'string' ? body.message.trim().slice(0, 2000) : '';
  if (!message) return NextResponse.json({ kind: 'error', message: 'Ask something.' }, { status: 400 });

  // The club the question is pinned to, when asked from /crm/[id]. Checked
  // against the table rather than taken on trust, so a bad id scopes to
  // nothing instead of silently widening to everything.
  let orgId: string | null = null;
  let clubName: string | null = null;
  const wanted = typeof body.org_id === 'string' ? body.org_id : '';
  if (/^[0-9a-f-]{36}$/i.test(wanted)) {
    const { data } = await ctx.db.from('crm_orgs').select('id, name').eq('id', wanted).maybeSingle();
    const row = data as { id: string; name: string } | null;
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    orgId = row.id;
    clubName = row.name;
  }

  const askCtx: CrmAskContext = {
    allowed: true,
    db: ctx.db,
    repEmail: ctx.repEmail,
    repName: ctx.repName,
    today: ctx.today,
    orgId,
  };

  const messages: Anthropic.Messages.MessageParam[] = [];
  const history = Array.isArray(body.history) ? (body.history as ClientMessage[]) : [];
  for (const m of history.slice(-8)) {
    if (m?.role !== 'user' && m?.role !== 'assistant') continue;
    const text = String(m.content ?? '').slice(0, 3000);
    if (text) messages.push({ role: m.role, content: text });
  }
  messages.push({ role: 'user', content: message });

  const system = [
    {
      type: 'text',
      text: crmSystemPrompt({
        repName: ctx.repName,
        repEmail: ctx.repEmail,
        today: ctx.today,
        clubName,
      }),
      cache_control: { type: 'ephemeral' },
    },
  ] as unknown as Anthropic.Messages.TextBlockParam[];

  const client = new Anthropic({ apiKey: ANTHROPIC_KEY });

  let text = '';
  let proposal: Proposal | null = null;
  try {
    // Enough hops to look something up, look at the club, and then propose.
    for (let round = 0; round < 5; round++) {
      const res: Anthropic.Messages.Message = await client.messages.create({
        model: MODEL,
        max_tokens: 1200,
        system,
        tools: CRM_TOOL_SCHEMAS,
        messages,
      });

      if (res.stop_reason !== 'tool_use') {
        text = res.content
          .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
          .map((b) => b.text.trim())
          .filter(Boolean)
          .join('\n')
          .trim();
        break;
      }

      const uses = res.content.filter((b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use');
      const results: Anthropic.Messages.ToolResultBlockParam[] = [];
      for (const use of uses) {
        const result = await runCrmTool(use.name, use.input, askCtx);
        // Only one proposal per turn reaches the rep. Two Confirm buttons for
        // two different changes is a way to press the wrong one.
        const p = proposalOf(result);
        if (p && !proposal) proposal = p;
        results.push({ type: 'tool_result', tool_use_id: use.id, content: JSON.stringify(result) });
      }
      messages.push({ role: 'assistant', content: res.content });
      messages.push({ role: 'user', content: results });

      // Carry any text the model wrote alongside the tool call, so a proposal
      // still has a sentence with it if the loop ends on the next round.
      const said = res.content
        .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
        .map((b) => b.text.trim())
        .filter(Boolean)
        .join('\n');
      if (said) text = said;
    }
  } catch (err) {
    console.error('CRM ask failed:', err);
    return NextResponse.json(
      { kind: 'error', message: 'That did not come back. Try it again.' },
      { status: 502 },
    );
  }

  if (proposal) {
    return NextResponse.json({
      kind: 'proposal',
      text: text || proposal.title,
      proposal,
    });
  }
  return NextResponse.json({ kind: 'message', text: text || 'I could not find an answer to that.' });
}
