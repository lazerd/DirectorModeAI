import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@/lib/supabase/server';
import { recordAiUsage } from '@/lib/billing';
import { resolvePacks } from '@/lib/assistant/registry';
import { routePacks, ROUTER_MODEL } from '@/lib/assistant/router';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { resolveBillingUserId } from '@/lib/billing';
import { resolveActiveClub } from '@/lib/clubs/activeClub';
import { isPlatformOwnerEmail } from '@/lib/platformOwner';
import { sendBilledEmail } from '@/lib/email';
import {
  addUsage,
  costMicro,
  emptyUsage,
  monthBilledMicro,
  overCap,
  askClaudeEntitled,
  paygActive,
  recordRequest,
  snapshot,
} from '@/lib/assistant/meter';
import { AI_INCLUDED_USD, AI_MONTHLY_CAP_USD, ASK_CLAUDE_PLAN_USD } from '@/config/pricing';
import { buildCheckoutUrl } from '@/lib/lemonsqueezy';

export const dynamic = 'force-dynamic';
// A confirmed member email goes out at ~2/sec (comms pack caps a send at 300).
export const maxDuration = 300;

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

const SYSTEM_PROMPT = `You are Ask Claude — the assistant built into ClubMode, the platform clubs use to run racquet sports. Directors talk to you the way they would to a sharp assistant director: "set up a Tuesday clinic", "tonight's attendance was…", "block courts 3-6 Saturday". When you have a tool for it, do the work (preview first for anything that changes data); don't just explain where the button is.

ClubMode covers: live court sheets (CourtSheet), team leagues and Junior Team Tennis (JTT), mixers and tournaments, lessons, stringing, player matching, a roster CRM, swim-team family signups, and a monthly Board Report.

How to help:
- Answer directly and briefly, in everyday language. No jargon, no walls of text.
- For how-to questions, give short numbered steps and name the right area of the app.
- Keep answers to a few sentences unless asked for detail.
- You only act inside ClubMode. You cannot touch other software the club uses (another booking system, another billing system, their email inbox). Say so plainly if asked.
- Each request costs the club a few cents on a meter they can see. Be efficient: don't call tools you don't need, and don't pad answers.

How your answers look (the chat panel shows plain text, not markdown):
- No markdown: no **bold**, no # headings, no --- lines, no tables, no emojis. Use short plain lines; a list is lines starting with "- ".
- Never mention tool or function names. Say what you can do in plain words ("I can enter their WTNs once you have them").
- Use the counts the tools return. Never state a number you did not get from a tool, and make every total match the list you show.`;

// Appended whenever the user has at least one active tool pack. Domain-specific
// guidance is supplied per pack; this covers the rules common to all actions.
const ACTIONS_PREAMBLE = `You can take real actions in ClubMode using your tools. Rules for every action:
- PREVIEW BEFORE CHANGING: for any tool that changes, deletes, sends, or charges, first call it WITHOUT confirm to get a preview, tell the user exactly what will happen (names, counts, amounts), and only call it again with confirm:true after they clearly say yes. If a tool result includes "needsConfirm", you are seeing a preview — do not claim it happened.
- Safe reads and lookups you can just do, then report the answer.
- Do exactly what's asked, then report what you did in one short line.
- If a tool returns ok:false, tell the user the reason plainly — don't pretend it worked.
- For anything your tools don't cover, just help and explain as usual.`;

interface ClientMessage { role: 'user' | 'assistant'; content: string }

/**
 * Who pays for this person's Ask Claude, and whether they pay at all.
 * The club owner's account is the pool (same as texts and emails). The platform
 * owner's own clubs are metered so the numbers are real, but never billed.
 */
