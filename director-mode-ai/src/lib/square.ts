/**
 * Minimal Square API client (REST via fetch — no SDK dependency).
 *
 * Used for tournament entry payments now that Stripe is unavailable. The flow
 * mirrors Stripe Checkout: create a Square-hosted payment link tied to a
 * specific tournament_entries row (order.reference_id = entry_id), redirect
 * the parent to pay, and a webhook marks the entry paid — so the payment is
 * bound to the entry (and therefore the age division) automatically. Square
 * never has to ask which division; the app already knows.
 *
 * Config (Vercel env):
 *   SQUARE_ACCESS_TOKEN   — production access token (SECRET; never in code/chat)
 *   SQUARE_ENVIRONMENT    — 'production' (default) | 'sandbox'
 *   SQUARE_LOCATION_ID    — optional; auto-discovered from the token if absent
 */

import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { SQUARE_ACCOUNT_OWNER_ID } from '@/config/payments';

const SQUARE_VERSION = '2025-01-23';

export function squareConfigured(): boolean {
  return !!process.env.SQUARE_ACCESS_TOKEN;
}

/**
 * Whether an event's entry fees may go through the platform Square account.
 *
 * The token is one club's seller account, so only that club may use it: the
 * owner themself, or staff of a club they own. Anyone else gets false and falls
 * through to the event's pasted external_payment_url. Uses the real service-role
 * client — the public register routes have no user session to scope by.
 */
export async function squareEnabledForEventOwner(
  eventOwnerId: string | null | undefined
): Promise<boolean> {
  if (!squareConfigured() || !eventOwnerId) return false;
  if (eventOwnerId === SQUARE_ACCOUNT_OWNER_ID) return true;
  try {
    const db = getSupabaseAdmin();
    const { data: memberships } = await db
      .from('cc_club_members')
      .select('club_id')
      .eq('user_id', eventOwnerId);
    const clubIds = ((memberships as { club_id: string }[]) || []).map((m) => m.club_id);
    if (!clubIds.length) return false;
    const { data: clubs } = await db
      .from('cc_clubs')
      .select('id')
      .in('id', clubIds)
      .eq('owner_id', SQUARE_ACCOUNT_OWNER_ID)
      .limit(1);
    return !!clubs && clubs.length > 0;
  } catch {
    return false;
  }
}

function baseUrl(): string {
  return (process.env.SQUARE_ENVIRONMENT || 'production').toLowerCase() === 'sandbox'
    ? 'https://connect.squareupsandbox.com'
    : 'https://connect.squareup.com';
}

async function squareFetch(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${process.env.SQUARE_ACCESS_TOKEN}`,
      'Square-Version': SQUARE_VERSION,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.errors?.[0]?.detail || data?.errors?.[0]?.code || res.statusText;
    throw new Error(`Square ${path} failed: ${msg}`);
  }
  return data;
}

let cachedLocationId: string | null = null;
export async function getLocationId(): Promise<string> {
  if (process.env.SQUARE_LOCATION_ID) return process.env.SQUARE_LOCATION_ID;
  if (cachedLocationId) return cachedLocationId;
  const data = await squareFetch('/v2/locations', { method: 'GET' });
  const loc = (data.locations || []).find((l: any) => l.status === 'ACTIVE') || data.locations?.[0];
  if (!loc?.id) throw new Error('No Square location found for this access token.');
  cachedLocationId = loc.id;
  return loc.id;
}

/**
 * Create a Square-hosted payment link for a single tournament entry.
 * The order's reference_id is the entry id, so the webhook can map the
 * completed payment straight back to the entry (and its division).
 */
export async function createEntryPaymentLink(args: {
  entryId: string;
  amountCents: number;
  name: string; // e.g. "JTT Season-End Tournament — 10U"
  buyerEmail?: string | null;
  redirectUrl: string;
}): Promise<{ url: string; orderId: string; paymentLinkId: string }> {
  const locationId = await getLocationId();
  const body = {
    idempotency_key: `entry-${args.entryId}`,
    order: {
      location_id: locationId,
      reference_id: args.entryId,
      line_items: [
        {
          name: args.name,
          quantity: '1',
          base_price_money: { amount: args.amountCents, currency: 'USD' },
        },
      ],
    },
    checkout_options: {
      redirect_url: args.redirectUrl,
      ask_for_shipping_address: false,
    },
    // NOTE: intentionally NOT pre-populating buyer_email — Square validates it
    // strictly and rejects test/edge-case addresses, which would block the
    // whole checkout. The parent enters their email on Square's page; we match
    // the payment to the entry by order.reference_id, not by email.
  };
  const data = await squareFetch('/v2/online-checkout/payment-links', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  const link = data.payment_link;
  if (!link?.url) throw new Error('Square did not return a payment link URL.');
  return { url: link.url, orderId: link.order_id, paymentLinkId: link.id };
}

export async function getPayment(paymentId: string): Promise<any> {
  const data = await squareFetch(`/v2/payments/${paymentId}`, { method: 'GET' });
  return data.payment;
}

export async function getOrder(orderId: string): Promise<any> {
  const data = await squareFetch(`/v2/orders/${orderId}`, { method: 'GET' });
  return data.order;
}
