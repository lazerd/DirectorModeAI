/**
 * GET /api/me/plan — lightweight plan context for the current user, for the
 * client trial/upgrade banner. Returns nulls for guests.
 */
import { NextResponse } from 'next/server';
import { getCurrentUserPlan } from '@/lib/billing';

export const dynamic = 'force-dynamic';

export async function GET() {
  const ctx = await getCurrentUserPlan();
  if (!ctx) return NextResponse.json({ signedIn: false });
  return NextResponse.json({
    signedIn: true,
    effectiveTier: ctx.effectiveTier,
    isBillingOwner: ctx.isBillingOwner,
    subscriptionStatus: ctx.subscriptionStatus,
    trialDaysRemaining: ctx.grandfatheredDaysRemaining,
    onTrial: ctx.rawTier === 'grandfathered' && (ctx.grandfatheredDaysRemaining ?? 0) > 0,
  });
}