async function billingFor(user: { id: string; email?: string | null }) {
  const db = getSupabaseAdmin();
  const billingUserId = await resolveBillingUserId(user.id);
  let ownerEmail: string | null = user.email ?? null;
  if (billingUserId !== user.id) {
    const { data } = await db.auth.admin.getUserById(billingUserId);
    ownerEmail = data?.user?.email ?? null;
  }
  const exempt = isPlatformOwnerEmail(user.email) || isPlatformOwnerEmail(ownerEmail);
  const entitled = exempt || (await askClaudeEntitled(db, billingUserId));
  const payg = exempt ? false : await paygActive(db, billingUserId);
  const isOwner = billingUserId === user.id;
  // Not on the $75 plan: the owner gets an upgrade checkout, staff get told who can.
  const upgradeUrl =
    !entitled && isOwner ? buildCheckoutUrl('pro_ai', { userId: billingUserId, email: ownerEmail }) : null;
  // Only the payer can turn pay-as-you-go on; the checkout is attached to them.
  const paygUrl =
    !exempt && !payg && isOwner
      ? buildCheckoutUrl('ai_usage', { userId: billingUserId, email: ownerEmail })
      : null;
  return { db, billingUserId, ownerEmail, exempt, entitled, payg, isOwner, paygUrl, upgradeUrl };
}

function upgradeMessage(b: Awaited<ReturnType<typeof billingFor>>): string {
  if (!b.isOwner) {
    return `Ask Claude is part of the $${ASK_CLAUDE_PLAN_USD}/month ClubMode plan. Your club owner can upgrade to turn it on.`;
  }
  return b.upgradeUrl
    ? `Ask Claude is part of the $${ASK_CLAUDE_PLAN_USD}/month ClubMode plan: tell it what you need ("set up a Tuesday clinic", "tonight's attendance was…", "block courts 3-6 Saturday") and it does it. $${AI_INCLUDED_USD} of use is included every month.`
    : `Ask Claude is part of the $${ASK_CLAUDE_PLAN_USD}/month ClubMode plan, which isn't on sale just yet.`;
}

function pausedMessage(b: Awaited<ReturnType<typeof billingFor>>): string {
  if (b.payg) {
    return `Ask Claude has reached this month's $${AI_MONTHLY_CAP_USD} limit for your club, so it is paused until the 1st. Everything else in ClubMode still works.`;
  }
  if (!b.isOwner) {
    return `Your club has used its $${AI_INCLUDED_USD} of Ask Claude for this month. Your club owner can turn on pay-as-you-go from the Ask Claude panel to keep going.`;
  }
  return b.paygUrl
    ? `You've used this month's $${AI_INCLUDED_USD} of included Ask Claude. Turn on pay-as-you-go to keep going: you're only billed for what you use, a few cents a request, and you'll see the meter the whole time.`
    : `You've used this month's $${AI_INCLUDED_USD} of included Ask Claude. Pay-as-you-go isn't available yet; it resets on the 1st.`;
}

