import Stripe from 'stripe';

const secretKey = process.env.STRIPE_SECRET_KEY;

if (!secretKey && process.env.NODE_ENV === 'production') {
  console.warn('[stripe] STRIPE_SECRET_KEY not set');
}

export const stripe = new Stripe(secretKey || 'sk_test_placeholder', {
  apiVersion: '2026-04-22.dahlia',
  typescript: true,
});

export const PRICE_IDS = {
  pro_monthly: process.env.STRIPE_PRICE_PRO_MONTHLY || '',
  pro_annual: process.env.STRIPE_PRICE_PRO_ANNUAL || '',
  day_pass: process.env.STRIPE_PRICE_DAY_PASS || '',
} as const;

export type StripePriceKey = keyof typeof PRICE_IDS;

export function priceToTier(priceId: string | null | undefined): 'pro' | null {
  if (!priceId) return null;
  if (priceId === PRICE_IDS.pro_monthly || priceId === PRICE_IDS.pro_annual) return 'pro';
  return null;
}
