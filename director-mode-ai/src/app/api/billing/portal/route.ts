/**
 * POST /api/billing/portal
 *
 * Returns the LemonSqueezy customer portal URL for the club owner's
 * subscription (update card / cancel). Replaces /api/stripe/portal.
 */
import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { resolveBillingUserId, } from '@/lib/billing';
import { lsConfigured, getSubscription } from '@/lib/lemonsqueezy';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    if (!lsConfigured()) {
      return NextResponse.json({ error: 'billing_unconfigured' }, { status: 503 });
    }
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    // The subscription lives on the club owner's profile.
    const ownerId = await resolveBillingUserId(user.id);
    const service = await createServiceClient();
    const { data: profile } = await service
      .from('profiles')
      .select('stripe_subscription_id')
      .eq('id', ownerId)
      .single();

    const subId = profile?.stripe_subscription_id;
    if (!subId) {
      return NextResponse.json({ error: 'no_subscription' }, { status: 400 });
    }

    const attrs = await getSubscription(String(subId));
    const url = attrs?.urls?.customer_portal;
    if (!url) return NextResponse.json({ error: 'no_portal_url' }, { status: 500 });

    return NextResponse.json({ url });
  } catch (err: any) {
    console.error('[billing/portal]', err);
    return NextResponse.json({ error: 'portal_failed', message: err?.message }, { status: 500 });
  }
}
