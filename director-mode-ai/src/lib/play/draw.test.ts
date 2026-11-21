import { describe, expect, it } from 'vitest';
import { computeRRStandings, generateTournamentMatches } from '@/lib/tournamentFormats';
import {
  DrawError, applyResult, buildDraw, fillCourts, makePairs, matchKey, moveMatch, nextFor, parseSets, rrGridFor, seedPlayers, standingsFor, winnerOfScore,
  type Draw, type DrawMatch, type DrawPlayer,
} from './draw';
import { cleanPairs, drawScoreText, scoreDraw } from './drawScore';
import { drawBoardRows, drawCallout } from './tv';

const NOW = '2026-11-21T18:00:00.000Z';
const players = (n: number, level?: (i: number) => number | null): DrawPlayer[] =>
  Array.from({ length: n }, (_, i) => ({ id: `r${i + 1}`, name: `P${i + 1}`, level: level ? level(i) : null }));

/** Tiny deterministic PRNG so the simulations are repeatable. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

/** Invariants that must hold after every step. */
function checkBoard(d: Draw) {
  const on = d.matches.filter((m) => m.status === 'on_court');
  const courts = on.map((m) => m.court);
  expect(new Set(courts).size, 'a court is double-booked').toBe(courts.length);
  for (const c of courts) expect(c).toBeGreaterThanOrEqual(1);
  const ids = on.flatMap((m) => [m.player1_id, m.player3_id]);
  expect(new Set(ids).size, 'an entry is on two courts').toBe(ids.length);
  // ...and no player (rsvp) is on two courts either.
  const rsvps = ids.flatMap((id) => d.entries.find((e) => e.id === id)!.rsvpIds);
  expect(new Set(rsvps).size).toBe(rsvps.length);
  expect(on.length).toBeLessThanOrEqual(d.courts);
  for (const m of d.matches) {
    if (m.status === 'ready' || m.status === 'on_court') expect(m.player1_id && m.player3_id).toBeTruthy();
  }
}

/** Play the whole draw: score whatever is on court (random winner) until everything is done. */
function playOut(d0: Draw, seed = 1, typed = false): Draw {
  const r = rng(seed);
  let d = fillCourts(d0, NOW);
  checkBoard(d);
  for (let guard = 0; guard < 1000; guard++) {
    const on = d.matches.filter((m) => m.status === 'on_court');
    if (!on.length) break;
    const m = on[Math.floor(r() * on.length)];
    const w = r() < 0.5 ? 'a' : 'b';
    // Every player on court sees their court.
    for (const id of [m.player1_id, m.player3_id]) {
      for (const rid of d.entries.find((e) => e.id === id)!.rsvpIds) {
        const c = nextFor(d, rid);
        expect(c.kind).toBe('on_court');
        if (c.kind === 'on_court') { expect(c.match.key).toBe(m.key); expect(c.court).toBe(m.court); }
      }
    }
    const lo = Math.floor(r() * 5);
    d = typed ? scoreDraw(d, m.key, w, `6-${lo}`, null, NOW) : fillCourts(applyResult(d, m.key, w, w === 'a' ? `6-${lo}` : `${lo}-6`, { now: NOW }), NOW);
    checkBoard(d);
  }
  return d;
}

