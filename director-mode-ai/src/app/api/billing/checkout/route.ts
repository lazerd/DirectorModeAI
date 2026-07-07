/**
 * POST /api/billing/checkout
 *
 * Creates a LemonSqueezy hosted checkout for a ClubMode plan. Drop-in
 * replacement for /api/stripe/create-checkout (same request shape so the
 * billing UI just changes the URL it posts to).
 *
 * Body: { priceKey: 'pro_monthly'|'pro_annual'|'day_pass', mode?: 'one-time', eventId? }
 * Returns: { url }
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { resolveBillingUserId } from '@/lib/billing';
import { buildCheckoutUrl, type PriceKey } from '@/lib/lemonsqueezy';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const priceKey = body.priceKey as PriceKey | undefined;
    const eventId = body.eventId as string | undefined;
    const isSubscription = body.mode !== 'one-time';

    if (!priceKey) return NextResponse.json({ error: 'invalid_price' }, { status: 400 });

    // Club subscription is club-level: only the owner (payer) may buy it.
    // Day Pass / one-time is per-event, allowed for anyone.
    if (isSubscription) {
      const billingUserId = await resolveBillingUserId(user.id);
      if (billingUserId !== user.id) {
        return NextResponse.json(
          { error: 'not_owner', message: 'Only the club owner can manage the subscription.' },
          { status: 403 }
        );
      }
    }

    const service = await createServiceClient();
    const { data: profile } = await service
      .from('profiles')
      .select('email')
      .eq('id', user.id)
      .single();

    const url = buildCheckoutUrl(priceKey, {
      userId: user.id,
      email: user.email || profile?.email || null,
      eventId: eventId || null,
    });
    if (!url) {
      return NextResponse.json({ error: 'price_not_configured' }, { status: 500 });
    }

    return NextResponse.json({ url });
  } catch (err: any) {
    console.error('[billing/checkout]', err);
    return NextResponse.json({ error: 'checkout_failed', message: err?.message }, { status: 500 });
  }
}
