import { Resend } from 'resend';
import { consumeEmailCredits, CreditLimitError } from '@/lib/billing';
import { createServiceClient } from '@/lib/supabase/server';
import { safeResendSend, type SafeSendResult } from '@/lib/emailUnsubscribe';
import { demoEmailHold, logDemoHold } from '@/lib/demo/suppress';
import { clubFromLine } from '@/lib/emailText';
import { canSend, holdEmail, recordSendUsage } from '@/lib/usageMeter';
import { EMAIL_PRICE_CENTS } from '@/config/pricing';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

const resend = new Resend(process.env.RESEND_API_KEY);

interface EmailPayload {
  from?: string;
  /**
   * The club this is from, for the name in the inbox: "Sleepy Hollow Swim &
   * Tennis Club", not "ClubMode". A member has a relationship with their club
   * and none with us, and the display name is most of what decides whether a
   * first email is opened or reported. The address stays ours — that is where
   * the DKIM key lives. Ignored when `from` is given outright.
   */
  fromName?: string;
  to: string;
  subject: string;
  html: string;
  /** Plain-text half; derived from the HTML when absent. */
  text?: string;
  replyTo?: string;
  headers?: Record<string, string>;
  /**
   * The club this email is for. Optional, but pass it where it is known: a
   * club in demo mode has its emails held back (lib/demo/emailGuard.ts), and
   * this is how a send is recognised as that club's.
   */
  clubId?: string | null;
  clubSlug?: string | null;
  /** Operational mail to the account holder — see safeResendSend. */
  operational?: boolean;
}

/** What a director sees when a send is waiting on their card. */
export const NEEDS_CARD_MESSAGE = `Add a card to send. Emails are ${EMAIL_PRICE_CENTS}¢ each; this one is saved and will go out once a card is on file.`;

const DEFAULT_FROM = process.env.RESEND_FROM_EMAIL || 'ClubMode <noreply@mail.clubmode.ai>';
/** Just the address out of DEFAULT_FROM, for building a club-named From line. */
const DEFAULT_ADDRESS = DEFAULT_FROM.match(/<([^>]+)>/)?.[1] || DEFAULT_FROM.trim();

/**
 * Demo sends are held BEFORE credits are spent, so exploring a demo never
 * burns the real owner's allowance or trips a credit-limit error mid-tour.
 * safeResendSend checks again; this copy exists only to skip the billing.
 */
async function holdForDemo(userId: string | null, p: EmailPayload): Promise<SafeSendResult | null> {
  const hold = await demoEmailHold([p.to], { clubId: p.clubId, clubSlug: p.clubSlug, billToUserId: userId });
  if (!hold) return null;
  logDemoHold(hold, p.to, p.subject);
  return { sent: true, messageId: 'demo-suppressed', demo: hold };
}

const toSend = (userId: string | null, p: EmailPayload) => ({
  from: p.from || (p.fromName ? clubFromLine(p.fromName, DEFAULT_ADDRESS) : DEFAULT_FROM),
  to: p.to,
  subject: p.subject,
  html: p.html,
  ...(p.text ? { text: p.text } : {}),
  ...(p.replyTo ? { replyTo: p.replyTo } : {}),
  ...(p.headers ? { headers: p.headers } : {}),
  operational: p.operational,
  clubId: p.clubId,
  clubSlug: p.clubSlug,
  billToUserId: userId,
});

/**
 * Drop-in send that does TWO things at once:
 *   1. Consumes one email credit on the owning user's plan (throws CreditLimitError if over cap)
 *   2. Routes through safeResendSend so unsubscribed recipients are skipped + footer is appended
 *
 * Returns the SafeSendResult so callers can branch on `r.sent`. If the recipient was
 * unsubscribed or the send failed, the credit was still consumed — keeps the implementation
 * simple and avoids race conditions.
 */
export async function sendBilledEmail(userId: string | null, payload: EmailPayload): Promise<SafeSendResult> {
  const held = await holdForDemo(userId, payload);
  if (held) return held;
  if (userId && !(await canSend(userId)) && (await holdEmail(userId, { ...payload }))) {
    return { sent: false, reason: 'needs_card', held: true, error: NEEDS_CARD_MESSAGE };
  }
  if (userId) {
    await consumeEmailCredits(userId, 1);
  }
  const r = await safeResendSend(resend, toSend(userId, payload));
  if (userId && r.sent && !r.demo) {
    await recordSendUsage({ userId, kind: 'email', units: 1, clubId: payload.clubId });
  }
  return r;
}

/**
 * Resend rate-limits bursts. Firing a whole roster at once with Promise.all got
 * 9 of 20 CaptainMode pre-season emails silently dropped on 2026-07-29 — every
 * failure came back as {sent:false} and callers only ever counted them, so nine
 * players simply never heard from their captain. Send in small paced batches and
 * retry the rate-limited ones instead.
 */
const SEND_BATCH = 2; // Resend's documented steady-state ceiling is ~2/sec
const SEND_GAP_MS = 1100;
const SEND_ATTEMPTS = 3;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Rate-limit / transient failures are worth another go; a bad address is not. */
function isRetryable(r: SafeSendResult): boolean {
  if (r.sent) return false;
  if (r.reason !== 'error') return false; // never retry 'unsubscribed'
  const e = (r.error || '').toLowerCase();
  return /rate|429|timeout|econn|network|temporar|too many|503|502/.test(e);
}

