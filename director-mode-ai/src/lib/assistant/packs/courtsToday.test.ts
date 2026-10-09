import { describe, it, expect } from 'vitest';
import { bindPack } from '../framework';
import { courtsTodayPack } from './courtsToday';

/**
 * What these guard:
 *   1. PREVIEW AND RUN AGREE — what the director approves is what is written.
 *   2. CONFLICTS ARE SURFACED, NEVER OVERWRITTEN — a colliding booking is not
 *      offered for confirmation, and nothing already on the sheet changes.
 *   3. Permissions and ownership — coaches read (and move their own lessons),
 *      rows owned by a class / member booking are not touched.
 *
 * The fake Supabase is a tiny in-memory table store that actually applies the
 * filters, so the CourtSheet planner, detectConflicts and applyPlan run for
 * real against it. Timestamps are stored the way PostgREST returns them
 * ("+00:00"), not the way JS writes them (".000Z") — the difference once made
 * back-to-back bookings look like collisions.
 */

const TZ = 'America/Los_Angeles';
const CLUB = 'club-1';
const DIRECTOR = 'u-director';
const COACH = 'u-coach';

/** Club-local wall time → the string PostgREST would hand back. PDT = UTC-7 in Oct 2026. */
function pg(date: string, hhmm: string): string {
  return new Date(`${date}T${hhmm}:00-07:00`).toISOString().replace('.000Z', '+00:00');
}

type Row = Record<string, any>;

function courts(): Row[] {
  const out: Row[] = [];
  for (let n = 1; n <= 11; n++) {
    out.push({ id: `ct${n}`, club_id: CLUB, number: n, name: null, sports: ['tennis'], surface: 'hard', indoor: false, status: 'active', display_order: n, parent_court_id: null });
  }
  out.push({ id: 'ct11a', club_id: CLUB, number: null, name: '11a', sports: ['pickleball'], surface: 'hard', indoor: false, status: 'active', display_order: 12, parent_court_id: 'ct11' });
  out.push({ id: 'ct11b', club_id: CLUB, number: null, name: '11b', sports: ['pickleball'], surface: 'hard', indoor: false, status: 'active', display_order: 13, parent_court_id: 'ct11' });
  // Another club's court — must never show up.
  out.push({ id: 'other-ct', club_id: 'club-2', number: 1, name: null, sports: [], surface: null, indoor: false, status: 'active', display_order: 1, parent_court_id: null });
  return out;
}

let seq = 0;
function res(p: Partial<Row> & { court_id: string; date: string; start: string; end: string; title: string }): Row {
  const { date, start, end, ...rest } = p;
  return {
    id: rest.id ?? `r${++seq}`,
    club_id: CLUB,
    series_id: null,
    starts_at: pg(date, start),
    ends_at: pg(date, end),
    type: 'event',
    source: 'manual',
    source_id: null,
    status: 'confirmed',
    color: null,
    signups_open: false,
    signups_capacity: null,
    signups_pitch: null,
    meta: {},
    created_by: DIRECTOR,
    ...rest,
  };
}

// Sat Oct 10 / Sun Oct 11 / Tue Oct 13, 2026.
const SAT = '2026-10-10';
const SUN = '2026-10-11';
const TUE = '2026-10-13';