describe('seeding and entries', () => {
  it('seeds by level, strongest first; blank levels last in signup order', () => {
    const ps = [{ id: 'a', name: 'A', level: null }, { id: 'b', name: 'B', level: 3.5 }, { id: 'c', name: 'C', level: null }, { id: 'd', name: 'D', level: 4.5 }, { id: 'e', name: 'E', level: 3.5 }];
    expect(seedPlayers(ps).map((p) => p.id)).toEqual(['d', 'b', 'e', 'a', 'c']);
    const d = buildDraw('rr-singles', ps, 2);
    expect(d.entries.map((e) => [e.id, e.name, e.seed])).toEqual([['e1', 'D', 1], ['e2', 'B', 2], ['e3', 'E', 3], ['e4', 'A', 4], ['e5', 'C', 5]]);
  });

  it('auto-pairs doubles strongest with weakest', () => {
    const ps = players(8, (i) => 5 - i * 0.25); // P1 strongest ... P8 weakest
    const pairs = makePairs(ps);
    expect(pairs.map((p) => p.map((x) => x.name).join('/'))).toEqual(['P1/P8', 'P2/P7', 'P3/P6', 'P4/P5']);
    const d = buildDraw('rr-doubles', ps, 2);
    expect(d.matchType).toBe('doubles');
    expect(d.entries.every((e) => e.rsvpIds.length === 2)).toBe(true);
    expect(d.entries[0].name).toBe('P1 / P8');
  });

  it('keeps host pairs, auto-pairs the rest, and drops a pair whose player is not here', () => {
    const ps = players(6, (i) => 4 - i * 0.1);
    const d = buildDraw('rr-doubles', ps, 2, { pairs: [['r1', 'r2'], ['r3', 'r99']] });
    const names = d.entries.map((e) => e.players.join('+')).sort();
    expect(names).toContain('P1+P2');
    // r3 went back in the pool: P3..P6 auto-paired strongest+weakest
    expect(names).toContain('P3+P6');
    expect(names).toContain('P4+P5');
  });

  it('refuses odd doubles, duplicate pairs and tiny or huge fields with a clear message', () => {
    expect(() => buildDraw('rr-doubles', players(5), 2)).toThrow(/even number/);
    expect(() => buildDraw('rr-doubles', players(6), 2, { pairs: [['r1', 'r2'], ['r2', 'r3']] })).toThrow(/two pairs/);
    expect(() => buildDraw('rr-singles', players(1), 2)).toThrow(DrawError);
    expect(() => buildDraw('rr-singles', players(17), 2)).toThrow(/tops out at 16/);
    expect(() => buildDraw('single-elim' as never, players(4), 2)).toThrow(/isn’t ready/);
  });
});

describe('round robin, 3 to 12 entrants', () => {
  for (const doubles of [false, true]) {
    for (let n = 3; n <= 12; n++) {
      it(`${doubles ? 'doubles' : 'singles'} with ${n} ${doubles ? 'pairs' : 'players'}`, () => {
        const ps = players(doubles ? n * 2 : n, (i) => (i % 3 === 0 ? null : 3 + (i % 5) * 0.25));
        for (const courts of [1, 2, 3, 5]) {
          const d = buildDraw(doubles ? 'rr-doubles' : 'rr-singles', ps, courts);
          expect(d.entries).toHaveLength(n);
          expect(d.matches).toHaveLength((n * (n - 1)) / 2);
          // every pair of entries meets exactly once
          const seen = new Map<string, number>();
          for (const m of d.matches) { const k = [m.player1_id, m.player3_id].sort().join('|'); seen.set(k, (seen.get(k) ?? 0) + 1); }
          expect(seen.size).toBe((n * (n - 1)) / 2);
          expect([...seen.values()].every((v) => v === 1)).toBe(true);
          // nobody plays twice in a round; byes rotate (odd n: each entry sits exactly one round)
          const rounds = [...new Set(d.matches.map((m) => m.round))];
          expect(rounds).toHaveLength(n % 2 ? n : n - 1);
          const sits = new Map(d.entries.map((e) => [e.id, 0]));
          for (const r of rounds) {
            const inR = d.matches.filter((m) => m.round === r).flatMap((m) => [m.player1_id!, m.player3_id!]);
            expect(new Set(inR).size).toBe(inR.length);
            expect(inR.length).toBe(2 * Math.floor(n / 2));
            for (const e of d.entries) if (!inR.includes(e.id)) sits.set(e.id, sits.get(e.id)! + 1);
          }
          for (const v of sits.values()) expect(v).toBe(n % 2 ? 1 : 0);
          expect(new Set(d.matches.map((m) => m.key)).size).toBe(d.matches.length);
          expect(d.matches.every((m) => m.status === 'ready' && m.key === matchKey(m))).toBe(true);

          const done = playOut(d, n * 7 + courts, doubles);
          expect(done.matches.every((m) => m.status === 'done')).toBe(true);
          // standings are MixerMode's computeRRStandings
          const ref = computeRRStandings(done.entries, done.matches.map((m) => ({ player1_id: m.player1_id, player3_id: m.player3_id, score: m.score ?? null, winner_side: m.winner ?? null, status: 'completed' })));
          const mine = standingsFor(done);
          expect(mine.map((s) => [s.id, s.rank, s.wins, s.losses, s.gamesWon, s.gamesLost])).toEqual(ref.map((s) => [s.entry_id, s.rank, s.match_wins, s.match_losses, s.games_won, s.games_lost]));
          expect(mine.reduce((t, s) => t + s.wins, 0)).toBe(done.matches.length);
          // every rsvp's card says done, with a record that adds up
          for (const e of done.entries) for (const rid of e.rsvpIds) {
            const c = nextFor(done, rid);
            expect(c.kind).toBe('done');
            if (c.kind === 'done') expect(c.wins + c.losses).toBe(n - 1);
          }
          const grid = rrGridFor(done);
          expect(grid.flights).toHaveLength(1);
          expect(grid.flights[0].complete).toBe(true);
        }
      });
    }
  }
});

