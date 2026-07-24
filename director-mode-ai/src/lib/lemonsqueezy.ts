/**
 * LemonSqueezy billing client (REST via fetch — no SDK).
 *
 * Replaces Stripe for ClubMode SaaS subscriptions (the Stripe account is dead —
 * see the billing-migration note). LemonSqueezy is a Merchant of Record, so it
 * handles tax/compliance and is far more lenient for SaaS than Stripe Connect.
 *
 * The gating layer (src/lib/billing.ts) is provider-agnostic — it only reads
 * profiles.plan_tier / subscription_status / current_period_end. So the webhook
 * here writes those same columns with the same status vocabulary
 * ('active' | 'trialing' | 'past_due' | 'canceled') and nothing downstream
 * needs to change. We reuse profiles.stripe_customer_id / stripe_subscription_id
 * to store the LS customer / subscription ids (already service-role-writable and
 * protected by the billing trigger).
 *
 * Config (Vercel env):
 *   LEMONSQUEEZY_API_KEY               — secret API key
 *   LEMONSQUEEZY_STORE_ID              — numeric store id
 *   LEMONSQUEEZY_WEBHOOK_SECRET        — webhook signing secret
 *   LEMONSQUEEZY_VARIANT_PRO_MONTHLY   — variant id for $29/mo
 *   LEMONSQUEEZY_VARIANT_PRO_ANNUAL    — variant id for $290/yr
 *   LEMONSQUEEZY_VARIANT_DAY_PASS      — variant id for $9 one-time (optional)
 */

import crypto from 'crypto';

const API = 'https://api.lemonsqueezy.com/v1';

export type PriceKey = 'pro_monthly' | 'pro_annual' | 'day_pass';

export function lsConfigured(): boolean {
  return !!process.env.LEMONSQUEEZY_API_KEY && !!process.env.LEMONSQUEEZY_STORE_ID;
}

// Hosted LemonSqueezy buy links (non-secret, stable per product). Using these
// avoids needing the API key / numeric store+variant ids just to start a
// checkout — we pass the account id via custom data query params, and the
// webhook reads it back from meta.custom_data to flip the right account to Pro.
//
// The monthly link used to be hardcoded here, which meant switching the store
// from test mode to live required a code change and a deploy. It's the last
// thing standing between the product and taking money, so it should not need
// an engineer: set LEMONSQUEEZY_BUY_LINK_PRO_MONTHLY in Vercel and the next
// request picks it up.
//
// The test-mode link stays as the fallback so nothing breaks before that's
// done — but lsCheckoutMode() reports 'test' while it's in use, and the
// billing UI says so out loud rather than letting a test checkout look real.
const TEST_BUY_LINK_PRO_MONTHLY =
  'https://coachmode.lemonsqueezy.com/checkout/buy/331145f1-d9ac-4376-b11d-b1b51a50b793';

function buyLinks(): Record<PriceKey, string | null> {
  return {
    pro_monthly: process.env.LEMONSQUEEZY_BUY_LINK_PRO_MONTHLY || TEST_BUY_LINK_PRO_MONTHLY,
    pro_annual: process.env.LEMONSQUEEZY_BUY_LINK_PRO_ANNUAL || null,
    day_pass: process.env.LEMONSQUEEZY_BUY_LINK_DAY_PASS || null,
  };
}

/**
 * Whether real money can be taken.
 *
 * 'test'  — still on the built-in test-store link; checkouts complete but
 *           charge nothing, so a "subscriber" is not a customer.
 * 'live'  — a buy link has been configured in the environment.
 */
export function lsCheckoutMode(): 'live' | 'test' {
  return process.env.LEMONSQUEEZY_BUY_LINK_PRO_MONTHLY ? 'live' : 'test';
}

/** Build a hosted-checkout URL for a plan with the account id attached. */
export function buildCheckoutUrl(
  priceKey: PriceKey,
  opts: { userId: string; email?: string | null; eventId?: string | null }
): string | null {
  const base = buyLinks()[priceKey];
  if (!base) return null;
  const u = new URL(base);
  u.searchParams.set('checkout[custom][user_id]', opts.userId);
  u.searchParams.set('checkout[custom][price_key]', priceKey);
  if (opts.email) u.searchParams.set('checkout[email]', opts.email);
  if (opts.eventId) u.searchParams.set('checkout[custom][event_id]', opts.eventId);
  return u.toString();
}

