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
 * The platform fee charged on each Connect payment. Cents per ticket.
 * Set to 0 to take no platform fee for now.
 */
export const QUADS_PLATFORM_FEE_BPS = 0; // basis points (0 = no fee)

export function platformFeeForCents(amountCents: number): number {
  if (QUADS_PLATFORM_FEE_BPS <= 0) return 0;
  return Math.round((amountCents * QUADS_PLATFORM_FEE_BPS) / 10_000);
}
