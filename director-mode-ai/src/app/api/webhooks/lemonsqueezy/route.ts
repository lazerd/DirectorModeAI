/**
 * POST /api/webhooks/lemonsqueezy
 *
 * Receives LemonSqueezy billing webhooks and writes the SAME profiles columns
 * the Stripe webhook wrote (plan_tier, subscription_status, current_period_end,
 * stripe_subscription_id [= LS sub id], stripe_customer_id [= LS customer id],
 * billing_status) — so the provider-agnostic gating layer needs no changes.
 *
 * Subscribe this URL in LemonSqueezy to: subscription_created, _updated,
 * _cancelled, _resumed, _expired, _paused, _unpaused, and order_created (day pass).
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import {
  verifyWebhookSignature,
  mapSubscriptionStatus,
  variantIdToTier,
} from '@/lib/lemonsqueezy';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature = request.headers.get('x-signature');
  if (!verifyWebhookSignature(rawBody, signature)) {
    return NextResponse.json({ error: 'bad_signature' }, { status: 400 });
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'bad_json' }, { status: 400 });
  }

  const eventName: string = payload?.meta?.event_name || '';
  const custom = payload?.meta?.custom_data || {};
  const data = payload?.data || {};
  const attrs = data?.attributes || {};
  const service = await createServiceClient();

  // Idempotency: LS has no event id, so synthesize a stable one.
  const eventKey = `ls:${data.type}:${data.id}:${eventName}:${attrs.updated_at || attrs.created_at || ''}`;
  const { data: seen } = await service
    .from('billing_events')
    .select('id')
    .eq('stripe_event_id', eventKey)
    .maybeSingle();
  if (seen) return NextResponse.json({ received: true, dedup: true });

  const lookupUserByCustomer = async (customerId: string | number | null): Promise<string | null> => {
    if (!customerId) return null;
    const { data: p } = await service
      .from('profiles')
      .select('id')
      .eq('stripe_customer_id', String(customerId))
      .maybeSingle();
    return p?.id || null;
  };

  // Only these carry subscription state (payment_success/failed are invoice
  // events with a different shape — handling them here would mis-map status).
  const SUBSCRIPTION_LIFECYCLE = new Set([
    'subscription_created',
    'subscription_updated',
    'subscription_cancelled',
    'subscription_resumed',
    'subscription_expired',
    'subscription_paused',
    'subscription_unpaused',
  ]);

  try {
    if (SUBSCRIPTION_LIFECYCLE.has(eventName)) {
      const userId = custom.user_id || (await lookupUserByCustomer(attrs.customer_id));
      if (userId) {
        const { status, grantsAccess } = mapSubscriptionStatus(String(attrs.status || ''));
        // With buy-link checkout we pass price_key in custom data, so derive the
        // tier from that (no variant env var needed); fall back to variant id.
        const tier =
          custom.price_key === 'pro_monthly' || custom.price_key === 'pro_annual'
            ? 'pro'
            : variantIdToTier(attrs.variant_id);
        const periodEnd = attrs.renews_at || attrs.ends_at || null;
        const { error: updErr } = await service
          .from('profiles')
          .update({
            plan_tier: grantsAccess ? (tier ?? 'free') : 'free',
            subscription_status: status,
            stripe_subscription_id: grantsAccess ? String(data.id) : null,
            stripe_customer_id: attrs.customer_id ? String(attrs.customer_id) : undefined,
            current_period_end: periodEnd,
          })
          .eq('id', userId);
        if (updErr) console.error('[lemonsqueezy/webhook] profile update failed:', updErr.message);
      }
    } else if (eventName === 'order_created') {
      // One-time Day Pass — flip the event's paid flag.
      const eventId = custom.event_id;
      if (eventId && custom.price_key === 'day_pass') {
        await service
          .from('events')
          .update({
            day_pass_purchased_at: new Date(attrs.created_at || Date.now()).toISOString(),
            is_paid: true,
          })
          .eq('id', eventId);
      }
    }

    await service.from('billing_events').insert({
      user_id: custom.user_id || (await lookupUserByCustomer(attrs.customer_id)),
      event_type: eventName,
      stripe_event_id: eventKey,
      metadata: attrs,
    });

    return NextResponse.json({ received: true });
  } catch (err: any) {
    console.error('[lemonsqueezy/webhook] handler error', err);
    return NextResponse.json({ error: 'handler_failed', message: err?.message }, { status: 500 });
  }
}
