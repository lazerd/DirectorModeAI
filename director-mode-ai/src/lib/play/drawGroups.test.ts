import { describe, expect, it } from 'vitest';
import {
  DrawError, addLateEntry, applyResult, buildDraw, drawPlan, drawProgress, fillCourts, isDrawFormat, matchEntries, moveMatch, nextFor, roundLabel, sideIds, standingsFor,
  type Draw, type DrawFormat, type DrawMatch, type DrawPlayer,
} from './draw';
import { allowedCourts, autoPools, betweenStages, groupTables, playoffMatches, poolChoices, quadCourtPairs } from './drawGroups';
import { scoreDraw } from './drawScore';
import { drawAwards } from './core';
import { drawResultsCsv } from './results';
import { buildQuadDoublesRound, computeFlightStandings } from '@/lib/quads';

/**
 * Quads (4..24 players, multiples of 4 or not) and pools + playoffs (6..24 entries, singles
 * and doubles): build → play the whole draw through applyResult under three result patterns →
 * every match is played, the doubles / playoffs appear only when they should, nobody is ever
 * on two courts, every phone card is right, and the places come out complete and unique.
 */
const NOW = '2026-11-21T18:00:00.000Z';
const players = (n: number): DrawPlayer[] => Array.from({ length: n }, (_, i) => ({ id: `r${i + 1}`, name: `P${i + 1}`, level: 5 - i * 0.1 }));

type Rule = (a: number, b: number, m: DrawMatch) => 'a' | 'b';
const RULES: [string, Rule][] = [
  ['seeds hold', (a, b) => (a < b ? 'a' : 'b')],
  ['upsets everywhere', (a, b) => (a > b ? 'a' : 'b')],
  ['mixed', (a, b, m) => ((a + b + m.round + m.slot) % 2 === 0 ? 'a' : 'b')],
];
const seedOf = (d: Draw, m: DrawMatch, s: 'a' | 'b') => sideIds(m, s).reduce((t, id) => t + d.entries.find((e) => e.id === id)!.seed, 0);

function checkBoard(d: Draw) {
  const on = d.matches.filter((m) => m.status === 'on_court');
  const courts = on.map((m) => m.court);
  expect(new Set(courts).size, 'a court is double-booked').toBe(courts.length);
  expect(on.length).toBeLessThanOrEqual(d.courts);
  const rsvps = on.flatMap(matchEntries).flatMap((id) => d.entries.find((e) => e.id === id)!.rsvpIds);
  expect(new Set(rsvps).size, 'a player is on two courts').toBe(rsvps.length);
  for (const m of on) {
    const allowed = allowedCourts(d, m);
    if (allowed) expect(allowed, 'a flight left its court pair').toContain(m.court);
  }
  for (const m of d.matches) if (m.status === 'ready' || m.status === 'on_court') expect(m.player1_id && m.player3_id).toBeTruthy();
}

function checkCards(d: Draw) {
  for (const e of d.entries) {
    const mine = d.matches.filter((m) => matchEntries(m).includes(e.id));
    const on = mine.find((m) => m.status === 'on_court');
    for (const rid of e.rsvpIds) {
      const c = nextFor(d, rid);
      if (on) { expect(c.kind).toBe('on_court'); if (c.kind === 'on_court') expect(c.match.key).toBe(on.key); continue; }
      if (mine.every((m) => m.status === 'done')) { expect(c.kind).toBe(betweenStages(d, e.id) ? 'between' : 'done'); continue; }
      expect(['up_next', 'waiting']).toContain(c.kind);
      if (c.kind === 'up_next' || c.kind === 'waiting') expect(c.match.status).not.toBe('done');
    }
  }
  for (const a of d.alternates ?? []) for (const rid of a.rsvpIds) expect(nextFor(d, rid).kind).toBe('alternate');
}

