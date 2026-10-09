import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * What these guard:
 *   1. PREVIEW AND RUN AGREE — the lineup, the changes and the recipients the
 *      director approves are what is saved / sent.
 *   2. NOTHING IS WRITTEN OR SENT WITHOUT confirm:true — checked against the
 *      fake database's write log and the email sender's call log.
 *   3. SCOPING — only teams the person captains, co-captains, or directs the
 *      club of; a paywalled team is refused; another captain's team is invisible.
 *
 * Emails are built by the real CaptainMode builders (timelineSend, emails.ts);
 * only the last hop (sendBilledEmails) is replaced, so "what would be sent" is
 * the real thing.
 */

const sent: { userId: string | null; payloads: { to: string; subject: string; html: string }[] }[] = [];
vi.mock('@/lib/email', () => ({
  sendBilledEmails: vi.fn(async (userId: string | null, payloads: { to: string; subject: string; html: string }[]) => {
    sent.push({ userId, payloads });
    return payloads.map(() => ({ sent: true }));
  }),
  creditLimitResponse: vi.fn(),
}));
let currentDb: any = null;
vi.mock('@/lib/supabase/admin', () => ({ getSupabaseAdmin: () => currentDb }));
const gate = vi.fn(async (_u: string, _t: string) => 'ok');
vi.mock('@/lib/captain/access', () => ({
  gateTeam: (u: string, t: string) => gate(u, t),
  getCaptainAccess: vi.fn(async () => ({ active: true })),
}));

import { bindPack } from '../framework';
import { captainPack, findPlayers, pageIds } from './captain';

type Row = Record<string, any>;

// ---------------------------------------------------------------- fake db

const TS = /^\d{4}-\d{2}-\d{2}T/;
const cmp = (a: any, b: any) =>
  typeof a === 'string' && typeof b === 'string' && TS.test(a) && TS.test(b)
    ? Date.parse(a) - Date.parse(b)
    : a < b ? -1 : a > b ? 1 : 0;

