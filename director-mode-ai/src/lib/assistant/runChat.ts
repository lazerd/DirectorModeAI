import Anthropic from '@anthropic-ai/sdk';
import { recordAiUsage, resolveBillingUserId } from '@/lib/billing';
import { resolvePacks } from '@/lib/assistant/registry';
import { routePacks, ROUTER_MODEL } from '@/lib/assistant/router';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { resolveActiveClub } from '@/lib/clubs/activeClub';
import { isPlatformOwnerEmail } from '@/lib/platformOwner';
import { overMonthlyLimit } from '@/lib/usageMeter';
import { sendBilledEmail } from '@/lib/email';
import {
  addUsage,
  costMicro,
  emptyUsage,
  monthBilledMicro,
  overCap,
  paygActive,
  recordRequest,
  snapshot,
} from '@/lib/assistant/meter';
import { AI_MONTHLY_CAP_USD } from '@/config/pricing';
import { buildCheckoutUrl } from '@/lib/lemonsqueezy';
import { resolveClubCtx } from '@/lib/assistant/clubContext';
import { houseRulesPrompt, loadHouseRules } from '@/lib/proshop/houseRules';

/*
 * Ask Claude's engine, shared by every way a director talks to their staff:
 * the chat panel and Pro Shop page (POST /api/assistant/chat) and text messages
 * (lib/textstaff). Same packs, same preview-before-changing rule, same meter.
 */

export const MODEL = process.env.AI_MODEL_AGENT ?? 'claude-sonnet-4-6';
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY ?? process.env.AI_API_KEY;
export const aiConfigured = () => !!ANTHROPIC_KEY;

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

// Text messages: the director is on their phone, often on court.
const TEXT_CHANNEL = `This conversation is by TEXT MESSAGE on the director's phone. They are usually on court or between lessons.
- Reply in 1 to 4 short lines, under 480 characters. No lists longer than 5 lines.
- When you have a preview, end with exactly one ask: "Reply YES to send." (or "...to save.").
- Sign nothing, greet nobody, never say "Great question".`;

export interface ChatTurn { role: 'user' | 'assistant'; content: string }
export type Meter = ReturnType<typeof snapshot> | Awaited<ReturnType<typeof recordRequest>> | null;
export type ChatResult =
  | { ok: true; text: string; meter: Meter }
  | { ok: false; status: number; message: string; meter?: Meter; paygUrl?: string | null };

/**
 * Who pays for this person's Ask Claude, and whether they pay at all.
 * The club owner's account is the pool (same as texts and emails). The platform
 * owner's own clubs are metered so the numbers are real, but never billed.
 */
export async function billingFor(user: { id: string; email?: string | null }) {
  const db = getSupabaseAdmin();
  const billingUserId = await resolveBillingUserId(user.id);
  let ownerEmail: string | null = user.email ?? null;
  if (billingUserId !== user.id) {
    const { data } = await db.auth.admin.getUserById(billingUserId);
    ownerEmail = data?.user?.email ?? null;
  }
  const exempt = isPlatformOwnerEmail(user.email) || isPlatformOwnerEmail(ownerEmail);
  // No plan gates Ask Claude any more: every club can use it once a card is on file.
  const entitled = true;
  const payg = exempt ? false : await paygActive(db, billingUserId);
  const isOwner = billingUserId === user.id;
  // Only the payer can turn pay-as-you-go on; the checkout is attached to them.
  const paygUrl =
    !exempt && !payg && isOwner
      ? buildCheckoutUrl('ai_usage', { userId: billingUserId, email: ownerEmail })
      : null;
  return { db, billingUserId, ownerEmail, exempt, entitled, payg, isOwner, paygUrl };
}

export function pausedMessage(b: Awaited<ReturnType<typeof billingFor>>): string {
  if (b.payg) {
    return `Ask Claude has reached this month's $${AI_MONTHLY_CAP_USD} limit for your club, so it is paused until the 1st. Everything else in ClubMode still works.`;
  }
  if (!b.isOwner) {
    return `Ask Claude is billed per request, and your club doesn't have a card on file yet. Your club owner can add one from the Ask Claude panel.`;
  }
  return b.paygUrl
    ? `Ask Claude is billed per request: a few cents each, with the meter in front of you the whole time. Add a card to start. It's the same card that covers your club's emails and texts.`
    : `Ask Claude is billed per request, and card checkout isn't available just yet.`;
}

/** The meter before a message is sent (the widget's GET). */
export async function meterFor(user: { id: string; email?: string | null }) {
  const b = await billingFor(user);
  return { meter: snapshot(await monthBilledMicro(b.db, b.billingUserId), b.exempt, undefined, b.payg), paygUrl: b.paygUrl };
}

