/**
 * The send meter: every email and text a club sends is priced in cents and
 * written to usage_events under the club owner who pays for it.
 *
 * Pricing is Darrin's (2026-10-21, constants in config/pricing): the platform is
 * free, every email is EMAIL_PRICE_CENTS and every text TEXT_PRICE_CENTS, with
 * no allowance. Email stops billing at EMAIL_MONTHLY_CAP_CENTS a month (10/27);
 * texts are never capped. The platform owner's clubs are recorded with exempt=true and
 * never invoiced, the same rule Ask Claude uses.
 *
 * Recording never throws: a metering hiccup must not stop a club's email.
 */

import { EMAIL_MONTHLY_CAP_CENTS, EMAIL_PRICE_CENTS, METERING_ENFORCED, TEXT_PRICE_CENTS } from '@/config/pricing';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { resolveBillingUserId } from '@/lib/billing';
import { isPlatformOwnerEmail } from '@/lib/platformOwner';
import { paygActive } from '@/lib/assistant/meter';

export type SendKind = 'email' | 'sms';

/** What `units` sends of this kind cost a club, in cents. */
export function priceCents(kind: SendKind, units: number): number {
  const n = Math.max(0, Math.floor(units));
  return n * (kind === 'email' ? EMAIL_PRICE_CENTS : TEXT_PRICE_CENTS);
}

/**
 * What these emails actually bill once the monthly email cap is applied, given
 * what this club's email has already been billed this month. Emails over the cap
 * are still recorded (units), just at 0 cents.
 */
export function cappedEmailCents(units: number, alreadyBilledCents: number): number {
  const room = Math.max(0, EMAIL_MONTHLY_CAP_CENTS - Math.max(0, alreadyBilledCents));
  return Math.min(priceCents('email', units), room);
}

/** This club's email charges so far this month, in cents (exempt rows included). */
async function monthEmailCents(billingUserId: string): Promise<number> {
  const { data } = await getSupabaseAdmin()
    .from('usage_events')
    .select('billed_cents')
    .eq('billing_user_id', billingUserId)
    .eq('kind', 'email')
    .gte('created_at', monthStart());
  return ((data as { billed_cents: number }[] | null) ?? []).reduce((a, r) => a + Number(r.billed_cents || 0), 0);
}

/** Who pays for this user's sends, and whether that account is the platform owner's. */
export async function sendBilling(userId: string): Promise<{ billingUserId: string; exempt: boolean }> {
  const db = getSupabaseAdmin();
  const billingUserId = await resolveBillingUserId(userId);
  const emails: (string | null | undefined)[] = [];
  const { data: me } = await db.auth.admin.getUserById(userId);
  emails.push(me?.user?.email);
  if (billingUserId !== userId) {
    const { data: owner } = await db.auth.admin.getUserById(billingUserId);
    emails.push(owner?.user?.email);
  }
  return { billingUserId, exempt: emails.some((e) => isPlatformOwnerEmail(e)) };
}

