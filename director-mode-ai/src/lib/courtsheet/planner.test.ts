import { describe, it, expect } from 'vitest';
import { signPlanId, verifyPlanId, PlanTooLargeError, planBooking } from './planner';
import type { BookingIntent, Court, OperatingHours } from './types';

describe('signPlanId / verifyPlanId', () => {
  it('round-trips a valid signature', () => {
    const signed = signPlanId('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'club-1');
    expect(verifyPlanId(signed, 'club-1')).toBe('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
  });

  it('rejects a tampered signature', () => {
    const signed = signPlanId('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'club-1');
    const [uuid, hmac] = signed.split('.');
    const tampered = `${uuid}.${hmac.replace(/./g, '0').slice(0, hmac.length)}`;
    expect(verifyPlanId(tampered, 'club-1')).toBeNull();
  });

  it('rejects a signature bound to a different club', () => {
    const signed = signPlanId('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'club-1');
    expect(verifyPlanId(signed, 'club-2')).toBeNull();
  });
});

describe('PlanTooLargeError', () => {
  it('is thrown when expanded instances exceed the cap', async () => {
    const courts: Court[] = Array.from({ length: 8 }, (_, i) => ({
      id: `court-${i + 1}`,
      club_id: 'club-1',
      number: i + 1,
      name: null,
      sports: ['tennis'],
      surface: 'hard',
      indoor: false,
      status: 'active' as const,
      display_order: i + 1,
    }));

    // 264 instances against a cap of 100.
    const intent: BookingIntent = {
      club_id: 'club-1',
      courts: [1, 2, 3, 4, 5, 6],
      date_range: { start: '2026-06-01', end: '2026-07-31' },
      days_of_week: [1, 2, 3, 4, 5],
      time_range: { start: '08:00', end: '12:00' },
      type: 'camp',
      title: 'Summer Camp',
    };

    const db = mockDb();
    const operating_hours: OperatingHours = {};

    await expect(
      planBooking(
        intent,
        {
          db: db as any,
          club: { id: 'club-1', timezone: 'America/Los_Angeles', operating_hours },
          courts,
          maxInstances: 100,
        }
      )
    ).rejects.toBeInstanceOf(PlanTooLargeError);
  });
});

// Minimal supabase-client mock that just returns empty arrays.
function mockDb() {
  const chain = {
    from() {
      return chain;
    },
    select() {
      return chain;
    },
    eq() {
      return chain;
    },
    neq() {
      return chain;
    },
    lt() {
      return chain;
    },
    gt() {
      return chain;
    },
    gte() {
      return chain;
    },
    in() {
      return chain;
    },
    order() {
      return chain;
    },
    limit() {
      return chain;
    },
    maybeSingle() {
      return Promise.resolve({ data: null, error: null });
    },
    single() {
      return Promise.resolve({ data: null, error: null });
    },
    then(resolve: any) {
      resolve({ data: [], error: null });
    },
  };
  return chain;
}
