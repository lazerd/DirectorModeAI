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
import { buildCheckoutUrl, isCaptainPriceKey, type PriceKey } from '@/lib/lemonsqueezy';
import { resolveCaptainRate } from '@/lib/captain/access';

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

    const isCaptain = isCaptainPriceKey(priceKey);

    // Club subscription is club-level: only the owner (payer) may buy it.
    // Day Pass / one-time is per-event, allowed for anyone.
    // CaptainMode is per-captain and deliberately exempt — a captain is usually
    // just a member of the club, not its owner, and pays with their own card.
    if (isSubscription && !isCaptain) {
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

    // For CaptainMode, the RATE IS RESOLVED SERVER-SIDE from the club's Pro
    // status — never trusted from the client, or anyone could self-select $10.
    let effectiveKey: PriceKey = priceKey;
    let clubId: string | null = null;
    if (isCaptain) {
      clubId = (body.clubId as string | undefined) || null;
      if (clubId) {
        const { data: membership } = await service
          .from('cc_club_members')
          .select('club_id')
          .eq('user_id', user.id)
          .eq('club_id', clubId)
          .maybeSingle();
        const { data: owned } = await service
          .from('cc_clubs')
          .select('id')
          .eq('id', clubId)
          .eq('owner_id', user.id)
          .maybeSingle();
        // Only honour a club the captain actually belongs to.
        if (!membership && !owned) clubId = null;
      }
      const rate = await resolveCaptainRate(clubId);
      effectiveKey = rate === 'club_linked' ? 'captain_club' : 'captain_solo';
    }

    const url = buildCheckoutUrl(effectiveKey, {
      userId: user.id,
      email: user.email || profile?.email || null,
      eventId: eventId || null,
      clubId,
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