describe('fillCourts', () => {
  it('fills free courts in round then slot order and never puts a player on two courts', () => {
    const d = fillCourts(buildDraw('rr-singles', players(4), 3), NOW);
    const on = d.matches.filter((m) => m.status === 'on_court');
    // 4 players: only 2 matches can run at once even with 3 courts
    expect(on.map((m) => [m.round, m.slot, m.court])).toEqual([[1, 1, 1], [1, 2, 2]]);
    expect(on.every((m) => m.startedAt === NOW)).toBe(true);
  });

  it('frees a court when its match is done and the next startable match takes it', () => {
    let d = fillCourts(buildDraw('rr-singles', players(5), 2), NOW);
    const first = d.matches.find((m) => m.court === 1 && m.status === 'on_court')!;
    d = fillCourts(applyResult(d, first.key, 'a', '6-2', { now: NOW }), NOW);
    expect(d.matches.find((m) => m.key === first.key)!.status).toBe('done');
    const c1 = d.matches.filter((m) => m.status === 'on_court' && m.court === 1);
    expect(c1).toHaveLength(1);
    expect(c1[0].key).not.toBe(first.key);
    checkBoard(d);
  });

  it('respects court labels and a reduced court count', () => {
    let d = fillCourts(buildDraw('rr-singles', players(8), 4, { courtLabels: ['5', '6', '7', '8'] }), NOW);
    const c = nextFor(d, d.entries[0].rsvpIds[0]);
    expect(c.kind).toBe('on_court');
    if (c.kind === 'on_court') expect(c.courtName).toBe(String(4 + c.court));
    // Down to 2 courts: courts 3 and 4 finish where they are, nothing new goes there.
    d = { ...d, courts: 2 };
    const on3 = d.matches.find((m) => m.court === 3 && m.status === 'on_court')!;
    d = fillCourts(applyResult(d, on3.key, 'a', '6-1', { now: NOW }), NOW);
    expect(d.matches.filter((m) => m.status === 'on_court' && m.court === 3)).toHaveLength(0);
  });
});

