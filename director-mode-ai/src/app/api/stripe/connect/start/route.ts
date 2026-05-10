/**
 * POST /api/stripe/connect/start
 *
 * Begins (or resumes) Stripe Connect Express onboarding for the logged-in
 * director. Creates an Express account if they don't have one yet, then
 * returns an account-link URL the director should be redirected to.
 *
 * No request body. Returns: { url: string }.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { stripe } from '@/lib/stripe';

export async function POST(request: Request) {
  try {
    const userClient = await createClient();
    const {
      data: { user },
    } = await userClient.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const admin = getSupabaseAdmin();
    const { data: profile } = await admin
      .from('profiles')
      .select('stripe_account_id, full_name')
      .eq('id', user.id)
      .maybeSingle();

    let accountId = profile?.stripe_account_id || null;

    if (!accountId) {
      const account = await stripe.accounts.create({
        type: 'express',
        email: user.email,
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        business_type: 'individual',
        business_profile: {
          product_description: 'Tennis tournament entry fees (CoachMode Quads)',
        },
        metadata: { user_id: user.id },
      });
      accountId = account.id;

      await admin
        .from('profiles')
        .update({ stripe_account_id: accountId })
        .eq('id', user.id);
    }

    const origin = new URL(request.url).origin;
    const link = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${origin}/api/stripe/connect/refresh`,
      return_url: `${origin}/mixer/settings?stripe_return=1`,
      type: 'account_onboarding',
    });

    return NextResponse.json({ url: link.url });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Stripe onboarding failed' },
      { status: 500 }
    );
  }
}
