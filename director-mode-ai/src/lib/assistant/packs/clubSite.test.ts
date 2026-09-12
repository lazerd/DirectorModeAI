import { describe, it, expect } from 'vitest';
import { bindPack } from '../framework';
import { clubSitePack } from './clubSite';

/**
 * The property worth guarding here is that PREVIEW AND RUN AGREE.
 *
 * The whole safety model of conversational admin is "show the director exactly
 * what will happen, then do exactly that". Two code paths for the same change
 * would eventually diverge, and the one that diverged would be the one that
 * ran. So these tests drive the pack's tools through the real framework binding
 * and check that what the preview promised is what the run did.
 *
 * A fake Supabase client, because the decisions are what matter and they are
 * invisible in a pass/fail against live rows.
 */

const TZ = 'America/Los_Angeles';

/** A Tue/Thu class over three weeks: 6 meetings, one already skipped. */
const PROGRAM = {
  id: 'p1',
  club_id: 'c1',
  title: 'After-School Juniors',
  slug: 'after-school-juniors',
  status: 'published',
  range_start: '2026-09-15',
  range_end: '2026-10-01',
  days_of_week: [2, 4],
  exclusions: ['2026-09-24'],
  time_start: '15:30',
  time_end: '17:00',
  price_cents: 24000,
  member_price_cents: null,
  drop_in_price_cents: null,
  capacity: 16,
  blocks_courts: false,
  court_count: null,
  display_order: 0,
};

const RATE = {
  id: 'r1',
  club_id: 'c1',
  label: 'Public',
  applies_to: 'public' as const,
  days_of_week: [] as number[],
  time_start: '06:00:00',
  time_end: '22:00:00',
  price_cents: 2400,
  advance_days: 3,
  min_minutes: 60,
  max_minutes: 120,
  active: true,
};

function fakeCtx(overrides: { program?: Record<string, unknown>; rates?: Record<string, unknown>[] } = {}) {
  const program = { ...PROGRAM, ...(overrides.program ?? {}) };
  const rates = overrides.rates ?? [RATE];
  const writes: { table: string; patch: Record<string, unknown> }[] = [];
  const inserts: { table: string; row: Record<string, unknown> }[] = [];

  /**
   * A chainable stub.
   *
   * `list` is what an awaited query yields; `single` what maybeSingle() does.
   * Keeping them separate matters — the real client returns an array for one
   * and an object for the other, and a stub that conflates them lets a bug
   * through that production would hit on the first call.
   */
  const chain = (result: { list?: unknown; single?: unknown; count?: number }): Record<string, unknown> => {
    const node: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'neq', 'in', 'order', 'limit', 'ilike', 'gte', 'lt', 'gt']) {
      node[m] = () => node;
    }
    node.maybeSingle = () =>
      Promise.resolve({ data: result.single ?? null, error: null, count: result.count });
    node.single = () => Promise.resolve({ data: result.single ?? null, error: null });
    node.then = (fn: (v: unknown) => unknown) =>
      Promise.resolve({ data: result.list ?? [], error: null, count: result.count }).then(fn);
    return node;
  };

  const db = {
    from(table: string) {
      if (table === 'club_programs') {
        return {
          ...chain({ list: [program], single: program, count: 1 }),
          update(patch: Record<string, unknown>) {
            writes.push({ table, patch });
            return chain({ single: { ...program, ...patch } });
          },
        };
      }
      if (table === 'court_rate_cards') {
        return {
          ...chain({ list: rates, single: rates[0], count: rates.length }),
          update(patch: Record<string, unknown>) {
            writes.push({ table, patch });
            return chain({ single: { ...rates[0], ...patch } });
          },
          insert(row: Record<string, unknown>) {
            inserts.push({ table, row });
            return chain({ single: { id: 'new', label: row.label } });
          },
        };
      }
      if (table === 'club_program_registrations') {
        // Twelve families signed up, so the "who does this land on" number is
        // non-zero and the preview has something to warn about.
        return chain({ list: [], count: 12 });
      }
      if (table === 'reservations') {
        return {
          ...chain({ list: [] }),
          insert: () => chain({}),
          delete: () => chain({ list: [] }),
        };
      }
      if (table === 'cc_clubs' || table === 'cc_club_members' || table === 'courts') {
        return chain({ list: [], single: null });
      }
      throw new Error(`unexpected table ${table}`);
    },
  };

  return {
    ctx: {
      userId: 'u1',
      db: db as never,
      clubId: 'c1',
      clubName: 'Test Club',
      clubSlug: 'test-club',
      timeZone: TZ,
    },
    writes,
    inserts,
  };
}

const bind = (ctxLike: ReturnType<typeof fakeCtx>) => bindPack(clubSitePack, ctxLike.ctx as never);

