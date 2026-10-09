import { describe, it, expect, vi, afterEach } from 'vitest';
import { bindPack } from '../framework';
import { attendancePack, matchName, type Candidate } from './attendance';

/**
 * Attendance pack. What is guarded:
 *   - preview and run agree (the run does what the preview showed),
 *   - names are matched or handed back, never guessed,
 *   - the drop-in rule (not enrolled / ahead / makeup / paid outside),
 *   - nobody is ever charged: there is no saved card to charge, and no call to
 *     Square is ever made, however many times the charge is confirmed,
 *   - role gates and club scoping,
 *   - an honest refusal while the attendance tables are not installed.
 *
 * The fake Supabase below actually filters rows (eq/in/lte/...), so a query
 * that forgot its club_id or date filter returns the wrong rows here too.
 */

const TZ = 'America/Los_Angeles';
const CLUB = 'c1';

/** Thursdays Sep 3 – Oct 29, rained out Sep 17. Held through Oct 8: 9/3, 9/10, 9/24, 10/1, 10/8. */
const PROGRAM = {
  id: 'p1',
  club_id: CLUB,
  title: 'Ladies B Team Clinic',
  status: 'published',
  range_start: '2026-09-03',
  range_end: '2026-10-29',
  days_of_week: [4],
  exclusions: ['2026-09-17'],
  drop_in_price_cents: 3500,
};
const OTHER_CLUB_PROGRAM = { ...PROGRAM, id: 'px', club_id: 'c2', title: 'Ladies B Team Clinic' };

const REGS = [
  { id: 'r1', club_id: CLUB, program_id: 'p1', participant_name: 'Chitra Patel', status: 'enrolled', payment_status: 'paid', master_player_id: 'm1' },
  { id: 'r2', club_id: CLUB, program_id: 'p1', participant_name: 'Kersti Olsen', status: 'enrolled', payment_status: 'pending', master_player_id: null },
  { id: 'r3', club_id: CLUB, program_id: 'p1', participant_name: 'Leena Shah', status: 'waitlist', payment_status: 'pending', master_player_id: null },
];
const VAULT = [
  { id: 'v1', club_id: CLUB, full_name: 'Chitra Patel', master_player_id: 'm1' }, // same person as r1
  { id: 'v2', club_id: CLUB, full_name: 'Yvette Moreau', master_player_id: null },
  { id: 'v3', club_id: CLUB, full_name: 'Ann Smith', master_player_id: null },
  { id: 'v4', club_id: CLUB, full_name: 'Ann Jones', master_player_id: null },
  { id: 'v9', club_id: 'c2', full_name: 'Bob Otherclub', master_player_id: null },
];

type Row = Record<string, any>;

