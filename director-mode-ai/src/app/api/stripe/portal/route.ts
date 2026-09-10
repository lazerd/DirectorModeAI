/**
 * POST /api/stripe/portal — RETIRED.
 *
 * The Stripe account behind the billing portal is disabled; subscriptions are
 * managed through LemonSqueezy. 410 so a stale client fails clearly.
 */
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST() {
  return NextResponse.json(
    { error: 'gone', message: 'The Stripe billing portal has been retired.' },
    { status: 410 }
  );
}
