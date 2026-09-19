/**
 * Per-club Square: each club connects its OWN Square account, and the money for
 * its class sign-ups and court bookings goes straight to it.
 *
 * The flow, end to end:
 *   1. Staff tap "Connect Square" → /api/club-site/payments/connect/square
 *      redirects to Square's authorize page with a signed `state` (club id).
 *   2. Square sends them back to /api/club-site/payments/callback/square with a
 *      code; we exchange it for the club's tokens (club_payment_tokens —
 *      service role only) and record the merchant + location on club_payments.
 *   3. A customer who owes money gets a link to /pay/<kind>/<id>. That creates a
 *      Square payment link on the CLUB's account for exactly what is owed, with
 *      order.reference_id = "<kind>:<id>", and redirects them to it.
 *   4. Square's webhook (/api/webhooks/square) carries merchant_id; we re-fetch
 *      the payment with that club's token (the trust boundary — a forged event
 *      fails the fetch) and mark the booking or registration paid.
 *
 * Env: SQUARE_OAUTH_APP_ID, SQUARE_OAUTH_APP_SECRET (the ClubMode Square
 * application); SQUARE_ENVIRONMENT = 'sandbox' to test. The platform
 * SQUARE_ACCESS_TOKEN in lib/square.ts is separate: Sleepy Hollow's own
 * tournament entries.
 */
import crypto from 'crypto';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

const SQUARE_VERSION = '2025-01-23';

/** Everything a checkout can be for. The prefix is the order's reference_id. */
export type PayKind = 'program' | 'court';
const TABLE: Record<PayKind, 'club_program_registrations' | 'court_bookings'> = {
  program: 'club_program_registrations',
  court: 'court_bookings',
};

export const SQUARE_SCOPES = [
  'MERCHANT_PROFILE_READ',
  'PAYMENTS_READ',
  'PAYMENTS_WRITE',
  'ORDERS_READ',
  'ORDERS_WRITE',
];

export function squareOAuthConfigured(): boolean {
  return Boolean(process.env.SQUARE_OAUTH_APP_ID && process.env.SQUARE_OAUTH_APP_SECRET);
}

export function squareBase(): string {
  return (process.env.SQUARE_ENVIRONMENT || 'production').toLowerCase() === 'sandbox'
    ? 'https://connect.squareupsandbox.com'
    : 'https://connect.squareup.com';
}

export function appBase(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || 'https://clubmode.ai').replace(/\/$/, '');
}

export const CALLBACK_PATH = '/api/club-site/payments/callback/square';

// ------------------------------------------------------------------ state

/**
 * The OAuth `state`: which club this connection is for, signed so a stranger
 * can't finish a flow that attaches THEIR Square account to someone else's
 * club. Expires after 30 minutes.
 */
export function signState(clubId: string, userId: string): string {
  const body = Buffer.from(JSON.stringify({ c: clubId, u: userId, t: Date.now() })).toString('base64url');
  const mac = crypto
    .createHmac('sha256', process.env.SQUARE_OAUTH_APP_SECRET || '')
    .update(body)
    .digest('base64url');
  return `${body}.${mac}`;
}

export function readState(state: string | null): { clubId: string; userId: string } | null {
  if (!state || !state.includes('.')) return null;
  const [body, mac] = state.split('.');
  const want = crypto
    .createHmac('sha256', process.env.SQUARE_OAUTH_APP_SECRET || '')
    .update(body)
    .digest('base64url');
  if (mac.length !== want.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(want))) return null;
  try {
    const j = JSON.parse(Buffer.from(body, 'base64url').toString()) as { c: string; u: string; t: number };
    if (Date.now() - j.t > 30 * 60_000) return null;
    return { clubId: j.c, userId: j.u };
  } catch {
    return null;
  }
}

export function authorizeUrl(state: string): string {
  const q = new URLSearchParams({
    client_id: process.env.SQUARE_OAUTH_APP_ID || '',
    scope: SQUARE_SCOPES.join(' '),
    session: 'false',
    state,
    redirect_uri: `${appBase()}${CALLBACK_PATH}`,
  });
  return `${squareBase()}/oauth2/authorize?${q}`;
}

