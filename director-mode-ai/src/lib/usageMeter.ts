/**
 * The send meter: every email and text a club sends is priced in cents and
 * written to usage_events under the club owner who pays for it.
 *
 * Pricing is Darrin's (2026-10-21, constants in config/pricing): the platform is
 * free, every email is EMAIL_PRICE_CENTS and every text TEXT_PRICE_CENTS, with
 * no allowance. The platform owner's clubs are recorded with exempt=true and
 * never invoiced, the same rule Ask Claude uses.
 *
 * Recording never throws: a metering hiccup must not stop a club's email.
 */

import { EMAIL_PRICE_CENTS, METERING_ENFORCED, TEXT_PRICE_CENTS } from '@/config/pricing';
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

/**
 * Can this account send right now? Always yes until METERING_ENFORCED; after
 * that, only the platform owner or a club with a card on file (an active
 * "ClubMode usage" metered subscription).
 */
export async function canSend(userId: string): Promise<boolean> {
  if (!METERING_ENFORCED) return true;
  try {
    const { billingUserId, exempt } = await sendBilling(userId);
    return exempt || (await paygActive(getSupabaseAdmin(), billingUserId));
  } catch (err) {
    console.error('canSend check failed; allowing the send:', err);
    return true;
  }
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
    const { error } = await getSupabaseAdmin()
      .from('usage_events')
      .insert({
        billing_user_id: billingUserId,
        user_id: args.userId,
        club_id: args.clubId ?? null,
        kind: args.kind,
        units: Math.floor(args.units),
        billed_cents: priceCents(args.kind, args.units),
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