describe('nextFor', () => {
  it('up next, waiting on a busy opponent, and not in the draw', () => {
    // 3 players, 1 court: r1 match on court, others queue.
    const d = fillCourts(buildDraw('rr-singles', players(3), 1), NOW);
    const on = d.matches.find((m) => m.status === 'on_court')!;
    const onIds = [on.player1_id, on.player3_id];
    const idle = d.entries.find((e) => !onIds.includes(e.id))!;
    const c = nextFor(d, idle.rsvpIds[0]);
    // the idle player's matches are both against someone on court
    expect(c.kind).toBe('waiting');
    if (c.kind === 'waiting') expect(c.waitingOn).toMatch(/on Court 1/);
    expect(nextFor(d, 'nobody').kind).toBe('not_in');
    expect(nextFor(d, null).kind).toBe('not_in');

    const d2 = fillCourts(buildDraw('rr-singles', players(6), 1), NOW);
    const queued = d2.matches.filter((m) => m.status === 'ready');
    const cards = d2.entries.map((e) => nextFor(d2, e.rsvpIds[0])).filter((x) => x.kind === 'up_next');
    expect(cards.length).toBeGreaterThan(0);
    for (const x of cards) if (x.kind === 'up_next') expect(x.ahead).toBe(queued.filter((m) => m.status === 'ready').sort((a, b) => a.round - b.round || a.slot - b.slot).filter((m) => !d2.matches.some((o) => o.status === 'on_court' && [o.player1_id, o.player3_id].some((id) => id === m.player1_id || id === m.player3_id))).indexOf(x.match));
  });

  it('a held match waits on the host', () => {
    let d = fillCourts(buildDraw('rr-singles', players(2), 1), NOW);
    const m = d.matches[0];
    d = fillCourts(moveMatch(d, m.key, null, NOW), NOW);
    expect(d.matches[0].status).toBe('ready');
    expect(d.matches[0].held).toBe(true);
    const c = nextFor(d, 'r1');
    expect(c.kind).toBe('waiting');
    if (c.kind === 'waiting') expect(c.waitingOn).toMatch(/host/);
    d = fillCourts(moveMatch(d, m.key, 'auto', NOW), NOW);
    expect(d.matches[0].status).toBe('on_court');
  });
});

describe('moveMatch', () => {
  it('moves a match to a free court, refuses a busy court or a busy player', () => {
    let d = fillCourts(buildDraw('rr-singles', players(4), 3), NOW);
    const on = d.matches.filter((m) => m.status === 'on_court');
    expect(() => moveMatch(d, on[0].key, on[1].court!, NOW)).toThrow(/Take that one off first/);
    d = moveMatch(d, on[0].key, 3, NOW);
    expect(d.matches.find((m) => m.key === on[0].key)!.court).toBe(3);
    const later = d.matches.find((m) => m.status === 'ready')!;
    // every remaining match has a player who is on court right now
    expect(() => moveMatch(d, later.key, 1, NOW)).toThrow(/still playing/);
    expect(() => moveMatch(d, later.key, 9, NOW)).toThrow(/from 1 to 3/);
  });
});

/* ---------- brackets: the advance rules (formats ship later; the rules are in now) ---------- */
function bracket(fmt: 'single-elim-singles' | 'ffic-singles', n: number, courts = 4): Draw {
  const entries = Array.from({ length: n }, (_, i) => ({ id: `e${i + 1}`, rsvpIds: [`r${i + 1}`], name: `P${i + 1}`, players: [`P${i + 1}`], seed: i + 1 }));
  const matches: DrawMatch[] = generateTournamentMatches(fmt, entries.map((e) => e.id)).map((m) => ({ ...m, key: matchKey(m), status: m.player1_id && m.player3_id ? 'ready' : 'pending', court: null, winner: null, score: null }));
  return { format: 'rr-singles', matchType: 'singles', entries, matches, courts };
}