// ------------------------------------------------------------------ tokens

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_at?: string;
  merchant_id: string;
};

async function tokenCall(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(`${squareBase()}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Square-Version': SQUARE_VERSION },
    body: JSON.stringify({
      client_id: process.env.SQUARE_OAUTH_APP_ID,
      client_secret: process.env.SQUARE_OAUTH_APP_SECRET,
      ...body,
    }),
    cache: 'no-store',
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) {
    throw new Error(j?.errors?.[0]?.detail || j?.message || 'Square did not return a token.');
  }
  return j as TokenResponse;
}

export function exchangeCode(code: string): Promise<TokenResponse> {
  return tokenCall({ code, grant_type: 'authorization_code', redirect_uri: `${appBase()}${CALLBACK_PATH}` });
}

/**
 * A usable access token for the club, refreshed when within a day of expiry.
 * Square access tokens last 30 days; the refresh token does not expire.
 */
export async function clubToken(clubId: string): Promise<{ token: string; merchantId: string } | null> {
  const db = getSupabaseAdmin();
  const { data } = await db
    .from('club_payment_tokens')
    .select('access_token, refresh_token, expires_at, merchant_id')
    .eq('club_id', clubId)
    .eq('provider', 'square')
    .maybeSingle();
  const row = data as {
    access_token: string;
    refresh_token: string | null;
    expires_at: string | null;
    merchant_id: string;
  } | null;
  if (!row) return null;

  const soon = row.expires_at && new Date(row.expires_at).getTime() - Date.now() < 24 * 3600_000;
  if (soon && row.refresh_token) {
    const fresh = await tokenCall({ grant_type: 'refresh_token', refresh_token: row.refresh_token });
    await db
      .from('club_payment_tokens')
      .update({
        access_token: fresh.access_token,
        refresh_token: fresh.refresh_token ?? row.refresh_token,
        expires_at: fresh.expires_at ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq('club_id', clubId);
    return { token: fresh.access_token, merchantId: row.merchant_id };
  }
  return { token: row.access_token, merchantId: row.merchant_id };
}

export async function revokeClub(clubId: string): Promise<void> {
  const db = getSupabaseAdmin();
  const tok = await clubToken(clubId).catch(() => null);
  if (tok) {
    // Best-effort: even if Square is unreachable, we forget the token below.
    await fetch(`${squareBase()}/oauth2/revoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Square-Version': SQUARE_VERSION,
        Authorization: `Client ${process.env.SQUARE_OAUTH_APP_SECRET}`,
      },
      body: JSON.stringify({ client_id: process.env.SQUARE_OAUTH_APP_ID, access_token: tok.token }),
    }).catch(() => {});
  }
  await db.from('club_payment_tokens').delete().eq('club_id', clubId);
  await db
    .from('club_payments')
    .update({ provider: 'none', provider_status: 'disconnected', provider_account_id: null, provider_location_id: null, provider_business_name: null })
    .eq('club_id', clubId);
}

// ------------------------------------------------------------------ API calls