/** The meter, for the widget to show before the first message is sent. */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ meter: null }, { status: 401 });
  const b = await billingFor(user);
  if (!b.entitled) {
    return NextResponse.json({ meter: null, entitled: false, message: upgradeMessage(b), upgradeUrl: b.upgradeUrl });
  }
  return NextResponse.json({
    meter: snapshot(await monthBilledMicro(b.db, b.billingUserId), b.exempt, undefined, b.payg),
    entitled: true,
    paygUrl: b.paygUrl,
  });
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ kind: 'error', message: 'Please log in to use the assistant.' }, { status: 401 });
  if (!checkRateLimit(user.id)) return NextResponse.json({ kind: 'error', message: 'You are sending messages too fast — give it a moment.' }, { status: 429 });
  if (!ANTHROPIC_KEY) return NextResponse.json({ kind: 'error', message: 'Assistant not configured (missing ANTHROPIC_API_KEY).' }, { status: 503 });

  const bill = await billingFor(user);
  if (!bill.entitled) {
    return NextResponse.json(
      { kind: 'upgrade', message: upgradeMessage(bill), upgradeUrl: bill.upgradeUrl },
      { status: 402 },
    );
  }
  const spentBefore = await monthBilledMicro(bill.db, bill.billingUserId);
  if (overCap(spentBefore, bill.exempt, bill.payg)) {
    return NextResponse.json({
      kind: 'error',
      message: pausedMessage(bill),
      meter: snapshot(spentBefore, bill.exempt, undefined, bill.payg),
      paygUrl: bill.paygUrl,
    }, { status: 402 });
  }

  const body = await req.json().catch(() => null);
  const message = (body?.message as string | undefined)?.trim();
  if (!message) return NextResponse.json({ kind: 'error', message: 'Missing message' }, { status: 400 });
  const history = (body?.history as ClientMessage[] | undefined) ?? [];
  const page = (body?.page as string | undefined)?.trim();

  // Resolve which domain packs are available for this user on this page. Each
  // pack carries its own tools, guidance, and executor (bound to its context).
  const client = new Anthropic({ apiKey: ANTHROPIC_KEY });
  const available = await resolvePacks(user.id, page);
  // Only the packs this request needs — see lib/assistant/router.
  const routed = await routePacks(client, available.map((p) => p.domain), message, history, page);
  const packs = routed.domains ? available.filter((p) => routed.domains!.includes(p.domain)) : available;
  const routerUsage = addUsage(emptyUsage(), routed.usage);
  const canAct = packs.length > 0;
  const tools: Anthropic.Messages.Tool[] = packs.flatMap((p) => p.toolSchemas);
  // Cache the tool list + system prompt: they are identical on every round of the
  // loop and across a director's messages, and cached input costs a tenth.
  if (tools.length) tools[tools.length - 1] = { ...tools[tools.length - 1], cache_control: { type: 'ephemeral' } } as Anthropic.Messages.Tool;
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
    // The model has no clock. Without this it guessed "this week" was late
    // January (2026-10-09, first live test). Pacific is the default club zone;
    // packs that need the club's own zone convert from the ISO instant.
    {
      type: 'text',
      text: `Right now it is ${new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })} Pacific (${new Date().toISOString()}). Resolve "today", "tonight", "this week", "Saturday" from this.`,
    },
    ...(page ? [{ type: 'text', text: `The director is currently on this page: ${page}` }] : []),
  ] as unknown as Anthropic.Messages.TextBlockParam[];

  // Tool-use loop: let the model call JTT tools, execute them, feed results back,
  // until it produces a final text answer. Capped so a loop can't run away.
  let finalText = '';
  let usage = emptyUsage();
  let rounds = 0;
  try {
    for (let round = 0; round < 6; round++) {
      rounds = round + 1;
      const response: Anthropic.Messages.Message = await client.messages.create({
        model: MODEL,
        max_tokens: 2048,
        system: systemBlocks,
        messages,
        ...(tools.length ? { tools } : {}),
      });
      usage = addUsage(usage, response.usage);
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
    const meter = await meterRequest(bill, user.id, page, usage, rounds, routerUsage).catch(() => null);
    return NextResponse.json({ kind: 'error', message: 'The assistant had trouble responding. Please try again.', meter }, { status: 502 });
  }

  const meter = await meterRequest(bill, user.id, page, usage, rounds, routerUsage).catch((e) => {
    console.error('Ask Claude meter failed:', e);
    return null;
  });
  return NextResponse.json({ kind: 'message', text: finalText || "Done.", meter });
}

/** Write the request to the meter; email the payer if it crossed a $10 step. */
async function meterRequest(
  bill: Awaited<ReturnType<typeof billingFor>>,
  userId: string,
  page: string | undefined,
  usage: ReturnType<typeof emptyUsage>,
  rounds: number,
  routerUsage: ReturnType<typeof emptyUsage>,
) {
  if (rounds === 0) return null;
  const { active } = await resolveActiveClub(userId, null).catch(() => ({ active: null as { id: string } | null }));
  const meter = await recordRequest(bill.db, {
    billingUserId: bill.billingUserId,
    userId,
    clubId: active?.id ?? null,
    model: MODEL,
    rounds,
    usage,
    extraCostMicro: costMicro(ROUTER_MODEL, routerUsage),
    page: page ?? null,
    exempt: bill.exempt,
    payg: bill.payg,
  });
  if (meter.notice && bill.ownerEmail) {
    await sendBilledEmail(null, {
      to: bill.ownerEmail,
      operational: true,
      subject: `Ask Claude: $${meter.overageUsd.toFixed(2)} over your monthly allowance`,
      html: `<p>${meter.notice}</p><p>So far this month: <b>$${meter.spentUsd.toFixed(2)}</b> of Ask Claude, with $${AI_INCLUDED_USD.toFixed(2)} included in your plan. You'll get another note every $10.</p><p>You can see the meter any time at the bottom of the Ask Claude panel.</p>`,
    }).catch((e) => console.error('Ask Claude notice email failed:', e));
  }
  return meter;
}
