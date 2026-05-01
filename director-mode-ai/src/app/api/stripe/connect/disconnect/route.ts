/**
 * POST /api/stripe/connect/disconnect
 *
 * Clears the Stripe Connect link from the logged-in director's profile.
 * Doesn't delete the connected account on Stripe's side (those are kept
 * for audit/refund history) — just severs the local mapping so the next
 * "Connect Stripe" click creates a fresh Express account.
 *
 * Returns: { success: true }
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

export async function POST() {
  const userClient = await createClient();
  const {
    data: { user },
  } = await userClient.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = getSupabaseAdmin();
  await admin
    .from('profiles')
    .update({
      stripe_account_id: null,
      stripe_charges_enabled: false,
      stripe_payouts_enabled: false,
      stripe_details_submitted: false,
    })
    .eq('id', user.id);

  return NextResponse.json({ success: true });
}