describe('applyResult advance rules', () => {
  it('moves the winner along winner_feeds_to and the loser along loser_feeds_to', () => {
    let d = bracket('ffic-singles', 4);
    const r1 = d.matches.filter((m) => m.bracket === 'main' && m.round === 1);
    d = applyResult(d, r1[0].key, 'a', '6-1');
    d = applyResult(d, r1[1].key, 'b', '1-6');
    const final = d.matches.find((m) => m.key === 'main:2:1')!;
    expect([final.player1_id, final.player3_id]).toEqual([r1[0].player1_id, r1[1].player3_id]);
    expect(final.status).toBe('ready');
    const cons = d.matches.find((m) => m.bracket === 'consolation')!;
    expect([cons.player1_id, cons.player3_id].sort()).toEqual([r1[0].player3_id, r1[1].player1_id].sort());
  });

  it('re-scoring swaps the advanced player while the next match has not started', () => {
    let d = bracket('single-elim-singles', 4);
    const [m1] = d.matches.filter((m) => m.round === 1);
    d = applyResult(d, m1.key, 'a', '6-1');
    expect(d.matches.find((m) => m.round === 2)!.player1_id).toBe(m1.player1_id);
    d = applyResult(d, m1.key, 'b', '3-6');
    const fin = d.matches.find((m) => m.round === 2)!;
    expect(fin.player1_id).toBe(m1.player3_id);
    expect(fin.status).toBe('pending'); // other semi not played
    // same winner, new score: nothing downstream moves
    d = applyResult(d, m1.key, 'b', '4-6');
    expect(d.matches.find((m) => m.key === m1.key)!.score).toBe('4-6');
    expect(d.matches.find((m) => m.round === 2)!.player1_id).toBe(m1.player3_id);
  });

  it('refuses to re-score once the next match is on court (and changes nothing)', () => {
    let d = bracket('single-elim-singles', 4);
    const [a, b] = d.matches.filter((m) => m.round === 1);
    d = applyResult(d, a.key, 'a', '6-1');
    d = applyResult(d, b.key, 'a', '6-2');
    d = fillCourts(d, NOW);
    expect(d.matches.find((m) => m.round === 2)!.status).toBe('on_court');
    expect(() => applyResult(d, a.key, 'b', '1-6')).toThrow(/already started/);
    expect(d.matches.find((m) => m.key === a.key)!.winner).toBe('a');
  });

  it('a pending match (sides unknown) cannot be scored', () => {
    const d = bracket('single-elim-singles', 4);
    expect(() => applyResult(d, 'main:2:1', 'a', '6-0')).toThrow(/isn’t set yet/);
    expect(() => applyResult(d, 'main:9:9', 'a', '6-0')).toThrow(/isn’t in the draw/);
  });

  it('nextFor names the feeder match while the opponent is TBD', () => {
    let d = bracket('single-elim-singles', 4);
    const [a] = d.matches.filter((m) => m.round === 1);
    d = applyResult(d, a.key, 'a', '6-1');
    const c = nextFor(d, `r${a.player1_id!.slice(1)}`);
    expect(c.kind).toBe('waiting');
    if (c.kind === 'waiting') expect(c.waitingOn).toMatch(/^the winner of /);
    const lost = nextFor(d, `r${a.player3_id!.slice(1)}`);
    expect(lost.kind).toBe('done');
  });
});

