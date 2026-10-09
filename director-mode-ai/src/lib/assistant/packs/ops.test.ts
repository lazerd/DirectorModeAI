import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Ops pack: PREVIEW AND RUN AGREE, nothing is written or SENT until confirm,
 * and every read and write stays inside the director's club. Driven through
 * the real framework binding against an in-memory Supabase stand-in that
 * actually filters. The campaign engine (the only send path) is mocked so a
 * live send is observable.
 */

const h = vi.hoisted(() => ({ live: [] as any[], restringCalls: [] as any[] }));

vi.mock('@/lib/campaigns/sources', () => {
  const base = (user: { id: string; email?: string | null }) => ({
    ownerId: user.id,
    clubName: 'Profile Org',
    senderName: 'Darrin',
    replyTo: user.email || 'noreply@mail.clubmode.ai',
    title: 'Stringing',
    liveUrl: '',
    liveUrlLabel: '',
    deadlineNote: null,
    stats: [],
    everyone: [],
    nudge: [],
    copy: { updateSubject: '', updateIntro: '', nudgeSubject: "Your racket's ready for pickup 🎾", nudgeLead: () => 'ready' },
  });
  return {
    stringingCampaign: vi.fn(async (user: any) => ({ ok: true, data: base(user) })),
    stringingRestringCampaign: vi.fn(async (id: string, user: any) => {
      h.restringCalls.push({ id, user });
      return {
        ok: true,
        data: {
          ...base(user),
          nudge: [{ email: 'gabe@x.com', firstName: 'Gabe', played: null, target: null, outstanding: [{ label: "It's been 91 days since your last string job", contact: '' }] }],
        },
      };
    }),
  };
});

vi.mock('@/lib/campaigns/core', () => ({
  runCampaign: vi.fn(async (d: any, kind: string, mode: string) => {
    if (mode === 'preview') return { mode, kind, count: d.nudge.length, recipients: d.nudge.map((n: any) => n.email), subject: d.copy.nudgeSubject };
    h.live.push(d);
    return { mode: 'live', kind, attempted: d.nudge.length, sent: d.nudge.length, failures: [] };
  }),
}));

import { bindPack } from '../framework';
import { opsPack, monthBounds } from './ops';

const TZ = 'America/Los_Angeles';
type Row = Record<string, any>;

function fakeDb(seed: Record<string, Row[]>) {
  const tables: Record<string, Row[]> = {};
  for (const [k, v] of Object.entries(seed)) tables[k] = v.map((r) => ({ ...r }));
  const log: { op: string; table: string; payload?: any }[] = [];
  let seq = 0;

  function from(table: string) {
    const rows = (tables[table] ??= []);
    let op: 'select' | 'insert' | 'update' | 'delete' = 'select';
    let payload: any;
    const filters: ((r: Row) => boolean)[] = [];
    const orders: { c: string; asc: boolean }[] = [];
    let limit: number | undefined;

    const exec = async () => {
      if (op === 'insert') {
        const items = (Array.isArray(payload) ? payload : [payload]).map((p: Row) => ({ id: `new-${++seq}`, ...p }));
        rows.push(...items);
        log.push({ op, table, payload });
        return { data: items, error: null, count: items.length };
      }
      let hit = rows.filter((r) => filters.every((f) => f(r)));
      if (op === 'update') {
        for (const r of hit) Object.assign(r, payload);
        log.push({ op, table, payload: { ...payload, _ids: hit.map((r) => r.id) } });
        return { data: hit, error: null, count: hit.length };
      }
      if (op === 'delete') {
        for (const r of hit) rows.splice(rows.indexOf(r), 1);
        log.push({ op, table });
        return { data: hit, error: null, count: hit.length };
      }
      for (const o of [...orders].reverse())
        hit = [...hit].sort((a, b) => String(a[o.c] ?? '').localeCompare(String(b[o.c] ?? '')) * (o.asc ? 1 : -1));
      if (limit != null) hit = hit.slice(0, limit);
      return { data: hit, error: null, count: hit.length };
    };

    const q: any = {
      select: () => q,
      eq: (c: string, v: unknown) => (filters.push((r) => String(r[c]) === String(v)), q),
      neq: (c: string, v: unknown) => (filters.push((r) => String(r[c]) !== String(v)), q),
      in: (c: string, v: unknown[]) => (filters.push((r) => v.map(String).includes(String(r[c]))), q),
      is: (c: string, v: unknown) => (filters.push((r) => (r[c] ?? null) === v), q),
      gte: (c: string, v: string) => (filters.push((r) => String(r[c]) >= v), q),
      lte: (c: string, v: string) => (filters.push((r) => String(r[c]) <= v), q),
      gt: (c: string, v: string) => (filters.push((r) => String(r[c]) > v), q),
      lt: (c: string, v: string) => (filters.push((r) => String(r[c]) < v), q),
      not: () => q,
      or: () => q,
      order: (c: string, o?: { ascending?: boolean }) => (orders.push({ c, asc: o?.ascending !== false }), q),
      limit: (n: number) => ((limit = n), q),
      insert: (p: unknown) => ((op = 'insert'), (payload = p), q),
      update: (p: unknown) => ((op = 'update'), (payload = p), q),
      delete: () => ((op = 'delete'), q),
      maybeSingle: () => exec().then((r) => ({ ...r, data: r.data[0] ?? null })),
      single: () => exec().then((r) => ({ ...r, data: r.data[0] ?? null })),
      then: (ok: any, bad: any) => exec().then(ok, bad),
    };
    return q;
  }

  return { db: { from }, tables, log, writes: () => log.filter((l) => l.op !== 'select') };
}

