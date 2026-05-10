/**
 * GET /api/stripe/connect/refresh
 *
 * Stripe redirects directors here when their account-link expires before
 * they finish onboarding. We just regenerate a fresh link and redirect.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { stripe } from '@/lib/stripe';

export async function GET(request: Request) {
  const userClient = await createClient();
  const {
    data: { user },
  } = await userClient.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL('/auth/signin', request.url));
  }

  const admin = getSupabaseAdmin();
  const { data: profile } = await admin
    .from('profiles')
    .select('stripe_account_id')
    .eq('id', user.id)
    .maybeSingle();

  if (!profile?.stripe_account_id) {
    return NextResponse.redirect(new URL('/mixer/settings', request.url));
  }

  const origin = new URL(request.url).origin;
  const link = await stripe.accountLinks.create({
    account: profile.stripe_account_id,
    refresh_url: `${origin}/api/stripe/connect/refresh`,
    return_url: `${origin}/mixer/settings?stripe_return=1`,
    type: 'account_onboarding',
  });

  return NextResponse.redirect(link.url);
}