export async function squareApi(token: string, path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`${squareBase()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Square-Version': SQUARE_VERSION,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.errors?.[0]?.detail || data?.errors?.[0]?.code || res.statusText);
  }
  return data;
}

/** The merchant's name and its first active location, for the settings screen. */
export async function merchantProfile(token: string, merchantId: string) {
  const [m, l] = await Promise.all([
    squareApi(token, `/v2/merchants/${merchantId}`, { method: 'GET' }).catch(() => ({})),
    squareApi(token, '/v2/locations', { method: 'GET' }),
  ]);
  const loc = (l.locations || []).find((x: any) => x.status === 'ACTIVE') || l.locations?.[0];
  return {
    businessName: (m?.merchant?.business_name as string) || (loc?.business_name as string) || null,
    locationId: (loc?.id as string) || null,
  };
}

// ------------------------------------------------------------------ checkout

/** The stable URL a customer is sent to — safe in emails; the checkout is made on click. */
export function payUrl(kind: PayKind, id: string): string {
  return `${appBase()}/pay/${kind}/${id}`;
}

export type PayTarget = {
  kind: PayKind;
  id: string;
  clubId: string;
  amountCents: number;
  paid: boolean;
  label: string;
  /** Where Square sends them after paying. */
  doneUrl: string;
};

/**
 * Create (or re-open) a Square payment link on the club's own account.
 * The idempotency key is the record + amount, so tapping "Pay" twice reuses one
 * checkout instead of opening two.
 */
export async function openCheckout(t: PayTarget): Promise<string> {
  const db = getSupabaseAdmin();
  const tok = await clubToken(t.clubId);
  if (!tok) throw new Error('This club has not connected Square.');
  const { data: cp } = await db
    .from('club_payments')
    .select('provider_location_id')
    .eq('club_id', t.clubId)
    .maybeSingle();
  let locationId = (cp as { provider_location_id: string | null } | null)?.provider_location_id ?? null;
  if (!locationId) {
    locationId = (await merchantProfile(tok.token, tok.merchantId)).locationId;
    if (!locationId) throw new Error('No active Square location on this account.');
    await db.from('club_payments').update({ provider_location_id: locationId }).eq('club_id', t.clubId);
  }

  const data = await squareApi(tok.token, '/v2/online-checkout/payment-links', {
    method: 'POST',
    body: JSON.stringify({
      idempotency_key: `${t.kind}-${t.id}-${t.amountCents}`,
      order: {
        location_id: locationId,
        reference_id: `${t.kind}:${t.id}`,
        line_items: [
          {
            name: t.label.slice(0, 250),
            quantity: '1',
            base_price_money: { amount: t.amountCents, currency: 'USD' },
          },
        ],
      },
      checkout_options: { redirect_url: t.doneUrl, ask_for_shipping_address: false },
    }),
  });
  const link = data.payment_link;
  if (!link?.url) throw new Error('Square did not return a checkout.');
  await db.from(TABLE[t.kind]).update({ square_order_id: link.order_id }).eq('id', t.id);
  return link.url as string;
}

// ------------------------------------------------------------------ webhook

/**
 * A payment event from a CONNECTED club. Re-fetches the payment with that
 * club's token and, when completed, marks the booking or registration paid.
 * Returns null when the merchant isn't one of ours (the caller then tries the
 * platform account).
 */
export async function settleClubPayment(
  merchantId: string,
  paymentId: string,
): Promise<{ ok: boolean; detail: string } | null> {
  const db = getSupabaseAdmin();
  const { data: row } = await db
    .from('club_payment_tokens')
    .select('club_id')
    .eq('merchant_id', merchantId)
    .maybeSingle();
  const clubId = (row as { club_id: string } | null)?.club_id;
  if (!clubId) return null;

  const tok = await clubToken(clubId);
  if (!tok) return { ok: false, detail: 'no token' };

  let payment: any;
  try {
    payment = (await squareApi(tok.token, `/v2/payments/${paymentId}`, { method: 'GET' })).payment;
  } catch {
    return { ok: false, detail: 'payment not found on this account' };
  }
  if (payment?.status !== 'COMPLETED') return { ok: true, detail: 'not completed yet' };

  const order = payment.order_id
    ? (await squareApi(tok.token, `/v2/orders/${payment.order_id}`, { method: 'GET' }).catch(() => ({}))).order
    : null;
  const ref: string = order?.reference_id || '';
  const [kind, id] = ref.split(':') as [PayKind, string];
  // Not a class or court checkout — e.g. a tournament entry on the same
  // merchant (Sleepy Hollow is both). Null lets the caller's platform path run.
  if (!TABLE[kind] || !id) return null;

  // Scoped to the club the money went to, so a reference_id can't mark another
  // club's booking paid.
  const { error } = await db
    .from(TABLE[kind])
    .update({ payment_status: 'paid', paid_at: new Date().toISOString(), square_order_id: payment.order_id })
    .eq('id', id)
    .eq('club_id', clubId)
    .neq('payment_status', 'paid');
  return error ? { ok: false, detail: error.message } : { ok: true, detail: `${kind} ${id} paid` };
}
