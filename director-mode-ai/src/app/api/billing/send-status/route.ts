/**
 * GET /api/billing/send-status — can this person's club send email and texts,
 * and if not, where the owner adds a card. Feeds the SendPaywall banner/modal.
 * Guests get { signedIn: false }.
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { EMAIL_PRICE_CENTS, METERING_ENFORCED, TEXT_PRICE_CENTS } from '@/config/pricing';
import { heldCount, sendBilling } from '@/lib/usageMeter';
import { paygActive } from '@/lib/assistant/meter';
import { buildCheckoutUrl } from '@/lib/lemonsqueezy';

export const dynamic = 'force-dynamic';

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ signedIn: false });

  const { billingUserId, exempt } = await sendBilling(user.id);
  const hasCard = exempt ? false : await paygActive(getSupabaseAdmin(), billingUserId);
  const isOwner = billingUserId === user.id;
  const held = await heldCount(billingUserId);

  return NextResponse.json({
    signedIn: true,
    enforced: METERING_ENFORCED,
    canSend: !METERING_ENFORCED || exempt || hasCard,
    exempt,
    hasCard,
    isOwner,
    held,
    emailCents: EMAIL_PRICE_CENTS,
    textCents: TEXT_PRICE_CENTS,
    // Only the payer can add the card; staff are told to ask them.
    checkoutUrl:
      isOwner && !exempt && !hasCard
        ? buildCheckoutUrl('ai_usage', { userId: billingUserId, email: user.email ?? null })
        : null,
  });
}