/** Quads only: a flight's doubles exists exactly when its six singles are done, paired 1+4 vs 2+3. */
function checkQuads(d: Draw) {
  for (const g of d.groups ?? []) {
    const ms = d.matches.filter((m) => m.group === g.id);
    const singles = ms.filter((m) => m.match_type === 'singles');
    const dbl = ms.filter((m) => m.match_type === 'doubles');
    expect(singles).toHaveLength(6);
    const allIn = singles.every((m) => m.status === 'done');
    expect(dbl.length, `${g.name} doubles`).toBe(allIn ? 1 : 0);
    if (dbl[0]) {
      const views = singles.map((m) => ({ player1_id: m.player1_id, player3_id: m.player3_id, score: m.score ?? null, winner_side: m.winner ?? null, status: 'completed', match_type: 'singles' as const, round: m.round }));
      const p = buildQuadDoublesRound(computeFlightStandings(g.entryIds.map((id, i) => ({ id, flight_seed: i + 1 })), views))!;
      expect([dbl[0].player1_id, dbl[0].player2_id, dbl[0].player3_id, dbl[0].player4_id]).toEqual([p.player1_id, p.player2_id, p.player3_id, p.player4_id]);
      expect(dbl[0].round).toBe(4);
    }
  }
}

/** Pools only: the playoffs exist exactly when every pool match is done. */
function checkPools(d: Draw) {
  const pool = d.matches.filter((m) => m.group);
  const allIn = pool.every((m) => m.status === 'done');
  expect(playoffMatches(d).length > 0, 'playoffs only after the pools').toBe(allIn);
}

function playOut(d0: Draw, rule: Rule, extra: (d: Draw) => void): Draw {
  let d = fillCourts(d0, NOW);
  checkBoard(d); checkCards(d); extra(d);
  for (let guard = 0; guard < 2000; guard++) {
    const on = d.matches.filter((m) => m.status === 'on_court').sort((a, b) => (a.court ?? 0) - (b.court ?? 0));
    if (!on.length) break;
    const m = on[guard % on.length];
    const w = rule(seedOf(d, m, 'a'), seedOf(d, m, 'b'), m);
    d = fillCourts(applyResult(d, m.key, w, w === 'a' ? `8-${guard % 7}` : `${guard % 7}-8`, { now: NOW }), NOW);
    checkBoard(d); checkCards(d); extra(d);
  }
  return d;
}

function checkFinal(d: Draw, n: number) {
  expect(d.matches.filter((m) => m.status !== 'done').map((m) => m.key), 'unplayed matches').toEqual([]);
  expect(drawProgress(d).complete).toBe(true);
  const st = standingsFor(d);
  expect(st).toHaveLength(n);
  expect(st.map((s) => s.rank)).toEqual(Array.from({ length: n }, (_, i) => i + 1));
  expect(st.map((s) => s.place), 'places unique and complete').toEqual(Array.from({ length: n }, (_, i) => i + 1));
  expect(new Set(st.map((s) => s.id)).size).toBe(n);
  for (const s of st) expect(s.label).toBeTruthy();
  for (const m of d.matches) expect(roundLabel(d, m)).toBeTruthy();
  const aw = drawAwards(d);
  expect(aw[0]?.title).toBe('Champion');
  expect(aw[0].who).toBe(st[0].name);
  expect(drawResultsCsv(d).split('\r\n').length).toBeGreaterThan(n);
}