describe('scores', () => {
  it('reads typed scores and refuses tied sets', () => {
    expect(parseSets('6-4 6-3')).toEqual([[6, 4], [6, 3]]);
    expect(parseSets('6–4, 3 - 6, 10-7')).toEqual([[6, 4], [3, 6], [10, 7]]);
    expect(parseSets('7-6(5) 6-4')).toEqual([[7, 6], [6, 4]]);
    expect(() => parseSets('4-4')).toThrow(/tied/);
    expect(() => parseSets('')).toThrow(/Enter the score/);
    expect(() => parseSets('six-four')).toThrow(/isn’t a set score/);
  });

  it('stores winner-first input player1-first (canonicalScore)', () => {
    expect(drawScoreText('6-4 6-3', 'a')).toBe('6-4, 6-3');
    expect(drawScoreText('6-4 6-3', 'b')).toBe('4-6, 3-6');
    expect(drawScoreText('6-4 3-6 10-7', 'b')).toBe('4-6, 6-3, 7-10');
    expect(drawScoreText('8-5', 'b')).toBe('5-8');
    expect(drawScoreText('5-8', 'b')).toBe('5-8'); // single set: orientation by magnitude
    expect(winnerOfScore('4-6, 6-3, 7-10')).toBe('b');
    expect(() => drawScoreText('6-4 6-4 2-6', 'a')).toThrow(/other side won/);
    expect(() => drawScoreText('4-4', 'a')).toThrow(/tied/);
  });

  it('walkover, default and retired', () => {
    expect(drawScoreText(null, 'a', 'W/O')).toBe('W/O');
    expect(drawScoreText('6-1', 'b', 'DEF')).toBe('DEF');
    expect(drawScoreText('', 'a', 'RET')).toBe('RET');
    expect(drawScoreText('6-4 2-2', 'b', 'RET')).toBe('4-6, 2-2, RET');
    // a W/O counts as a win with no games in the standings
    let d = fillCourts(buildDraw('rr-singles', players(3), 1), NOW);
    const m = d.matches.find((x) => x.status === 'on_court')!;
    d = scoreDraw(d, m.key, 'b', null, 'W/O', NOW);
    const st = standingsFor(d);
    const w = st.find((s) => s.id === m.player3_id)!;
    expect([w.wins, w.gamesWon, w.gamesLost]).toEqual([1, 0, 0]);
    expect(d.matches.find((x) => x.key === m.key)!.how).toBe('W/O');
    // the court went to the next match
    expect(d.matches.filter((x) => x.status === 'on_court')).toHaveLength(1);
  });
});

/* ---------- what the server actions do, end to end without a DB ---------- */
describe('a doubles round robin from start to finish (server flow)', () => {
  it('pairs, start, typed scores, fixes, standings, TV callouts', () => {
    const ps = players(8, (i) => [4.5, 4.0, 3.5, 3.0, null, 3.5, 4.0, 3.0][i]);
    const pairs = cleanPairs([['r1', 'r5']], new Set(ps.map((p) => p.id)));
    expect(() => cleanPairs([['r1', 'r1']], new Set(['r1']))).toThrow(DrawError);
    expect(() => cleanPairs([['r1', 'zz']], new Set(['r1']))).toThrow(/isn’t on this one/);
    let d = fillCourts(buildDraw('rr-doubles', ps, 2, { pairs }), NOW);
    expect(d.entries.some((e) => e.rsvpIds.join() === 'r1,r5')).toBe(true);
    const before = new Set<string>();
    expect(drawCallout(d, before)).toMatch(/^Court 1: P\d and P\d versus P\d and P\d\. Court 2: /);
    const r = rng(42);
    let fixes = 0;
    for (let i = 0; i < 100; i++) {
      const on = d.matches.filter((m) => m.status === 'on_court');
      if (!on.length) break;
      const m = on[0];
      const w = r() < 0.5 ? 'a' : 'b';
      const prev = new Set(on.map((x) => x.key));
      d = scoreDraw(d, m.key, w, '6-3 4-6 10-8', null, NOW);
      checkBoard(d);
      const called = drawCallout(d, prev);
      if (d.matches.some((x) => x.status === 'on_court' && !prev.has(x.key))) expect(called).toMatch(/^Court /);
      // the host fixes a result (winner flips): RR has nothing downstream, so it always works
      if (i % 3 === 0) { d = scoreDraw(d, m.key, w === 'a' ? 'b' : 'a', '7-5 6-4', null, NOW); fixes++; }
    }
    expect(fixes).toBeGreaterThan(0);
    expect(d.matches.every((m) => m.status === 'done')).toBe(true);
    const st = standingsFor(d);
    expect(st.reduce((t, s) => t + s.wins, 0)).toBe(6);
    const rows = drawBoardRows(d);
    expect(rows[0].rank).toBe('1');
    expect(rows.map((x) => x.id)).toEqual(st.map((x) => x.id));
  });
});