function fixtures(): Record<string, Row[]> {
  return {
    cc_clubs: [{ id: CLUB, slug: 'test', name: 'Sleepy Hollow Swim & Tennis Club', timezone: TZ, operating_hours: {}, is_public: true, owner_id: DIRECTOR }],
    courts: courts(),
    reservations: [
      res({ id: 'member4', court_id: 'ct4', date: SAT, start: '16:00', end: '17:00', type: 'member', source: 'courtconnect', title: 'Court booking — Owen' }),
      res({ id: 'evening5', court_id: 'ct5', date: SAT, start: '18:00', end: '19:00', type: 'member', title: 'Evening doubles' }),
      res({ id: 'julia1', court_id: 'ct7', date: SAT, start: '09:00', end: '10:00', type: 'lesson', title: 'Julia — Smith', created_by: COACH }),
      res({ id: 'julia2', court_id: 'ct8', date: SAT, start: '10:00', end: '11:00', type: 'lesson', title: 'Julia — Lee', created_by: COACH }),
      res({ id: 'prog2', court_id: 'ct2', date: SAT, start: '08:00', end: '09:00', type: 'member', source: 'programs', title: 'Pickleball open play' }),
      res({ id: 'raj10', court_id: 'ct10', date: SAT, start: '14:00', end: '15:00', type: 'lesson', title: 'Private — Raj' }),
      res({ id: 'pb11a', court_id: 'ct11a', date: SAT, start: '12:00', end: '13:00', type: 'member', title: 'Pickleball hit' }),
      res({ id: 'jt3', court_id: 'ct3', date: SUN, start: '13:00', end: '18:00', title: 'Junior tournament', source: 'ai' }),
      res({ id: 'jt4', court_id: 'ct4', date: SUN, start: '13:00', end: '18:00', title: 'Junior tournament', source: 'ai', signups_open: true }),
      res({ id: 'social3', court_id: 'ct3', date: SUN, start: '18:00', end: '19:00', title: 'Sunday social' }),
      ...[1, 2, 3, 4].map((n) => res({ id: `b2-${n}`, court_id: `ct${n}`, date: TUE, start: '09:30', end: '12:30', type: 'match', title: 'Fall B2 vs OCC' })),
      // Other club, same time as everything — must be invisible.
      res({ id: 'other', club_id: 'club-2', court_id: 'other-ct', date: SAT, start: '15:00', end: '18:00', title: 'Other club thing' }),
    ],
    reservation_signups: [{ id: 's1', reservation_id: 'jt4', status: 'confirmed' }],
    reservation_series: [],
    courtsheet_audit_log: [],
    club_programs: [
      { id: 'p1', club_id: CLUB, title: 'Saturday Juniors', status: 'published', range_start: '2026-09-01', range_end: '2026-12-01', days_of_week: [6], exclusions: [], time_start: '09:00:00', time_end: '10:30:00', registration_mode: 'open', registration_opens_at: null, registration_closes_at: null },
    ],
    events: [
      { id: 'e1', club_id: CLUB, user_id: DIRECTOR, name: "Dunkin' Quads", match_format: 'quads', public_status: 'open', event_date: SAT, end_date: null, start_time: '13:00:00', end_time: null, daily_start_time: null, public_registration: true },
      { id: 'e2', club_id: CLUB, user_id: DIRECTOR, name: 'Draft thing', match_format: null, public_status: 'draft', event_date: SAT, end_date: null, start_time: null, end_time: null, daily_start_time: null, public_registration: false },
    ],
    captain_teams: [
      { id: 't12', club_id: CLUB, name: '12U Yellow Ball Fall 2026', archived: false },
      { id: 't14', club_id: CLUB, name: '14U Intermediate Fall 2026', archived: false },
      { id: 'tb2', club_id: CLUB, name: 'Fall B2/B3 2026', archived: false },
    ],
    captain_matches: [
      { id: 'm1', team_id: 't12', match_at: pg(SUN, '16:00'), is_home: true, opponent: 'MCC', location: null, status: 'scheduled' },
      { id: 'm2', team_id: 't14', match_at: pg(SAT, '10:00'), is_home: false, opponent: 'OCC', location: 'Orinda CC', status: 'scheduled' },
      { id: 'm3', team_id: 'tb2', match_at: pg(SAT, '14:00'), is_home: true, opponent: 'Round Hill', location: null, status: 'scheduled' },
    ],
    leagues: [],
    league_divisions: [],
    league_team_matchups: [],
    league_clubs: [],
    lesson_coaches: [{ id: 'lc1', club_id: CLUB, display_name: 'Julia' }],
    lesson_slots: [
      { id: 'ls1', coach_id: 'lc1', start_time: pg(SAT, '11:00'), end_time: pg(SAT, '12:00'), status: 'booked', guest_name: 'Amy', court_id: null },
      { id: 'ls2', coach_id: 'lc1', start_time: pg(SAT, '12:00'), end_time: pg(SAT, '13:00'), status: 'open', guest_name: null, court_id: null },
    ],
    pf_games: [{ id: 'g1', club_id: CLUB, starts_at: pg(SAT, '17:00'), duration_min: 90, format: 'doubles', spots_needed: 1, court: null, status: 'open' }],
  };
}

