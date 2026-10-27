/**
 * GET /api/billing/send-status — can this person's club send email and texts,
 * and if not, where the owner adds a card. Feeds the SendPaywall banner/modal.
 * Guests get { signedIn: false }.
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { DEFAULT_MONTHLY_LIMIT_USD, EMAIL_MONTHLY_CAP_CENTS, EMAIL_PRICE_CENTS, FREE_EMAIL_NUDGE_AT, METERING_ENFORCED, TEXT_PRICE_CENTS } from '@/config/pricing';
import { freeEmailStatus, heldCount, monthSpendCents, monthlyLimitCents, payerFor, sendBilling } from '@/lib/usageMeter';
import { buildCheckoutUrl } from '@/lib/lemonsqueezy';

export const dynamic = 'force-dynamic';

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ signedIn: false });

  const { billingUserId, exempt } = await sendBilling(user.id);
  const payer = exempt ? null : await payerFor(billingUserId);
  const hasCard = !!payer;
  const isOwner = billingUserId === user.id;
  const [held, limitCents, spentCents, free] = await Promise.all([
    heldCount(billingUserId),
    monthlyLimitCents(billingUserId),
    monthSpendCents(billingUserId),
    freeEmailStatus(billingUserId),
  ]);
  const overLimit = !exempt && limitCents !== null && spentCents >= limitCents;

  return NextResponse.json({
    signedIn: true,
    enforced: METERING_ENFORCED,
    // Emails are free until the club's allowance runs out; then a payer is needed. Texts always need one.
    canSend: !METERING_ENFORCED || exempt || (hasCard ? !overLimit : free.remaining > 0),
    overLimit: METERING_ENFORCED && hasCard && overLimit,
    limitCents,
    spentCents,
    suggestedLimitUsd: DEFAULT_MONTHLY_LIMIT_USD,
    exempt,
    hasCard,
    sponsored: !!payer?.sponsor,
    isOwner,
    freeUsed: free.used,
    freeTotal: free.total,
    freeRemaining: free.remaining,
    nudge: METERING_ENFORCED && !exempt && !hasCard && free.used >= FREE_EMAIL_NUDGE_AT,
    sponsorCapCents: EMAIL_MONTHLY_CAP_CENTS,
    held,
    emailCents: EMAIL_PRICE_CENTS,
    textCents: TEXT_PRICE_CENTS,
    // Only the payer can add the card; staff are told to ask them.
    checkoutUrl:
      isOwner && !exempt && !hasCard
        ? buildCheckoutUrl('ai_usage', { userId: billingUserId, email: user.email ?? null })
        : null,
    // Anyone else at the club can sponsor it: their card, the club's sends, up to $30 a month.
    sponsorCheckoutUrl:
      !isOwner && !exempt && !hasCard
        ? buildCheckoutUrl('ai_usage', { userId: user.id, email: user.email ?? null, sponsorFor: billingUserId })
        : null,
  });
}
