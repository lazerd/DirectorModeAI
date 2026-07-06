// Checks the PLATFORM Stripe account (the one behind STRIPE_SECRET_KEY that
// collects ClubMode subscription revenue) — separate from the rejected Connect
// account used for tournament payouts. Prints non-secret status only.
import { readFileSync } from 'node:fs';

const env = {};
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const KEY = env.STRIPE_SECRET_KEY;
const H = { Authorization: `Bearer ${KEY}`, 'Stripe-Version': '2024-06-20' };

async function sget(path) {
  const r = await fetch(`https://api.stripe.com${path}`, { headers: H });
  return { ok: r.ok, status: r.status, data: await r.json().catch(() => ({})) };
}

console.log('Key mode:', KEY.startsWith('sk_live_') ? 'LIVE' : KEY.startsWith('sk_test_') ? 'TEST' : '?');

// The platform account itself (GET /v1/account).
const acct = await sget('/v1/account');
if (!acct.ok) {
  console.log('\nGET /v1/account FAILED:', acct.status, acct.data?.error?.message);
} else {
  const a = acct.data;
  console.log('\n=== PLATFORM account', a.id, '===');
  console.log('business:', a.business_profile?.name || a.settings?.dashboard?.display_name || '(none)');
  console.log('charges_enabled:', a.charges_enabled);
  console.log('payouts_enabled:', a.payouts_enabled);
  console.log('details_submitted:', a.details_submitted);
  console.log('requirements.disabled_reason:', a.requirements?.disabled_reason ?? null);
  console.log('requirements.currently_due:', JSON.stringify(a.requirements?.currently_due ?? []));
  console.log('card_payments capability:', a.capabilities?.card_payments ?? '(n/a)');
}

// Can we still transact? Active subscriptions + prices.
const subs = await sget('/v1/subscriptions?status=active&limit=100');
if (subs.ok) console.log('\nActive subscriptions on platform:', subs.data.data?.length ?? 0);
else console.log('\nsubscriptions list failed:', subs.data?.error?.message);

const prices = await sget('/v1/prices?active=true&limit=10');
if (prices.ok) {
  console.log('Active prices:', (prices.data.data || []).map(p => `${p.id} (${p.unit_amount ? '$' + (p.unit_amount / 100) : '?'}/${p.recurring?.interval || 'one-time'})`).join(', ') || '(none)');
}
