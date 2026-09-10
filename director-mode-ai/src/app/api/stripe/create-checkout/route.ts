/**
 * POST /api/stripe/create-checkout — RETIRED.
 *
 * The Stripe account behind this is disabled. ClubMode plans move to
 * LemonSqueezy (/api/billing/checkout), and nothing is sold while FOUNDING_MODE
 * is on. Kept as a 410 so a stale client gets a clear answer instead of a
 * Stripe error from a dead account.
 */
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST() {
  return NextResponse.json(
    {
      error: 'gone',
      message: 'Stripe checkout has been retired. ClubMode is free for founding clubs during beta.',
    },
    { status: 410 }
  );
}