export async function sendBilledEmails(userId: string | null, payloads: EmailPayload[]): Promise<SafeSendResult[]> {
  const results = new Array<SafeSendResult>(payloads.length);
  const holds = await Promise.all(payloads.map((p) => holdForDemo(userId, p)));
  holds.forEach((h, i) => {
    if (h) results[i] = h;
  });
  let pending = payloads.map((p, i) => ({ p, i })).filter(({ i }) => !holds[i]);

  // No card on file: park the whole batch until the club adds one.
  if (userId && pending.length && !(await canSend(userId))) {
    const parked: typeof pending = [];
    for (const item of pending) {
      if (await holdEmail(userId, { ...item.p })) {
        results[item.i] = { sent: false, reason: 'needs_card', held: true, error: NEEDS_CARD_MESSAGE };
      } else {
        parked.push(item);
      }
    }
    pending = parked;
  }

  if (userId && pending.length) {
    await consumeEmailCredits(userId, pending.length);
  }

  for (let attempt = 1; attempt <= SEND_ATTEMPTS && pending.length; attempt++) {
    const retry: typeof pending = [];

    for (let start = 0; start < pending.length; start += SEND_BATCH) {
      const batch = pending.slice(start, start + SEND_BATCH);
      const settled = await Promise.all(
        batch.map(({ p }) =>
          safeResendSend(resend, toSend(userId, p))
        )
      );
      settled.forEach((r, k) => {
        const item = batch[k];
        results[item.i] = r;
        if (isRetryable(r) && attempt < SEND_ATTEMPTS) retry.push(item);
      });
      if (start + SEND_BATCH < pending.length) await sleep(SEND_GAP_MS);
    }

    pending = retry;
    if (pending.length) await sleep(SEND_GAP_MS * attempt); // back off before the next sweep
  }

  // Bill only what actually went out: not unsubscribed, failed or demo-held sends.
  if (userId) {
    const sent = results.filter((r, i) => r?.sent && !r.demo && !holds[i]).length;
    await recordSendUsage({ userId, kind: 'email', units: sent, clubId: payloads[0]?.clubId });
  }

  return results;
}

export async function resolveCoachUserId(coachId?: string | null, coachEmail?: string | null): Promise<string | null> {
  if (!coachId && !coachEmail) return null;
  const supabase = await createServiceClient();
  if (coachId) {
    const { data } = await supabase
      .from('lesson_coaches')
      .select('profile_id')
      .eq('id', coachId)
      .maybeSingle();
    if (data?.profile_id) return data.profile_id;
  }
  if (coachEmail) {
    const { data } = await supabase
      .from('lesson_coaches')
      .select('profile_id')
      .eq('email', coachEmail)
      .maybeSingle();
    if (data?.profile_id) return data.profile_id;
    const { data: profile } = await supabase
      .from('profiles')
      .select('id')
      .eq('email', coachEmail)
      .maybeSingle();
    return profile?.id || null;
  }
  return null;
}

export async function resolveStringerUserId(jobId?: string | null): Promise<string | null> {
  if (!jobId) return null;
  const supabase = await createServiceClient();
  const { data } = await supabase
    .from('stringing_jobs')
    .select('stringer_id, profile_id, user_id')
    .eq('id', jobId)
    .maybeSingle();
  return (data as any)?.stringer_id || (data as any)?.profile_id || (data as any)?.user_id || null;
}

export async function resolveCcEventOwner(eventId?: string | null): Promise<string | null> {
  if (!eventId) return null;
  const supabase = await createServiceClient();
  const { data } = await supabase
    .from('cc_events')
    .select('organizer_id, created_by, user_id')
    .eq('id', eventId)
    .maybeSingle();
  return (data as any)?.organizer_id || (data as any)?.created_by || (data as any)?.user_id || null;
}

export function creditLimitResponse(err: CreditLimitError) {
  return Response.json(
    {
      error: 'credit_limit',
      kind: err.kind,
      tier: err.tier,
      limit: err.limit,
      message: `You've reached your ${err.kind} limit on the ${err.tier} plan (${err.limit}). Upgrade to keep sending.`,
      upgradeUrl: '/pricing',
    },
    { status: 402 }
  );
}

export { CreditLimitError };
export type { SafeSendResult };

/**
 * Send everything a club owner's card was holding up, oldest first. Called when
 * their "ClubMode usage" subscription goes active. Each send goes back through
 * sendBilledEmail, so it is priced and recorded like any other.
 */
export async function releaseHeldEmails(billingUserId: string): Promise<{ released: number; failed: number }> {
  const db = getSupabaseAdmin();
  const { data } = await db
    .from('held_messages')
    .select('id, user_id, payload')
    .eq('billing_user_id', billingUserId)
    .is('released_at', null)
    .order('created_at', { ascending: true })
    .limit(500);
  let released = 0;
  let failed = 0;
  for (const row of (data as { id: number; user_id: string; payload: EmailPayload }[] | null) ?? []) {
    const r = await sendBilledEmail(row.user_id, row.payload);
    if (!r.sent && r.reason === 'needs_card') {
      // Still no card as far as the meter can tell; leave the rest waiting.
      failed++;
      break;
    }
    await db.from('held_messages').update({ released_at: new Date().toISOString() }).eq('id', row.id);
    if (r.sent) released++;
    else failed++;
    await sleep(SEND_GAP_MS / 2);
  }
  return { released, failed };
}