function fakeDb(tables: Record<string, Row[]>) {
  const writes: { table: string; op: string; rows: Row[] }[] = [];
  let ids = 0;
  const opFilter = (k: string, op: string, v: string): ((r: Row) => boolean) => {
    if (op === 'is' && v === 'null') return (r) => r[k] == null;
    if (op === 'lt') return (r) => r[k] != null && cmp(r[k], v) < 0;
    if (op === 'eq') return (r) => String(r[k]) === v;
    throw new Error(`fake or(): ${op}`);
  };

  class Q {
    private filters: ((r: Row) => boolean)[] = [];
    private mode: 'select' | 'insert' | 'update' | 'delete' | 'upsert' = 'select';
    private payload: Row[] = [];
    private patch: Row = {};
    private conflict: string[] = [];
    private sorts: { k: string; asc: boolean }[] = [];
    private max: number | null = null;
    constructor(private table: string) {}
    select() { return this; }
    eq(k: string, v: any) { this.filters.push((r) => r[k] === v); return this; }
    neq(k: string, v: any) { this.filters.push((r) => r[k] !== v); return this; }
    in(k: string, vs: any[]) { this.filters.push((r) => vs.includes(r[k])); return this; }
    is(k: string, v: any) { this.filters.push((r) => (v === null ? r[k] == null : r[k] === v)); return this; }
    not(k: string, op: string, v: any) {
      if (op !== 'is' || v !== null) throw new Error('fake not()');
      this.filters.push((r) => r[k] != null);
      return this;
    }
    or(expr: string) {
      const parts = expr.split(',').map((p) => {
        const [k, op, ...rest] = p.split('.');
        return opFilter(k, op, rest.join('.'));
      });
      this.filters.push((r) => parts.some((f) => f(r)));
      return this;
    }
    ilike(k: string, v: string) { this.filters.push((r) => String(r[k] ?? '').toLowerCase() === v.toLowerCase()); return this; }
    gte(k: string, v: any) { this.filters.push((r) => r[k] != null && cmp(r[k], v) >= 0); return this; }
    gt(k: string, v: any) { this.filters.push((r) => r[k] != null && cmp(r[k], v) > 0); return this; }
    lte(k: string, v: any) { this.filters.push((r) => r[k] != null && cmp(r[k], v) <= 0); return this; }
    lt(k: string, v: any) { this.filters.push((r) => r[k] != null && cmp(r[k], v) < 0); return this; }
    order(k: string, o?: { ascending?: boolean }) { this.sorts.push({ k, asc: o?.ascending !== false }); return this; }
    limit(n: number) { this.max = n; return this; }
    insert(rows: Row | Row[]) { this.mode = 'insert'; this.payload = Array.isArray(rows) ? rows : [rows]; return this; }
    upsert(rows: Row | Row[], o?: { onConflict?: string }) {
      this.mode = 'upsert';
      this.payload = Array.isArray(rows) ? rows : [rows];
      this.conflict = (o?.onConflict || 'id').split(',');
      return this;
    }
    update(p: Row) { this.mode = 'update'; this.patch = p; return this; }
    delete() { this.mode = 'delete'; return this; }
    private exec(): { data: Row[]; error: null } {
      const t = (tables[this.table] ??= []);
      const match = (r: Row) => this.filters.every((f) => f(r));
      if (this.mode === 'insert') {
        const made = this.payload.map((r) => ({ id: `new-${++ids}`, ...r }));
        t.push(...made);
        writes.push({ table: this.table, op: 'insert', rows: made });
        return { data: made, error: null };
      }
      if (this.mode === 'upsert') {
        const out: Row[] = [];
        for (const r of this.payload) {
          const hit = t.find((x) => this.conflict.every((k) => x[k] === r[k]));
          if (hit) { Object.assign(hit, r); out.push(hit); } else { const n = { id: `new-${++ids}`, ...r }; t.push(n); out.push(n); }
        }
        writes.push({ table: this.table, op: 'upsert', rows: out.map((r) => ({ ...r })) });
        return { data: out, error: null };
      }
      if (this.mode === 'update') {
        const hit = t.filter(match);
        for (const r of hit) Object.assign(r, this.patch);
        writes.push({ table: this.table, op: 'update', rows: hit.map((r) => ({ ...r })) });
        return { data: hit, error: null };
      }
      if (this.mode === 'delete') {
        writes.push({ table: this.table, op: 'delete', rows: t.filter(match) });
        tables[this.table] = t.filter((r) => !match(r));
        return { data: [], error: null };
      }
      let out = t.filter(match).map((r) => ({ ...r }));
      for (const s of [...this.sorts].reverse()) out.sort((a, b) => (s.asc ? 1 : -1) * cmp(a[s.k], b[s.k]));
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

// ---------------------------------------------------------------- fixtures

const ME = 'u-me';
const OTHER = 'u-other';
const DAY = 86_400_000;
const at = (days: number) => new Date(Math.floor((Date.now() + days * DAY) / 3600_000) * 3600_000).toISOString();
const SUNDAY = at(3);
const LAST_WEEK = at(-7);
const NEXT_MONTH = at(30);
const TZ = 'America/Los_Angeles';
const ymd = (iso: string) =>
  new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: TZ }).format(new Date(iso));

function player(id: string, team: string, name: string, extra: Row = {}): Row {
  return {
    id, team_id: team, name, email: `${id}@ex.com`, phone: null, rating: 3.5, rating_type: 'computer', gender: 'F',
    return_side: null, court_limit: null, is_sub: false, active: true, player_token: `tok-${id}`, unavailable_days: [],
    sort_order: null, wtn: null, wtn_doubles: null, max_lines: null, contact2_name: null, contact2_email: null,
    contact2_phone: null, created_at: '2026-08-01T00:00:00+00:00', ...extra,
  };
}

function match(id: string, team: string, when: string, extra: Row = {}): Row {
  return {
    id, team_id: team, match_at: when, is_home: true, opponent: 'Orinda CC', location: 'Sleepy Hollow', arrival_note: null,
    opposing_captain_name: null, opposing_captain_email: null, opposing_captain_phone: null, singles_courts: 0,
    doubles_courts: 3, status: 'scheduled', court_format: null, lineup_email_sent_at: null, availability_poll_sent_at: null,
    nudge_sent_at: null, reminder_sent_at: null, match_coach_id: null, ...extra,
  };
}

function fixtures(): Record<string, Row[]> {
  const W = 't-women';
  const J = 't-jtt';
  const women = ['Daralisa Ray', 'Leena Ko', 'Nikki Lam', 'Jamie Fox', 'Maya Chen', 'Priya Shah', 'Sara Bell'];
  const jtt = ['Ava', 'Ben', 'Cal', 'Dee', 'Eli', 'Fay', 'Gus'];
  return {
    cc_clubs: [
      { id: 'club-1', name: 'Sleepy Hollow', timezone: TZ, owner_id: 'u-owner' },
      { id: 'club-2', name: 'Elsewhere', timezone: TZ, owner_id: OTHER },
    ],
    cc_club_members: [{ club_id: 'club-1', user_id: 'u-dir', role: 'director' }, { club_id: 'club-1', user_id: 'u-coach', role: 'coach' }],
    captain_teams: [
      { id: W, captain_user_id: ME, club_id: 'club-1', name: 'Harbor View Women 3.5', league_type: 'flex', level: '3.5', archived: false, eligibility_enabled: false, captaining_style: 'equal_play', court_format: null, max_players: null },
      { id: J, captain_user_id: OTHER, club_id: 'club-1', name: '12U Yellow Ball', league_type: 'jtt', level: null, archived: false, eligibility_enabled: false, captaining_style: 'equal_play', court_format: 3, max_players: null },
      { id: 't-foreign', captain_user_id: OTHER, club_id: 'club-2', name: 'Someone Else 4.0', league_type: 'flex', archived: false },
    ],
    captain_team_staff: [{ team_id: J, user_id: ME, role: 'co-captain' }],
    captain_players: [
      ...women.map((n, i) => player(`w${i + 1}`, W, n, i === 0 ? { contact2_name: 'Dad', contact2_email: 'dad@ex.com' } : {})),
      ...jtt.map((n, i) => player(`j${i + 1}`, J, n)),
      player('x1', 't-foreign', 'Daralisa Elsewhere'),
    ],
    captain_matches: [
      match('m-past', W, LAST_WEEK, { status: 'played' }),
      match('m-sun', W, SUNDAY),
      match('m-later', W, NEXT_MONTH, { opponent: 'Moraga CC' }),
      match('j-sun', J, SUNDAY, { singles_courts: 4, doubles_courts: 4, court_format: null, opponent: 'MCC' }),
      match('f-sun', 't-foreign', SUNDAY),
    ],
    captain_availability: [
      // Sunday: six yes, Sara no.
      ...['w1', 'w2', 'w3', 'w4', 'w5', 'w6'].map((p) => ({ id: `a-${p}`, team_id: W, match_id: 'm-sun', player_id: p, status: 'yes', note: null })),
      { id: 'a-w7', team_id: W, match_id: 'm-sun', player_id: 'w7', status: 'no', note: null },
      ...['j1', 'j2', 'j3', 'j4', 'j5', 'j6'].map((p) => ({ id: `a-${p}`, team_id: J, match_id: 'j-sun', player_id: p, status: 'yes', note: null })),
    ],
    captain_lineups: [
      // Last week: Daralisa + Leena played; Maya did not.
      { id: 'l-p1', team_id: W, match_id: 'm-past', court_number: 1, court_type: 'doubles', player1_id: 'w1', player2_id: 'w2' },
      { id: 'l-p2', team_id: W, match_id: 'm-past', court_number: 2, court_type: 'doubles', player1_id: 'w3', player2_id: 'w4' },
      // Sunday's saved sheet.
      { id: 'l-s1', team_id: W, match_id: 'm-sun', court_number: 1, court_type: 'doubles', player1_id: 'w1', player2_id: 'w2', player1_confirmed_at: '2026-10-01T00:00:00+00:00', player2_confirmed_at: null },
      { id: 'l-s2', team_id: W, match_id: 'm-sun', court_number: 2, court_type: 'doubles', player1_id: 'w3', player2_id: 'w4' },
      { id: 'l-s3', team_id: W, match_id: 'm-sun', court_number: 3, court_type: 'doubles', player1_id: 'w5', player2_id: 'w6' },
      // JTT Sunday saved sheet (3-court rounds: S1+S2+D1 | S3+S4+D2 | D3+D4).
      ...[1, 2, 3, 4].map((n) => ({ id: `jl-s${n}`, team_id: J, match_id: 'j-sun', court_number: n, court_type: 'singles', player1_id: `j${n}`, player2_id: null })),
      { id: 'jl-d1', team_id: J, match_id: 'j-sun', court_number: 5, court_type: 'doubles', player1_id: 'j3', player2_id: 'j4' },
      { id: 'jl-d2', team_id: J, match_id: 'j-sun', court_number: 6, court_type: 'doubles', player1_id: 'j1', player2_id: 'j2' },
      { id: 'jl-d3', team_id: J, match_id: 'j-sun', court_number: 7, court_type: 'doubles', player1_id: 'j5', player2_id: 'j6' },
      { id: 'jl-d4', team_id: J, match_id: 'j-sun', court_number: 8, court_type: 'doubles', player1_id: 'j1', player2_id: 'j3' },
    ],
    captain_results: [],
    captain_partner_prefs: [],
    captain_never_pair: [],
    captain_email_settings: [],
    captain_email_overrides: [],
    captain_team_contacts: [],
    captain_opponents: [
      { id: 'o1', team_id: W, opponent: 'Orinda CC', captain_name: 'Olivia Opp', captain_email: 'olivia@orinda.ex', captain_phone: '+19255550100', cocaptain_name: null, cocaptain_email: null, cocaptain_phone: null, home_club: 'Orinda Country Club', club_phone: null, notes: null },
    ],
    profiles: [],
  };
}

function setup(teams?: any[], userId = ME) {
  const tables = fixtures();
  const f = fakeDb(tables);
  currentDb = f.db;
  sent.length = 0;
  const ctx = {
    userId,
    db: f.db as never,
    teams: teams ?? [
      { id: 't-women', name: 'Harbor View Women 3.5', role: 'captain', clubId: 'club-1', access: 'ok' },
      { id: 't-jtt', name: '12U Yellow Ball', role: 'co-captain', clubId: 'club-1', access: 'ok' },
    ],
    defaultTeamId: null,
    defaultMatchId: null,
  };
  const pack = bindPack(captainPack, ctx as never);
  const writes = () => f.writes;
  const lineup = (mid: string) =>
    tables.captain_lineups.filter((l) => l.match_id === mid).sort((a, b) => a.court_number - b.court_number);
  return { pack, tables, writes, lineup, ctx };
}

const W = { team: 'Harbor View', match: ymd(SUNDAY) };

beforeEach(() => {
  gate.mockClear();
});

// ----------------------------------------------------------------- tests

describe('the confirm gate', () => {
  it('adds confirm to exactly the writes and sends', () => {
    const { pack } = setup();
    const gated = pack.toolSchemas
      .filter((t) => 'confirm' in ((t.input_schema.properties as Record<string, unknown>) ?? {}))
      .map((t) => t.name)
      .sort();
    expect(gated).toEqual([
      'captain_add_player',
      'captain_ask_to_confirm',
      'captain_build_lineup',
      'captain_edit_lineup',
      'captain_email_opposing_captain',
      'captain_send_lineup',
      'captain_set_availability',
    ]);
  });
});

describe('resolve — who may run which team', () => {
  it('captain + co-captain teams; never another captain’s team at another club', async () => {
    const f = fakeDb(fixtures());
    currentDb = f.db;
    const ctx = await captainPack.resolve(ME, '/captain/t-jtt');
    expect(ctx!.teams.map((t) => `${t.name}:${t.role}`).sort()).toEqual(['12U Yellow Ball:co-captain', 'Harbor View Women 3.5:captain']);
    // Page id isn't a UUID here, so no default is taken from it.
    expect(ctx!.defaultTeamId).toBeNull();
  });

  it('a club director gets the club’s teams; a coach at the club gets none', async () => {
    currentDb = fakeDb(fixtures()).db;
    const dir = await captainPack.resolve('u-dir', undefined);
    expect(dir!.teams.map((t) => t.name).sort()).toEqual(['12U Yellow Ball', 'Harbor View Women 3.5']);
    expect(dir!.teams.every((t) => t.role === 'director')).toBe(true);
    expect(await captainPack.resolve('u-coach', undefined)).toBeNull();
    expect(await captainPack.resolve('u-nobody', undefined)).toBeNull();
  });

  it('a captain whose team needs a subscription is listed but refused', async () => {
    currentDb = fakeDb(fixtures()).db;
    gate.mockImplementation(async (_u, t) => (t === 't-women' ? 'needs_subscription' : 'ok'));
    const ctx = await captainPack.resolve(ME, undefined);
    gate.mockImplementation(async () => 'ok');
    expect(ctx!.teams.find((t) => t.id === 't-women')!.access).toBe('needs_subscription');
    const pack = bindPack(captainPack, ctx!);
    const r = await pack.execute('captain_match', { team: 'Harbor View' });
    expect(r.ok).toBe(false);
    expect(String(r.error)).toMatch(/subscription/);
  });

  it('reads team and match ids from the page', () => {
    const t = '11111111-2222-3333-4444-555555555555';
    const m = '66666666-7777-8888-9999-000000000000';
    expect(pageIds(`/captain/${t}/match/${m}`)).toEqual({ teamId: t, matchId: m });
    expect(pageIds('/captain/' + t)).toEqual({ teamId: t, matchId: null });
  });
});

describe('scoping', () => {
  it('cannot touch a team that is not theirs, by name or id', async () => {
    const s = setup();
    for (const team of ['Someone Else', 't-foreign']) {
      const r = await s.pack.execute('captain_build_lineup', { team, confirm: true });
      expect(r.ok).toBe(false);
      expect(String(r.error)).toMatch(/No team/);
    }
    expect(s.writes()).toHaveLength(0);
  });

  it('a player name from another team is not found', () => {
    const roster = fixtures().captain_players.filter((p) => p.team_id === 't-women') as any;
    const r = findPlayers(roster, ['Daralisa Elsewhere']);
    expect('error' in r).toBe(true);
  });
});

describe('build_lineup — "redo the lineup for Sunday"', () => {
  it('previews without writing, and run saves exactly the previewed sheet', async () => {
    const s = setup();
    const preview = await s.pack.execute('captain_build_lineup', W);
    expect(preview.needsConfirm).toBe(true);
    expect(s.writes()).toHaveLength(0);
    const lines = preview.lineup as string[];
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/^Doubles 1: /);
    // Sara said no, so she is nowhere on it.
    expect(lines.join(' ')).not.toMatch(/Sara/);

    const run = await s.pack.execute('captain_build_lineup', { ...W, confirm: true });
    expect(run.ok).toBe(true);
    expect(run.lineup).toEqual(preview.lineup);
    expect(run.sitting_out).toEqual(preview.sitting_out);
    const saved = s.lineup('m-sun');
    expect(saved).toHaveLength(3);
    expect(saved.every((r) => r.team_id === 't-women')).toBe(true);
    // No email went anywhere.
    expect(sent).toHaveLength(0);
  });

  it('JTT "it’s a 2-court format today": preview == run, and the match keeps the format', async () => {
    const s = setup();
    const ask = { team: '12U', match: ymd(SUNDAY), court_format: 2 };
    const preview = await s.pack.execute('captain_build_lineup', ask);
    expect(preview.needsConfirm).toBe(true);
    expect((preview.explanation as string[]).join(' ')).toMatch(/2-court format/);
    expect((preview.format as any).court_format).toBe(2);
    expect(s.writes()).toHaveLength(0);
    const run = await s.pack.execute('captain_build_lineup', { ...ask, confirm: true });
    expect(run.lineup).toEqual(preview.lineup);
    expect(s.tables.captain_matches.find((m) => m.id === 'j-sun')!.court_format).toBe(2);
    // Rounds printed from the 2-court plan: S1+D1 in round 1.
    expect((run.lineup as string[])[0]).toMatch(/\(round 1\)/);
  });

  it('refuses a court format on an adult team', async () => {
    const s = setup();
    const r = await s.pack.execute('captain_build_lineup', { ...W, court_format: 2 });
    expect(r.ok).toBe(false);
    expect(s.writes()).toHaveLength(0);
  });

  it('"Leena dropped — put Sara in and remake it": availability recorded, lineup rebuilt, preview == run', async () => {
    const s = setup();
    const ask = { ...W, mark_out: ['Leena'], mark_in: ['Sara'] };
    const preview = await s.pack.execute('captain_build_lineup', ask);
    expect(preview.needsConfirm).toBe(true);
    expect((preview.lineup as string[]).join(' ')).toMatch(/Sara Bell/);
    expect((preview.lineup as string[]).join(' ')).not.toMatch(/Leena/);
    expect(s.writes()).toHaveLength(0);

    const run = await s.pack.execute('captain_build_lineup', { ...ask, confirm: true });
    expect(run.lineup).toEqual(preview.lineup);
    const status = (p: string) => s.tables.captain_availability.find((a) => a.match_id === 'm-sun' && a.player_id === p)?.status;
    expect(status('w2')).toBe('no');
    expect(status('w7')).toBe('yes');
    // Daralisa's confirmation survives the rebuild (an answer belongs to the person).
    const d = s.lineup('m-sun').find((r) => r.player1_id === 'w1' || r.player2_id === 'w1')!;
    expect(d.player1_id === 'w1' ? d.player1_confirmed_at : d.player2_confirmed_at).toBeTruthy();
  });
});