describe('quads', () => {
  for (let n = 4; n <= 24; n++) {
    it(`${n} players: flights of 4, ${n % 4} alternate${n % 4 === 1 ? '' : 's'}, plays out under every pattern`, () => {
      expect(isDrawFormat('quads')).toBe(true);
      const courts = n % 3 === 0 ? 3 : 8;
      const start = buildDraw('quads', players(n), courts, { now: NOW, scoring: 'pro8' });
      const flights = Math.floor(n / 4);
      expect(start.groups).toHaveLength(flights);
      expect(start.entries).toHaveLength(flights * 4);
      expect(start.alternates?.length ?? 0).toBe(n % 4);
      expect(start.scoring).toBe('pro8');
      // MixerMode: the strongest four are Flight A, the leftovers are the lowest seeds.
      expect(start.groups![0].entryIds.map((id) => start.entries.find((e) => e.id === id)!.rsvpIds[0])).toEqual(['r1', 'r2', 'r3', 'r4']);
      expect((start.alternates ?? []).map((e) => e.rsvpIds[0])).toEqual(players(n).slice(flights * 4).map((p) => p.id));
      expect(start.matches).toHaveLength(flights * 6);
      for (const [, rule] of RULES) {
        const d = playOut(start, rule, checkQuads);
        expect(d.matches).toHaveLength(flights * 7);
        for (const e of d.entries) expect(d.matches.filter((m) => matchEntries(m).includes(e.id))).toHaveLength(4);
        checkFinal(d, flights * 4);
        // Every flight crowns a winner; places run by flight (A = 1-4, B = 5-8, ...).
        const st = standingsFor(d);
        d.groups!.forEach((g, fi) => {
          const rows = st.filter((s) => g.entryIds.includes(s.id));
          expect(rows.map((s) => s.place)).toEqual([fi * 4 + 1, fi * 4 + 2, fi * 4 + 3, fi * 4 + 4]);
          expect(rows[0].label).toBe(`${g.name} champion`);
        });
        expect(drawAwards(d).filter((a) => /champion|Champion/.test(a.title))).toHaveLength(flights);
      }
    }, 60_000);
  }

  it('each flight keeps its court pair (MixerMode autoScheduleQuads)', () => {
    expect(quadCourtPairs(8, 3)).toEqual([[1, 2], [3, 4], [5, 6]]);
    expect(quadCourtPairs(4, 3)).toEqual([[1, 2], [3, 4], [1, 2]]);
    expect(quadCourtPairs(1, 2)).toEqual([[1], [1]]);
    const d = fillCourts(buildDraw('quads', players(12), 6, { now: NOW }), NOW);
    expect(d.matches.filter((m) => m.status === 'on_court').map((m) => [m.group, m.court])).toEqual([['A', 1], ['A', 2], ['B', 3], ['B', 4], ['C', 5], ['C', 6]]);
  });

  it('phone cards: "Flight B · Round 2 · Court 3", the alternate card, the wait for the doubles', () => {
    let d = fillCourts(buildDraw('quads', players(9), 4, { now: NOW }), NOW);
    const c = nextFor(d, 'r5');
    expect(c.kind).toBe('on_court');
    if (c.kind === 'on_court') { expect(roundLabel(d, c.match)).toBe('Flight B · Round 1'); expect(c.courtName).toBe('3'); expect(c.opponent).toBe('P8'); }
    expect(nextFor(d, 'r9')).toMatchObject({ kind: 'alternate', position: 1, of: 1 });
    // Flight A plays its six singles; whoever finishes first waits on the doubles pairing.
    for (let i = 0; i < 6; i++) {
      const m = d.matches.find((x) => x.group === 'A' && x.status === 'on_court' && x.match_type === 'singles')!;
      d = fillCourts(applyResult(d, m.key, 'a', '8-3', { now: NOW }), NOW);
      if (i === 4) {
        const idle = d.entries.find((e) => d.groups![0].entryIds.includes(e.id) && !d.matches.some((m) => m.status !== 'done' && matchEntries(m).includes(e.id)))!;
        const w = nextFor(d, idle.rsvpIds[0]);
        expect(w.kind).toBe('between');
        if (w.kind === 'between') expect(w.stage).toBe('Flight A · Round 4 doubles');
      }
    }
    const dbl = d.matches.find((m) => m.group === 'A' && m.match_type === 'doubles')!;
    expect(dbl.status).toBe('on_court');
    expect(roundLabel(d, dbl)).toBe('Flight A · Round 4 doubles');
    expect([1, 2]).toContain(dbl.court);
    const card = nextFor(d, 'r1');
    expect(card.kind).toBe('on_court');
    if (card.kind === 'on_court') { expect(card.partner).toBe('P4'); expect(card.opponent).toBe('P2 / P3'); }
    // The quads doubles counts in full for both partners.
    d = fillCourts(applyResult(d, dbl.key, 'b', '3-8', { now: NOW }), NOW);
    const t = groupTables(d, String)[0];
    expect(t.rows.map((r) => r.gamesWon).reduce((s, x) => s + x, 0)).toBe(6 * 11 + 2 * 11);
    expect(nextFor(d, 'r1').kind).toBe('done');
  });

  it('a corrected singles score re-pairs a doubles that has not started; one on court refuses', () => {
    let d = buildDraw('quads', players(4), 1, { now: NOW });
    for (const m of d.matches.filter((x) => x.match_type === 'singles')) d = applyResult(d, m.key, 'a', '8-2', { now: NOW });
    const dbl = d.matches.find((m) => m.match_type === 'doubles')!;
    expect([dbl.player1_id, dbl.player2_id, dbl.player3_id, dbl.player4_id]).toEqual(['e1', 'e4', 'e2', 'e3']);
    // 1v2 (round 3) flips: P2 goes 3-0 and P1 2-1.
    const r3 = d.matches.find((m) => m.round === 3 && m.player1_id === 'e1')!;
    d = applyResult(d, r3.key, 'b', '2-8', { now: NOW });
    const again = d.matches.find((m) => m.match_type === 'doubles')!;
    expect([again.player1_id, again.player2_id, again.player3_id, again.player4_id]).toEqual(['e2', 'e4', 'e1', 'e3']);
    d = fillCourts(d, NOW);
    expect(() => applyResult(d, r3.key, 'a', '8-2', { now: NOW })).toThrow(DrawError);
    // Played: the doubles stands as played (MixerMode).
    d = applyResult(d, again.key, 'a', '8-6', { now: NOW });
    const fixed = applyResult(d, r3.key, 'a', '8-2', { now: NOW });
    expect(fixed.matches.find((m) => m.match_type === 'doubles')!.player1_id).toBe('e2');
  });

  it('scores must fit the scoring format; late arrivals cannot join', () => {
    const d = fillCourts(buildDraw('quads', players(8), 4, { now: NOW, scoring: 'pro8' }), NOW);
    const m = d.matches.find((x) => x.status === 'on_court')!;
    expect(() => scoreDraw(d, m.key, 'a', '8-5 8-3', null, NOW)).toThrow(/one score/);
    expect(scoreDraw(d, m.key, 'b', '8-5', null, NOW).matches.find((x) => x.key === m.key)!.score).toBe('5-8');
    const b3 = fillCourts(buildDraw('quads', players(8), 4, { now: NOW, scoring: 'best3' }), NOW);
    expect(scoreDraw(b3, m.key, 'a', '7-6 (7-3), 3-6, 10-7', null, NOW).matches.find((x) => x.key === m.key)!.score).toBe('7-6, 3-6, 10-7');
    expect(buildDraw('quads', players(8), 4, { now: NOW, scoring: 'nonsense' }).scoring).toBe('pro8');
    expect(() => addLateEntry(d, [{ id: 'x', name: 'X' }], NOW)).toThrow(/flights are set/);
    expect(() => buildDraw('quads', players(3), 2, { now: NOW })).toThrow(/at least 4/);
  });

  it('the host can still move a match anywhere; drawPlan reads out flights and alternates', () => {
    const d = fillCourts(buildDraw('quads', players(8), 4, { now: NOW }), NOW);
    const m = d.matches.find((x) => x.status === 'on_court' && x.group === 'B')!;
    const off = moveMatch(d, m.key, null, NOW);
    expect(off.matches.find((x) => x.key === m.key)!.status).toBe('ready');
    expect(drawPlan('quads', 10)).toMatchObject({ matches: 14, minEach: 4, maxEach: 4, groups: 2, alternates: 2 });
  });
});

