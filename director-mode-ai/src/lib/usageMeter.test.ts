import { describe, expect, it, vi, beforeEach } from 'vitest';

const emails: Record<string, string> = { owner: 'darrinjco@gmail.com', club: 'director@club.test' };
let cardOnFile = false;
let sponsorCard = false;
let emailsSent = 0;

// Just enough of the query builder for usage_events (units) and club_sponsors.
function table(name: string) {
  const q: any = {
    select: () => q,
    eq: () => q,
    gte: () => q,
    maybeSingle: async () => ({ data: name === 'club_sponsors' ? { sponsor_user_id: 'sponsor' } : null }),
    then: (res: (v: unknown) => unknown) => res({ data: name === 'usage_events' ? [{ units: emailsSent, billed_cents: 0 }] : [] }),
  };
  return q;
}

vi.mock('@/lib/supabase/admin', () => ({
  getSupabaseAdmin: () => ({
    auth: { admin: { getUserById: async (id: string) => ({ data: { user: { email: emails[id] } } }) } },
    from: (name: string) => table(name),
  }),
}));
vi.mock('@/lib/billing', () => ({ resolveBillingUserId: async (id: string) => id }));
vi.mock('@/lib/assistant/meter', () => ({
  paygActive: async (_db: unknown, id: string) => (id === 'sponsor' ? sponsorCard : cardOnFile),
}));

import { canSend, cappedEmailCents, freeEmailUnits, priceCents } from './usageMeter';

describe('priceCents', () => {
  it('charges 1¢ an email and 3¢ a text', () => {
    expect(priceCents('email', 1)).toBe(1);
    expect(priceCents('email', 250)).toBe(250);
    expect(priceCents('sms', 1)).toBe(3);
    expect(priceCents('sms', 40)).toBe(120);
  });

  it('never prices zero, negative or fractional sends above what was sent', () => {
    expect(priceCents('email', 0)).toBe(0);
    expect(priceCents('sms', -3)).toBe(0);
    expect(priceCents('email', 2.9)).toBe(2);
  });
});

describe('cappedEmailCents', () => {
  it('bills a penny an email until the club hits $30 for the month', () => {
    expect(cappedEmailCents(1, 0)).toBe(1);
    expect(cappedEmailCents(500, 2000)).toBe(500);
    expect(cappedEmailCents(500, 2800)).toBe(200);
    expect(cappedEmailCents(1, 3000)).toBe(0);
    expect(cappedEmailCents(10_000, 0)).toBe(3000);
  });
});

describe('freeEmailUnits', () => {
  it('uses the club\'s 1,000 free emails first', () => {
    expect(freeEmailUnits(10, 0)).toBe(10);
    expect(freeEmailUnits(50, 980)).toBe(20);
    expect(freeEmailUnits(5, 1000)).toBe(0);
    expect(freeEmailUnits(5, 2400)).toBe(0);
  });
});

describe('canSend', () => {
  beforeEach(() => {
    process.env.PLATFORM_OWNER_EMAILS = 'darrinjco@gmail.com';
    cardOnFile = false;
    sponsorCard = false;
    emailsSent = 1000;
  });

  it('holds a club with no card once its free emails are used', async () => {
    expect(await canSend('club')).toBe(false);
  });

  it('lets a club with no card send emails until 1,000, but never texts', async () => {
    emailsSent = 999;
    expect(await canSend('club')).toBe(true);
    expect(await canSend('club', 'sms')).toBe(false);
  });

  it('lets a sponsored club send', async () => {
    sponsorCard = true;
    expect(await canSend('club')).toBe(true);
    expect(await canSend('club', 'sms')).toBe(true);
  });

  it('lets a club with a card send', async () => {
    cardOnFile = true;
    expect(await canSend('club')).toBe(true);
  });

  it('never blocks the platform owner', async () => {
    expect(await canSend('owner')).toBe(true);
  });
});
