/**
 * GET /api/club-site/payments/connect/[provider]
 *
 * The per-club processor connection. NOT BUILT YET.
 *
 * This route exists so that the day somebody sets SQUARE_OAUTH_APP_ID in the
 * environment, the Connect button they just enabled leads somewhere that
 * explains itself instead of a 404. The settings screen only renders that
 * button when the env vars are present, so under normal configuration nothing
 * reaches here at all.
 *
 * What finishing it needs, in order:
 *   1. A Square application (or Stripe Connect client) registered to ClubMode.
 *   2. This route redirecting to the provider's authorize URL with a signed
 *      state parameter carrying the club id.
 *   3. A callback route exchanging the code, storing the merchant id on
 *      club_payments and the access token somewhere that is NOT a table page
 *      code reads.
 *   4. Checkout creation at booking time, and a webhook marking bookings paid.
 *
 * Until then the payment LINK on the same screen is how a club gets paid, and
 * it works.
 */

import { NextResponse } from 'next/server';
import { requireStaffForClub } from '@/lib/courtsheet/routeAuth';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  // Staff-gated even though it does nothing: the day it does something, it
  // will be changing how a club gets paid.
  const ctx = await requireStaffForClub({ requireWrite: true });
  if ('error' in ctx) return ctx.error;

  const { provider } = await params;
  if (provider !== 'square' && provider !== 'stripe') {
    return NextResponse.json({ error: 'Unknown provider.' }, { status: 404 });
  }

  return NextResponse.json(
    {
      error: `Connecting ${provider === 'square' ? 'Square' : 'Stripe'} is not finished yet.`,
      detail:
        'Your payment link on the same screen is how the club gets paid in the meantime, and it works today.',
      provider,
    },
    { status: 501 },
  );
}