// ---------------------------------------------------------------- fake db

const TS = /^\d{4}-\d{2}-\d{2}T/;
const cmp = (a: any, b: any) =>
  typeof a === 'string' && typeof b === 'string' && TS.test(a) && TS.test(b)
    ? Date.parse(a) - Date.parse(b)
    : a < b ? -1 : a > b ? 1 : 0;

function fakeDb(tables: Record<string, Row[]>) {
  const writes: { table: string; op: string; rows: Row[] }[] = [];
  let ids = 0;

  class Q {
    private filters: ((r: Row) => boolean)[] = [];
    private mode: 'select' | 'insert' | 'update' | 'delete' = 'select';
    private payload: Row[] = [];
    private patch: Row = {};
    private sortKey: string | null = null;
    private asc = true;
    private max: number | null = null;
    constructor(private table: string) {}
    select() { return this; }
    eq(k: string, v: any) { this.filters.push((r) => r[k] === v); return this; }
    neq(k: string, v: any) { this.filters.push((r) => r[k] !== v); return this; }
    in(k: string, vs: any[]) { this.filters.push((r) => vs.includes(r[k])); return this; }
    is(k: string, v: any) { this.filters.push((r) => (v === null ? r[k] == null : r[k] === v)); return this; }
    gte(k: string, v: any) { this.filters.push((r) => r[k] != null && cmp(r[k], v) >= 0); return this; }
    gt(k: string, v: any) { this.filters.push((r) => r[k] != null && cmp(r[k], v) > 0); return this; }
    lte(k: string, v: any) { this.filters.push((r) => r[k] != null && cmp(r[k], v) <= 0); return this; }
    lt(k: string, v: any) { this.filters.push((r) => r[k] != null && cmp(r[k], v) < 0); return this; }
    order(k: string, o?: { ascending?: boolean }) { this.sortKey = k; this.asc = o?.ascending !== false; return this; }
    limit(n: number) { this.max = n; return this; }
    insert(rows: Row | Row[]) { this.mode = 'insert'; this.payload = Array.isArray(rows) ? rows : [rows]; return this; }
    update(p: Row) { this.mode = 'update'; this.patch = p; return this; }
    delete() { this.mode = 'delete'; return this; }
    private exec(): { data: Row[]; error: null } {
      const t = (tables[this.table] ??= []);
      const match = (r: Row) => this.filters.every((f) => f(r));
      if (this.mode === 'insert') {
        const made = this.payload.map((r) => {
          const row: Row = { id: `new-${++ids}`, status: 'confirmed', ...r };
          for (const k of ['starts_at', 'ends_at']) {
            if (typeof row[k] === 'string') row[k] = row[k].replace('.000Z', '+00:00');
          }
          return row;
        });
        t.push(...made);
        writes.push({ table: this.table, op: 'insert', rows: made });
        return { data: made, error: null };
      }
      if (this.mode === 'update') {
        const hit = t.filter(match);
        for (const r of hit) Object.assign(r, this.patch);
        writes.push({ table: this.table, op: 'update', rows: hit.map((r) => ({ ...r })) });
        return { data: hit, error: null };
      }
      if (this.mode === 'delete') {
        const keep = t.filter((r) => !match(r));
        writes.push({ table: this.table, op: 'delete', rows: t.filter(match) });
        tables[this.table] = keep;
        return { data: [], error: null };
      }
      let out = t.filter(match).map((r) => ({ ...r }));
      if (this.sortKey) {
        const k = this.sortKey;
        out.sort((a, b) => (this.asc ? 1 : -1) * cmp(a[k], b[k]));
      }
      if (this.max != null) out = out.slice(0, this.max);
      return { data: out, error: null };
    }
    then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) {
      return Promise.resolve(this.exec()).then(res, rej);
    }
    maybeSingle() { return Promise.resolve({ data: this.exec().data[0] ?? null, error: null }); }
    single() {
      const d = this.exec().data[0] ?? null;
      return Promise.resolve({ data: d, error: d ? null : { message: 'no rows' } });
    }
  }

  return { db: { from: (t: string) => new Q(t) }, writes };
}

