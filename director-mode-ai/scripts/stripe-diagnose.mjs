// One-off Stripe Connect diagnostic for the JTT tournament checkout failure.
// Prints ONLY non-secret status fields. Usage:
//   node scripts/stripe-diagnose.mjs [cs_live_session_id]
import Stripe from 'stripe';
import { readFileSync } from 'node:fs';

const env = {};
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const stripe = new Stripe(env.STRIPE_SECRET_KEY);
const ACCT = 'acct_1TTYBjIjgUBjpWNi';
const sessionId = process.argv[2];

const keyMode = env.STRIPE_SECRET_KEY.startsWith('sk_live_') ? 'LIVE' : env.STRIPE_SECRET_KEY.startsWith('sk_test_') ? 'TEST' : 'UNKNOWN';
console.log(`Platform secret key mode: ${keyMode}`);

try {
  const acct = await stripe.accounts.retrieve(ACCT);
  console.log('\n=== Connected account', ACCT, '===');
  console.log('type:', acct.type);
  console.log('charges_enabled:', acct.charges_enabled);
  console.log('payouts_enabled:', acct.payouts_enabled);
  console.log('details_submitted:', acct.details_submitted);
  console.log('capabilities:', JSON.stringify(acct.capabilities));
  console.log('requirements.disabled_reason:', acct.requirements?.disabled_reason);
  console.log('requirements.currently_due:', JSON.stringify(acct.requirements?.currently_due));
  console.log('requirements.past_due:', JSON.stringify(acct.requirements?.past_due));
  console.log('future_requirements.currently_due:', JSON.stringify(acct.future_requirements?.currently_due));
} catch (e) {
  console.log('\nAccount retrieve FAILED:', e.message);
}

if (sessionId) {
  try {
    const s = await stripe.checkout.sessions.retrieve(sessionId, { stripeAccount: ACCT });
    console.log('\n=== Checkout session', sessionId, '(on connected account) ===');
    console.log('status:', s.status, '| payment_status:', s.payment_status);
    console.log('amount_total:', s.amount_total, s.currency);
    console.log('expires_at:', s.expires_at ? new Date(s.expires_at * 1000).toISOString() : null);
    console.log('url present:', !!s.url);
  } catch (e) {
    console.log('\nSession retrieve on connected account FAILED:', e.message);
    // Maybe it was created on the platform, not the connected account.
    try {
      const s2 = await stripe.checkout.sessions.retrieve(sessionId);
      console.log('...but it EXISTS on the PLATFORM account. status:', s2.status, 'payment_status:', s2.payment_status);
    } catch (e2) {
      console.log('...also not found on platform:', e2.message);
    }
  }
}
