import { describe, it, expect } from 'vitest';
import { syncQuadDoublesRound, sameDoublesPairing } from './quadDoubles';
import { computeFlightStandings, computeQuadFinalStandings } from './quads';

/** Just enough of the supabase-js query builder for syncQuadDoublesRound. */
function fakeDb(init: { matches: any[]; entries: any[]; duration?: number }) {
  const db = {
    quad_matches: init.matches.map((m) => ({ ...m })),
    quad_entries: init.entries,
    quad_flights: [{ id: 'F', event: { round_duration_minutes: init.duration ?? 30, start_time: '12:00' } }],
  } as Record<string, any[]>;
  let nextId = 1;
  const client = {
    from(table: string) {
      const filters: Array<[string, any]> = [];
      const rows = () => db[table].filter((r) => filters.every(([k, v]) => r[k] === v));
      const q: any = {
        select: () => q,
        eq: (k: string, v: any) => {
          filters.push([k, v]);
          return q;
        },
        maybeSingle: async () => ({ data: rows()[0] ?? null }),
        then: (resolve: any) => resolve({ data: rows() }),
        insert: async (row: any) => {
          // Mirrors the quad_matches_one_doubles_per_flight unique index.
          if (
            row.match_type === 'doubles' &&
            db[table].some((r) => r.flight_id === row.flight_id && r.match_type === 'doubles')
          ) {
            return { error: { code: '23505', message: 'duplicate key' } };
          }
          db[table].push({ id: `new${nextId++}`, status: 'pending', ...row });
          return { error: null };
        },
        update: (patch: any) => ({
          eq: async (k: string, v: any) => {
            db[table].filter((r) => r[k] === v).forEach((r) => Object.assign(r, patch));
            return { error: null };
          },
        }),
      };
      return q;
    },
  };
  return { client, db };
}

const ENTRIES = ['a', 'b', 'c', 'd'].map((id, i) => ({ id, flight_id: 'F', flight_seed: i + 1 }));
const TIMES = ['12:00:00', '12:30:00', '13:00:00'];

let mid = 0;
function sgl(round: number, p1: string, p3: string, score: string | null, winner: 'a' | 'b' | null, court: string) {
  return {
    id: `m${String(++mid).padStart(3, '0')}`,
    flight_id: 'F',
    round,
    match_type: 'singles',
    player1_id: p1,
    player3_id: p3,
    score,
    winner_side: winner,
    status: score ? 'completed' : 'pending',
    court,
    scheduled_at: TIMES[round - 1],
  };
}

// Rounds at 12:00 / 12:30 / 1:00 on courts 1 + 2 (what auto-schedule writes).
// a beats everyone, b beats c and d; the last match (c v d) is the variable.
function flight(last: [string | null, 'a' | 'b' | null]) {
  return [
    sgl(1, 'a', 'd', '4-1', 'a', '1'),
    sgl(1, 'b', 'c', '4-2', 'a', '2'),
    sgl(2, 'a', 'c', '4-2', 'a', '1'),
    sgl(2, 'b', 'd', '4-3', 'a', '2'),
    sgl(3, 'a', 'b', '4-0', 'a', '1'),
    sgl(3, 'c', 'd', last[0], last[1], '2'),
  ];
}

const doublesOf = (db: Record<string, any[]>) => db.quad_matches.filter((m) => m.match_type === 'doubles');
const pair = (p1: string, p2: string, p3: string, p4: string) => ({
  player1_id: p1,
  player2_id: p2,
  player3_id: p3,
  player4_id: p4,
});

describe('syncQuadDoublesRound', () => {
  it('waits while any singles is unscored', async () => {
    const { client, db } = fakeDb({ matches: flight([null, null]), entries: ENTRIES });
    expect(await syncQuadDoublesRound(client, 'F')).toEqual({ action: 'waiting' });
    expect(doublesOf(db)).toHaveLength(0);
  });

  it('pairs from the database, counting the score that was just saved', async () => {
    // c beats d → ladder a, b, c, d → a+d vs b+c.
    const { client, db } = fakeDb({ matches: flight(['4-2', 'a']), entries: ENTRIES });
    expect((await syncQuadDoublesRound(client, 'F')).action).toBe('created');
    const [d] = doublesOf(db);
    expect(sameDoublesPairing(d, pair('a', 'd', 'b', 'c'))).toBe(true);
    // One round after R3, on the flight's first court.
    expect(d.scheduled_at).toBe('13:30');
    expect(d.court).toBe('1');
  });

  it('the last score decides the pairing (d beats c → a+c vs b+d)', async () => {
    const { client, db } = fakeDb({ matches: flight(['2-4', 'b']), entries: ENTRIES });
    await syncQuadDoublesRound(client, 'F');
    expect(sameDoublesPairing(doublesOf(db)[0], pair('a', 'c', 'b', 'd'))).toBe(true);
  });

  it('re-pairs an unscored doubles when a singles score is corrected', async () => {
    const { client, db } = fakeDb({ matches: flight(['4-2', 'a']), entries: ENTRIES });
    await syncQuadDoublesRound(client, 'F');
    Object.assign(
      db.quad_matches.find((m) => m.round === 3 && m.player1_id === 'c'),
      { score: '2-4', winner_side: 'b' }
    );
    expect((await syncQuadDoublesRound(client, 'F')).action).toBe('repaired');
    const doubles = doublesOf(db);
    expect(doubles).toHaveLength(1);
    expect(sameDoublesPairing(doubles[0], pair('a', 'c', 'b', 'd'))).toBe(true);
    expect(doubles[0].court).toBe('1');
  });

  it('never re-pairs a doubles that has been played, but reports it', async () => {
    const { client, db } = fakeDb({ matches: flight(['4-2', 'a']), entries: ENTRIES });
    await syncQuadDoublesRound(client, 'F');
    Object.assign(doublesOf(db)[0], { status: 'completed', score: '4-2', winner_side: 'a' });
    Object.assign(
      db.quad_matches.find((m) => m.round === 3 && m.player1_id === 'c'),
      { score: '2-4', winner_side: 'b' }
    );
    expect(await syncQuadDoublesRound(client, 'F')).toEqual({ action: 'locked', stalePairing: true });
    expect(sameDoublesPairing(doublesOf(db)[0], pair('a', 'd', 'b', 'c'))).toBe(true);
  });

  it('two simultaneous final scores create only one doubles', async () => {
    const { client, db } = fakeDb({ matches: flight(['4-2', 'a']), entries: ENTRIES });
    await Promise.all([syncQuadDoublesRound(client, 'F'), syncQuadDoublesRound(client, 'F')]);
    expect(doublesOf(db)).toHaveLength(1);
  });
});