function setup(role = 'director', userId = DIRECTOR) {
  const tables = fixtures();
  const f = fakeDb(tables);
  const ctx = { userId, db: f.db as never, clubId: CLUB, clubName: 'Sleepy Hollow Swim & Tennis Club', clubSlug: 'test', timeZone: TZ, role };
  const pack = bindPack(courtsTodayPack, ctx as never);
  const resWrites = () => f.writes.filter((w) => w.table === 'reservations');
  const row = (id: string) => tables.reservations.find((r) => r.id === id)!;
  const live = () => tables.reservations.filter((r) => r.status !== 'cancelled' && r.club_id === CLUB);
  return { pack, tables, writes: f.writes, resWrites, row, live };
}

// ----------------------------------------------------------------- tests

describe('the confirm gate', () => {
  it('adds confirm to exactly the four writes', () => {
    const { pack } = setup();
    const gated = pack.toolSchemas
      .filter((t) => 'confirm' in ((t.input_schema.properties as Record<string, unknown>) ?? {}))
      .map((t) => t.name)
      .sort();
    expect(gated).toEqual(['book_courts', 'cancel_reservations', 'change_reservation_times', 'move_reservations']);
  });
});

describe('book_courts — "block 3-6 Saturday 3:30 to 6 for the junior tournament"', () => {
  const ask = { courts: ['3-6'], date: SAT, time_start: '15:30', time_end: '18:00', title: 'Junior tournament', type: 'event' };

  it('lists the collision instead of offering it for confirmation, and writes nothing', async () => {
    const s = setup();
    const r = await s.pack.execute('book_courts', ask);
    expect(r.ok).toBe(false);
    expect(r.needsConfirm).toBeUndefined();
    const conflicts = r.conflicts as string[];
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatch(/Court 4 .*Court booking — Owen.*member booking/);
    // Back-to-back is NOT a collision: Evening doubles starts at 6:00 on court 5.
    expect(conflicts.join(' ')).not.toMatch(/Evening doubles/);
    // Another club's booking at the same time is invisible.
    expect(conflicts.join(' ')).not.toMatch(/Other club/);
    expect(s.writes).toHaveLength(0);
  });

  it('confirming the refused request still writes nothing (no overwrite)', async () => {
    const s = setup();
    const r = await s.pack.execute('book_courts', { ...ask, confirm: true });
    expect(r.ok).toBe(false);
    expect(s.resWrites()).toHaveLength(0);
    expect(s.row('member4').status).toBe('confirmed');
  });

  it('with skip_conflicts, preview and run agree and the member booking is untouched', async () => {
    const s = setup();
    const preview = await s.pack.execute('book_courts', { ...ask, skip_conflicts: true });
    expect(preview.needsConfirm).toBe(true);
    expect((preview.will_book as any).slots).toBe(3);
    expect(preview.skipping_taken_slots).toHaveLength(1);
    expect(s.writes).toHaveLength(0);

    const run = await s.pack.execute('book_courts', { ...ask, skip_conflicts: true, confirm: true });
    expect(run.ok).toBe(true);
    expect(run.booked).toBe(3);
    expect(run.when).toEqual((preview.will_book as any).when);

    const inserted = s.resWrites().filter((w) => w.op === 'insert').flatMap((w) => w.rows);
    expect(inserted.map((r) => r.court_id).sort()).toEqual(['ct3', 'ct5', 'ct6']);
    expect(inserted.every((r) => r.club_id === CLUB && r.title === 'Junior tournament')).toBe(true);
    expect(s.resWrites().filter((w) => w.op === 'update')).toHaveLength(0);
    expect(s.row('member4').status).toBe('confirmed');
    // Audit row written, so CourtSheet's Undo works.
    expect(s.tables.courtsheet_audit_log).toHaveLength(1);
  });

  it('refuses a coach before planning anything', async () => {
    const s = setup('coach', COACH);
    const r = await s.pack.execute('book_courts', { ...ask, courts: [9], confirm: true });
    expect(r.ok).toBe(false);
    expect(String(r.error)).toMatch(/owner or director/);
    expect(s.writes).toHaveLength(0);
  });

  it('refuses an unknown court instead of silently dropping it', async () => {
    const s = setup();
    const r = await s.pack.execute('book_courts', { ...ask, courts: [3, 14] });
    expect(r.ok).toBe(false);
    expect(String(r.error)).toMatch(/No court called 14/);
  });
});

