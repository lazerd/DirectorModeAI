import { describe, expect, it, vi, beforeEach } from 'vitest';

const emails: Record<string, string> = { owner: 'darrinjco@gmail.com', club: 'director@club.test' };
let cardOnFile = false;

vi.mock('@/lib/supabase/admin', () => ({
  getSupabaseAdmin: () => ({
    auth: { admin: { getUserById: async (id: string) => ({ data: { user: { email: emails[id] } } }) } },
  }),
}));
vi.mock('@/lib/billing', () => ({ resolveBillingUserId: async (id: string) => id }));
vi.mock('@/lib/assistant/meter', () => ({ paygActive: async () => cardOnFile }));

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
  beforeEach(() => {
    process.env.PLATFORM_OWNER_EMAILS = 'darrinjco@gmail.com';
    cardOnFile = false;
  });

  it('holds a club with no card on file', async () => {
    expect(await canSend('club')).toBe(false);
  });

  it('lets a club with a card send', async () => {
    cardOnFile = true;
    expect(await canSend('club')).toBe(true);
  });

  it('never blocks the platform owner', async () => {
    expect(await canSend('owner')).toBe(true);
  });
});