describe('edit_lineup — "move Daralisa and Leena to line 2, keep Nikki and Jamie on line 1"', () => {
  it('swaps the two lines; preview == run', async () => {
    const s = setup();
    const ask = { ...W, moves: [{ line: 'line 2', players: ['Daralisa', 'Leena'] }, { line: 'line 1', players: ['Nikki', 'Jamie'] }] };
    const preview = await s.pack.execute('captain_edit_lineup', ask);
    expect(preview.needsConfirm).toBe(true);
    expect(preview.lineup).toEqual([
      'Doubles 1: Nikki Lam / Jamie Fox',
      'Doubles 2: Daralisa Ray / Leena Ko',
      'Doubles 3: Maya Chen / Priya Shah',
    ]);
    expect(s.writes()).toHaveLength(0);
    const run = await s.pack.execute('captain_edit_lineup', { ...ask, confirm: true });
    expect(run.lineup).toEqual(preview.lineup);
    const rows = s.lineup('m-sun');
    expect([rows[0].player1_id, rows[0].player2_id]).toEqual(['w3', 'w4']);
    expect([rows[1].player1_id, rows[1].player2_id]).toEqual(['w1', 'w2']);
    // Daralisa's confirmation moved with her.
    expect(rows[1].player1_confirmed_at).toBeTruthy();
  });

  it('moving one pair swaps the displaced pair into the hole they left', async () => {
    const s = setup();
    const r = await s.pack.execute('captain_edit_lineup', { ...W, moves: [{ line: 'D3', players: ['Daralisa', 'Leena'] }] });
    expect(r.lineup).toEqual([
      'Doubles 1: Maya Chen / Priya Shah',
      'Doubles 2: Nikki Lam / Jamie Fox',
      'Doubles 3: Daralisa Ray / Leena Ko',
    ]);
  });

  it('JTT: refuses a sheet with a child on two lines in the same round', async () => {
    const s = setup();
    // Round 1 is S1+S2+D1; Ava is on Singles 1, so she cannot also be on Doubles 1.
    const r = await s.pack.execute('captain_edit_lineup', { team: '12U', match: ymd(SUNDAY), moves: [{ line: 'Doubles 1', players: ['Ava', 'Eli'] }], confirm: true });
    expect(r.ok).toBe(false);
    expect(String(r.error)).toMatch(/same round/);
    expect(s.writes()).toHaveLength(0);
  });

  it('a doubles line needs both partners named', async () => {
    const s = setup();
    const r = await s.pack.execute('captain_edit_lineup', { ...W, moves: [{ line: 'Doubles 2', players: ['Maya'] }] });
    expect(r.ok).toBe(false);
    expect(String(r.error)).toMatch(/both partners/);
  });
});