describe('pools + playoffs', () => {
  it('pool counts: auto by field size, host choices need 3 a pool', () => {
    expect([6, 12, 13, 18, 19, 24].map(autoPools)).toEqual([2, 2, 3, 3, 4, 4]);
    expect(poolChoices(8)).toEqual([2]);
    expect(poolChoices(9)).toEqual([2, 3]);
    expect(poolChoices(12)).toEqual([2, 3, 4]);
  });

  for (const doubles of [false, true]) {
    for (let n = 6; n <= 24; n++) {
      const fmt: DrawFormat = doubles ? 'rr-pools-doubles' : 'rr-pools-singles';
      const counts = [null, ...poolChoices(n).filter((k) => k !== autoPools(n))];
      it(`${doubles ? 'doubles' : 'singles'}, ${n} ${doubles ? 'pairs' : 'players'}: pools (${counts.map((k) => k ?? 'auto').join('/')}) + playoffs play out`, () => {
        for (const k of counts) {
          const start = buildDraw(fmt, players(doubles ? n * 2 : n), 4, { now: NOW, pools: k });
          expect(start.entries).toHaveLength(n);
          expect(start.groups).toHaveLength(k ?? autoPools(n));
          // Snake seeding: the top seeds are spread one a pool.
          expect(start.groups!.map((g) => g.entryIds[0])).toEqual(start.groups!.map((_, i) => `e${i + 1}`));
          const sizes = start.groups!.map((g) => g.entryIds.length);
          expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
          for (const [, rule] of RULES) {
            const d = playOut(start, rule, checkPools);
            checkFinal(d, n);
            const st = standingsFor(d);
            const final = d.matches.find((m) => m.places?.[0] === 1)!;
            expect(st[0].id).toBe(final.winner === 'b' ? final.player3_id : final.player1_id);
            expect(st[0].label).toBe('Champion');
            expect(st[1].label).toBe('Finalist');
            // Everyone plays their whole pool, and the playoff field is 1st vs 1st, 2nd vs 2nd ...
            const tabs = groupTables(d, String);
            const firsts = new Set(tabs.map((t) => t.rows[0].id));
            expect(firsts.has(final.player1_id!) || firsts.has(final.player3_id!)).toBe(true);
            if (d.groups!.length === 2) {
              expect(firsts).toEqual(new Set([final.player1_id, final.player3_id]));
              expect(roundLabel(d, final)).toBe('Final (1st–2nd)');
            }
          }
        }
      }, 60_000);
    }
  }

  it('phone card between pool play and the playoffs; a corrected pool score re-seats the playoffs', () => {
    let d = fillCourts(buildDraw('rr-pools-singles', players(6), 6, { now: NOW }), NOW);
    expect(d.groups!.map((g) => g.name)).toEqual(['Pool A', 'Pool B']);
    // Pool A (e1, e4, e5) finishes first: its players wait on Pool B.
    for (let guard = 0; guard < 10; guard++) {
      const m = d.matches.find((x) => x.group === 'A' && x.status !== 'done');
      if (!m) break;
      d = fillCourts(applyResult(d, m.key, 'a', '6-2', { now: NOW }), NOW);
    }
    const w = nextFor(d, 'r1');
    expect(w.kind).toBe('between');
    expect(drawProgress(d).total).toBe(6 + 3);
    for (const m of d.matches.filter((x) => x.group === 'B')) d = fillCourts(applyResult(d, m.key, 'a', '6-2', { now: NOW }), NOW);
    const po = playoffMatches(d);
    expect(po).toHaveLength(3);
    expect(po.map((m) => roundLabel(d, m))).toEqual(['Final (1st–2nd)', 'Playoff for 3rd–4th', 'Playoff for 5th–6th']);
    // Fix a Pool B score so its 2nd and 3rd swap: the 3rd-4th and 5th-6th playoffs re-seat (not started).
    const before = po.map((m) => m.player3_id);
    const bMatch = d.matches.find((m) => m.group === 'B' && m.player1_id === before[1] && m.player3_id === before[2]) ?? d.matches.find((m) => m.group === 'B' && m.player3_id === before[1] && m.player1_id === before[2])!;
    const flipped = applyResult(moveMatch(moveMatch(d, po[1].key, null, NOW), po[2].key, null, NOW), bMatch.key, bMatch.winner === 'a' ? 'b' : 'a', '2-6', { now: NOW });
    const after = playoffMatches(flipped);
    expect(new Set(after.map((m) => m.player3_id))).toEqual(new Set(before));
  });

  it('three and four pools: tiers play semis, a final and a 3rd-place match', () => {
    let d = buildDraw('rr-pools-singles', players(12), 6, { now: NOW, pools: 4 });
    for (const m of d.matches) d = applyResult(d, m.key, 'a', '6-1', { now: NOW });
    const po = playoffMatches(d);
    expect(po.filter((m) => m.tier === 1).map((m) => roundLabel(d, m))).toEqual(['Playoff semis (1st–4th)', 'Playoff semis (1st–4th)', 'Final (1st–2nd)', '3rd-place match']);
    let d3 = buildDraw('rr-pools-singles', players(9), 6, { now: NOW, pools: 3 });
    for (const m of d3.matches) d3 = applyResult(d3, m.key, 'a', '6-1', { now: NOW });
    expect(playoffMatches(d3).filter((m) => m.tier === 1).map((m) => roundLabel(d3, m))).toEqual(['Playoff semi (1st–3rd)', 'Final (1st–2nd)']);
    expect(() => addLateEntry(buildDraw('rr-pools-singles', players(8), 4, { now: NOW }), [{ id: 'x', name: 'X' }], NOW)).toThrow(/pools are set/);
    expect(() => buildDraw('rr-pools-singles', players(5), 4, { now: NOW })).toThrow(/at least 6/);
  });
});
