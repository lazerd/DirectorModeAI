/**
 * GET /api/billing/status — can ClubMode actually take money right now?
 *
 * Owner-only. Reports whether each piece of the LemonSqueezy setup is present
 * and whether checkout is pointed at the live store or the built-in test link.
 *
 * Reports PRESENCE, never values — no key, secret, or id is echoed back. The
 * point is to answer "are we live?" without anyone having to read source or
 * paste a secret into a chat window to find out.
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { lsCheckoutMode, lsConfigured } from '@/lib/lemonsqueezy';

export const dynamic = 'force-dynamic';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = getSupabaseAdmin();
  const { data: club } = await admin
    .from('cc_clubs')
    .select('id')
    .eq('owner_id', user.id)
    .maybeSingle();
  if (!club) return NextResponse.json({ error: 'Club owners only.' }, { status: 403 });

  const mode = lsCheckoutMode();
  const has = (k: string) => !!process.env[k];

  // Only the buy link and the webhook secret are load-bearing: checkout runs
  // off the hosted link, and the webhook derives the tier from custom.price_key
  // rather than needing variant ids. The rest are for the management API.
  const required = [
    { key: 'LEMONSQUEEZY_BUY_LINK_PRO_MONTHLY', set: has('LEMONSQUEEZY_BUY_LINK_PRO_MONTHLY'), why: 'Live checkout link — without it, checkout uses the test store and charges nothing.' },
    { key: 'LEMONSQUEEZY_WEBHOOK_SECRET', set: has('LEMONSQUEEZY_WEBHOOK_SECRET'), why: 'Verifies webhooks. Without it, a completed purchase never grants Pro.' },
  ];
  const optional = [
    { key: 'LEMONSQUEEZY_API_KEY', set: has('LEMONSQUEEZY_API_KEY'), why: 'Customer portal ("manage plan") and API lookups.' },
    { key: 'LEMONSQUEEZY_STORE_ID', set: has('LEMONSQUEEZY_STORE_ID'), why: 'Pairs with the API key.' },
    { key: 'LEMONSQUEEZY_BUY_LINK_PRO_ANNUAL', set: has('LEMONSQUEEZY_BUY_LINK_PRO_ANNUAL'), why: 'Annual plan. Hidden from the UI when unset.' },
    { key: 'LEMONSQUEEZY_BUY_LINK_DAY_PASS', set: has('LEMONSQUEEZY_BUY_LINK_DAY_PASS'), why: 'One-off day pass. Hidden when unset.' },
  ];

  const { count: paying } = await admin
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('plan_tier', 'pro')
    .eq('subscription_status', 'active');

  const blocking = required.filter((r) => !r.set);

  return NextResponse.json({
    canTakeMoney: mode === 'live' && blocking.length === 0,
    mode,
    summary: mode === 'live'
      ? (blocking.length === 0
          ? 'Live — real checkouts will charge and grant Pro.'
          : 'Live link set, but something else is missing. See blocking.')
      : 'TEST MODE — checkouts complete but charge nothing. Set LEMONSQUEEZY_BUY_LINK_PRO_MONTHLY to go live.',
    blocking,
    required,
    optional,
    portalAvailable: lsConfigured(),
    activeProAccounts: paying ?? 0,
  });
}
