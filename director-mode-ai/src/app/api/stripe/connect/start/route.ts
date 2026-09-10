/**
 * POST /api/stripe/connect/start — RETIRED.
 *
 * Began Stripe Connect Express onboarding for entry-fee payouts. The platform
 * Stripe account is disabled, so onboarding could only create accounts nothing
 * can pay into. Paid entry is now a payment link the director pastes on the
 * event. 410 so a stale client fails clearly.
 */
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST() {
  return NextResponse.json(
    {
      error: 'gone',
      message:
        'Stripe payouts have been retired. For a paid entry, add your own payment link to the event.',
    },
    { status: 410 }
  );
}