describe('who sits / subs / counts (reads write nothing)', () => {
  it('who_sits names who would sit and never writes', async () => {
    const s = setup();
    // Sara flips to yes: 7 available for 6 spots.
    s.tables.captain_availability.find((a) => a.id === 'a-w7')!.status = 'yes';
    const r = await s.pack.execute('captain_who_sits', W);
    expect(r.ok).toBe(true);
    expect((r.sit_out as unknown[]).length).toBe(1);
    expect((r.fairness as unknown[]).length).toBe(7);
    expect(s.writes()).toHaveLength(0);
  });

  it('find_subs: yes before no-answer, fewest matches first, "no" left out', async () => {
    const s = setup();
    s.tables.captain_players.push(player('w8', 't-women', 'Tess Ng', { is_sub: true }));
    s.tables.captain_lineups = s.tables.captain_lineups.filter((l) => l.id !== 'l-s3'); // Maya + Priya free
    const r = await s.pack.execute('captain_find_subs', { ...W, replacing: 'Leena' });
    const subs = (r.subs as any[]).map((x) => `${x.name}:${x.answer}`);
    expect(subs).toEqual(['Maya Chen:yes', 'Priya Shah:yes', 'Tess Ng:no answer']);
    expect(r.partner).toBe('Daralisa Ray');
  });

  it('season counts: matches so far per player', async () => {
    const s = setup();
    const r = await s.pack.execute('captain_season_counts', { team: 'Harbor View' });
    const by = Object.fromEntries((r.players as any[]).map((p) => [p.name, p.matches_so_far]));
    expect(by['Daralisa Ray']).toBe(1);
    expect(by['Maya Chen']).toBe(0);
    expect((r.players as any[]).find((p) => p.name === 'Maya Chen').in_upcoming_lineups).toEqual([ymd(SUNDAY)]);
  });

  it('opposing captain from the opponent directory; print gives the match page', async () => {
    const s = setup();
    const o = await s.pack.execute('captain_opposing_captain', W);
    expect((o.captain as any).email).toBe('olivia@orinda.ex');
    expect((o.captain as any).from).toBe('opponent directory');
    const p = await s.pack.execute('captain_print_lineup', W);
    expect(String(p.url)).toMatch(/\/captain\/t-women\/match\/m-sun$/);
    expect(s.writes()).toHaveLength(0);
  });
});