describe('book_courts — "courts 10, 11a, 11b Saturday 9-11 for Alex\'s class"', () => {
  it('books the three, preview == run', async () => {
    const s = setup();
    const ask = { courts: [10, '11a', '11b'], date: SAT, time_start: '09:00', time_end: '11:00', title: 'Alex — class', type: 'lesson' };
    const preview = await s.pack.execute('book_courts', ask);
    expect(preview.needsConfirm).toBe(true);
    expect((preview.will_book as any).when).toEqual(['Sat, Oct 10 9:00 AM–11:00 AM on Court 10, 11a, 11b']);
    const run = await s.pack.execute('book_courts', { ...ask, confirm: true });
    expect(run.booked).toBe(3);
    expect(run.when).toEqual((preview.will_book as any).when);
  });

  it('treats court 11 and its halves as one space', async () => {
    const s = setup();
    const r = await s.pack.execute('book_courts', { courts: [11], date: SAT, time_start: '12:30', time_end: '13:30', title: 'Hit' });
    expect(r.ok).toBe(false);
    expect((r.conflicts as string[])[0]).toMatch(/Pickleball hit.*on 11a, which shares the space/);
  });
});

describe('house-rule heads-ups (facts, not hard-coded rules)', () => {
  it('flags a match next to a lesson, and other home matches at the time', async () => {
    const s = setup();
    const r = await s.pack.execute('book_courts', { courts: [11], date: SAT, time_start: '14:00', time_end: '15:00', title: 'Ladies match', type: 'match' });
    expect(r.needsConfirm).toBe(true);
    const notes = (r.heads_up as string[]).join(' | ');
    expect(notes).toMatch(/lesson \("Private — Raj"\) is on Court 10 right next to this match on Court 11/);
    expect(notes).toMatch(/Home team matches starting around then: Fall B2\/B3 2026 vs Round Hill/);
  });
});

describe('move_reservations — "move Julia\'s lessons Saturday to court 10"', () => {
  const ask = { match: { date: SAT, title_match: 'julia', type: 'lesson' }, to_courts: [10] };

  it('previews both moves and the run does exactly that', async () => {
    const s = setup();
    const preview = await s.pack.execute('move_reservations', ask);
    expect(preview.needsConfirm).toBe(true);
    expect(preview.will_change).toEqual([
      { title: 'Julia — Smith', from: 'Court 7 Sat, Oct 10 9:00 AM–10:00 AM', to: 'Court 10 Sat, Oct 10 9:00 AM–10:00 AM' },
      { title: 'Julia — Lee', from: 'Court 8 Sat, Oct 10 10:00 AM–11:00 AM', to: 'Court 10 Sat, Oct 10 10:00 AM–11:00 AM' },
    ]);
    expect(s.writes).toHaveLength(0);

    const run = await s.pack.execute('move_reservations', { ...ask, confirm: true });
    expect(run.ok).toBe(true);
    expect(run.changed).toBe(2);
    expect(s.row('julia1').status).toBe('cancelled');
    expect(s.row('julia2').status).toBe('cancelled');
    const onTen = s.live().filter((r) => r.court_id === 'ct10' && r.title.startsWith('Julia'));
    expect(onTen.map((r) => r.starts_at).sort()).toEqual([pg(SAT, '09:00'), pg(SAT, '10:00')]);
  });

  it('refuses a move into a taken spot, even when confirmed', async () => {
    const s = setup();
    const ask2 = { reservation_ids: ['evening5'], to_courts: [4], to_start: '16:00' };
    const p = await s.pack.execute('move_reservations', ask2);
    expect(p.ok).toBe(false);
    expect((p.conflicts as string[])[0]).toMatch(/Court booking — Owen/);
    const r = await s.pack.execute('move_reservations', { ...ask2, confirm: true });
    expect(r.ok).toBe(false);
    expect(s.writes).toHaveLength(0);
    expect(s.row('evening5').status).toBe('confirmed');
  });

  it('will not move a row a class owns, and says where to change it', async () => {
    const s = setup();
    const r = await s.pack.execute('move_reservations', { reservation_ids: ['prog2'], to_courts: [9], confirm: true });
    expect(r.ok).toBe(false);
    expect((r.blocked as string[])[0]).toMatch(/Classes screen/);
    expect(s.writes).toHaveLength(0);
  });

  it('lets a coach move their own lesson, but nothing else', async () => {
    const s = setup('coach', COACH);
    const ok = await s.pack.execute('move_reservations', { reservation_ids: ['julia1'], to_courts: [9], confirm: true });
    expect(ok.ok).toBe(true);
    const no = await s.pack.execute('move_reservations', { reservation_ids: ['raj10'], to_courts: [9], confirm: true });
    expect(no.ok).toBe(false);
    expect(String(no.error)).toMatch(/only lessons they put on the sheet/);
  });
});

