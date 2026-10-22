import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/admin', () => ({ getSupabaseAdmin: () => ({}) }));
vi.mock('@/lib/billing', () => ({ resolveBillingUserId: async (id: string) => id }));
vi.mock('@/lib/assistant/meter', () => ({ paygActive: async () => false }));

import { canSend, priceCents } from './usageMeter';

describe('priceCents', () => {
  it('charges 2¢ an email and 3¢ a text', () => {
    expect(priceCents('email', 1)).toBe(2);
    expect(priceCents('email', 250)).toBe(500);
    expect(priceCents('sms', 1)).toBe(3);
    expect(priceCents('sms', 40)).toBe(120);
  });

  it('never prices zero, negative or fractional sends above what was sent', () => {
    expect(priceCents('email', 0)).toBe(0);
    expect(priceCents('sms', -3)).toBe(0);
    expect(priceCents('email', 2.9)).toBe(4);
  });
});

describe('canSend', () => {
  it('lets everyone send while metering is not enforced', async () => {
    expect(await canSend('any-user')).toBe(true);
  });
});