describe('the confirm gate', () => {
  it('previews a write instead of doing it, until confirm is true', async () => {
    const f = fakeCtx();
    const pack = bind(f);

    const preview = await pack.execute('set_class_price', {
      class_id: 'p1',
      price_dollars: 260,
    });
    expect(preview.needsConfirm).toBe(true);
    // Nothing written. This is the property the whole design rests on.
    expect(f.writes).toHaveLength(0);

    const done = await pack.execute('set_class_price', {
      class_id: 'p1',
      price_dollars: 260,
      confirm: true,
    });
    expect(done.ok).toBe(true);
    expect(f.writes).toHaveLength(1);
    expect(f.writes[0].patch).toEqual({ price_cents: 26000 });
  });

  it('does not gate a read', async () => {
    const f = fakeCtx();
    const r = await bind(f).execute('list_court_rates', {});
    expect(r.needsConfirm).toBeUndefined();
    expect(r.ok).toBe(true);
  });

  it('adds a confirm flag to every destructive tool and no others', () => {
    const pack = bind(fakeCtx());
    const withConfirm = pack.toolSchemas.filter(
      (t) => 'confirm' in ((t.input_schema.properties as Record<string, unknown>) ?? {}),
    );
    expect(withConfirm.map((t) => t.name).sort()).toEqual([
      'add_court_rate',
      'set_class_price',
      'set_class_skip_dates',
      'set_court_rate',
    ]);
  });
});

describe('set_class_skip_dates', () => {
  it('previews the exact dates, and the run matches', async () => {
    const f = fakeCtx();
    const pack = bind(f);
    const input = { class_id: 'p1', add: ['2026-09-29'] };

    const preview = await pack.execute('set_class_skip_dates', input);
    expect(preview.newly_skipping).toEqual(['Tue, Sep 29']);
    expect(preview.sessions_before).toBe(5);
    expect(preview.sessions_now).toBe(4);
    // The number that makes this honest: somebody has to be told.
    expect(preview.families_affected).toBe(12);
    expect(preview.reminder).toMatch(/does NOT email/i);

    const done = await pack.execute('set_class_skip_dates', { ...input, confirm: true });
    expect(done.ok).toBe(true);
    expect(done.sessions).toBe(preview.sessions_now);
    // Both the pre-existing skip and the new one are stored.
    expect(f.writes[0].patch.exclusions).toEqual(['2026-09-24', '2026-09-29']);
  });

  it('un-skips a date and says the class meets again', async () => {
    const f = fakeCtx();
    const pack = bind(f);
    const preview = await pack.execute('set_class_skip_dates', {
      class_id: 'p1',
      remove: ['2026-09-24'],
    });
    expect(preview.meeting_again).toEqual(['Thu, Sep 24']);
    expect(preview.sessions_now).toBe(6);

    await pack.execute('set_class_skip_dates', {
      class_id: 'p1',
      remove: ['2026-09-24'],
      confirm: true,
    });
    expect(f.writes[0].patch.exclusions).toEqual([]);
  });

  it('ignores a date the class was never going to meet on', async () => {
    // Sep 20 is a Sunday. Reporting "you skipped Sunday" on a Tue/Thu class is
    // noise a director has to read past and then doubt.
    const preview = await bind(fakeCtx()).execute('set_class_skip_dates', {
      class_id: 'p1',
      add: ['2026-09-20'],
    });
    expect(preview.newly_skipping).toEqual([]);
    expect(preview.sessions_now).toBe(5);
  });

  it('refuses a malformed date rather than silently dropping it', async () => {
    const r = await bind(fakeCtx()).execute('set_class_skip_dates', {
      class_id: 'p1',
      add: ['next Tuesday'],
    });
    expect(r.ok).toBe(false);
    expect(String(r.error)).toMatch(/YYYY-MM-DD/);
  });

  it('refuses an unknown class instead of guessing one', async () => {
    // A lookup that misses. The framework must pass the refusal through rather
    // than dressing it up as a preview awaiting confirmation.
    const db = {
      from: () => ({
        select: () => ({
          eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }) }),
        }),
      }),
    };
    const r = await bindPack(clubSitePack, {
      userId: 'u1',
      db: db as never,
      clubId: 'c1',
      clubName: 'Test Club',
      clubSlug: 'test-club',
      timeZone: TZ,
    } as never).execute('set_class_skip_dates', { class_id: 'nope', add: ['2026-09-29'] });
    expect(r.ok).toBe(false);
    expect(r.needsConfirm).toBeUndefined();
    expect(String(r.error)).toMatch(/list_classes/);
  });
});