/** One director message → the staff's answer, with tools, metered. */
export async function runChat(opts: {
  user: { id: string; email?: string | null };
  message: string;
  history?: ChatTurn[];
  page?: string;
  channel?: 'web' | 'text';
}): Promise<ChatResult> {
  const { user, message } = opts;
  const page = opts.page?.trim() || undefined;
  const history = opts.history ?? [];
  if (!ANTHROPIC_KEY) return { ok: false, status: 503, message: 'Assistant not configured (missing ANTHROPIC_API_KEY).' };

  const bill = await billingFor(user);
  const spentBefore = await monthBilledMicro(bill.db, bill.billingUserId);
  if (overCap(spentBefore, bill.exempt, bill.payg)) {
    return { ok: false, status: 402, message: pausedMessage(bill), meter: snapshot(spentBefore, bill.exempt, undefined, bill.payg), paygUrl: bill.paygUrl };
  }
  if (await overMonthlyLimit(bill.billingUserId, bill.exempt)) {
    return {
      ok: false,
      status: 402,
      message: bill.isOwner
        ? "Your club has reached the monthly spending limit you set, so Ask Claude is paused. Raise the limit on the Usage & billing page to keep going."
        : "Your club has reached its monthly spending limit, so Ask Claude is paused. Your club owner can raise it.",
      meter: snapshot(spentBefore, bill.exempt, undefined, bill.payg),
    };
  }

  // Resolve which domain packs are available for this user on this page. Each
  // pack carries its own tools, guidance, and executor (bound to its context).
  const client = new Anthropic({ apiKey: ANTHROPIC_KEY });
  let available = await resolvePacks(user.id, page);
  // A club whose courts live in ClubSpot (Sleepy Hollow): ClubMode's own court sheet is empty
  // there, so court questions go to the ClubSpot pack only.
  if (available.some((p) => p.domain === 'clubspot')) available = available.filter((p) => p.domain !== 'courts');
  // Only the packs this request needs — see lib/assistant/router.
  const routed = await routePacks(client, available.map((p) => p.domain), message, history, page);
  // On /proshop the staff pack always rides along: it's what that page is for.
  const packs = routed.domains
    ? available.filter((p) => routed.domains!.includes(p.domain) || (p.domain === 'proshop' && page?.startsWith('/proshop')))
    : available;
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
  // The API needs user/assistant turns to alternate, starting with the user.
  while (messages.length && messages[0].role !== 'user') messages.shift();
  messages.push({ role: 'user', content: message });

  // The club's house rules (what the director taught the staff) ride on every answer,
  // right after the base prompt and cached with it: they change rarely.
  let houseRules = '';
  try {
    const club = await resolveClubCtx(user.id);
    // HOUSE_RULES_OFF=1 only for scripts/_staff-eval.ts baseline runs.
    if (club && process.env.HOUSE_RULES_OFF !== '1') houseRules = houseRulesPrompt(club.clubName, await loadHouseRules(club.db, club.clubId));
  } catch { houseRules = ''; }

  const systemBlocks = [
    houseRules
      ? { type: 'text', text: SYSTEM_PROMPT }
      : { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
    ...(houseRules ? [{ type: 'text', text: houseRules, cache_control: { type: 'ephemeral' } }] : []),
    ...(canAct ? [{ type: 'text', text: ACTIONS_PREAMBLE }] : []),
    ...packs.map((p) => ({ type: 'text', text: p.actionsPrompt })),
    ...(opts.channel === 'text' ? [{ type: 'text', text: TEXT_CHANNEL }] : []),
    // The model has no clock. Without this it guessed "this week" was late
    // January (2026-10-09, first live test). Pacific is the default club zone;
    // packs that need the club's own zone convert from the ISO instant.
    {
      type: 'text',
      text: `Right now it is ${new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })} Pacific (${new Date().toISOString()}). Resolve "today", "tonight", "this week", "Saturday" from this.`,
    },
    ...(page ? [{ type: 'text', text: `The director is currently on this page: ${page}` }] : []),
  ] as unknown as Anthropic.Messages.TextBlockParam[];

  // Tool-use loop: let the model call tools, execute them, feed results back,
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
    return { ok: false, status: 502, message: 'The assistant had trouble responding. Please try again.', meter };
  }

  const meter = await meterRequest(bill, user.id, page, usage, rounds, routerUsage).catch((e) => {
    console.error('Ask Claude meter failed:', e);
    return null;
  });
  return { ok: true, text: finalText || 'Done.', meter };
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
      platformPaid: true,
      to: bill.ownerEmail,
      operational: true,
      subject: `Ask Claude: $${meter.overageUsd.toFixed(2)} over your monthly allowance`,
      html: `<p>${meter.notice}</p><p>So far this month: <b>$${meter.spentUsd.toFixed(2)}</b> of Ask Claude, billed with your club's monthly usage. You'll get another note every $10.</p><p>You can see the meter any time at the bottom of the Ask Claude panel.</p>`,
    }).catch((e) => console.error('Ask Claude notice email failed:', e));
  }
  return meter;
}
