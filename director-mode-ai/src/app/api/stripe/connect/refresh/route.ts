/**
 * GET /api/stripe/connect/refresh — RETIRED.
 *
 * Regenerated an expired Stripe Connect onboarding link. Onboarding is retired
 * (see ../start), so this answers 410 rather than minting a new account link.
 */
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(
    { error: 'gone', message: 'Stripe payouts have been retired.' },
    { status: 410 }
  );
}