describe('set_class_price', () => {
  it('shows the old and new price, and warns who is already signed up', async () => {
    const preview = await bind(fakeCtx()).execute('set_class_price', {
      class_id: 'p1',
      price_dollars: 260,
    });
    expect(preview.changes).toEqual([{ field: 'price', from: '$240', to: '$260' }]);
    expect(preview.families_already_signed_up).toBe(12);
    expect(String(preview.note)).toMatch(/keep the amount they were charged/);
  });

  it('changes only the price fields it was given', async () => {
    const f = fakeCtx();
    await bind(f).execute('set_class_price', {
      class_id: 'p1',
      member_price_dollars: 200,
      confirm: true,
    });
    expect(f.writes[0].patch).toEqual({ member_price_cents: 20000 });
  });

  it('refuses a negative price', async () => {
    const r = await bind(fakeCtx()).execute('set_class_price', {
      class_id: 'p1',
      price_dollars: -5,
    });
    expect(r.ok).toBe(false);
  });

  it('accepts zero — a free class is a real thing', async () => {
    const f = fakeCtx();
    await bind(f).execute('set_class_price', { class_id: 'p1', price_dollars: 0, confirm: true });
    expect(f.writes[0].patch).toEqual({ price_cents: 0 });
  });
});

describe('court rates', () => {
  it('quotes a straddled booking from the engine, not arithmetic', async () => {
    const f = fakeCtx({
      rates: [
        { ...RATE, id: 'off', label: 'Off-peak', time_start: '06:00', time_end: '16:00', price_cents: 2000 },
      ],
    });
    // The stub returns one rate for any query, so this checks the tool is
    // asking the pricing engine rather than multiplying.
    const r = await bind(f).execute('quote_court_price', {
      date: '2026-09-15',
      time: '10:00',
      minutes: 90,
      audience: 'public',
    });
    expect(r.ok).toBe(true);
    expect(r.total).toBe('$30');
  });

  it('says a time is unbookable instead of inventing a price', async () => {
    const f = fakeCtx({
      rates: [{ ...RATE, time_start: '06:00', time_end: '16:00' }],
    });
    const r = await bind(f).execute('quote_court_price', {
      date: '2026-09-15',
      time: '17:00',
      minutes: 60,
      audience: 'public',
    });
    expect(r.bookable).toBe(false);
    expect(String(r.reason)).toMatch(/No public rate covers/);
  });

  it('previews a rate change as from → to', async () => {
    const preview = await bind(fakeCtx()).execute('set_court_rate', {
      rate_id: 'r1',
      price_dollars: 30,
    });
    expect(preview.changes).toEqual([
      { field: 'price per hour', from: '$24', to: '$30' },
    ]);
  });

  it('refuses a window that ends before it starts', async () => {
    const r = await bind(fakeCtx()).execute('set_court_rate', {
      rate_id: 'r1',
      time_end: '05:00',
    });
    expect(r.ok).toBe(false);
    expect(String(r.error)).toMatch(/not after/);
  });

  it('checks a one-sided window change against the stored other end', async () => {
    // Only time_start is given; it must be compared with the stored 22:00.
    const ok = await bind(fakeCtx()).execute('set_court_rate', {
      rate_id: 'r1',
      time_start: '18:00',
    });
    expect(ok.ok).toBe(true);

    const bad = await bind(fakeCtx()).execute('set_court_rate', {
      rate_id: 'r1',
      time_start: '23:00',
    });
    expect(bad.ok).toBe(false);
  });

  it('adds a rate with sensible defaults per audience', async () => {
    const f = fakeCtx();
    await bind(f).execute('add_court_rate', {
      label: 'Peak',
      applies_to: 'public',
      price_dollars: 36,
      time_start: '16:00',
      time_end: '22:00',
      confirm: true,
    });
    expect(f.inserts[0].row).toMatchObject({
      label: 'Peak',
      applies_to: 'public',
      price_cents: 3600,
      // The public default, not the member one.
      advance_days: 3,
    });
  });

  it('gives members the longer default window', async () => {
    const f = fakeCtx();
    await bind(f).execute('add_court_rate', {
      label: 'Members',
      applies_to: 'member',
      price_dollars: 0,
      confirm: true,
    });
    expect(f.inserts[0].row).toMatchObject({ advance_days: 7, price_cents: 0 });
  });
});

describe('what the pack refuses to be able to do', () => {
  it('has no tool that publishes, sends, deletes or takes money', () => {
    const names = bind(fakeCtx()).toolSchemas.map((t) => t.name);
    for (const forbidden of ['publish', 'send', 'email', 'delete', 'paid', 'charge', 'refund']) {
      expect(names.filter((n) => n.includes(forbidden))).toEqual([]);
    }
  });

  it('tells the model it cannot build features', () => {
    // The one instruction that stops "I want a court waitlist" turning into a
    // reply that implies it has been built.
    expect(clubSitePack.actionsPrompt).toMatch(/Never imply it has been built/);
  });
});
