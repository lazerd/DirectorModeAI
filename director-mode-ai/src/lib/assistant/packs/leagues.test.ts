import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';

const setWtn = vi.fn(async (..._args: unknown[]) => ({ updated: { cc_vault_players: 1 }, errors: [] as string[] }));
vi.mock('@/lib/ratings/wtn', async (orig) => ({
  ...(await orig<typeof import('@/lib/ratings/wtn')>()),
  setWtnForPerson: (...a: unknown[]) => setWtn(...a),
}));

import { bindPack } from '../framework';
import { leaguesPack, parseScore, setsWinner, formatSets, flipSets } from './leagues';

/**
 * Same property as the other packs: PREVIEW AND RUN AGREE, and nothing is
 * written until confirm. Driven through the real framework binding against an
 * in-memory Supabase stand-in that filters, so league scoping and the rows a
 * write produces are checked, not just that a call happened.
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
        return { data: items, error: null };
      }
      let hit = rows.filter((r) => filters.every((f) => f(r)));
      if (op === 'update') {
        for (const r of hit) Object.assign(r, payload);
        log.push({ op, table, payload });
        return { data: hit, error: null };
      }
      if (op === 'delete') {
        for (const r of hit) rows.splice(rows.indexOf(r), 1);
        log.push({ op, table, payload: hit.map((h) => h.id ?? h.roster_id) });
        return { data: hit, error: null };
      }
      for (const o of [...orders].reverse()) hit = [...hit].sort((a, b) => String(a[o] ?? '').localeCompare(String(b[o] ?? '')));
      if (limit != null) hit = hit.slice(0, limit);
      return { data: hit, error: null };
    };

    const q: any = {
      select: () => q,
      eq: (c: string, v: unknown) => (filters.push((r) => String(r[c]) === String(v)), q),
      neq: (c: string, v: unknown) => (filters.push((r) => String(r[c]) !== String(v)), q),
      in: (c: string, v: unknown[]) => (filters.push((r) => v.includes(r[c])), q),
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

// ------------------------------------------------------------------ seed

const L1 = { id: 'L1', name: 'Lamorinda JTT Fall', status: 'running', start_date: '2026-09-01', end_date: '2026-11-30', club_id: 'cc1' };
const DIVS = [
  { id: 'D10', league_id: 'L1', name: '10&U', short_code: '10U', day_of_week: 0, start_time: '16:00:00', line_format: 'custom', sort_order: 1 },
  { id: 'D12', league_id: 'L1', name: '12&U', short_code: '12U', day_of_week: 0, start_time: '16:00:00', line_format: 'custom', sort_order: 2 },
  // Another director's league — must never be reachable.
  { id: 'DX', league_id: 'LX', name: '10&U', short_code: '10U', day_of_week: 0, start_time: null, line_format: 'custom', sort_order: 1 },
];
const CLUBS = [
  { id: 'SH', league_id: 'L1', name: 'Sleepy Hollow', short_code: 'SH', courts_available: 3 },
  { id: 'MCC', league_id: 'L1', name: 'Moraga CC', short_code: 'MCC', courts_available: 4 },
  { id: 'XC', league_id: 'LX', name: 'Elsewhere', short_code: 'XC', courts_available: 4 },
];

const kid = (id: string, division_id: string, club_id: string, player_name: string, ladder_position: number, extra: Row = {}) => ({
  id, division_id, club_id, player_name, ladder_position, status: 'active', master_player_id: null, wtn: null, ntrp: null, ...extra,
});

const ROSTERS = [
  ...['Gavin Cohen', 'Ava Li', 'Ben Ortiz', 'Cara Diaz', 'Dev Shah', 'Eli Park', 'Finn Moss', 'Gia Ruiz'].map((n, i) =>
    kid(`s${i + 1}`, 'D10', 'SH', n, i + 1, i === 0 ? { master_player_id: 'mp-gavin' } : {}),
  ),
  ...['Hal Wu', 'Ivy Tran', 'Jon Kim', 'Kai Roe', 'Lea Fox'].map((n, i) => kid(`m${i + 1}`, 'D10', 'MCC', n, i + 1)),
  kid('t1', 'D12', 'SH', 'Tom Young', 1),
  kid('t2', 'D12', 'SH', 'Uma Bell', 2),
  kid('u1', 'D12', 'MCC', 'Vic Hale', 1),
  kid('u2', 'D12', 'MCC', 'Wes Lane', 2),
  kid('x1', 'DX', 'XC', 'Outsider Kid', 1),
];

const matchup = (id: string, division_id: string, match_date: string, home: string, away: string, extra: Row = {}) => ({
  id, division_id, match_date, start_time: null, home_club_id: home, away_club_id: away,
  home_lines_won: 0, away_lines_won: 0, winner: null, status: 'scheduled', notes: null, courts_override: null, ...extra,
});

const MATCHUPS = [
  // Played last Sunday at MCC: SH won 3-1.
  matchup('11111111-0000-4000-8000-000000000000', 'D10', '2026-10-04', 'MCC', 'SH', { status: 'completed', home_lines_won: 1, away_lines_won: 3, winner: 'away' }),
  // This Sunday at home.
  matchup('22222222-0000-4000-8000-000000000000', 'D10', '2026-10-11', 'SH', 'MCC'),
  // 12U away, lineup set, unscored.
  matchup('33333333-0000-4000-8000-000000000000', 'D12', '2026-10-18', 'MCC', 'SH'),
  matchup('99999999-0000-4000-8000-000000000000', 'DX', '2026-10-11', 'XC', 'XC'),
];
const [M0, M1, M2, MX] = MATCHUPS.map((m) => m.id);

const line = (id: string, matchup_id: string, line_number: number, line_type: string, h: (string | null)[], a: (string | null)[], extra: Row = {}) => ({
  id, matchup_id, line_number, line_type, round_number: 1,
  home_player1_id: h[0] ?? null, home_player2_id: h[1] ?? null, away_player1_id: a[0] ?? null, away_player2_id: a[1] ?? null,
  score: null, winner: null, status: 'pending', counts_for_team: true, court_label: null, ...extra,
});

const LINES = [
  line('l01', M0, 1, 'singles', ['m1'], ['s1'], { score: '3-6, 2-6', winner: 'away', status: 'completed' }),
  line('l02', M0, 2, 'singles', ['m2'], ['s2'], { score: '6-4, 6-4', winner: 'home', status: 'completed' }),
  line('l03', M0, 3, 'doubles', ['m3', 'm4'], ['s3', 's4'], { score: '2-6', winner: 'away', status: 'completed' }),
  line('l04', M0, 4, 'doubles', ['m5', null], ['s5', 's6'], { score: '1-6', winner: 'away', status: 'completed' }),
  line('l21', M2, 1, 'singles', ['u1'], ['t1']),
  line('l22', M2, 2, 'singles', ['u2'], ['t2']),
];

function setup(extra: Record<string, Row[]> = {}, club: Row | null = { id: 'cc1', name: 'Sleepy Hollow Swim & Tennis Club', role: 'owner' }) {
  const f = fakeDb({
    league_divisions: DIVS,
    league_clubs: CLUBS,
    league_division_clubs: [{ division_id: 'D10', club_id: 'SH' }, { division_id: 'D10', club_id: 'MCC' }],
    league_team_rosters: ROSTERS,
    league_team_matchups: MATCHUPS,
    league_matchup_lines: LINES,
    league_matchup_checkins: [],
    league_player_availability: [
      ...['s1', 's2', 's3', 's4', 's5', 's6', 's7'].map((r) => ({ roster_id: r, matchup_id: M1, status: 'yes' })),
      { roster_id: 's8', matchup_id: M1, status: 'no' },
    ],
    master_players: [
      { id: 'mp-gavin', full_name: 'Gavin Cohen', wtn: 34.1, wtn_doubles: null, ntrp: null },
      { id: 'mp-heather', full_name: 'Heather Young', wtn: null, wtn_doubles: null, ntrp: null },
      { id: 'mp-craig', full_name: 'Craig Pell', wtn: null, wtn_doubles: null, ntrp: null },
    ],
    cc_vault_players: [
      { id: 'v1', club_id: 'cc1', full_name: 'Heather Young', master_player_id: 'mp-heather', wtn: null, wtn_doubles: null, usta_rating: null },
      { id: 'v2', club_id: 'cc1', full_name: 'Craig Pell', master_player_id: 'mp-craig', wtn: null, wtn_doubles: null, usta_rating: 3.5 },
      { id: 'v3', club_id: 'other', full_name: 'Craig Other', master_player_id: 'mp-x', wtn: null, wtn_doubles: null, usta_rating: null },
    ],
    ...extra,
  });
  const ctx = { userId: 'u1', db: f.db, leagues: [L1], club, timeZone: TZ };
  return { ...f, pack: bindPack(leaguesPack, ctx as never) };
}

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-09T18:00:00Z'));
});
afterAll(() => vi.useRealTimers());
beforeEach(() => setWtn.mockClear());

const strip = (r: Record<string, unknown>) => JSON.parse(JSON.stringify(r));

// ------------------------------------------------------------------ gate

describe('the confirm gate', () => {
  it('adds confirm to exactly the write tools, and names never collide with the JTT pack', () => {
    const { pack } = setup();
    const withConfirm = pack.toolSchemas
      .filter((t) => 'confirm' in ((t.input_schema.properties as Record<string, unknown>) ?? {}))
      .map((t) => t.name)
      .sort();
    expect(withConfirm).toEqual([
      'league_add_player',
      'league_build_lineup',
      'league_enter_scores',
      'league_move_players',
      'league_record_rating',
      'league_remove_player',
      'league_reschedule_matchup',
    ]);
    for (const n of pack.toolSchemas.map((t) => t.name)) {
      expect(['list_today', 'check_in', 'check_out', 'add_player', 'remove_player']).not.toContain(n);
    }
  });

  it('has no tool that emails, texts or reaches an outside system', () => {
    const names = setup().pack.toolSchemas.map((t) => t.name);
    for (const bad of ['email', 'send', 'sms', 'text', 'tennislink', 'topdog', 'book']) {
      expect(names.filter((n) => n.includes(bad))).toEqual([]);
    }
  });

  it('cannot reach another director\'s matchup by id', async () => {
    const f = setup();
    const r = await f.pack.execute('league_matchup_lineup', { matchup_id: MX });
    expect(r.ok).toBe(false);
    const w = await f.pack.execute('league_reschedule_matchup', { matchup_id: MX, new_date: '2026-11-04', confirm: true });
    expect(w.ok).toBe(false);
    expect(f.writes()).toHaveLength(0);
  });
});

// ------------------------------------------------------------------ build lineup

describe('league_build_lineup', () => {
  const INPUT = { division: '10U', date: '2026-10-11' };

  it('home match: everyone who said yes plays — leftovers on the exhibition court — and nothing is written before confirm', async () => {
    const f = setup();
    const p = await f.pack.execute('league_build_lineup', INPUT);
    expect(p.ok).toBe(true);
    expect(p.needsConfirm).toBe(true);
    expect(f.writes()).toHaveLength(0);
    const will = p.will as any;
    expect(will.we_are).toBe('home');
    expect(will.available.SH.from).toBe('RSVP yes');
    expect(will.available.SH.players).toHaveLength(7);
    expect(will.available.SH.not_included).toEqual([{ player: 'Gia Ruiz', why: 'RSVP no' }]);
    expect(will.rounds[0].exhibition.length).toBeGreaterThan(0);
    expect(will.rounds[0].sitting_out).toBeUndefined();

    const r = await f.pack.execute('league_build_lineup', { ...INPUT, confirm: true });
    expect(r.ok).toBe(true);
    expect(strip(r.did as any)).toEqual(strip(will));

    const saved = f.tables.league_matchup_lines.filter((l) => l.matchup_id === M1);
    expect(saved).toHaveLength(r.lines_saved as number);
    expect(saved.every((l) => !String(l.id).startsWith('tmp'))).toBe(true);
    // Every available SH kid is on a court in round 1.
    const onCourt = new Set(
      saved.flatMap((l) => [l.home_player1_id, l.home_player2_id, l.away_player1_id, l.away_player2_id]).filter((x) => String(x).startsWith('s')),
    );
    expect([...onCourt].sort()).toEqual(['s1', 's2', 's3', 's4', 's5', 's6', 's7']);
    const ex = saved.filter((l) => l.counts_for_team === false);
    expect(ex.length).toBeGreaterThan(0);
    expect(ex.every((l) => String(l.court_label).startsWith('Exhibition'))).toBe(true);
    expect(saved.filter((l) => l.counts_for_team).length).toBe(3); // the 3 match courts
  });

  it('applies the cap to the AWAY side only', async () => {
    const f = setup();
    const p = await f.pack.execute('league_build_lineup', { ...INPUT, away_cap: 3 });
    const will = p.will as any;
    expect(will.available.MCC.players).toEqual(['Hal Wu', 'Ivy Tran', 'Jon Kim']);
    expect(will.available.MCC.not_included.map((x: any) => x.why)).toEqual(['over the away cap of 3', 'over the away cap of 3']);
    expect(will.available.SH.players).toHaveLength(7);
  });

  it('refuses to rebuild a matchup that already has scores', async () => {
    const f = setup();
    const p = await f.pack.execute('league_build_lineup', { matchup_id: M0 });
    expect(p.ok).toBe(false);
    expect(String(p.error)).toMatch(/already have a score/);
  });
});

// ------------------------------------------------------------------ reads

describe('reads', () => {
  it('names who played #1 singles for them against us', async () => {
    const f = setup();
    const r = await f.pack.execute('league_matchup_lineup', { division: '10U', date: '2026-10-04' });
    expect(r.ok).toBe(true);
    const l1 = (r.lines as any[]).find((l) => l.position === '#1 singles');
    expect(l1.home).toBe('MCC (them): Hal Wu');
    expect(l1.away).toBe('SH (us): Gavin Cohen');
    expect(r.we_are).toBe('away');
  });

  it('standings and results', async () => {
    const r = await setup().pack.execute('league_standings', { division: '10U', include_players: true });
    expect(r.ok).toBe(true);
    expect((r.standings as any[])[0]).toMatchObject({ club: 'SH', w: 1, points: 2, lines: '3-1' });
    expect((r.results as any[])[0].winner).toBe('SH');
    expect((r.players as any[]).find((p) => p.player === 'Gavin Cohen').singles).toBe('1-0');
  });

  it('participation: fewest matches first, only our club by default', async () => {
    const r = await setup().pack.execute('league_participation', { division: '10U' });
    const rows = r.players as any[];
    expect(rows.every((p) => p.club === 'SH')).toBe(true);
    expect(rows[0].matches).toBe(0);
    expect(rows.find((p) => p.player === 'Ben Ortiz')).toMatchObject({ matches: 1, doubles: 1, record: '1-0' });
  });

  it('missing WTN reads the person record first', async () => {
    const r = await setup().pack.execute('league_missing_wtn', { division: '10U' });
    const names = (r.missing as any[]).map((m) => m.player);
    expect(names).not.toContain('Gavin Cohen'); // has a WTN on master_players
    expect(names).toContain('Ava Li');
    expect(r.missing_count).toBe(7);
  });
});

// ------------------------------------------------------------------ move players

describe('league_move_players', () => {
  it('swaps two players within the round; preview == run', async () => {
    const f = setup();
    const input = { division: '12U', date: '2026-10-18', moves: [{ player: 'Uma Bell', line: 1 }] };
    const p = await f.pack.execute('league_move_players', input);
    expect(p.ok).toBe(true);
    expect(f.writes()).toHaveLength(0);
    const r = await f.pack.execute('league_move_players', { ...input, confirm: true });
    expect(strip(r.did as any)).toEqual(strip(p.will as any));
    const byId = Object.fromEntries(f.tables.league_matchup_lines.map((l) => [l.id, l]));
    expect(byId.l21.away_player1_id).toBe('t2');
    expect(byId.l22.away_player1_id).toBe('t1');
  });

  it('will not touch a scored line', async () => {
    const r = await setup().pack.execute('league_move_players', { matchup_id: M0, moves: [{ player: 'Ava Li', line: 1 }] });
    expect(r.ok).toBe(false);
  });
});

// ------------------------------------------------------------------ scores

describe('league_enter_scores', () => {
  const INPUT = {
    division: '12U',
    date: '2026-10-18',
    lines: [
      { line: 1, score: '6-3 6-2' },
      { line: 2, score: '6-3', winner: 'them' },
    ],
    team_total: { us: 8, them: 4 },
  };

  it('parses from our side, stores home-first, flags a total that doesn\'t match; preview == run', async () => {
    const f = setup();
    const p = await f.pack.execute('league_enter_scores', INPUT);
    expect(p.ok).toBe(true);
    expect(f.writes()).toHaveLength(0);
    const will = p.will as any;
    // We are AWAY: our 6-3 6-2 is stored home-first as 3-6, 6... and away wins.
    expect(will.lines[0]).toMatchObject({ line: 1, score: '3-6, 2-6', winner: 'SH (us)' });
    // "Lost 6-3" said winner-first: home (them) won 6-3.
    expect(will.lines[1]).toMatchObject({ line: 2, score: '6-3', winner: 'MCC (them)' });
    expect(will.team_score_after).toBe('MCC 1 – 1 SH — final');
    expect(will.notes.join(' ')).toMatch(/winner's score/);
    expect(will.notes.join(' ')).toMatch(/you said 4–8/);

    const r = await f.pack.execute('league_enter_scores', { ...INPUT, confirm: true });
    expect(r.ok).toBe(true);
    expect(strip(r.did as any)).toEqual(strip(will));
    const l21 = f.tables.league_matchup_lines.find((l) => l.id === 'l21')!;
    expect(l21).toMatchObject({ winner: 'away', score: '3-6, 2-6', status: 'completed', reported_by_name: 'Director (Ask ClubMode)' });
    expect(l21.reported_at).toMatch(/^2026-10-09T/);
    // Re-laddered like the coach routes.
    expect(f.writes().some((w) => w.table === 'league_team_rosters' && 'ladder_position' in (w.payload as Row))).toBe(true);
  });

  it('a bare total is refused with the reason', async () => {
    const r = await setup().pack.execute('league_enter_scores', { division: '12U', date: '2026-10-18', team_total: { us: 8, them: 4 } });
    expect(r.ok).toBe(false);
    expect(String(r.error)).toMatch(/lines won/);
  });

  it('parseScore', () => {
    const a = parseScore('6-3, 2-6, (10-8)');
    expect('sets' in a && formatSets(a.sets)).toBe('6-3, 2-6, (10-8)');
    expect('sets' in a && setsWinner(a.sets)).toBe('a');
    const b = parseScore('7-6(4) 3–6 6-4');
    expect('sets' in b && formatSets(flipSets(b.sets))).toBe('6-7(4), 6-3, 4-6');
    expect('error' in parseScore('six three')).toBe(true);
    expect('error' in parseScore('4-4')).toBe(true);
  });
});

// ------------------------------------------------------------------ roster

describe('roster', () => {
  it('adds a kid with parent contacts to our team', async () => {
    const f = setup();
    const input = { player: 'Nia Gold', division: '12U', parent_name: 'Ann Gold', parent_email: 'Ann@Gold.com', parent_phone: '925-555-1212' };
    const p = await f.pack.execute('league_add_player', input);
    expect(p.ok).toBe(true);
    expect(f.writes()).toHaveLength(0);
    const r = await f.pack.execute('league_add_player', { ...input, confirm: true });
    expect(r.ok).toBe(true);
    const row = f.tables.league_team_rosters.find((x) => x.player_name === 'Nia Gold')!;
    expect(row).toMatchObject({ club_id: 'SH', division_id: 'D12', parent_email: 'ann@gold.com', ladder_position: 3, status: 'active' });
  });

  it('removing a kid with results withdraws them and clears upcoming lines', async () => {
    const f = setup();
    const r = await f.pack.execute('league_remove_player', { player: 'Tom Young', division: '12U', confirm: true });
    expect(r.ok).toBe(true);
    expect(r.withdrawn).toBeUndefined(); // no scored lines yet → deleted
    expect(f.tables.league_team_rosters.find((x) => x.id === 't1')).toBeUndefined();
    expect(f.tables.league_matchup_lines.find((l) => l.id === 'l21')!.away_player1_id).toBeNull();

    const g = setup();
    const w = await g.pack.execute('league_remove_player', { player: 'Gavin', division: '10U', confirm: true });
    expect(w.withdrawn).toBe('Gavin Cohen');
    expect(g.tables.league_team_rosters.find((x) => x.id === 's1')!.status).toBe('withdrawn');
  });
});

// ------------------------------------------------------------------ ratings

describe('league_record_rating', () => {
  it('writes WTN to the person record via the shared helper', async () => {
    const f = setup();
    const input = { name: 'Heather Young', wtn_singles: 33.6, wtn_doubles: 32.7 };
    const p = await f.pack.execute('league_record_rating', input);
    expect(p.ok).toBe(true);
    expect(setWtn).not.toHaveBeenCalled();
    const r = await f.pack.execute('league_record_rating', { ...input, confirm: true });
    expect(r.ok).toBe(true);
    expect(setWtn).toHaveBeenCalledWith('mp-heather', { wtn: 33.6, wtnDoubles: 32.7 }, 'manual');
  });

  it('"Craig is a 3.0" — NTRP on the person and the club rating; another club\'s Craig is invisible', async () => {
    const f = setup();
    const r = await f.pack.execute('league_record_rating', { name: 'Craig', ntrp: 3.0, confirm: true });
    expect(r.ok).toBe(true);
    expect(f.tables.master_players.find((x) => x.id === 'mp-craig')).toMatchObject({ ntrp: 3, ntrp_source: 'director' });
    expect(f.tables.cc_vault_players.find((x) => x.id === 'v2')!.usta_rating).toBe(3);
    expect(f.tables.cc_vault_players.find((x) => x.id === 'v3')!.usta_rating).toBeNull();
  });

  it('keeps an existing singles WTN when only doubles is given; rejects out-of-band numbers', async () => {
    const f = setup();
    await f.pack.execute('league_record_rating', { name: 'Gavin Cohen', wtn_doubles: 33, confirm: true });
    expect(setWtn).toHaveBeenCalledWith('mp-gavin', { wtn: 34.1, wtnDoubles: 33 }, 'manual');
    const bad = await f.pack.execute('league_record_rating', { name: 'Gavin Cohen', wtn_singles: 3.5, ntrp: 9 });
    expect(bad.ok).toBe(false);
  });

  it('asks when the name matches two people', async () => {
    const f = setup({
      cc_vault_players: [
        { id: 'v2', club_id: 'cc1', full_name: 'Craig Pell', master_player_id: 'mp-craig', wtn: null, wtn_doubles: null, usta_rating: null },
        { id: 'v4', club_id: 'cc1', full_name: 'Craig Sun', master_player_id: 'mp-sun', wtn: null, wtn_doubles: null, usta_rating: null },
      ],
    });
    const r = await f.pack.execute('league_record_rating', { name: 'Craig', ntrp: 3 });
    expect(r.ok).toBe(false);
    expect((r.candidates as any[]).map((c) => c.name).sort()).toEqual(['Craig Pell', 'Craig Sun']);
  });
});

// ------------------------------------------------------------------ reschedule

describe('league_reschedule_matchup', () => {
  it('moves the date in ClubMode only; preview lists what changes', async () => {
    const f = setup();
    const input = { division: '10U', date: '2026-10-11', new_date: '2026-11-04', new_time: '17:30' };
    const p = await f.pack.execute('league_reschedule_matchup', input);
    expect(p.ok).toBe(true);
    const will = p.will as any;
    expect(will.changes).toEqual(['date: Sun 2026-10-11 → Wed 2026-11-04', 'time: 16:00 (division default) → 17:30']);
    expect(will.warnings[0]).toMatch(/normally plays Sundays/);
    expect(will.stays_attached.rsvps).toMatch(/7 yes \/ 1 no/);
    expect(f.writes()).toHaveLength(0);
    const r = await f.pack.execute('league_reschedule_matchup', { ...input, confirm: true });
    expect(strip(r.did as any)).toEqual(strip(will));
    expect(f.tables.league_team_matchups.find((m) => m.id === M1)).toMatchObject({ match_date: '2026-11-04', start_time: '17:30:00' });
  });

  it('a played match cannot be moved', async () => {
    const r = await setup().pack.execute('league_reschedule_matchup', { matchup_id: M0, new_date: '2026-11-04' });
    expect(r.ok).toBe(false);
  });
});