describe('change_reservation_times', () => {
  it('"open the courts back up at 5" shortens the block, preview == run', async () => {
    const s = setup();
    const ask = { match: { date: SUN, title_match: 'junior tournament' }, new_end: '17:00' };
    const preview = await s.pack.execute('change_reservation_times', ask);
    expect(preview.needsConfirm).toBe(true);
    const changes = preview.will_change as Array<{ to: string }>;
    expect(changes.map((c) => c.to)).toEqual([
      'Court 3 Sun, Oct 11 1:00 PM–5:00 PM',
      'Court 4 Sun, Oct 11 1:00 PM–5:00 PM',
    ]);
    // Somebody is signed up and the pack sends nothing — say so.
    expect(preview.signups_not_notified).toMatch(/1 player/);

    const run = await s.pack.execute('change_reservation_times', { ...ask, confirm: true });
    expect(run.ok).toBe(true);
    expect(run.now).toEqual(['Sun, Oct 11 1:00 PM–5:00 PM on Court 3, Court 4']);
    const now = s.live().filter((r) => r.title === 'Junior tournament');
    expect(now.map((r) => r.ends_at)).toEqual([pg(SUN, '17:00'), pg(SUN, '17:00')]);
  });

  it('refuses an extension that runs into the next booking', async () => {
    const s = setup();
    const r = await s.pack.execute('change_reservation_times', { reservation_ids: ['jt3'], new_end: '19:00', confirm: true });
    expect(r.ok).toBe(false);
    expect((r.conflicts as string[])[0]).toMatch(/Sunday social/);
    expect(s.writes).toHaveLength(0);
  });

  it('refuses an end before the start and points at cancel', async () => {
    const s = setup();
    const r = await s.pack.execute('change_reservation_times', { reservation_ids: ['jt3'], new_end: '12:00' });
    expect(r.ok).toBe(false);
    expect(String(r.error)).toMatch(/cancel it instead/);
  });
});

describe('cancel_reservations', () => {
  it('previews the exact rows and cancels exactly those', async () => {
    const s = setup();
    const ask = { reservation_ids: ['jt3', 'jt4'] };
    const preview = await s.pack.execute('cancel_reservations', ask);
    expect(preview.will_cancel).toHaveLength(2);
    expect(s.writes).toHaveLength(0);
    const run = await s.pack.execute('cancel_reservations', { ...ask, confirm: true });
    expect(run.cancelled).toBe(2);
    expect(run.what).toEqual(preview.will_cancel);
    expect(s.row('jt3').status).toBe('cancelled');
    expect(s.row('social3').status).toBe('confirmed');
  });

  it('will not cancel a member booking or let a coach cancel', async () => {
    const s = setup();
    const r = await s.pack.execute('cancel_reservations', { reservation_ids: ['member4'], confirm: true });
    expect(r.ok).toBe(false);
    const c = setup('coach', COACH);
    const r2 = await c.pack.execute('cancel_reservations', { reservation_ids: ['julia1'], confirm: true });
    expect(r2.ok).toBe(false);
    expect(s.writes).toHaveLength(0);
    expect(c.writes).toHaveLength(0);
  });

  it('cannot reach another club\'s reservation by id', async () => {
    const s = setup();
    const r = await s.pack.execute('cancel_reservations', { reservation_ids: ['other'], confirm: true });
    expect(r.ok).toBe(false);
    expect(s.writes).toHaveLength(0);
  });
});

