import Stripe from 'stripe';

let _stripe: Stripe | null = null;

/**
 * Lazily-initialized Stripe client (platform account). Throws at call time, not
 * import time, so the build step (which has no env vars) never crashes.
 */
export function getStripe(): Stripe {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error('STRIPE_SECRET_KEY is not set');
    _stripe = new Stripe(key);
  }
  return _stripe;
}

export const stripe = new Proxy({} as Stripe, {
  get(_t, prop) {
    return (getStripe() as any)[prop];
  },
});

/**
 * Platform fee CoachMode skims off each paid Connect Checkout charge.
 * Charged to the connected account, routed to the platform account
 * automatically by Stripe via `payment_intent_data.application_fee_amount`.
 *
 * 300 bps = 3%. Adjust here to change platform-wide. Per-tournament
 * overrides could go on the events row later if needed.
 */
export const QUADS_PLATFORM_FEE_BPS = 300; // 3%

/** Compute platform fee in cents (rounded), capped at 100% of the charge. */
export function platformFeeForCents(amountCents: number): number {
  if (QUADS_PLATFORM_FEE_BPS <= 0 || amountCents <= 0) return 0;
  const fee = Math.round((amountCents * QUADS_PLATFORM_FEE_BPS) / 10_000);
  return Math.min(fee, amountCents);
}
