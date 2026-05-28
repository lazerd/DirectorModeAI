/**
 * AI dispatcher tests — verify tool input shapes produce the right Plan
 * for the canonical 270-instance camp sentence and the §7.4 utterances.
 *
 * Anthropic itself is NOT exercised here — these tests feed pre-parsed
 * tool inputs straight to dispatch(). The chat route's prompt-to-tool
 * step is verified by manual smoke tests + Anthropic's own model
 * benchmarks.
 */

import { describe, it, expect, vi } from 'vitest';
import { dispatch, type DispatchContext } from './dispatch';
import type { Court, OperatingHours, Club } from '../types';

function fakeCourts(n: number): Court[] {
  return Array.from({ length: n }, (_, i) => ({
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
}

function fakeClub(): Club {
  return {
    id: 'club-1',
    slug: 'test',
    name: 'Test Club',
    timezone: 'America/Los_Angeles',
    operating_hours: {} as OperatingHours,
    is_public: false,
    owner_id: 'u1',
  };
}

function fakeEngine(opts: { courts?: Court[]; existing?: any[] } = {}) {
  const courts = opts.courts ?? fakeCourts(8);
  const club = fakeClub();
  const existing = opts.existing ?? [];

  // Mock the supabase-like db on the engine for fetch operations.
  const chain = (rows: any[] = []) => {
    const c: any = {
      from: () => c,
      select: () => c,
      eq: () => c,
      neq: () => c,
      lt: () => c,
      gt: () => c,
      gte: () => c,
      in: () => c,
      order: () => c,
      limit: () => c,
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
      single: () => Promise.resolve({ data: null, error: null }),
      then: (resolve: any) => resolve({ data: rows, error: null }),
    };
    return c;
  };

  return {
    getClub: () => club,
    getCourts: () => courts,
    computeBookingPlan: vi.fn(async (intent: any) => {
      // Mimic the engine's expansion → instances → plan summary.
      const { expandSeries } = await import('../recurrence');
      const result = expandSeries(intent, {
        timezone: club.timezone,
        courts,
        operating_hours: club.operating_hours,
      });
      return {
        plan_id: 'plan-fake',
        club_id: club.id,
        toCreate: result.instances,
        toModify: [],
        toCancel: [],
        conflicts: [],
        summary: {
          instance_count: result.instances.length,
          court_count: new Set(result.instances.map((i) => i.court_id)).size,
          day_count: new Set(result.instances.map((i) => i.starts_at.slice(0, 10))).size,
          spans: 'test span',
        },
        intent,
      };
    }),
    computeMutationPlan: vi.fn(async (mut: any) => ({
      plan_id: 'plan-fake-mut',
      club_id: club.id,
      toCreate: [],
      toModify: mut.kind === 'modify' ? [{ reservation_id: 'r1', changes: mut.changes }] : [],
      toCancel: mut.kind === 'cancel' ? [{ reservation_id: 'r1' }] : [],
      conflicts: [],
      summary: { instance_count: 1, court_count: 1, day_count: 1, spans: 'test' },
    })),
    availability: vi.fn(async () => [
      { court_id: 'court-4', court_label: 'Court 4', date: '2026-06-15', start: '13:00', end: '15:00', duration_minutes: 120, starts_at_utc: '', ends_at_utc: '' },
    ]),
    db: chain(existing),
  };
}

describe('dispatch — canonical summer camp', () => {
  it('produces a 270-instance Plan for the canonical sentence', async () => {
    const engine = fakeEngine();
    const ctx: DispatchContext = { engine: engine as any, todayISO: '2026-05-15' };

    const result = await dispatch(
      'book',
      {
        courts: [1, 2, 3, 4, 5, 6],
        date_range: { start: '2026-06-01', end: '2026-07-31' },
        days_of_week: [1, 2, 3, 4, 5],
        time_range: { start: '08:00', end: '12:00' },
        type: 'camp',
        title: 'Summer Camp',
      },
      ctx
    );

    expect(result.kind).toBe('plan');
    if (result.kind === 'plan') {
      expect(result.plan.summary.instance_count).toBe(270);
      expect(result.intent_summary).toContain('Summer Camp');
    }
  });
});

describe('dispatch — §7.4 utterances', () => {
  it('query_availability returns slots (no write)', async () => {
    const engine = fakeEngine();
    const ctx: DispatchContext = { engine: engine as any, todayISO: '2026-06-14' };
    const result = await dispatch(
      'query_availability',
      {
        date_range: { start: '2026-06-15', end: '2026-06-15' },
        courts: [4],
        time_range: { start: '12:00', end: '18:00' },
      },
      ctx
    );
    expect(result.kind).toBe('slots');
    if (result.kind === 'slots') {
      expect(result.slots.length).toBeGreaterThan(0);
      expect(result.slots[0].court).toBe('Court 4');
    }
  });

  it('move emits a Plan with a target court change', async () => {
    const engine = fakeEngine();
    const ctx: DispatchContext = { engine: engine as any, todayISO: '2026-06-14' };
    const result = await dispatch(
      'move',
      {
        selector: {
          days_of_week: [2],
          time_range: { start: '09:00', end: '10:00' },
          title_match: 'clinic',
        },
        target: { courts: [3] },
      },
      ctx
    );
    expect(result.kind).toBe('plan');
    expect(engine.computeMutationPlan).toHaveBeenCalled();
  });

  it('cancel scope=range emits a cancel Plan', async () => {
    const engine = fakeEngine();
    const ctx: DispatchContext = { engine: engine as any, todayISO: '2026-07-01' };
    const result = await dispatch(
      'cancel',
      {
        selector: {
          days_of_week: [5],
          type: 'camp',
          date_range: { start: '2026-07-01', end: '2026-07-31' },
        },
        scope: 'range',
      },
      ctx
    );
    expect(result.kind).toBe('plan');
    if (result.kind === 'plan') {
      expect(result.plan.toCancel.length).toBeGreaterThan(0);
    }
  });

  it('block_courts emits a maintenance Plan', async () => {
    const engine = fakeEngine();
    const ctx: DispatchContext = { engine: engine as any, todayISO: '2026-06-14' };
    const result = await dispatch(
      'block_courts',
      {
        courts: [7, 8],
        date_range: { start: '2026-06-15', end: '2026-06-22' },
        reason: 'Resurfacing',
        kind: 'maintenance',
      },
      ctx
    );
    expect(result.kind).toBe('plan');
    if (result.kind === 'plan') {
      // 2 courts × 8 days = 16 instances.
      expect(result.plan.summary.instance_count).toBe(16);
      expect(result.plan.toCreate[0].type).toBe('maintenance');
    }
  });
});

describe('dispatch — missing required fields', () => {
  it('book without time_range returns an error', async () => {
    const engine = fakeEngine();
    const ctx: DispatchContext = { engine: engine as any, todayISO: '2026-06-14' };
    const result = await dispatch(
      'book',
      {
        courts: [1],
        date_range: { start: '2026-06-15', end: '2026-06-15' },
        type: 'camp',
        title: 'Camp',
      },
      ctx
    );
    expect(result.kind).toBe('error');
  });

  it('cancel without scope returns an error', async () => {
    const engine = fakeEngine();
    const ctx: DispatchContext = { engine: engine as any, todayISO: '2026-06-14' };
    const result = await dispatch('cancel', { selector: {} }, ctx);
    expect(result.kind).toBe('error');
  });
});