describe('courts_booked', () => {
  it('confirms 1-4 are held for the B2 match', async () => {
    const s = setup();
    const r = await s.pack.execute('courts_booked', { date: TUE, time_start: '09:30', time_end: '12:30', courts: ['1-4'], title_match: 'B2' });
    expect((r.confirmation as any).all_reserved).toBe(true);
    const r2 = await s.pack.execute('courts_booked', { date: TUE, time_start: '09:30', time_end: '13:00', courts: ['1-4'], title_match: 'B2' });
    expect((r2.confirmation as any).all_reserved).toBe(false);
  });

  it('lists the day per court with free courts, scoped to this club', async () => {
    const s = setup();
    const r = await s.pack.execute('courts_booked', { date: SAT, time_start: '15:00', time_end: '17:00' });
    const courtsOut = r.courts as Array<{ court: string; bookings: Array<{ title: string; editable_here: boolean }> }>;
    expect(courtsOut.map((c) => c.court)).toEqual(['Court 4']);
    expect(courtsOut[0].bookings[0].editable_here).toBe(false);
    expect(r.free_courts).toContain('Court 5');
    expect(r.free_courts).not.toContain('Court 4');
  });
});

describe('whats_on', () => {
  it('briefs Saturday across classes, events, matches, blocks, lessons, sign-ups, pickup games', async () => {
    const s = setup();
    const r = await s.pack.execute('whats_on', { start: SAT });
    expect(r.classes).toEqual(['Sat, Oct 10 9:00 AM–10:30 AM — Saturday Juniors']);
    expect(r.events).toEqual(["Sat, Oct 10 1:00 PM — Dunkin' Quads (Quads, open)"]);
    expect((r.matches as string[]).length).toBe(2);
    expect((r.court_blocks as string[]).join('\n')).toMatch(/Court booking — Owen/);
    expect((r.court_blocks as string[]).join('\n')).not.toMatch(/Pickleball open play/); // classes, not blocks
    expect(r.lessons).toEqual(['Sat, Oct 10 11:00 AM–12:00 PM — Julia with Amy']);
    expect((r.open_signups as string[]).join('\n')).toMatch(/Quads "Dunkin' Quads" is open/);
    expect(r.pickup_games).toEqual(['Sat, Oct 10 5:00 PM — doubles (needs 1)']);
  });

  it('filters to home matches only', async () => {
    const s = setup();
    const r = await s.pack.execute('whats_on', { start: SAT, end: '2026-10-16', only: ['matches'], home_only: true });
    expect(Object.keys(r)).not.toContain('classes');
    expect(r.matches).toEqual([
      'Sat, Oct 10 2:00 PM — Fall B2/B3 2026 vs Round Hill (HOME)',
      'Sun, Oct 11 4:00 PM — 12U Yellow Ball Fall 2026 vs MCC (HOME)',
    ]);
  });
});

describe('find_free_dates', () => {
  it('skips days the teams play and days with club events', async () => {
    const s = setup();
    const r = await s.pack.execute('find_free_dates', { start: SAT, end: '2026-10-12', teams: ['12U', '14U'] });
    expect(r.free_dates).toEqual(['2026-10-12 (Mon, Oct 12)']);
    expect((r.busy_dates as string[]).join('\n')).toMatch(/Sat, Oct 10: .*14U.*away vs OCC.*club event: Dunkin' Quads/);
  });

  it('refuses an unknown team and lists the real ones', async () => {
    const s = setup();
    const r = await s.pack.execute('find_free_dates', { start: SAT, end: SUN, teams: ['18U'] });
    expect(r.ok).toBe(false);
    expect(r.teams).toContain('12U Yellow Ball Fall 2026');
  });
});
