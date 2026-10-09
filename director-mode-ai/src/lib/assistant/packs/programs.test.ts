import { describe, it, expect } from 'vitest';
import { bindPack } from '../framework';
import { programsPack, levelFits } from './programs';

/**
 * Same property as clubSite.test.ts: PREVIEW AND RUN AGREE, and nothing is
 * written until confirm. Driven through the real framework binding against an
 * in-memory Supabase stand-in that actually filters, so club scoping and the
 * rows a write produces can be checked, not just that a call happened.
 */

const TZ = 'America/Los_Angeles';
type Row = Record<string, any>;

function fakeDb(seed: Record<string, Row[]>) {
  const tables: Record<string, Row[]> = {};
  for (const [k, v] of Object.entries(seed)) tables[k] = v.map((r) => ({ ...r }));
  const log: { op: string; table: string; payload?: unknown }[] = [];
  let seq = 0;

  function from(table: string) {
    const rows = (tables[table] ??= []);
    let op: 'select' | 'insert' | 'update' | 'delete' = 'select';
    let payload: any;
    const filters: ((r: Row) => boolean)[] = [];
    const orders: string[] = [];
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
        log.push({ op, table, payload });
        return { data: hit, error: null, count: hit.length };
      }
      if (op === 'delete') {
        for (const r of hit) rows.splice(rows.indexOf(r), 1);
        log.push({ op, table });
        return { data: hit, error: null, count: hit.length };
      }
      for (const o of [...orders].reverse()) hit = [...hit].sort((a, b) => String(a[o] ?? '').localeCompare(String(b[o] ?? '')));
      if (limit != null) hit = hit.slice(0, limit);
      return { data: hit, error: null, count: hit.length };
    };

    const likeRe = (pat: string) =>
      new RegExp(`^${pat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*')}$`, 'i');

    const q: any = {
      select: () => q,
      eq: (c: string, v: unknown) => (filters.push((r) => String(r[c]) === String(v)), q),
      neq: (c: string, v: unknown) => (filters.push((r) => String(r[c]) !== String(v)), q),
      in: (c: string, v: unknown[]) => (filters.push((r) => v.includes(r[c])), q),
      ilike: (c: string, v: string) => (filters.push((r) => likeRe(v).test(String(r[c] ?? ''))), q),
      gte: (c: string, v: string) => (filters.push((r) => String(r[c]) >= v), q),
      lte: (c: string, v: string) => (filters.push((r) => String(r[c]) <= v), q),
      order: (c: string) => (orders.push(c), q),
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

const CLINIC = {
  id: '11111111-1111-4111-8111-111111111111',
  club_id: 'c1',
  title: 'Tuesday Night Clinic',
  slug: 'tuesday-night-clinic',
  status: 'published',
  range_start: '2026-11-03',
  range_end: '2026-11-24',
  days_of_week: [2],
  exclusions: [],
  time_start: '18:00:00',
  time_end: '19:30:00',
  price_cents: 25000,
  member_price_cents: null,
  drop_in_price_cents: 3500,
  capacity: 2,
  waitlist_enabled: true,
  registration_mode: 'online',
  blocks_courts: true,
  court_count: 2,
  audience: 'adult',
  level_note: 'NTRP 3.0–3.5',
  coach_name: 'Kim',
  description: 'Drills and play.',
  display_order: 0,
};

const OTHER_CLUB_CLASS = { ...CLINIC, id: '22222222-2222-4222-8222-222222222222', club_id: 'c2', title: 'Tuesday Night Clinic' };

const WEEKEND_JR = {
  ...CLINIC,
  id: '33333333-3333-4333-8333-333333333333',
  title: 'Saturday Juniors',
  slug: 'saturday-juniors',
  days_of_week: [6],
  time_start: '09:00:00',
  time_end: '10:30:00',
  audience: 'junior',
  level_note: null,
  blocks_courts: false,
  court_count: null,
  range_end: '2027-06-01',
};

const REGS = [
  { id: 'r1', program_id: CLINIC.id, club_id: 'c1', participant_name: 'Ann Lee', parent_name: null, parent_email: 'ann@x.com', status: 'enrolled', payment_status: 'paid', amount_cents: 25000, created_at: '1' },
  { id: 'r2', program_id: CLINIC.id, club_id: 'c1', participant_name: 'Bo Diaz', parent_name: null, parent_email: 'bo@x.com', status: 'enrolled', payment_status: 'pending', amount_cents: 25000, created_at: '2' },
  { id: 'r3', program_id: CLINIC.id, club_id: 'c1', participant_name: 'Cy Wu', parent_name: null, parent_email: 'cy@x.com', status: 'waitlist', payment_status: 'pending', amount_cents: null, created_at: '3' },
  // Another club's registration under the same class id must never be seen.
  { id: 'r9', program_id: CLINIC.id, club_id: 'c2', participant_name: 'Intruder', parent_name: null, parent_email: 'i@x.com', status: 'enrolled', payment_status: 'paid', amount_cents: 1, created_at: '0' },
];

const COURTS = [
  { id: 'k1', club_id: 'c1', name: 'Court 1', number: 1, status: 'open', display_order: 1 },
  { id: 'k2', club_id: 'c1', name: 'Court 2', number: 2, status: 'open', display_order: 2 },
];

function setup(role = 'director', extra: Record<string, Row[]> = {}) {
  const f = fakeDb({
    club_programs: [CLINIC, OTHER_CLUB_CLASS, WEEKEND_JR],
    club_program_registrations: REGS,
    courts: COURTS,
    reservations: [],
    lesson_coaches: [{ club_id: 'c1', display_name: 'Kim', open_rate_note: '$120/hr' }],
    ...extra,
  });
  const ctx = { userId: 'u1', db: f.db, clubId: 'c1', clubName: 'Test Club', clubSlug: 'test', timeZone: TZ, role };
  return { ...f, pack: bindPack(programsPack, ctx as never) };
}

describe('the confirm gate and roles', () => {
  it('adds confirm to exactly the write tools', () => {
    const { pack } = setup();
    const withConfirm = pack.toolSchemas
      .filter((t) => 'confirm' in ((t.input_schema.properties as Record<string, unknown>) ?? {}))
      .map((t) => t.name)
      .sort();
    expect(withConfirm).toEqual([
      'add_student',
      'cancel_class_meeting',
      'cancel_whole_class',
      'copy_class_to_new_session',
      'create_class',
      'edit_class_details',
      'extend_class',
      'withdraw_student',
    ]);
  });

  it('a coach can read but not write — not even preview', async () => {
    const f = setup('coach');
    const read = await f.pack.execute('class_on_date', { date: '2026-11-10', class: 'Tuesday Night' });
    expect(read.ok).toBe(true);
    const w = await f.pack.execute('cancel_class_meeting', { class: 'Tuesday Night', date: '2026-11-10' });
    expect(w.ok).toBe(false);
    expect(w.needsConfirm).toBeUndefined();
    const w2 = await f.pack.execute('cancel_class_meeting', { class: 'Tuesday Night', date: '2026-11-10', confirm: true });
    expect(w2.ok).toBe(false);
    expect(f.writes()).toHaveLength(0);
  });

  it('has no tool that publishes, sends, deletes or takes money', () => {
    const names = setup().pack.toolSchemas.map((t) => t.name);
    for (const bad of ['publish', 'send', 'email', 'delete', 'paid', 'charge', 'refund', 'credit']) {
      expect(names.filter((n) => n.includes(bad))).toEqual([]);
    }
  });
});

describe('create_class', () => {
  const INPUT = {
    title: 'Fall Evening Clinic',
    days_of_week: [2],
    time_start: '18:00',
    time_end: '19:30',
    range_start: '2026-11-03',
    weeks: 10,
    skip_dates: ['2026-11-24'],
    price_dollars: 250,
    drop_in_price_dollars: 35,
    capacity: 8,
    court_count: 2,
    coach_name: 'Kim',
  };

  it('previews a draft with every date, then creates exactly that and holds courts', async () => {
    const f = setup();
    const p = await f.pack.execute('create_class', INPUT);
    expect(p.needsConfirm).toBe(true);
    expect(f.writes()).toHaveLength(0);
    const will = p.will as Record<string, any>;
    // 10 Tuesdays Nov 3 – Jan 5, minus the Nov 24 skip = 9.
    expect(will.meetings).toBe(9);
    expect(will.first_date).toBe('Tue, Nov 3');
    expect(will.last_date).toBe('Tue, Jan 5');
    expect(will.skipping).toEqual(['Tue, Nov 24']);
    expect(will.season_price).toBe('$250');
    expect(will.drop_in_price).toBe('$35');
    expect(will.status).toMatch(/draft/);
    expect(will.courts).toMatch(/cannot be pinned/);

    const done = await f.pack.execute('create_class', { ...INPUT, confirm: true });
    expect(done.ok).toBe(true);
    expect(done.did).toEqual(p.will);
    const row = f.tables.club_programs.find((r) => r.title === 'Fall Evening Clinic')!;
    expect(row).toMatchObject({
      club_id: 'c1',
      status: 'draft',
      range_end: '2027-01-05',
      exclusions: ['2026-11-24'],
      price_cents: 25000,
      drop_in_price_cents: 3500,
      capacity: 8,
      court_count: 2,
      blocks_courts: true,
      slug: 'fall-evening-clinic',
    });
    // 9 meetings × 2 courts on the sheet.
    expect(f.tables.reservations.filter((r) => r.source_id === row.id)).toHaveLength(18);
  });

  it('meetings counts actual sessions after skips', async () => {
    const p = await setup().pack.execute('create_class', { ...INPUT, weeks: undefined, meetings: 10 });
    expect((p.will as any).meetings).toBe(10);
    expect((p.will as any).last_date).toBe('Tue, Jan 12');
  });

  it('refuses through the same schema the Classes screen uses', async () => {
    const r = await setup().pack.execute('create_class', { ...INPUT, time_end: '17:00' });
    expect(r.ok).toBe(false);
    expect(String(r.error)).toMatch(/end time/);
  });

  it('refuses when there is no length', async () => {
    const r = await setup().pack.execute('create_class', { ...INPUT, weeks: undefined });
    expect(r.ok).toBe(false);
  });
});

describe('copy_class_to_new_session', () => {
  it('copies as a draft with new dates, new skips, and a new drop-in price only on the copy', async () => {
    const f = setup();
    const input = {
      class: 'Tuesday Night Clinic',
      range_start: '2026-12-01',
      range_end: '2027-01-26',
      skip_dates: ['2026-12-22', '2026-12-29'],
      drop_in_price_dollars: 55,
    };
    const p = await f.pack.execute('copy_class_to_new_session', input);
    const will = p.will as Record<string, any>;
    expect(will.meetings).toBe(7);
    expect(will.price_changes).toEqual([{ field: 'drop-in price', from: '$35', to: '$55' }]);
    expect(f.writes()).toHaveLength(0);

    const done = await f.pack.execute('copy_class_to_new_session', { ...input, confirm: true });
    expect(done.did).toEqual(p.will);
    const copy = f.tables.club_programs.find((r) => r.id === done.id)!;
    expect(copy).toMatchObject({ status: 'draft', drop_in_price_cents: 5500, price_cents: 25000, club_id: 'c1', slug: 'tuesday-night-clinic-2' });
    expect(copy.exclusions).toEqual(['2026-12-22', '2026-12-29']);
    // The current session's price is untouched.
    expect(f.tables.club_programs.find((r) => r.id === CLINIC.id)!.drop_in_price_cents).toBe(3500);
  });

  it('only ever finds classes in this club', async () => {
    // Same title exists in c2; only c1's should match, so this is not ambiguous.
    const p = await setup().pack.execute('copy_class_to_new_session', { class: 'Tuesday Night Clinic', range_start: '2026-12-01' });
    expect(p.ok).toBe(true);
    const byId = await setup().pack.execute('copy_class_to_new_session', { class: OTHER_CLUB_CLASS.id, range_start: '2026-12-01' });
    expect(byId.ok).toBe(false);
  });
});

describe('extend_class', () => {
  it('lists the added dates, and the run stores the new end', async () => {
    const f = setup();
    const p = await f.pack.execute('extend_class', { class: 'Tuesday Night', new_end: '2026-12-15' });
    const will = p.will as Record<string, any>;
    expect(will.added_dates).toEqual(['Tue, Dec 1', 'Tue, Dec 8', 'Tue, Dec 15']);
    expect(will.meetings_after).toBe(7);
    const done = await f.pack.execute('extend_class', { class: 'Tuesday Night', new_end: '2026-12-15', confirm: true });
    expect(done.meetings).toBe(will.meetings_after);
    expect(f.tables.club_programs.find((r) => r.id === CLINIC.id)!.range_end).toBe('2026-12-15');
    // Holds courts, so the sheet was rebuilt: 7 meetings × 2 courts.
    expect(f.tables.reservations).toHaveLength(14);
  });
});

describe('class_on_date', () => {
  it('says whether it meets and who prepaid, scoped to this club', async () => {
    const r = await setup().pack.execute('class_on_date', { date: '2026-11-10', class: 'Tuesday Night' });
    const c = (r.classes as any[])[0];
    expect(c.meets).toBe(true);
    expect(c.prepaid).toEqual(['Ann Lee']);
    expect(c.not_paid).toEqual(['Bo Diaz']);
    expect(c.waitlist).toEqual(['Cy Wu']);
    expect(JSON.stringify(r)).not.toMatch(/Intruder/);
  });

  it('explains why not', async () => {
    const r = await setup().pack.execute('class_on_date', { date: '2026-11-11', class: 'Tuesday Night' });
    expect((r.classes as any[])[0].meets).toBe(false);
    expect((r.classes as any[])[0].why_not).toMatch(/meets Tue/);
  });

  it('without a class, lists what meets that day', async () => {
    const r = await setup().pack.execute('class_on_date', { date: '2026-11-14' });
    expect((r.classes as any[]).map((c) => c.title)).toEqual(['Saturday Juniors']);
  });
});

describe('cancel_class_meeting', () => {
  it('skips one real meeting, releases its courts, and lists who is affected', async () => {
    const f = setup();
    const p = await f.pack.execute('cancel_class_meeting', { class: 'Tuesday Night', date: '2026-11-10' });
    const will = p.will as Record<string, any>;
    expect(will.meetings_before).toBe(4);
    expect(will.meetings_after).toBe(3);
    expect(will.affected.map((a: any) => a.name)).toEqual(['Ann Lee', 'Bo Diaz', 'Cy Wu']);
    expect(will.not_done).toMatch(/No credits or refunds/);

    const done = await f.pack.execute('cancel_class_meeting', { class: 'Tuesday Night', date: '2026-11-10', confirm: true });
    expect(done.meetings).toBe(3);
    expect(f.tables.club_programs.find((r) => r.id === CLINIC.id)!.exclusions).toEqual(['2026-11-10']);
    expect(f.tables.reservations).toHaveLength(6);
    // Registrations untouched — no money, no status change.
    expect(f.log.filter((l) => l.op !== 'select' && l.table === 'club_program_registrations')).toHaveLength(0);
  });

  it('refuses a date the class does not meet', async () => {
    const r = await setup().pack.execute('cancel_class_meeting', { class: 'Tuesday Night', date: '2026-11-11' });
    expect(r.ok).toBe(false);
    expect(r.needsConfirm).toBeUndefined();
  });
});

describe('cancel_whole_class', () => {
  it('archives, never deletes', async () => {
    const f = setup();
    await f.pack.execute('cancel_whole_class', { class: 'Tuesday Night', confirm: true });
    const row = f.tables.club_programs.find((r) => r.id === CLINIC.id)!;
    expect(row.status).toBe('archived');
    expect(f.tables.club_program_registrations).toHaveLength(REGS.length);
  });
});

describe('edit_class_details', () => {
  it('changes only the named fields, from → to', async () => {
    const f = setup();
    const p = await f.pack.execute('edit_class_details', { class: 'Tuesday Night', time_end: '20:00', description: 'New copy.' });
    expect((p.will as any).changes).toEqual([
      { field: 'description', from: 'Drills and play.', to: 'New copy.' },
      { field: 'time_end', from: '19:30', to: '20:00' },
    ]);
    await f.pack.execute('edit_class_details', { class: 'Tuesday Night', time_end: '20:00', description: 'New copy.', confirm: true });
    const upd = f.log.find((l) => l.op === 'update' && l.table === 'club_programs')!;
    expect(upd.payload).toEqual({ description: 'New copy.', time_end: '20:00' });
  });

  it('checks a one-sided time change against the stored start', async () => {
    const r = await setup().pack.execute('edit_class_details', { class: 'Tuesday Night', time_end: '17:00' });
    expect(r.ok).toBe(false);
  });
});

describe('students', () => {
  it('withdraw cancels the registration and leaves payment alone', async () => {
    const f = setup();
    const p = await f.pack.execute('withdraw_student', { class: 'Tuesday Night', student: 'Ann' });
    const will = p.will as Record<string, any>;
    expect(will.money).toMatch(/PAID \$250/);
    expect(will.waitlist).toMatch(/Cy Wu/);
    await f.pack.execute('withdraw_student', { class: 'Tuesday Night', student: 'Ann', confirm: true });
    const r1 = f.tables.club_program_registrations.find((r) => r.id === 'r1')!;
    expect(r1.status).toBe('cancelled');
    expect(r1.payment_status).toBe('paid');
    // Not auto-promoted.
    expect(f.tables.club_program_registrations.find((r) => r.id === 'r3')!.status).toBe('waitlist');
  });

  it('add puts them on the waitlist when full, owing nothing, never paid', async () => {
    const f = setup();
    const p = await f.pack.execute('add_student', { class: 'Tuesday Night', student: 'Dee Fox', email: 'dee@x.com' });
    expect((p.will as any).as).toMatch(/WAITLIST/);
    await f.pack.execute('add_student', { class: 'Tuesday Night', student: 'Dee Fox', email: 'dee@x.com', confirm: true });
    const row = f.tables.club_program_registrations.find((r) => r.participant_name === 'Dee Fox')!;
    expect(row).toMatchObject({ status: 'waitlist', payment_status: 'pending', amount_cents: null, club_id: 'c1' });
  });

  it('add records the amount owed when there is room', async () => {
    const f = setup('owner', {
      club_programs: [{ ...CLINIC, capacity: 8 }],
    });
    const p = await f.pack.execute('add_student', { class: 'Tuesday Night', student: 'Dee Fox', email: 'dee@x.com', confirm: true });
    expect(p.payment_status).toBe('pending');
    const row = f.tables.club_program_registrations.find((r) => r.participant_name === 'Dee Fox')!;
    expect(row.amount_cents).toBe(25000);
  });

  it('reuses an unambiguous earlier email, refuses a duplicate', async () => {
    const f = setup('director', { club_programs: [{ ...CLINIC, capacity: 8 }, WEEKEND_JR] });
    const p = await f.pack.execute('add_student', { class: 'Saturday Juniors', student: 'Bo Diaz' });
    expect((p.will as any).contact).toMatch(/bo@x.com/);
    const dup = await f.pack.execute('add_student', { class: 'Tuesday Night', student: 'Bo Diaz', email: 'bo@x.com' });
    expect(dup.ok).toBe(false);
  });
});

describe('reads for staff', () => {
  it('offerings_summary has paste text with prices and lesson notes', async () => {
    const r = await setup().pack.execute('offerings_summary', { include_past: true });
    expect(r.paste_text).toMatch(/Tuesday Night Clinic/);
    expect(r.paste_text).toMatch(/\$250 season · \$35 drop-in/);
    expect(r.paste_text).toMatch(/Kim: \$120\/hr/);
  });

  it('find_classes filters by audience, level and weekend', async () => {
    const r = await setup().pack.execute('find_classes', { audience: 'adult', level: 3.0, days: 'weekend' });
    expect(r.count).toBe(0);
    const r2 = await setup().pack.execute('find_classes', { audience: 'adult', level: 3.0 });
    expect((r2.classes as any[]).map((c) => c.title)).toEqual(['Tuesday Night Clinic']);
  });

  it('levelFits reads common level notes', () => {
    expect(levelFits('NTRP 3.0–3.5', 3.0)).toBe(true);
    expect(levelFits('3.5+', 3.0)).toBe(false);
    expect(levelFits('2.5', 3.0)).toBe(false);
    expect(levelFits('Beginners', 3.0)).toBe(null);
  });
});