function fakeDb(seed: {
  attendance?: Row[];
  extras?: Row[];
  payments?: Row | null;
  installed?: boolean;
}) {
  const installed = seed.installed !== false;
  const tables: Record<string, Row[]> = {
    club_programs: [PROGRAM, OTHER_CLUB_PROGRAM],
    club_program_registrations: REGS,
    cc_vault_players: VAULT,
    club_program_attendance: (seed.attendance ?? []).map((r) => ({ is_makeup: false, makeup_note: null, paid_outside_at: null, paid_outside_note: null, registration_id: null, vault_player_id: null, club_id: CLUB, program_id: 'p1', ...r })),
    club_program_extra_meetings: (seed.extras ?? []).map((r) => ({ club_id: CLUB, program_id: 'p1', makes_up_for: null, ...r })),
    club_payments: seed.payments ? [{ club_id: CLUB, ...seed.payments }] : [],
  };
  const writes: { table: string; op: 'insert' | 'update'; rows: Row[] }[] = [];
  const missing = (t: string) => !installed && (t === 'club_program_attendance' || t === 'club_program_extra_meetings');
  const MISSING = { code: 'PGRST205', message: "Could not find the table 'public.club_program_attendance'" };
  let seq = 0;

  function query(table: string, mode: 'select' | 'update', patch?: Row) {
    const filters: ((r: Row) => boolean)[] = [];
    const node: any = {};
    const f = (fn: (r: Row) => boolean) => (filters.push(fn), node);
    node.select = () => node;
    node.eq = (c: string, v: unknown) => f((r) => r[c] === v);
    node.neq = (c: string, v: unknown) => f((r) => r[c] !== v);
    node.in = (c: string, v: unknown[]) => f((r) => v.includes(r[c]));
    node.lte = (c: string, v: string) => f((r) => String(r[c]) <= v);
    node.gte = (c: string, v: string) => f((r) => String(r[c]) >= v);
    node.is = (c: string, v: unknown) => f((r) => (r[c] ?? null) === v);
    node.order = () => node;
    node.limit = () => node;
    const exec = () => {
      if (missing(table)) return { data: null, error: MISSING };
      const hit = (tables[table] ?? []).filter((r) => filters.every((fn) => fn(r)));
      if (mode === 'update') {
        hit.forEach((r) => Object.assign(r, patch));
        writes.push({ table, op: 'update', rows: hit.map((r) => ({ ...r })) });
      }
      return { data: hit, error: null };
    };
    node.maybeSingle = () => Promise.resolve({ ...exec(), data: (exec().data ?? [])[0] ?? null });
    node.then = (fn: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(exec()).then(fn, rej);
    return node;
  }

  const db = {
    from(table: string) {
      const q = query(table, 'select');
      q.update = (patch: Row) => query(table, 'update', patch);
      q.insert = (rows: Row | Row[]) => {
        if (missing(table)) return Promise.resolve({ data: null, error: MISSING });
        const list = Array.isArray(rows) ? rows : [rows];
        // Enforce the migration's unique key, as Postgres would.
        if (table === 'club_program_attendance') {
          for (const r of list) {
            if (tables[table].some((x) => x.program_id === r.program_id && x.meeting_date === r.meeting_date && x.person_key === r.person_key)) {
              return Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate' } });
            }
          }
        }
        const made = list.map((r) => ({ id: `new${++seq}`, is_makeup: false, makeup_note: null, paid_outside_at: null, paid_outside_note: null, ...r }));
        tables[table].push(...made);
        writes.push({ table, op: 'insert', rows: made });
        return Promise.resolve({ data: made, error: null });
      };
      return q;
    },
  };
  return { db, writes, tables };
}

function setup(seed: Parameters<typeof fakeDb>[0] = {}, role = 'director') {
  const f = fakeDb(seed);
  const ctx = { userId: 'u1', db: f.db, clubId: CLUB, clubName: 'Test Club', clubSlug: 'test', timeZone: TZ, role };
  return { ...f, pack: bindPack(attendancePack, ctx as never) };
}

/** Attendance rows for a person on the given dates. */
const marks = (key: string, name: string, dates: string[], extra: Row = {}) =>
  dates.map((d, i) => ({ id: `${key}-${d}-${i}`, meeting_date: d, name, person_key: key, ...extra }));

const HELD = ['2026-09-03', '2026-09-10', '2026-09-24', '2026-10-01', '2026-10-08'];

afterEach(() => vi.restoreAllMocks());

// --------------------------------------------------------------------------

describe('matchName', () => {
  const roster: Candidate[] = [{ key: 'reg:1', name: 'Kersti Olsen', source: 'roster' }];
  const known: Candidate[] = [
    { key: 'v:1', name: 'Ann Smith', source: 'known' },
    { key: 'v:2', name: 'Ann Jones', source: 'known' },
  ];
  it('matches a first name, a near spelling, and refuses to pick between two', () => {
    expect(matchName('Kersti', roster, known)).toMatchObject({ kind: 'match', person: { key: 'reg:1' } });
    expect(matchName('Kirsti', roster, known)).toMatchObject({ kind: 'match', person: { key: 'reg:1' } });
    expect(matchName('Ann', roster, known)).toMatchObject({ kind: 'ambiguous', could_be: ['Ann Smith', 'Ann Jones'] });
    expect(matchName('Ann S', roster, known)).toMatchObject({ kind: 'match', person: { key: 'v:1' } });
    expect(matchName('Zelda', roster, known)).toMatchObject({ kind: 'none' });
  });
});

describe('mark_attendance', () => {
  const input = { class: "tonight's B team clinic", date: '2026-10-08', names: ['Chitra', 'Kersty', 'Leena', 'Yvette', 'Zelda', 'Ann'] };

  it('previews without writing, and the run records exactly the previewed people', async () => {
    const { pack, writes } = setup();
    const preview = await pack.execute('mark_attendance', input);
    expect(preview.needsConfirm).toBe(true);
    expect(writes).toHaveLength(0);
    expect((preview.will_mark as Row[]).map((w) => w.name)).toEqual(['Chitra Patel', 'Kersti Olsen', 'Leena Shah', 'Yvette Moreau']);
    expect(preview.unmatched).toEqual(['Zelda']);
    expect(preview.ambiguous).toEqual([{ typed: 'Ann', could_be: ['Ann Smith', 'Ann Jones'] }]);
    // Leena is waitlisted, Yvette is not on the roster: both flagged as drop-in candidates.
    expect((preview.will_mark as Row[]).filter((w) => w.note).map((w) => w.name)).toEqual(['Leena Shah', 'Yvette Moreau']);

    const done = await pack.execute('mark_attendance', { ...input, confirm: true });
    expect(done.ok).toBe(true);
    expect(done.will_mark).toEqual(preview.will_mark);
    expect(writes).toHaveLength(1);
    expect(writes[0].rows.map((r) => r.person_key)).toEqual(['reg:r1', 'reg:r2', 'reg:r3', 'vault:v2']);
    expect(writes[0].rows.every((r) => r.club_id === CLUB && r.program_id === 'p1' && r.meeting_date === '2026-10-08')).toBe(true);
  });

  it('does not mark anyone twice', async () => {
    const { pack, writes } = setup();
    await pack.execute('mark_attendance', { ...input, confirm: true });
    const again = await pack.execute('mark_attendance', { class: 'p1', date: '2026-10-08', names: ['Chitra Patel'], confirm: true });
    expect(again.ok).toBe(false);
    expect(again.already_marked).toEqual(['Chitra Patel']);
    expect(writes).toHaveLength(1);
  });

  it('records a confirmed guest by name only', async () => {
    const { pack, writes } = setup();
    const r = await pack.execute('mark_attendance', { class: 'p1', date: '2026-10-08', names: [], guest_names: ['Zelda Fitz'], confirm: true });
    expect(r.ok).toBe(true);
    expect(writes[0].rows[0]).toMatchObject({ name: 'Zelda Fitz', person_key: 'name:zelda fitz', registration_id: null, vault_player_id: null });
  });

  it('refuses a date the class does not meet, and never reaches another club', async () => {
    const { pack } = setup();
    const r = await pack.execute('mark_attendance', { class: 'p1', date: '2026-09-17', names: ['Chitra'] });
    expect(r.ok).toBe(false);
    expect(String(r.error)).toMatch(/add_extra_meeting/);
    const other = await pack.execute('mark_attendance', { class: 'px', date: '2026-10-08', names: ['Chitra'] });
    // 'px' belongs to club c2: not found by id here (the title would resolve to OUR class, never theirs).
    expect(other.ok).toBe(false);
    const bob = await pack.execute('mark_attendance', { class: 'p1', date: '2026-10-08', names: ['Bob Otherclub'] });
    expect(bob.unmatched).toEqual(['Bob Otherclub']);
  });

  it('lets a coach mark attendance but not front desk', async () => {
    expect((await setup({}, 'coach').pack.execute('mark_attendance', input)).ok).toBe(true);
    const fd = await setup({}, 'front_desk').pack.execute('mark_attendance', input);
    expect(fd.ok).toBe(false);
  });

  it('says plainly when the attendance tables are not installed', async () => {
    const { pack, writes } = setup({ installed: false });
    const r = await pack.execute('mark_attendance', { ...input, confirm: true });
    expect(r.ok).toBe(false);
    expect(String(r.error)).toMatch(/migration/);
    expect(writes).toHaveLength(0);
  });
});

describe('add_extra_meeting', () => {
  it('adds an unscheduled session, preview matching run, and it becomes markable', async () => {
    const { pack, writes } = setup();
    const input = { class: 'p1', date: '2026-10-06', makes_up_for: '2026-09-17' };
    const preview = await pack.execute('add_extra_meeting', input);
    expect(preview).toMatchObject({ needsConfirm: true, counts_toward_season: true });
    expect(writes).toHaveLength(0);
    const done = await pack.execute('add_extra_meeting', { ...input, confirm: true });
    expect(done.adding).toBe(preview.adding);
    expect(writes[0].rows[0]).toMatchObject({ meeting_date: '2026-10-06', makes_up_for: '2026-09-17', club_id: CLUB });
    const m = await pack.execute('mark_attendance', { class: 'p1', date: '2026-10-06', names: ['Chitra'] });
    expect(m.ok).toBe(true);
    expect(m.extra_session).toBe(true);
  });

  it('refuses a date already scheduled, and is managers only', async () => {
    const { pack } = setup();
    expect((await pack.execute('add_extra_meeting', { class: 'p1', date: '2026-10-08' })).ok).toBe(false);
    const coach = await setup({}, 'coach').pack.execute('add_extra_meeting', { class: 'p1', date: '2026-10-06' });
    expect(coach.ok).toBe(false);
  });
});

describe('drop_ins_owed', () => {
  it('not enrolled, waitlisted and ahead owe; season and makeup do not', async () => {
    const attendance = [
      ...marks('reg:r1', 'Chitra Patel', HELD, { registration_id: 'r1' }), // 5 of 5: covered
      // Kersti came to an extra (non-makeup) session on 10/6 as well: 6 vs 5 held.
      ...marks('reg:r2', 'Kersti Olsen', [...HELD, '2026-10-06'], { registration_id: 'r2' }),
      ...marks('reg:r3', 'Leena Shah', ['2026-10-08'], { registration_id: 'r3' }),
      ...marks('vault:v2', 'Yvette Moreau', ['2026-10-08'], { vault_player_id: 'v2' }),
      ...marks('vault:v3', 'Ann Smith', ['2026-10-08'], { vault_player_id: 'v3', is_makeup: true, makeup_note: 'rainout' }),
    ];
    const { pack } = setup({ attendance, extras: [{ id: 'e1', meeting_date: '2026-10-06' }] });

    const tonight = await pack.execute('drop_ins_owed', { class: 'B team', date: '2026-10-08' });
    expect(tonight.ok).toBe(true);
    expect(tonight.drop_in_price).toBe('$35');
    expect((tonight.owes as Row[]).map((o) => [o.name, o.reason])).toEqual([
      ['Leena Shah', 'on the waitlist, not enrolled'],
      ['Yvette Moreau', 'not enrolled in this class'],
    ]);
    expect(tonight.covered_by_season).toBe(2); // Chitra, and Kersti (her drop-in was the 10/6 session)
    expect(tonight.total).toBe('$70');
    expect(tonight.already_settled).toEqual([{ name: 'Ann Smith', how: 'makeup (rainout)' }]);

    // The extra session is the meeting she was ahead on, and it is counted once.
    const extra = await pack.execute('drop_ins_owed', { class: 'p1', date: '2026-10-06' });
    expect((extra.owes as Row[]).map((o) => o.name)).toEqual(['Kersti Olsen']);
    expect(String((extra.owes as Row[])[0].reason)).toMatch(/ahead/);
  });

  it('an extra session that makes up a rainout is owed to season sign-ups', async () => {
    const attendance = marks('reg:r2', 'Kersti Olsen', [...HELD, '2026-10-06'], { registration_id: 'r2' });
    const { pack } = setup({ attendance, extras: [{ id: 'e1', meeting_date: '2026-10-06', makes_up_for: '2026-09-17' }] });
    const r = await pack.execute('drop_ins_owed', { class: 'p1', date: '2026-10-06' });
    expect(r.owes).toEqual([]);
  });

  it('a paid drop-in drops off the list', async () => {
    const attendance = marks('vault:v2', 'Yvette Moreau', ['2026-10-08'], { vault_player_id: 'v2', paid_outside_at: '2026-10-08T20:00:00Z', paid_outside_note: 'Venmo' });
    const { pack } = setup({ attendance });
    const r = await pack.execute('drop_ins_owed', { class: 'p1', date: '2026-10-08' });
    expect(r.owes).toEqual([]);
    expect(r.already_settled).toEqual([{ name: 'Yvette Moreau', how: 'paid outside ClubMode (Venmo)' }]);
  });
});

describe('mark_makeup and mark_drop_in_paid', () => {
  const attendance = marks('vault:v2', 'Yvette Moreau', ['2026-10-08'], { vault_player_id: 'v2' });

  it('records paid outside ClubMode once, preview matching run', async () => {
    const { pack, writes } = setup({ attendance });
    const input = { class: 'p1', date: '2026-10-08', name: 'Yvette', method: 'Venmo' };
    const preview = await pack.execute('mark_drop_in_paid', input);
    expect(preview).toMatchObject({ needsConfirm: true, person: 'Yvette Moreau', method: 'Venmo', amount: '$35' });
    expect(writes).toHaveLength(0);
    const done = await pack.execute('mark_drop_in_paid', { ...input, confirm: true });
    expect(done.person).toBe(preview.person);
    expect(writes[0].rows[0]).toMatchObject({ paid_outside_note: 'Venmo' });
    const again = await pack.execute('mark_drop_in_paid', { ...input, confirm: true });
    expect(again.ok).toBe(false);
    expect(writes).toHaveLength(1);
  });

  it('marks a makeup, and refuses someone not marked present', async () => {
    const { pack, writes } = setup({ attendance });
    const done = await pack.execute('mark_makeup', { class: 'p1', date: '2026-10-08', name: 'Yvette', note: '9/17 rainout', confirm: true });
    expect(done.ok).toBe(true);
    expect(writes[0].rows[0]).toMatchObject({ is_makeup: true, makeup_note: '9/17 rainout' });
    const nope = await pack.execute('mark_makeup', { class: 'p1', date: '2026-10-08', name: 'Chitra' });
    expect(nope.ok).toBe(false);
    expect(String(nope.error)).toMatch(/isn't marked present/);
  });

  it('coaches cannot touch money records', async () => {
    const { pack } = setup({ attendance }, 'coach');
    expect((await pack.execute('mark_drop_in_paid', { class: 'p1', date: '2026-10-08', name: 'Yvette' })).ok).toBe(false);
    expect((await pack.execute('mark_makeup', { class: 'p1', date: '2026-10-08', name: 'Yvette' })).ok).toBe(false);
  });
});

describe('charge_drop_ins', () => {
  const attendance = [
    ...marks('reg:r3', 'Leena Shah', ['2026-10-08'], { registration_id: 'r3' }),
    ...marks('vault:v2', 'Yvette Moreau', ['2026-10-08'], { vault_player_id: 'v2' }),
  ];

  it('never charges: Square connected or not, previewed or confirmed, any number of times', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('Square must never be called');
    });
    for (const payments of [null, { provider: 'square', provider_status: 'connected' }]) {
      const { pack, writes } = setup({ attendance, payments });
      for (const confirm of [false, true, true]) {
        const r = await pack.execute('charge_drop_ins', { class: 'p1', date: '2026-10-08', confirm });
        expect(r.ok).toBe(false);
        expect(r.needsConfirm).toBeUndefined();
        expect((r.would_charge as Row[]).map((w) => `${w.name} ${w.amount}`)).toEqual(['Leena Shah $35', 'Yvette Moreau $35']);
        expect(r.total).toBe('$70');
        expect(String(r.error)).toMatch(payments ? /cards on file/ : /connected Square/);
      }
      expect(writes).toHaveLength(0);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('is managers only', async () => {
    const r = await setup({ attendance }, 'coach').pack.execute('charge_drop_ins', { class: 'p1', date: '2026-10-08' });
    expect(r.ok).toBe(false);
    expect(r.would_charge).toBeUndefined();
  });
});

describe('reads', () => {
  it('attendance_status shows which meetings are in', async () => {
    const attendance = marks('reg:r1', 'Chitra Patel', ['2026-10-01'], { registration_id: 'r1' });
    const { pack } = setup({ attendance });
    const r = await pack.execute('attendance_status', { class: 'p1', from: '2026-09-28', to: '2026-10-09' });
    expect((r.meetings as Row[]).map((m) => [m.date, m.attendance, m.marked_present, m.enrolled])).toEqual([
      ['2026-10-01', 'in', 1, 2],
      ['2026-10-08', 'NOT in', 0, 2],
    ]);
    expect(r.missing).toBe(1);
  });

  it('who_came lists names with flags', async () => {
    const attendance = [
      ...marks('reg:r1', 'Chitra Patel', ['2026-10-08'], { registration_id: 'r1' }),
      ...marks('vault:v2', 'Yvette Moreau', ['2026-10-08'], { vault_player_id: 'v2', paid_outside_at: 'x', paid_outside_note: 'cash' }),
    ];
    const r = await setup({ attendance }).pack.execute('who_came', { date: '2026-10-08' });
    expect(r.classes).toEqual([
      { class: 'Ladies B Team Clinic', present: [{ name: 'Chitra Patel' }, { name: 'Yvette Moreau', paid: 'cash', not_on_roster: true }] },
    ]);
  });

  it('only the writes carry a confirm flag', () => {
    const pack = setup().pack;
    const gated = pack.toolSchemas
      .filter((t) => 'confirm' in ((t.input_schema.properties as Record<string, unknown>) ?? {}))
      .map((t) => t.name)
      .sort();
    expect(gated).toEqual(['add_extra_meeting', 'charge_drop_ins', 'mark_attendance', 'mark_drop_in_paid', 'mark_makeup']);
  });
});
