import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createServiceClient } from '@/lib/supabase/server';
import { stripe, priceToTier } from '@/lib/stripe';

export const runtime = 'nodejs';

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '';

export async function POST(request: NextRequest) {
  const sig = request.headers.get('stripe-signature');
  if (!sig || !webhookSecret) {
    return NextResponse.json({ error: 'missing_signature' }, { status: 400 });
  }

  const rawBody = await request.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err: any) {
    console.error('[stripe/webhook] signature verification failed', err?.message);
    return NextResponse.json({ error: 'bad_signature' }, { status: 400 });
  }

  const service = await createServiceClient();

  // Idempotency — skip if we've already logged this event
  const { data: existing } = await service
    .from('billing_events')
    .select('id')
    .eq('stripe_event_id', event.id)
    .maybeSingle();
  if (existing) {
    return NextResponse.json({ received: true, dedup: true });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.metadata?.supabase_user_id;
        const eventId = session.metadata?.mixer_event_id;

        if (eventId && session.mode === 'payment') {
          // Day Pass purchase — flip the event flag
          await service
            .from('mixer_events')
            .update({
              day_pass_purchased_at: new Date().toISOString(),
              day_pass_stripe_session_id: session.id,
              is_paid: true,
            })
            .eq('id', eventId);
        }
        // Subscription mode: subscription.created will follow with the priced details, no work here
        break;
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription;
        const userId = (sub.metadata?.supabase_user_id as string) || (await lookupUserByCustomer(sub.customer as string));
        if (!userId) break;
        const item = sub.items.data[0];
        const priceId = item?.price?.id;
        const tier = priceToTier(priceId);
        // Stripe SDK 18+ moved current_period_end to the subscription item
        const periodEndUnix =
          (item as any)?.current_period_end ?? (sub as any).current_period_end ?? null;
        await service
          .from('profiles')
          .update({
            plan_tier: tier ?? 'free',
            stripe_subscription_id: sub.id,
            subscription_status: sub.status,
            current_period_end: periodEndUnix ? new Date(periodEndUnix * 1000).toISOString() : null,
            billing_status: sub.status === 'active' ? 'active' : sub.status === 'canceled' ? 'cancelled' : 'trial',
          })
          .eq('id', userId);
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        const userId = (sub.metadata?.supabase_user_id as string) || (await lookupUserByCustomer(sub.customer as string));
        if (!userId) break;
        await service
          .from('profiles')
          .update({
            plan_tier: 'free',
            subscription_status: 'canceled',
            stripe_subscription_id: null,
            current_period_end: null,
            billing_status: 'cancelled',
          })
          .eq('id', userId);
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        const userId = await lookupUserByCustomer(invoice.customer as string);
        if (!userId) break;
        await service
          .from('profiles')
          .update({ subscription_status: 'past_due' })
          .eq('id', userId);
        break;
      }
    }

    await service.from('billing_events').insert({
      user_id: await safeUserFromEvent(event),
      event_type: event.type,
      stripe_event_id: event.id,
      metadata: event.data.object as any,
    });

    return NextResponse.json({ received: true });
  } catch (err: any) {
    console.error('[stripe/webhook] handler error', err);
    return NextResponse.json({ error: 'handler_failed', message: err?.message }, { status: 500 });
  }
}

async function lookupUserByCustomer(customerId: string | null): Promise<string | null> {
  if (!customerId) return null;
  const service = await createServiceClient();
  const { data } = await service
    .from('profiles')
    .select('id')
    .eq('stripe_customer_id', customerId)
    .maybeSingle();
  return data?.id || null;
}

async function safeUserFromEvent(event: Stripe.Event): Promise<string | null> {
  const obj = event.data.object as any;
  if (obj?.metadata?.supabase_user_id) return obj.metadata.supabase_user_id;
  if (obj?.customer) return lookupUserByCustomer(obj.customer);
  return null;
}