/** First instant of the current month, UTC: the period every limit is measured over. */
function monthStart(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

/**
 * What this club has been billed so far this month, in cents: sends plus Ask
 * Claude. Exempt rows count too, so the platform owner sees real numbers.
 */
export async function monthSpendCents(billingUserId: string): Promise<number> {
  const db = getSupabaseAdmin();
  const since = monthStart();
  const [{ data: sends }, { data: ai }] = await Promise.all([
    db.from('usage_events').select('billed_cents').eq('billing_user_id', billingUserId).gte('created_at', since),
    db.from('ai_usage_events').select('billed_micro').eq('billing_user_id', billingUserId).gte('created_at', since),
  ]);
  const sendCents = ((sends as { billed_cents: number }[] | null) ?? []).reduce((a, r) => a + Number(r.billed_cents || 0), 0);
  const aiMicro = ((ai as { billed_micro: number }[] | null) ?? []).reduce((a, r) => a + Number(r.billed_micro || 0), 0);
  return sendCents + Math.floor(aiMicro / 10_000);
}

/** The owner's monthly spending limit in cents, or null for none. */
export async function monthlyLimitCents(billingUserId: string): Promise<number | null> {
  const { data } = await getSupabaseAdmin()
    .from('usage_limits')
    .select('monthly_limit_cents')
    .eq('billing_user_id', billingUserId)
    .maybeSingle();
  const v = (data as { monthly_limit_cents: number | null } | null)?.monthly_limit_cents;
  return v === null || v === undefined ? null : Number(v);
}

/** Has this club reached its own monthly limit? Never true for the platform owner. */
export async function overMonthlyLimit(billingUserId: string, exempt: boolean): Promise<boolean> {
  if (exempt) return false;
  const limit = await monthlyLimitCents(billingUserId);
  if (limit === null) return false;
  return (await monthSpendCents(billingUserId)) >= limit;
}

export type SendBlock = 'needs_card' | 'over_limit' | null;

/**
 * Why this account can't send right now, or null if it can. Nothing is blocked
 * until METERING_ENFORCED; after that a club needs a card on file, and must be
 * under the monthly limit its owner set. A failed check allows the send.
 */
export async function sendBlock(userId: string): Promise<SendBlock> {
  if (!METERING_ENFORCED) return null;
  try {
    const { billingUserId, exempt } = await sendBilling(userId);
    if (exempt) return null;
    if (!(await paygActive(getSupabaseAdmin(), billingUserId))) return 'needs_card';
    if (await overMonthlyLimit(billingUserId, false)) return 'over_limit';
    return null;
  } catch (err) {
    console.error('sendBlock check failed; allowing the send:', err);
    return null;
  }
}

/** Can this account send right now? See sendBlock for why not. */
export async function canSend(userId: string): Promise<boolean> {
  return (await sendBlock(userId)) === null;
}

/** Write `units` sends to the meter. Never throws. */
export async function recordSendUsage(args: {
  userId: string;
  kind: SendKind;
  units: number;
  clubId?: string | null;
  ref?: string | null;
}): Promise<void> {
  if (args.units <= 0) return;
  try {
    const { billingUserId, exempt } = await sendBilling(args.userId);
    const billed =
      args.kind === 'email'
        ? cappedEmailCents(args.units, await monthEmailCents(billingUserId))
        : priceCents(args.kind, args.units);
    const { error } = await getSupabaseAdmin()
      .from('usage_events')
      .insert({
        billing_user_id: billingUserId,
        user_id: args.userId,
        club_id: args.clubId ?? null,
        kind: args.kind,
        units: Math.floor(args.units),
        billed_cents: billed,
        exempt,
        ref: args.ref ?? null,
      });
    if (error) console.error('recordSendUsage insert failed (non-fatal):', error.message);
  } catch (err) {
    console.error('recordSendUsage failed (non-fatal):', err);
  }
}

/**
 * Park an email the club can't pay for yet. Returns false when even the hold
 * failed, so the caller can fall back to sending rather than losing it.
 */
export async function holdEmail(userId: string, payload: Record<string, unknown> & { clubId?: string | null }): Promise<boolean> {
  try {
    const { billingUserId } = await sendBilling(userId);
    const { error } = await getSupabaseAdmin()
      .from('held_messages')
      .insert({ billing_user_id: billingUserId, user_id: userId, club_id: payload.clubId ?? null, kind: 'email', payload });
    if (error) {
      console.error('holdEmail insert failed:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error('holdEmail failed:', err);
    return false;
  }
}

/** How many emails are waiting on this club owner's card. */
export async function heldCount(billingUserId: string): Promise<number> {
  const { count } = await getSupabaseAdmin()
    .from('held_messages')
    .select('id', { count: 'exact', head: true })
    .eq('billing_user_id', billingUserId)
    .is('released_at', null);
  return count ?? 0;
}