describe('three-way ties', () => {
  // a>b, b>c, c>a — a head-to-head circle — and all three beat d.
  const m = (round: number, p1: string, p3: string, score: string, w: 'a' | 'b') => ({
    round,
    match_type: 'singles',
    player1_id: p1,
    player3_id: p3,
    score,
    winner_side: w,
    status: 'completed',
  });
  const cycle = [
    m(1, 'a', 'd', '4-2', 'a'),
    m(1, 'b', 'c', '4-2', 'a'),
    m(2, 'a', 'c', '2-4', 'b'),
    m(2, 'b', 'd', '4-2', 'a'),
    m(3, 'a', 'b', '4-2', 'a'),
    m(3, 'c', 'd', '4-2', 'a'),
  ] as any[];
  const entries = ['a', 'b', 'c', 'd'].map((id, i) => ({ id, flight_seed: i + 1 }));

  it('rank the same no matter what order the rows arrive in', () => {
    const ladder = computeFlightStandings(entries, cycle).map((s) => s.entry_id);
    const final = computeQuadFinalStandings(entries, cycle).map((s) => s.entry_id);
    for (let i = 0; i < 25; i++) {
      const shuffled = [...cycle].sort(() => Math.random() - 0.5);
      const ents = [...entries].sort(() => Math.random() - 0.5);
      expect(computeFlightStandings(ents, shuffled).map((s) => s.entry_id)).toEqual(ladder);
      expect(computeQuadFinalStandings(ents, shuffled).map((s) => s.entry_id)).toEqual(final);
    }
    // All three on 2-1 with 10 games won and 8 lost; seed breaks it.
    expect(ladder).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('winner-first scores', () => {
  // Darrin's own rehearsal entries (9/29): he picked the winner, then typed
  // the score winner-first — "4-2" for every match, whichever side won.
  const s = (round: number, a: string, b: string, w: 'a' | 'b') => ({
    round,
    match_type: 'singles',
    player1_id: a,
    player3_id: b,
    score: '4-2',
    winner_side: w,
    status: 'completed',
  });
  const matches = [
    s(1, 'ava', 'dee', 'a'),
    s(1, 'ben', 'cal', 'b'),
    s(2, 'ava', 'cal', 'a'),
    s(2, 'ben', 'dee', 'b'),
    s(3, 'ava', 'ben', 'b'),
    s(3, 'cal', 'dee', 'a'),
    {
      round: 4,
      match_type: 'doubles',
      player1_id: 'ava',
      player2_id: 'ben',
      player3_id: 'cal',
      player4_id: 'dee',
      score: '4-2',
      winner_side: 'b',
      status: 'completed',
    },
  ] as any[];
  const entries = ['ava', 'ben', 'cal', 'dee'].map((id, i) => ({ id, flight_seed: i + 1 }));

  it('credit the winner with the bigger number', () => {
    const rows = computeQuadFinalStandings(entries, matches);
    expect(rows.map((r) => [r.entry_id, r.games_won])).toEqual([
      ['cal', 14], // champion — was scored as Ava 16
      ['ava', 12], // ties Dee on games + wins, beat her head-to-head
      ['dee', 12],
      ['ben', 10],
    ]);
    expect(rows[0].is_champion).toBe(true);
  });

  it('read the same whether typed winner-first or left-player-first', () => {
    const leftFirst = matches.map((m) => (m.winner_side === 'b' ? { ...m, score: '2-4' } : m));
    expect(computeQuadFinalStandings(entries, leftFirst)).toEqual(computeQuadFinalStandings(entries, matches));
  });
});