// ------------------------------------------------------------------ fixtures

const SEED = () => ({
  cc_clubs: [{ id: 'c1', owner_id: 'u1' }],
  club_programs: [
    { id: 'p1', club_id: 'c1', title: 'Tuesday Night Clinic', range_start: '2026-09-01', range_end: '2026-11-30', status: 'published' },
    { id: 'p9', club_id: 'c2', title: 'Tuesday Night Clinic', range_start: '2026-09-01', range_end: '2026-11-30', status: 'published' },
  ],
  club_program_registrations: [
    { id: 'r1', program_id: 'p1', club_id: 'c1', participant_name: 'Ann Lee', parent_name: null, parent_email: 'ann@x.com', status: 'enrolled', payment_status: 'paid', amount_cents: 25000, paid_at: '2026-10-03T18:00:00Z', created_at: '2026-10-02T18:00:00Z' },
    { id: 'r2', program_id: 'p1', club_id: 'c1', participant_name: 'Bo Diaz', parent_name: 'Jen Diaz', parent_email: 'jen@x.com', status: 'enrolled', payment_status: 'pending', amount_cents: 25000, paid_at: null, created_at: '2026-10-04T18:00:00Z' },
    { id: 'r4', program_id: 'p1', club_id: 'c1', participant_name: 'Cy Wu', parent_name: null, parent_email: 'cy@x.com', status: 'waitlist', payment_status: 'pending', amount_cents: null, paid_at: null, created_at: '2026-10-05T18:00:00Z' },
    { id: 'r5', program_id: 'p1', club_id: 'c1', participant_name: 'Di Ho', parent_name: null, parent_email: 'di@x.com', status: 'enrolled', payment_status: 'paid', amount_cents: 20000, paid_at: '2026-09-10T18:00:00Z', created_at: '2026-09-09T18:00:00Z' },
    { id: 'r9', program_id: 'p9', club_id: 'c2', participant_name: 'Intruder', parent_name: null, parent_email: 'i@x.com', status: 'enrolled', payment_status: 'pending', amount_cents: 99900, paid_at: null, created_at: '2026-10-04T18:00:00Z' },
  ],
  court_bookings: [
    { id: 'b1', club_id: 'c1', reservation_id: 'res1', booker_name: 'Pat Kim', booker_email: 'pat@x.com', amount_cents: 2750, payment_status: 'pending', status: 'booked', paid_at: null, created_at: '2026-10-06T18:00:00Z' },
    { id: 'b2', club_id: 'c1', reservation_id: null, booker_name: 'Lou', booker_email: 'lou@x.com', amount_cents: 3000, payment_status: 'paid', status: 'booked', paid_at: '2026-10-05T18:00:00Z', created_at: '2026-10-05T18:00:00Z' },
    { id: 'b9', club_id: 'c2', reservation_id: null, booker_name: 'Other', booker_email: 'o@x.com', amount_cents: 88800, payment_status: 'pending', status: 'booked', paid_at: null, created_at: '2026-10-06T18:00:00Z' },
  ],
  courts: [
    { id: 'k1', club_id: 'c1', status: 'open' },
    { id: 'k2', club_id: 'c1', status: 'open' },
  ],
  reservations: [
    { id: 'res1', club_id: 'c1', type: 'member', status: 'confirmed', starts_at: '2026-10-07T17:00:00.000Z', ends_at: '2026-10-07T18:00:00.000Z' },
    { id: 'res9', club_id: 'c2', type: 'member', status: 'confirmed', starts_at: '2026-10-07T17:00:00.000Z', ends_at: '2026-10-07T23:00:00.000Z' },
  ],
  events: [
    { id: 'e1', club_id: 'c1', name: 'Dunkin Quads', event_date: '2026-10-03', entry_fee_cents: 3500 },
    { id: 'e9', club_id: 'c2', name: 'Dunkin Classic', event_date: '2026-10-03', entry_fee_cents: 1 },
  ],
  quad_entries: [
    { event_id: 'e1', player_name: 'A', payment_status: 'paid', amount_paid_cents: 3500, registered_at: '2026-10-01T18:00:00Z', created_at: '2026-10-01T18:00:00Z' },
    { event_id: 'e1', player_name: 'B', payment_status: 'paid', amount_paid_cents: 3500, registered_at: '2026-10-01T18:00:00Z', created_at: '2026-10-01T18:00:00Z' },
    { event_id: 'e1', player_name: 'C', payment_status: 'pending', amount_paid_cents: null, registered_at: '2026-10-01T18:00:00Z', created_at: '2026-10-01T18:00:00Z' },
    { event_id: 'e9', player_name: 'X', payment_status: 'paid', amount_paid_cents: 99999, registered_at: '2026-10-01T18:00:00Z', created_at: '2026-10-01T18:00:00Z' },
  ],
  tournament_entries: [],
  cc_vault_players: [],
  nps_responses: [],
  leagues: [],

  stringing_customers: [
    { id: 1, club_id: 'c1', user_id: 'u1', full_name: 'Gabe Fett', email: 'gabe@x.com', phone: null },
    { id: 2, club_id: 'c1', user_id: 'u1', full_name: 'Ann Ready', email: 'ann.r@x.com', phone: null },
    { id: 3, club_id: 'c1', user_id: 'u1', full_name: 'No Mail', email: null, phone: null },
    { id: 9, club_id: 'c2', user_id: 'u9', full_name: 'Gabe Fett', email: 'other-gabe@x.com', phone: null },
  ],
  stringing_catalog: [
    { id: 's1', club_id: 'c1', brand: 'Tecnifibre', name: 'NRG2', gauge: '16', in_stock: true },
    { id: 's2', club_id: 'c1', brand: 'Luxilon', name: 'ALU Power', gauge: '16L', in_stock: true },
    { id: 's9', club_id: 'c2', brand: 'Tecnifibre', name: 'NRG2', gauge: '16', in_stock: true },
  ],
  stringing_rackets: [{ id: 'rk1', customer_id: 1, brand: 'Babolat', model: 'Pure Aero' }],
  stringing_jobs: [
    { id: 'j1', customer_id: 1, racket_id: 'rk1', string_id: 's2', custom_string_name: null, main_tension_lbs: 55, cross_tension_lbs: 53, status: 'picked_up', quoted_ready_at: null, completed_at: '2026-07-11T18:00:00Z', picked_up_at: '2026-07-12T18:00:00Z', created_at: '2026-07-10T18:00:00Z', stringer_name: 'Tom', stringer_paid_at: null, customer_paid_at: null },
    { id: 'j2', customer_id: 2, racket_id: null, string_id: 's1', custom_string_name: null, main_tension_lbs: 50, cross_tension_lbs: null, status: 'done', quoted_ready_at: null, completed_at: '2026-07-21T18:00:00Z', picked_up_at: null, created_at: '2026-07-20T18:00:00Z', stringer_name: 'Tom', stringer_paid_at: null, customer_paid_at: null },
    { id: 'j3', customer_id: 3, racket_id: null, string_id: null, custom_string_name: 'Poly Tour', main_tension_lbs: 50, cross_tension_lbs: null, status: 'done', quoted_ready_at: null, completed_at: '2026-10-02T18:00:00Z', picked_up_at: null, created_at: '2026-10-01T18:00:00Z', stringer_name: null, stringer_paid_at: null, customer_paid_at: null },
    { id: 'j4', customer_id: 2, racket_id: null, string_id: 's1', custom_string_name: null, main_tension_lbs: 50, cross_tension_lbs: null, status: 'pending', quoted_ready_at: '2026-10-08T00:00:00Z', completed_at: null, picked_up_at: null, created_at: '2026-10-05T18:00:00Z', stringer_name: null, stringer_paid_at: null, customer_paid_at: null },
    { id: 'j9', customer_id: 9, racket_id: null, string_id: 's9', custom_string_name: null, main_tension_lbs: 50, cross_tension_lbs: null, status: 'done', quoted_ready_at: null, completed_at: '2026-07-16T18:00:00Z', picked_up_at: null, created_at: '2026-07-15T18:00:00Z', stringer_name: 'Tom', stringer_paid_at: null, customer_paid_at: null },
  ],

  maint_tasks: [
    { id: 't1', club_id: 'c1', title: 'Replace windscreen on court 3', description: null, department: 'tennis', location: 'Court 3', priority: 'normal', due_date: null, status: 'open', photo_url: null, created_by: 'u2', created_at: '2026-10-01T18:00:00Z', started_at: null, started_by: null, completed_at: null, completed_by: null, completion_note: null, completion_photo_url: null },
    { id: 't2', club_id: 'c1', title: 'Fix light pole 4', description: null, department: 'tennis', location: null, priority: 'urgent', due_date: '2026-10-05', status: 'in_progress', photo_url: null, created_by: 'u2', created_at: '2026-10-02T18:00:00Z', started_at: null, started_by: null, completed_at: null, completed_by: null, completion_note: null, completion_photo_url: null },
    { id: 't9', club_id: 'c2', title: 'Replace windscreen', description: null, department: 'tennis', location: null, priority: 'normal', due_date: null, status: 'open', photo_url: null, created_by: 'u9', created_at: '2026-10-01T18:00:00Z', started_at: null, started_by: null, completed_at: null, completed_by: null, completion_note: null, completion_photo_url: null },
  ],
  maint_projects: [{ id: 'mp1', club_id: 'c1', title: 'Resurface courts 7-8', status: 'active', description: null, department: 'tennis', location: null, target_date: null, completed_at: null, created_by: 'u1', created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z' }],
  maint_project_steps: [],
  maint_updates: [],
  maint_routine_items: [
    { id: 'ri1', club_id: 'c1', title: 'Blow courts', notes: null, department: 'tennis', location: null, days_of_week: [0, 1, 2, 3, 4, 5, 6], target_time: '07:00', sort_order: 0, active_from: '2026-01-01', archived_on: null },
  ],
  maint_routine_checks: [],
});

function setup(role = 'director') {
  const f = fakeDb(SEED());
  const ctx = { userId: 'u1', db: f.db, clubId: 'c1', clubName: 'Test Club', clubSlug: 'test', timeZone: TZ, role };
  return { ...f, pack: bindPack(opsPack, ctx as never) };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-09T19:00:00Z'));
  h.live.length = 0;
  h.restringCalls.length = 0;
});
afterEach(() => vi.useRealTimers());

// ------------------------------------------------------------------ gate

describe('the confirm gate and roles', () => {
  it('adds confirm to exactly the write/send tools', () => {
    const names = setup()
      .pack.toolSchemas.filter((t) => 'confirm' in ((t.input_schema.properties as Record<string, unknown>) ?? {}))
      .map((t) => t.name)
      .sort();
    expect(names).toEqual([
      'add_checklist_item',
      'add_work_order',
      'email_ready_rackets',
      'log_stringing_job',
      'mark_stringing_jobs_paid',
      'nudge_restring',
      'set_stringing_job_status',
      'update_work_order',
    ]);
  });

  it('has no tool that charges, refunds or credits', () => {
    const names = setup().pack.toolSchemas.map((t) => t.name);
    for (const bad of ['charge', 'refund', 'credit', 'quickbooks', 'captyn']) expect(names.filter((n) => n.includes(bad))).toEqual([]);
  });

  it('a coach cannot see finances, mark paid, or send — not even a preview', async () => {
    const f = setup('coach');
    expect((await f.pack.execute('board_report_numbers', {})).ok).toBe(false);
    expect((await f.pack.execute('who_still_owes', {})).ok).toBe(false);
    const paid = await f.pack.execute('mark_stringing_jobs_paid', { who: 'customer', month: '2026-07', confirm: true });
    expect(paid.ok).toBe(false);
    const send = await f.pack.execute('email_ready_rackets', { confirm: true });
    expect(send.ok).toBe(false);
    expect(send.needsConfirm).toBeUndefined();
    expect(h.live).toHaveLength(0);
    expect(f.writes()).toHaveLength(0);
  });

  it('a coach CAN log a stringing job and post a work order (same as the hand path)', async () => {
    const f = setup('coach');
    expect((await f.pack.execute('log_stringing_job', { customer: 'Gabe Fett', confirm: true })).ok).toBe(true);
    expect((await f.pack.execute('add_work_order', { title: 'Net crank', confirm: true })).ok).toBe(true);
    expect((await f.pack.execute('add_checklist_item', { title: 'Sweep', confirm: true })).ok).toBe(false);
  });

  it('the maintenance crew gets maintenance and nothing else', async () => {
    const f = setup('maintenance');
    expect((await f.pack.execute('maintenance_board', {})).ok).toBe(true);
    expect((await f.pack.execute('add_work_order', { title: 'Leak', confirm: true })).ok).toBe(true);
    expect((await f.pack.execute('stringing_queue', {})).ok).toBe(false);
    expect((await f.pack.execute('court_utilization_by_month', {})).ok).toBe(false);
  });
});

// ------------------------------------------------------------------ reports

describe('reports read only this club', () => {
  it('month boundaries are club-local', () => {
    const { start, end } = monthBounds('2026-10', TZ);
    expect(start.toISOString()).toBe('2026-10-01T07:00:00.000Z');
    expect(end.toISOString()).toBe('2026-11-01T07:00:00.000Z');
  });

  it('board_report_numbers: revenue, sign-ups, events, previous month', async () => {
    const f = setup();
    const r: any = await f.pack.execute('board_report_numbers', {});
    expect(r.ok).toBe(true);
    expect(r.this_period.revenue).toMatchObject({ classes: '$250', court_bookings: '$30', event_entries: '$70', total: '$350' });
    expect(r.this_period.class_registrations.new).toBe(3);
    expect(r.this_period.events).toEqual([{ name: 'Dunkin Quads', date: '2026-10-03', entrants: 3 }]);
    expect(r.previous_month.revenue.classes).toBe('$200');
    expect(r.still_owed_now.total).toBe('$277.50');
    expect(r.courts.court_hours_booked).toBe(1);
    expect(JSON.stringify(r)).not.toContain('999');
    expect(f.writes()).toHaveLength(0);
  });

  it('who_still_owes groups by payer and excludes waitlist and other clubs', async () => {
    const r: any = await setup().pack.execute('who_still_owes', {});
    expect(r.total_owed).toBe('$277.50');
    expect(r.people.map((p: any) => p.who)).toEqual(['Jen Diaz', 'Pat Kim']);
    expect(r.people[1].for[0]).toContain('2026-10-07');
    expect(r.stringing_jobs_not_marked_paid).toBe(3);
    expect(JSON.stringify(r)).not.toMatch(/Intruder|Other|Cy Wu/);
  });

  it('revenue_for_class_or_event never matches another club', async () => {
    const f = setup();
    const ev: any = await f.pack.execute('revenue_for_class_or_event', { name: 'Dunkin' });
    expect(ev).toMatchObject({ ok: true, kind: 'event', collected: '$70', paid_entries: 2, unpaid_entries: 1 });
    const cl: any = await f.pack.execute('revenue_for_class_or_event', { name: 'tuesday' });
    expect(cl).toMatchObject({ ok: true, kind: 'class', collected: '$450', still_owed: '$250' });
    expect((await f.pack.execute('revenue_for_class_or_event', { name: 'Gala' })).ok).toBe(false);
  });

  it('court_utilization_by_month', async () => {
    const r: any = await setup().pack.execute('court_utilization_by_month', { months: 2 });
    expect(r.months).toHaveLength(2);
    expect(r.months[1].month).toContain('October 2026');
    expect(r.months[1].court_hours_booked).toBe(1);
    expect(r.months[0].utilization_pct).toBeNull();
  });
});

// ------------------------------------------------------------------ stringing

describe('stringing', () => {
  it('queue: ready, overdue — this club only', async () => {
    const r: any = await setup().pack.execute('stringing_queue', {});
    expect(r.ready_for_pickup.map((j: any) => j.customer).sort()).toEqual(['Ann Ready', 'No Mail']);
    expect(r.overdue.map((j: any) => j.id)).toEqual(['j4']);
    expect(r.stringer_jobs_unpaid).toEqual({ Tom: 2 });
  });

  it('log_stringing_job: preview writes nothing; run writes exactly the preview', async () => {
    const f = setup();
    const input = { customer: 'Gabe Fett', string: 'NRG2', main_tension: 52, ready_date: '2026-10-15' };
    const p: any = await f.pack.execute('log_stringing_job', input);
    expect(p.needsConfirm).toBe(true);
    expect(p.will.string).toContain('Tecnifibre NRG2');
    expect(p.will.racket).toContain('Babolat Pure Aero');
    expect(p.will.tension).toContain('52');
    expect(f.writes()).toHaveLength(0);

    const r: any = await f.pack.execute('log_stringing_job', { ...input, confirm: true });
    expect(r.ok).toBe(true);
    expect(r.did).toEqual(p.will);
    const w = f.writes();
    expect(w).toHaveLength(1);
    expect(w[0].payload).toMatchObject({
      customer_id: 1,
      string_id: 's1',
      racket_id: 'rk1',
      main_tension_lbs: 52,
      cross_tension_lbs: null,
      status: 'pending',
      quoted_ready_at: '2026-10-16T00:00:00.000Z',
      customer_paid_at: null,
    });
  });

  it('no string/tension → same as last time', async () => {
    const f = setup();
    const r: any = await f.pack.execute('log_stringing_job', { customer: 'gabe fett', confirm: true });
    expect(r.ok).toBe(true);
    expect(f.writes()[0].payload).toMatchObject({ string_id: 's2', main_tension_lbs: 55, cross_tension_lbs: 53 });
  });

  it('an unknown customer is refused unless create_customer, which scopes the new row to this club', async () => {
    const f = setup();
    expect((await f.pack.execute('log_stringing_job', { customer: 'Han Solo', string: 'NRG2', main_tension: 50 })).ok).toBe(false);
    const r: any = await f.pack.execute('log_stringing_job', { customer: 'Han Solo', string: 'NRG2', main_tension: 50, create_customer: true, customer_email: 'han@x.com', confirm: true });
    expect(r.ok).toBe(true);
    const [cust, job] = f.writes();
    expect(cust.payload).toMatchObject({ full_name: 'Han Solo', club_id: 'c1', user_id: 'u1', email: 'han@x.com' });
    expect(job.payload.customer_id).toBe(r.customer_id);
  });

  it('set_stringing_job_status sends nothing', async () => {
    const f = setup();
    const r: any = await f.pack.execute('set_stringing_job_status', { customer: 'Ann Ready', status: 'done', confirm: true });
    expect(r.ok).toBe(true);
    expect(f.tables.stringing_jobs.find((j) => j.id === 'j4')!.status).toBe('done');
    expect(h.live).toHaveLength(0);
  });

  it('email_ready_rackets: preview lists recipients and sends nothing; confirm sends exactly those', async () => {
    const f = setup();
    const p: any = await f.pack.execute('email_ready_rackets', {});
    expect(p.needsConfirm).toBe(true);
    expect(p.will.recipients).toEqual(['Ann Ready <ann.r@x.com>']);
    expect(p.will.skipped_no_email).toEqual(['No Mail']);
    expect(h.live).toHaveLength(0);

    const r: any = await f.pack.execute('email_ready_rackets', { confirm: true });
    expect(r).toMatchObject({ ok: true, sent: 1 });
    expect(h.live).toHaveLength(1);
    expect(h.live[0].nudge.map((n: any) => n.email)).toEqual(['ann.r@x.com']);
    expect(h.live[0]).toMatchObject({ clubName: 'Test Club', ownerId: 'u1' });
    expect(r.did).toEqual(p.will);
  });

  it('nudge_restring: preview first, then the existing restring source for this club customer', async () => {
    const f = setup();
    const p: any = await f.pack.execute('nudge_restring', { customer: 'Gabe Fett' });
    expect(p.will.to).toBe('Gabe Fett <gabe@x.com>');
    expect(h.live).toHaveLength(0);
    const r: any = await f.pack.execute('nudge_restring', { customer: 'Gabe Fett', confirm: true });
    expect(r.ok).toBe(true);
    expect(h.live).toHaveLength(1);
    expect(h.restringCalls.every((c) => c.id === '1')).toBe(true);
  });

  it('mark_stringing_jobs_paid: July customer payments touch only this club\'s July jobs', async () => {
    const f = setup();
    const p: any = await f.pack.execute('mark_stringing_jobs_paid', { who: 'customer', month: '2026-07' });
    expect(p.will.count).toBe(2);
    expect(f.writes()).toHaveLength(0);
    const r: any = await f.pack.execute('mark_stringing_jobs_paid', { who: 'customer', month: '2026-07', confirm: true });
    expect(r).toMatchObject({ ok: true, marked: 2 });
    expect(r.did).toEqual(p.will);
    const paid = f.tables.stringing_jobs.filter((j) => j.customer_paid_at).map((j) => j.id).sort();
    expect(paid).toEqual(['j1', 'j2']);
  });

  it('mark the stringer paid: finished jobs for that stringer only', async () => {
    const f = setup();
    const r: any = await f.pack.execute('mark_stringing_jobs_paid', { who: 'stringer', stringer_name: 'tom', confirm: true });
    expect(r.marked).toBe(2);
    expect(f.tables.stringing_jobs.find((j) => j.id === 'j9')!.stringer_paid_at).toBeNull();
    expect(f.tables.stringing_jobs.filter((j) => j.customer_paid_at)).toHaveLength(0);
  });

  it('mark paid needs a filter', async () => {
    expect((await setup().pack.execute('mark_stringing_jobs_paid', { who: 'customer' })).ok).toBe(false);
  });
});

// ------------------------------------------------------------------ maintenance

describe('maintenance', () => {
  it('board: open work orders for this club, urgent first, checklist', async () => {
    const r: any = await setup().pack.execute('maintenance_board', {});
    expect(r.open_work_orders.map((t: any) => t.id)).toEqual(['t2', 't1']);
    expect(r.open_work_orders[0].overdue).toBe(true);
    expect(r.todays_checklist[0]).toMatchObject({ item: 'Blow courts', state: 'late' });
  });

  it('add_work_order: preview == run, scoped and stamped', async () => {
    const f = setup();
    const input = { title: 'Court 6 net crank broken', location: 'Court 6', priority: 'high' };
    const p: any = await f.pack.execute('add_work_order', input);
    expect(f.writes()).toHaveLength(0);
    const r: any = await f.pack.execute('add_work_order', { ...input, confirm: true });
    expect(r.did).toEqual(p.will);
    expect(f.writes()[0].payload).toMatchObject({ club_id: 'c1', priority: 'high', department: 'tennis', created_by: 'u1' });
    expect((await f.pack.execute('add_work_order', { title: 'x', priority: 'asap' })).ok).toBe(false);
  });

  it('update_work_order: "windscreen" → this club\'s task, done', async () => {
    const f = setup();
    const p: any = await f.pack.execute('update_work_order', { item: 'windscreen' });
    expect(p.will.work_order).toBe('Replace windscreen on court 3');
    const r: any = await f.pack.execute('update_work_order', { item: 'windscreen', note: 'new screen up', confirm: true });
    expect(r.ok).toBe(true);
    expect(f.tables.maint_tasks.find((t) => t.id === 't1')).toMatchObject({ status: 'done', completed_by: 'u1', completion_note: 'new screen up' });
    expect(f.tables.maint_tasks.find((t) => t.id === 't9')!.status).toBe('open');
  });

  it('update_work_order falls back to a project (managers only)', async () => {
    const f = setup();
    const r: any = await f.pack.execute('update_work_order', { item: 'resurface', confirm: true });
    expect(r.ok).toBe(true);
    expect(f.tables.maint_projects[0].status).toBe('done');
    expect((await setup('coach').pack.execute('update_work_order', { item: 'resurface', confirm: true })).ok).toBe(false);
  });

  it('a coach cannot cancel someone else\'s work order', async () => {
    const r = await setup('coach').pack.execute('update_work_order', { item: 'windscreen', status: 'cancelled', confirm: true });
    expect(r.ok).toBe(false);
  });

  it('add_checklist_item: days and dupes', async () => {
    const f = setup();
    const r: any = await f.pack.execute('add_checklist_item', { title: 'Check nets', days_of_week: [1, 3, 5], target_time: '08:00', confirm: true });
    expect(r.ok).toBe(true);
    expect(f.writes()[0].payload).toMatchObject({ club_id: 'c1', days_of_week: [1, 3, 5], target_time: '08:00', sort_order: 1, active_from: '2026-10-09' });
    expect((await f.pack.execute('add_checklist_item', { title: 'blow courts' })).ok).toBe(false);
  });
});
