import { describe, it, expect, beforeAll } from 'vitest';
import { signState, readState, payUrl } from './squareConnect';
import { paymentOffer, DEFAULT_PAYMENTS } from './courts/payments';

beforeAll(() => {
  process.env.SQUARE_OAUTH_APP_SECRET = 'test-secret';
});

describe('OAuth state', () => {
  it('round-trips the club and user', () => {
    expect(readState(signState('club-1', 'user-1'))).toEqual({ clubId: 'club-1', userId: 'user-1' });
  });
  it('rejects a tampered club id', () => {
    const [body, mac] = signState('club-1', 'user-1').split('.');
    const forged = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString()), c: 'club-2' }),
    ).toString('base64url');
    expect(readState(`${forged}.${mac}`)).toBeNull();
  });
  it('rejects garbage', () => {
    expect(readState(null)).toBeNull();
    expect(readState('nope')).toBeNull();
  });
});

describe('connected Square beats every pasted link', () => {
  const connected = { ...DEFAULT_PAYMENTS, provider: 'square' as const, provider_status: 'connected' as const, payment_link: 'https://square.link/u/abc' };
  it('uses the record checkout when there is one', () => {
    const o = paymentOffer({ amountCents: 2400, clubPayments: connected, surface: 'court', checkoutUrl: payUrl('court', 'b1') });
    expect(o).toMatchObject({ kind: 'link', label: 'Pay by card' });
    expect(o.kind === 'link' && o.url).toMatch(/\/pay\/court\/b1$/);
  });
  it('even over a class’s own link', () => {
    const o = paymentOffer({ amountCents: 9000, clubPayments: connected, surface: 'program', ownLink: 'https://paypal.me/x', checkoutUrl: payUrl('program', 'r1') });
    expect(o.kind === 'link' && o.url).toMatch(/\/pay\/program\/r1$/);
  });
  it('falls back to the pasted link when not connected', () => {
    const o = paymentOffer({ amountCents: 2400, clubPayments: { ...connected, provider_status: 'disconnected' }, surface: 'court', checkoutUrl: payUrl('court', 'b1') });
    expect(o.kind === 'link' && o.url).toBe('https://square.link/u/abc');
  });
  it('asks nothing of a free booking', () => {
    expect(paymentOffer({ amountCents: 0, clubPayments: connected, surface: 'court', checkoutUrl: payUrl('court', 'b1') }).kind).toBe('free');
  });
});
