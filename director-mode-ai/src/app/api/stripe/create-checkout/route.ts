import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { stripe, PRICE_IDS, type StripePriceKey } from '@/lib/stripe';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const priceKey = body.priceKey as StripePriceKey | undefined;
    const eventId = body.eventId as string | undefined;
    const mode = body.mode === 'one-time' ? 'payment' : 'subscription';

    if (!priceKey || !PRICE_IDS[priceKey]) {
      return NextResponse.json({ error: 'invalid_price' }, { status: 400 });
    }
    const priceId = PRICE_IDS[priceKey];
    if (!priceId) {
      return NextResponse.json({ error: 'price_not_configured' }, { status: 500 });
    }

    const service = await createServiceClient();
    const { data: profile } = await service
      .from('profiles')
      .select('stripe_customer_id, email')
      .eq('id', user.id)
      .single();

    let customerId = profile?.stripe_customer_id || null;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email || profile?.email || undefined,
        metadata: { supabase_user_id: user.id },
      });
      customerId = customer.id;
      await service.from('profiles').update({ stripe_customer_id: customerId }).eq('id', user.id);
    }

    const origin = request.headers.get('origin') || process.env.NEXT_PUBLIC_APP_URL || '';
    const successPath =
      mode === 'payment' && eventId
        ? `/mixer/events/${eventId}?day_pass=success`
        : '/mixer/subscription?status=success';
    const cancelPath =
      mode === 'payment' && eventId ? `/mixer/events/${eventId}?day_pass=cancelled` : '/pricing';

    const session = await stripe.checkout.sessions.create({
      mode,
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin}${successPath}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}${cancelPath}`,
      allow_promotion_codes: true,
      metadata: {
        supabase_user_id: user.id,
        price_key: priceKey,
        ...(eventId ? { mixer_event_id: eventId } : {}),
      },
      ...(mode === 'subscription' && {
        subscription_data: {
          metadata: { supabase_user_id: user.id, price_key: priceKey },
        },
      }),
    });

    return NextResponse.json({ url: session.url, sessionId: session.id });
  } catch (err: any) {
    console.error('[stripe/create-checkout]', err);
    return NextResponse.json({ error: 'checkout_failed', message: err?.message }, { status: 500 });
  }
}
