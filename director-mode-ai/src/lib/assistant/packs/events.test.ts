import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

// Side systems the shared scoring/scheduling code reaches for. The behaviour
// under test is ours; these are checked only for having been called.
const sheetSync = vi.fn(async () => ({ adapter: 'disabled' }));
vi.mock('@/lib/courtsheet/adapters/tournaments', () => ({ syncTournamentEvent: (...a: unknown[]) => sheetSync(...(a as [])) }));
vi.mock('@/lib/tournamentPlayoffs', () => ({ syncPlacementPlayoffs: vi.fn(async () => null) }));
vi.mock('@/lib/flexPlayoffs', () => ({ syncFlexPlayoffsForEvent: vi.fn(async () => null) }));

import { bindPack } from '../framework';
import { eventsPack, divisionMatches, findScheduleConflicts, type SlotItem } from './events';

/**
 * Same property as programs.test.ts: PREVIEW AND RUN AGREE, nothing is written
 * until confirm, and nothing outside the club is reachable. Driven through the
 * real framework binding against an in-memory Supabase stand-in that filters.
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
    const orders: { c: string; asc: boolean }[] = [];
    let limit: number | undefined;

    const exec = async () => {
      if (op === 'insert') {
        const items = (Array.isArray(payload) ? payload : [payload]).map((p: Row) => ({
          id: `new-${++seq}`,
          created_at: new Date().toISOString(),
          registered_at: new Date().toISOString(),
          ...p,
        }));
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
      for (const o of [...orders].reverse())
        hit = [...hit].sort((a, b) => {
          const x = a[o.c] ?? '';
          const y = b[o.c] ?? '';
          const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
          return o.asc ? c : -c;
        });
      if (limit != null) hit = hit.slice(0, limit);
      return { data: hit, error: null, count: hit.length };
    };

    const q: any = {
      select: () => q,
      eq: (c: string, v: unknown) => (filters.push((r) => String(r[c]) === String(v)), q),
      neq: (c: string, v: unknown) => (filters.push((r) => String(r[c]) !== String(v)), q),
      in: (c: string, v: unknown[]) => (filters.push((r) => v.includes(r[c])), q),
      is: (c: string, v: unknown) => (filters.push((r) => (r[c] ?? null) === v), q),
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

const OWNER = 'owner-1';
const CLUB = { id: 'c1', owner_id: OWNER };

const baseEvent = {
  user_id: OWNER,
  club_id: 'c1',
  slug: null,
  event_code: null,
  end_date: null,
  start_time: '08:00:00',
  end_time: null,
  daily_start_time: '08:00:00',
  daily_end_time: '18:00:00',
  num_courts: 2,
  court_names: null,
  court_windows: null,
  default_match_length_minutes: 60,
  player_rest_minutes: 30,
  match_buffer_minutes: 0,
  round_duration_minutes: 45,
  entry_fee_cents: 4000,
  max_players: 4,
  divisions: null,
  entry_flow: 'pay_now',
  hub_slug: null,
  hub_title: null,
  series_slug: null,
  registration_closes_at: '2026-10-15T07:00:00Z',
  public_registration: true,
  external_payment_url: null,
};

const TOURNEY = {
  ...baseEvent,
  id: 'e-t',
  name: 'Fall Classic — Men\'s Singles',
  slug: 'fall-classic-ms',
  match_format: 'single-elim-singles',
  public_status: 'open',
  event_date: '2026-10-17',
};
const TOURNEY_W = { ...TOURNEY, id: 'e-tw', name: 'Fall Classic — Women\'s Singles', slug: 'fall-classic-ws' };

const QUADS = {
  ...baseEvent,
  id: 'e-q',
  name: 'Dunkin Quads',
  slug: 'dunkin-quads',
  match_format: 'quads',
  public_status: 'open',
  event_date: '2026-10-24',
  entry_fee_cents: 3500,
  max_players: 24,
  entry_flow: 'request_then_invite',
  divisions: [
    { id: '10u', label: '10 & Under', age_max: 10, sort: 0 },
    { id: 'g12', label: 'Girls 12 & Under', age_max: 12, sort: 1 },
  ],
};

const OTHER_CLUB = { ...TOURNEY, id: 'e-x', club_id: 'c2', user_id: 'someone', name: 'Fall Classic — Other Club' };
const LEGACY = { ...TOURNEY, id: 'e-l', club_id: null, name: 'Old Owner Mixer', match_format: 'doubles', slug: null, event_code: 'ABC123', public_status: 'open', event_date: '2026-10-20', public_registration: false };
const LAST_YEAR = { ...TOURNEY, id: 'e-ly', name: 'Fall Classic 2025 — Men\'s Singles', public_status: 'completed', event_date: '2025-10-18' };

const te = (id: string, event_id: string, name: string, extra: Row = {}) => ({
  id,
  event_id,
  player_name: name,
  partner_name: null,
  position: 'in_draw',
  payment_status: 'paid',
  amount_paid_cents: 4000,
  registered_at: '2026-10-01T17:00:00Z',
  created_at: '2026-10-01T17:00:00Z',
  gender: 'male',
  composite_rating: 10,
  seed: null,
  ...extra,
});

const qe = (id: string, name: string, division: string, extra: Row = {}) => ({
  id,
  event_id: 'e-q',
  player_name: name,
  division,
  position: 'in_flight',
  payment_status: 'paid',
  amount_paid_cents: 3500,
  discount_percent: null,
  registered_at: '2026-10-02T17:00:00Z',
  created_at: '2026-10-02T17:00:00Z',
  payment_due_at: null,
  gender: 'female',
  composite_rating: 5,
  ...extra,
});

function seed() {
  return {
    cc_clubs: [CLUB],
    events: [TOURNEY, TOURNEY_W, QUADS, OTHER_CLUB, LEGACY, LAST_YEAR],
    tournament_entries: [
      te('a', 'e-t', 'Andy Adams', { composite_rating: 12 }),
      te('b', 'e-t', 'Ben Brown', { composite_rating: 11, payment_status: 'pending', amount_paid_cents: null }),
      te('c', 'e-t', 'Carl Cole', { composite_rating: 9 }),
      te('d', 'e-t', 'Dan Diaz', { composite_rating: 8, registered_at: '2026-10-09T16:00:00Z' }),
      te('w1', 'e-t', 'Walt Wait', { position: 'waitlist', payment_status: 'pending', amount_paid_cents: null, registered_at: '2026-10-05T17:00:00Z' }),
      te('w2', 'e-t', 'Will Later', { position: 'waitlist', payment_status: 'pending', amount_paid_cents: null, registered_at: '2026-10-06T17:00:00Z' }),
      te('ws1', 'e-tw', 'Wendy Smith', { gender: 'female' }),
      te('x1', 'e-x', 'Other Club Person'),
      te('ly1', 'e-ly', 'Prior One'),
      te('ly2', 'e-ly', 'Prior Two'),
    ],
    quad_entries: [
      qe('q1', 'Gia Green', 'g12'),
      qe('q2', 'Hana Hill', 'g12', { position: 'pending_payment', payment_status: 'pending', amount_paid_cents: null, payment_due_at: '2026-10-10T07:00:00Z' }),
      qe('q3', 'Ivy Ito', 'g12', { position: 'waitlist', payment_status: 'pending', amount_paid_cents: null }),
      qe('q4', 'Kid Ten', '10u', { position: 'waitlist', payment_status: 'pending', amount_paid_cents: null, registered_at: '2026-10-01T00:00:00Z' }),
    ],
    tournament_matches: [] as Row[],
    event_players: [] as Row[],
    event_teams: [] as Row[],
    courts: Array.from({ length: 9 }, (_, i): Row => ({ id: `ct${i}`, club_id: 'c1', status: 'active', parent_court_id: null })).concat([
      { id: 'sub', club_id: 'c1', status: 'active', parent_court_id: 'ct0' },
      { id: 'other', club_id: 'c2', status: 'active', parent_court_id: null },
    ]),
  };
}

function setup(role = 'director', s = seed()) {
  const f = fakeDb(s);
  const ctx = { userId: OWNER, db: f.db as never, clubId: 'c1', clubName: 'Test Club', clubSlug: 'test', timeZone: TZ, role };
  return { ...f, pack: bindPack(eventsPack, ctx) };
}

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-09T19:00:00Z')); // noon Friday, Oct 9 at the club
});
afterAll(() => vi.useRealTimers());

// ------------------------------------------------------------------ pure

describe('divisionMatches', () => {
  it('reads director shorthand', () => {
    expect(divisionMatches('G12', 'Girls 12 & Under')).toBe(true);
    expect(divisionMatches('12U', 'Girls 12 & Under')).toBe(true);
    expect(divisionMatches('G12', '10 & Under')).toBe(false);
    expect(divisionMatches("women's", "Women's Singles")).toBe(true);
    expect(divisionMatches('gold', 'Silver')).toBe(false);
  });
});

describe('findScheduleConflicts', () => {
  const rules = { matchLengthMinutes: 60, restMinutes: 30, courts: Array.from({ length: 9 }, (_, i) => String(i + 1)), dailyStart: '08:00', dailyEnd: '19:00' };
  const m = (id: string, time: string, court: string | null, players: string[], extra: Partial<SlotItem> = {}): SlotItem => ({
    id, label: id, date: '2026-10-17', time, court, players, status: 'pending', ...extra,
  });

  it('flags 10 matches at 8am on 9 courts', () => {
    const items = Array.from({ length: 10 }, (_, i) => m(`m${i}`, '08:00', String((i % 9) + 1), [`p${i}a`, `p${i}b`]));
    const c = findScheduleConflicts(items, rules);
    expect(c.some((x) => x.type === 'over_capacity' && x.detail.startsWith('10 matches'))).toBe(true);
    expect(c.some((x) => x.type === 'court_double_booked')).toBe(true);
  });

  it('flags player double-booking, short rest, a daily cap and feeder order', () => {
    const items = [
      m('r1', '08:00', '1', ['amy', 'bob']),
      m('r2', '08:30', '2', ['amy', 'cat']),
      m('r3', '10:00', '3', ['bob', 'dan']), // bob rests 60 → fine
      m('r4', '11:15', '4', ['bob', 'eve']), // bob rests 15 → short
      m('f', '08:30', '5', ['x', 'y'], { predecessors: ['r1'] }), // before r1 ends
    ];
    const types = findScheduleConflicts(items, { ...rules, maxPerPlayerPerDay: 2 }).map((x) => x.type);
    expect(types).toContain('player_double_booked');
    expect(types).toContain('short_rest');
    expect(types).toContain('over_daily_cap');
    expect(types).toContain('before_feeder');
  });

  it('is quiet about a clean schedule', () => {
    expect(findScheduleConflicts([m('a', '08:00', '1', ['p', 'q']), m('b', '09:30', '1', ['p', 'r'])], rules)).toEqual([]);
  });
});

// ------------------------------------------------------------------ reads

describe('scope and reads', () => {
  it('never reaches another club, but sees the owner\'s club-less events', async () => {
    const { pack } = setup();
    const r = await pack.execute('event_signups', { event: 'Fall Classic Other Club' });
    expect(r.ok).toBe(false);
    const legacy = await pack.execute('event_share_link', { event: 'Old Owner Mixer' });
    expect(legacy.ok).toBe(true);
    expect(JSON.stringify(legacy)).toContain('/event/ABC123');
  });

  it('reports a competition by division, with today\'s sign-ups', async () => {
    const { pack } = setup();
    const r: any = await pack.execute('event_signups', { event: 'Fall Classic' });
    expect(r.ok).toBe(true);
    const men = r.by_division.find((d: any) => d.division === "Men's Singles");
    expect(men).toMatchObject({ entered: 4, waitlist: 2, cap: 4 });
    expect(r.by_division.find((d: any) => d.division === "Women's Singles").entered).toBe(1);
    expect(r.new_since.entries.map((e: any) => e.name)).toEqual(['Dan Diaz']);
  });

  it('splits paid, owes and waitlist-not-due', async () => {
    const { pack } = setup();
    const r: any = await pack.execute('event_payments', { event: 'e-t' });
    expect(r.still_owe.map((x: any) => x.name)).toEqual(['Ben Brown']);
    expect(r.waitlist_unpaid_not_yet_due.map((x: any) => x.name)).toEqual(['Walt Wait', 'Will Later']);
    expect(r.paid).toHaveLength(3);
    expect(r.collected_in_app).toBe('$120');
  });

  it('lists what is open, and compares to last year', async () => {
    const { pack } = setup();
    const l: any = await pack.execute('list_events', {});
    const names = l.open_for_signups.map((e: any) => e.name);
    expect(names).toContain('Dunkin Quads');
    expect(names).not.toContain('Fall Classic — Other Club');
    const c: any = await pack.execute('compare_to_last_year', { event: 'e-t' });
    expect(c.ok).toBe(true);
    expect(c.this_year.entries).toBe(6);
    expect(c.last_year.entries).toBe(2);
  });
});

// ------------------------------------------------------------------ writes

async function previewThenRun(pack: ReturnType<typeof setup>['pack'], writes: () => unknown[], tool: string, input: Row) {
  const p: any = await pack.execute(tool, input);
  expect(p.ok, JSON.stringify(p)).toBe(true);
  expect(p.needsConfirm).toBe(true);
  expect(writes()).toHaveLength(0);
  const r: any = await pack.execute(tool, { ...input, confirm: true });
  expect(r.ok).toBe(true);
  expect(r.did).toEqual(p.will);
  return { p, r };
}

describe('writes: preview == run, nothing before confirm', () => {
  it('coaches cannot write', async () => {
    const { pack, writes } = setup('coach');
    const r = await pack.execute('add_late_entry', { event: 'Dunkin', division: 'G12', player_name: 'New Kid', confirm: true });
    expect(r.ok).toBe(false);
    expect(writes()).toHaveLength(0);
  });

  it('adds a late entry to G12 (quads request flow, fee owed)', async () => {
    const { pack, writes, tables } = setup();
    const { p } = await previewThenRun(pack, writes, 'add_late_entry', { event: 'Dunkin', division: 'G12', player_name: 'Nora New' });
    expect(p.will).toMatchObject({ division: 'Girls 12 & Under', position: 'requested', payment: 'owes $35 (not charged)' });
    const row = tables.quad_entries.find((e) => e.player_name === 'Nora New');
    expect(row).toMatchObject({ division: 'g12', position: 'requested', payment_status: 'pending', event_id: 'e-q' });
  });

  it('withdraws a player and moves the first alternate in', async () => {
    const { pack, writes, tables } = setup();
    await previewThenRun(pack, writes, 'move_entry', { event: 'e-t', player: 'Ben Brown', to: 'withdrawn' });
    const pos = Object.fromEntries(tables.tournament_entries.map((e) => [e.id, e.position]));
    expect(pos).toMatchObject({ b: 'withdrawn', w1: 'in_draw', w2: 'waitlist' });
    expect(tables.tournament_entries.find((e) => e.id === 'b')!.payment_status).toBe('pending');
  });

  it('promotes the alternate within the same quads division only', async () => {
    const { pack, writes, tables } = setup();
    await previewThenRun(pack, writes, 'move_entry', { event: 'Dunkin', division: 'G12', to: 'promote_alternate' });
    expect(tables.quad_entries.find((e) => e.id === 'q3')!.position).toBe('in_flight');
    expect(tables.quad_entries.find((e) => e.id === 'q4')!.position).toBe('waitlist');
  });

  it('extends the payment hold to a club-local time', async () => {
    const { pack, writes, tables } = setup();
    await previewThenRun(pack, writes, 'extend_deadline', { event: 'Dunkin', which: 'payment_hold', new_deadline: '2026-10-11T00:00' });
    expect(tables.quad_entries.find((e) => e.id === 'q2')!.payment_due_at).toBe('2026-10-11T07:00:00.000Z');
    expect(tables.quad_entries.find((e) => e.id === 'q1')!.payment_due_at).toBeNull();
  });

  it('generates the draw, schedules it, scores through the shared path', async () => {
    const { pack, writes, tables, log } = setup();
    // Division required for a write on a multi-division competition.
    const amb: any = await pack.execute('generate_draw', { event: 'Fall Classic' });
    expect(amb.ok).toBe(false);
    expect(amb.candidates).toHaveLength(2);

    const { p } = await previewThenRun(pack, writes, 'generate_draw', { event: 'Fall Classic', division: "men's" });
    expect(p.will.seeds_in_order[0]).toBe('1. Andy Adams');
    expect(tables.tournament_matches).toHaveLength(3); // 4-draw single elim
    expect(tables.events.find((e) => e.id === 'e-t')!.public_status).toBe('running');

    log.length = 0;
    const s = await previewThenRun(pack, () => log.filter((l) => l.op !== 'select'), 'schedule_matches', {
      event: 'e-t', courts: 9, start_time: '08:00', end_time: '18:30', rest_minutes: 30,
    });
    expect(s.p.will.will_schedule).toBe(3);
    expect(s.p.will.conflicts_after).toEqual([]);
    expect(tables.tournament_matches.every((m) => m.court && m.scheduled_at && m.scheduled_date === '2026-10-17')).toBe(true);
    expect(tables.events.find((e) => e.id === 'e-t')!).toMatchObject({ num_courts: 9, daily_end_time: '18:30' });
    expect(sheetSync).toHaveBeenCalledWith('e-t');

    const chk: any = await pack.execute('check_schedule', { event: 'e-t' });
    expect(chk.results[0].conflict_count).toBe(0);

    // R1 match with the 4 seed: Andy (1) v Dan (4). Dan wins, typed winner-first.
    const r1 = tables.tournament_matches.find((m) => m.round === 1 && [m.player1_id, m.player3_id].includes('d'))!;
    log.length = 0;
    const res = await previewThenRun(pack, () => log.filter((l) => l.op !== 'select'), 'enter_result', {
      event: 'e-t', winner: 'Dan Diaz', score: '6-3 6-4',
    });
    const danSide = r1.player1_id === 'd' ? 'a' : 'b';
    expect(res.p.will.score_as_stored).toBe(danSide === 'a' ? '6-3, 6-4' : '3-6, 4-6');
    expect(r1).toMatchObject({ status: 'completed', winner_side: danSide, reported_by_name: 'Director (Ask ClubMode)' });
    const final = tables.tournament_matches.find((m) => m.round === 2)!;
    expect([final.player1_id, final.player3_id]).toContain('d');

    // A scored draw cannot be regenerated.
    const again: any = await pack.execute('generate_draw', { event: 'e-t' });
    expect(again.ok).toBe(false);
  });

  it('creates a team battle as a draft on all courts', async () => {
    const { pack, writes, tables } = setup();
    const { p } = await previewThenRun(pack, writes, 'create_event', {
      name: 'Coaches Cup', format: 'team-battle', date: '2026-10-13', start_time: '10:00', end_time: '13:00', courts: 'max',
    });
    expect(p.will.courts).toBe(9);
    const ev = tables.events.find((e) => e.name === 'Coaches Cup')!;
    expect(ev).toMatchObject({ public_status: 'draft', club_id: 'c1', user_id: OWNER, num_courts: 9, duration_minutes: 180 });
    expect(tables.event_teams.filter((t) => t.event_id === ev.id)).toHaveLength(2);
  });

  it('refuses tournaments in create_event and quads in schedule_matches', async () => {
    const { pack, writes } = setup();
    expect((await pack.execute('create_event', { name: 'X', format: 'single-elim-singles', date: '2026-10-20', start_time: '09:00' })).ok).toBe(false);
    expect((await pack.execute('schedule_matches', { event: 'Dunkin' })).ok).toBe(false);
    expect(writes()).toHaveLength(0);
  });
});
