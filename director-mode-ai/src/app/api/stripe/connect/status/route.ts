/**
 * GET /api/stripe/connect/status
 *
 * Pulls the latest Connect account state from Stripe and syncs it to the
 * director's profile row. Called after returning from Stripe onboarding.
 *
 * Returns: { stripe_account_id, charges_enabled, payouts_enabled, details_submitted }
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { stripe } from '@/lib/stripe';

export async function GET() {
  const userClient = await createClient();
  const {
    data: { user },
  } = await userClient.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = getSupabaseAdmin();
  const { data: profile } = await admin
    .from('profiles')
    .select('stripe_account_id, stripe_charges_enabled, stripe_payouts_enabled, stripe_details_submitted')
    .eq('id', user.id)
    .maybeSingle();

  if (!profile?.stripe_account_id) {
    return NextResponse.json({
      stripe_account_id: null,
      charges_enabled: false,
      payouts_enabled: false,
      details_submitted: false,
    });
  }

  try {
    const acct = await stripe.accounts.retrieve(profile.stripe_account_id);
    await admin
      .from('profiles')
      .update({
        stripe_charges_enabled: !!acct.charges_enabled,
        stripe_payouts_enabled: !!acct.payouts_enabled,
        stripe_details_submitted: !!acct.details_submitted,
      })
      .eq('id', user.id);

    return NextResponse.json({
      stripe_account_id: acct.id,
      charges_enabled: !!acct.charges_enabled,
      payouts_enabled: !!acct.payouts_enabled,
      details_submitted: !!acct.details_submitted,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Failed to retrieve Stripe account' },
      { status: 500 }
    );
  }
}
