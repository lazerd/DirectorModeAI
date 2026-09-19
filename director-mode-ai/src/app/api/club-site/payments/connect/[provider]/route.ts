/**
 * GET /api/club-site/payments/connect/[provider]
 *
 * Starts connecting the club's OWN processor. Square: redirect to Square's
 * authorize page with a signed state naming this club; Square brings the staff
 * member back to /api/club-site/payments/callback/square. See lib/squareConnect.
 *
 * Stripe Connect is not built — ClubMode's Stripe platform account is disabled.
 */
import { NextResponse } from 'next/server';
import { requireStaffForClub } from '@/lib/courtsheet/routeAuth';
import { blockIfDemo } from '@/lib/demo/server';
import { authorizeUrl, signState, squareOAuthConfigured } from '@/lib/squareConnect';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  // Changes how the club gets paid: write access only, and never a demo.
  const ctx = await requireStaffForClub({ requireWrite: true });
  if ('error' in ctx) return ctx.error;
  const demo = await blockIfDemo(ctx.user.id);
  if (demo) return demo;

  const { provider } = await params;
  if (provider === 'square') {
    if (!squareOAuthConfigured()) {
      return NextResponse.json({ error: 'Square connection is not switched on yet.' }, { status: 501 });
    }
    return NextResponse.redirect(authorizeUrl(signState(ctx.club.id, ctx.user.id)));
  }
  if (provider === 'stripe') {
    return NextResponse.json({ error: 'Connecting Stripe is not available yet.' }, { status: 501 });
  }
  return NextResponse.json({ error: 'Unknown provider.' }, { status: 404 });
}