export function variantForPriceKey(priceKey: PriceKey): string | null {
  switch (priceKey) {
    case 'pro_monthly':
      return process.env.LEMONSQUEEZY_VARIANT_PRO_MONTHLY || null;
    case 'pro_annual':
      return process.env.LEMONSQUEEZY_VARIANT_PRO_ANNUAL || null;
    case 'day_pass':
      return process.env.LEMONSQUEEZY_VARIANT_DAY_PASS || null;
    default:
      return null;
  }
}

/** Which subscription tier a LS variant grants. Day pass is one-time → null. */
export function variantIdToTier(variantId: string | number | null | undefined): 'pro' | null {
  const v = String(variantId ?? '');
  if (v && (v === process.env.LEMONSQUEEZY_VARIANT_PRO_MONTHLY || v === process.env.LEMONSQUEEZY_VARIANT_PRO_ANNUAL)) {
    return 'pro';
  }
  return null;
}

/** Map a LemonSqueezy subscription status to our provider-agnostic vocabulary. */
export function mapSubscriptionStatus(lsStatus: string): {
  status: 'active' | 'trialing' | 'past_due' | 'canceled';
  grantsAccess: boolean;
} {
  switch (lsStatus) {
    case 'active':
      return { status: 'active', grantsAccess: true };
    case 'on_trial':
      return { status: 'trialing', grantsAccess: true };
    case 'past_due':
      return { status: 'past_due', grantsAccess: true };
    // 'cancelled' in LS means "will not renew" but stays valid until ends_at —
    // keep access (mirrors Stripe cancel_at_period_end). 'expired' is the real end.
    case 'cancelled':
      return { status: 'active', grantsAccess: true };
    case 'paused':
    case 'unpaid':
    case 'expired':
    default:
      return { status: 'canceled', grantsAccess: false };
  }
}

async function lsFetch(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.api+json',
      'Content-Type': 'application/vnd.api+json',
      Authorization: `Bearer ${process.env.LEMONSQUEEZY_API_KEY}`,
      ...(init?.headers || {}),
    },
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.errors?.[0]?.detail || data?.errors?.[0]?.title || res.statusText;
    throw new Error(`LemonSqueezy ${path} failed: ${msg}`);
  }
  return data;
}

/**
 * Create a hosted checkout for a variant. `custom` is returned verbatim in the
 * webhook as meta.custom_data — we pass the billing user_id (and event id for
 * day passes) so the webhook can map the purchase back to the account.
 */
export async function createCheckout(args: {
  variantId: string;
  email?: string | null;
  custom: Record<string, string>;
  redirectUrl: string;
}): Promise<string> {
  const body = {
    data: {
      type: 'checkouts',
      attributes: {
        checkout_data: {
          ...(args.email ? { email: args.email } : {}),
          custom: args.custom,
        },
        product_options: {
          redirect_url: args.redirectUrl,
          enabled_variants: [Number(args.variantId)],
        },
      },
      relationships: {
        store: { data: { type: 'stores', id: String(process.env.LEMONSQUEEZY_STORE_ID) } },
        variant: { data: { type: 'variants', id: String(args.variantId) } },
      },
    },
  };
  const data = await lsFetch('/checkouts', { method: 'POST', body: JSON.stringify(body) });
  const url = data?.data?.attributes?.url;
  if (!url) throw new Error('LemonSqueezy did not return a checkout URL.');
  return url;
}

export async function getSubscription(id: string): Promise<any> {
  const data = await lsFetch(`/subscriptions/${id}`, { method: 'GET' });
  return data?.data?.attributes ?? null;
}

/** Verify the X-Signature header: HMAC-SHA256(rawBody) hex, timing-safe. */
export function verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
  const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET;
  if (!secret || !signature) return false;
  const digest = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  const a = Buffer.from(digest, 'utf8');
  const b = Buffer.from(signature, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