describe('set_availability — "mark Nikki out for Sunday"', () => {
  it('preview writes nothing; run records it exactly like confirm-for', async () => {
    const s = setup();
    const ask = { ...W, players: ['Nikki'], state: 'out', note: 'sick' };
    const preview = await s.pack.execute('captain_set_availability', ask);
    expect(preview.needsConfirm).toBe(true);
    expect((preview.changes as string[])[0]).toMatch(/Nikki Lam: yes → out \(no\) \(on Doubles 2/);
    expect(s.writes()).toHaveLength(0);
    const run = await s.pack.execute('captain_set_availability', { ...ask, confirm: true });
    expect(run.changes).toEqual(preview.changes);
    const a = s.tables.captain_availability.find((x) => x.match_id === 'm-sun' && x.player_id === 'w3')!;
    expect(a.status).toBe('no');
    expect(a.note).toBe('sick');
    const row = s.tables.captain_lineups.find((l) => l.id === 'l-s2')!;
    expect(row.player1_declined_at).toBeTruthy();
    expect(row.player1_decline_note).toBe('sick');
  });
});

describe('add_player — "add Zoe Park, mom is Kim, kim@ex.com"', () => {
  it('adds with the parent as second contact; preview == run', async () => {
    const s = setup();
    const ask = { team: '12U', name: 'Zoe Park', parent_name: 'Kim', parent_email: 'kim@ex.com', parent_phone: '925-555-0148' };
    const preview = await s.pack.execute('captain_add_player', ask);
    expect(preview.needsConfirm).toBe(true);
    expect(s.writes()).toHaveLength(0);
    const run = await s.pack.execute('captain_add_player', { ...ask, confirm: true });
    expect(run.details).toEqual(preview.details);
    const z = s.tables.captain_players.find((p) => p.name === 'Zoe Park')!;
    expect(z.team_id).toBe('t-jtt');
    expect(z.contact2_email).toBe('kim@ex.com');
    expect(z.contact2_phone).toBe('+19255550148');
  });

  it('an existing player only gets blanks filled', async () => {
    const s = setup();
    const r = await s.pack.execute('captain_add_player', { team: 'Harbor View', name: 'daralisa ray', email: 'new@ex.com', parent_phone: '9255550101', confirm: true });
    expect(r.ok).toBe(true);
    const d = s.tables.captain_players.find((p) => p.id === 'w1')!;
    expect(d.email).toBe('w1@ex.com');
    expect(d.contact2_phone).toBe('+19255550101');
    expect(r.not_overwritten).toEqual(['email']);
  });
});

describe('sends — never without confirm', () => {
  it('send_lineup: preview lists every recipient and the text; confirm sends exactly that', async () => {
    const s = setup();
    const preview = await s.pack.execute('captain_send_lineup', W);
    expect(preview.needsConfirm).toBe(true);
    expect(sent).toHaveLength(0);
    expect(s.writes()).toHaveLength(0);
    const rcpts = preview.recipients as string[];
    // 7 players + Daralisa's second parent.
    expect(rcpts).toHaveLength(8);
    expect(rcpts).toContain('Daralisa Ray · Dad <dad@ex.com>');
    expect(String(preview.text)).toMatch(/Daralisa Ray \/ Leena Ko/);

    const run = await s.pack.execute('captain_send_lineup', { ...W, confirm: true });
    expect(run.ok).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0].payloads.map((p) => p.to).sort()).toEqual(
      rcpts.map((r) => r.match(/<(.*)>/)![1]).sort(),
    );
    expect(sent[0].payloads[0].subject).toBe(preview.subject);
    expect(sent[0].userId).toBe(ME); // billed to the team's captain, as timeline/send does
    expect(s.tables.captain_matches.find((m) => m.id === 'm-sun')!.lineup_email_sent_at).toBeTruthy();

    // A second confirm straight after is the double-click guard, not a second blast.
    const again = await s.pack.execute('captain_send_lineup', { ...W, confirm: true });
    expect(again.ok).toBe(false);
    expect(sent).toHaveLength(1);
  });

  it('send_lineup to only_players leaves the team-wide stamp alone', async () => {
    const s = setup();
    const r = await s.pack.execute('captain_send_lineup', { ...W, only_players: ['Maya'], confirm: true });
    expect(r.ok).toBe(true);
    expect(sent[0].payloads.map((p) => p.to)).toEqual(['w5@ex.com']);
    expect(s.tables.captain_matches.find((m) => m.id === 'm-sun')!.lineup_email_sent_at).toBeNull();
  });

  it('ask_to_confirm: lineup players get the confirm email, others the can-you-play email', async () => {
    const s = setup();
    const ask = { ...W, players: ['Daralisa', 'Sara'] };
    const preview = await s.pack.execute('captain_ask_to_confirm', ask);
    expect(preview.needsConfirm).toBe(true);
    expect(sent).toHaveLength(0);
    expect((preview.confirm_your_line as any).recipients).toEqual(['Daralisa Ray <w1@ex.com>', 'Daralisa Ray · Dad <dad@ex.com>']);
    expect((preview.can_you_play as any).recipients).toEqual(['Sara Bell <w7@ex.com>']);
    expect((preview.confirm_your_line as any).text).toMatch(/Yes — I'll be there/);
    const run = await s.pack.execute('captain_ask_to_confirm', { ...ask, confirm: true });
    expect(run.ok).toBe(true);
    expect(sent[0].payloads.map((p) => p.to)).toEqual(['w1@ex.com', 'dad@ex.com', 'w7@ex.com']);
  });

  it('email_opposing_captain: address from the directory, the user’s words verbatim, sent only on confirm', async () => {
    const s = setup();
    const ask = { ...W, message: "Hi Olivia, we're short this week and will default Doubles 3.\n\nDarrin" };
    const preview = await s.pack.execute('captain_email_opposing_captain', ask);
    expect(preview.needsConfirm).toBe(true);
    expect(preview.to).toBe('Olivia Opp <olivia@orinda.ex>');
    expect(String(preview.text)).toMatch(/default Doubles 3/);
    expect(sent).toHaveLength(0);
    const run = await s.pack.execute('captain_email_opposing_captain', { ...ask, confirm: true });
    expect(run.ok).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0].payloads).toHaveLength(1);
    expect(sent[0].payloads[0].to).toBe('olivia@orinda.ex');
    expect(sent[0].payloads[0].subject).toBe(preview.subject);
  });

  it('no stored address → refused with a plain reason, nothing sent', async () => {
    const s = setup();
    const r = await s.pack.execute('captain_email_opposing_captain', { ...W, match: 'Moraga', message: 'Hi', confirm: true });
    expect(r.ok).toBe(false);
    expect(String(r.error)).toMatch(/No opposing-captain email/);
    expect(sent).toHaveLength(0);
  });
});
