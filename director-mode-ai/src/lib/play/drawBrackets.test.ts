import { describe, expect, it } from 'vitest';
import {
  DRAW_LIMITS, DrawError, addLateEntry, applyResult, buildDraw, drawFormatFor, drawKind, drawPlan, drawProgress, drawSizeProblem, fillCourts, isDrawFormat,
  moveMatch, nextFor, resolveByes, roundLabel, standingsFor,
  type Draw, type DrawKind, type DrawMatch, type DrawPlayer,
} from './draw';
import { scoreDraw } from './drawScore';
import { drawAwards } from './core';

/**
 * Brackets (single elimination, FMLC, FFIC, compass), singles and doubles, every size:
 * build → play the whole thing through applyResult with three result patterns → every
 * match is played, no court or player is ever double-booked, every phone card is right,
 * and the placements come out complete.
 */
const NOW = '2026-11-21T18:00:00.000Z';
const players = (n: number): DrawPlayer[] => Array.from({ length: n }, (_, i) => ({ id: `r${i + 1}`, name: `P${i + 1}`, level: 5 - i * 0.1 }));

type Rule = (a: number, b: number, m: DrawMatch) => 'a' | 'b';
const RULES: [string, Rule][] = [
  ['seeds hold', (a, b) => (a < b ? 'a' : 'b')],
  ['upsets everywhere', (a, b) => (a > b ? 'a' : 'b')],
  ['mixed', (a, b, m) => ((a + b + m.round + m.slot) % 2 === 0 ? 'a' : 'b')],
];

function checkBoard(d: Draw) {
  const on = d.matches.filter((m) => m.status === 'on_court');
  const courts = on.map((m) => m.court);
  expect(new Set(courts).size, 'a court is double-booked').toBe(courts.length);
  expect(on.length).toBeLessThanOrEqual(d.courts);
  const rsvps = on.flatMap((m) => [m.player1_id, m.player3_id]).flatMap((id) => d.entries.find((e) => e.id === id)!.rsvpIds);
  expect(new Set(rsvps).size, 'a player is on two courts').toBe(rsvps.length);
  for (const m of d.matches) {
    if (m.status === 'ready' || m.status === 'on_court') {
      expect(m.player1_id && m.player3_id).toBeTruthy();
      // A BYE never waits for a court: it settles the moment both sides are known.
      expect(d.entries.find((e) => e.id === m.player1_id)!.bye).toBeFalsy();
      expect(d.entries.find((e) => e.id === m.player3_id)!.bye).toBeFalsy();
    }
  }
}

/** Every player's phone card agrees with the draw. */
function checkCards(d: Draw) {
  for (const e of d.entries.filter((x) => !x.bye)) {
    const mine = d.matches.filter((m) => m.player1_id === e.id || m.player3_id === e.id);
    const on = mine.find((m) => m.status === 'on_court');
    for (const rid of e.rsvpIds) {
      const c = nextFor(d, rid);
      if (on) { expect(c.kind).toBe('on_court'); if (c.kind === 'on_court') expect(c.match.key).toBe(on.key); continue; }
      if (mine.every((m) => m.status === 'done')) { expect(c.kind).toBe('done'); continue; }
      expect(['up_next', 'waiting']).toContain(c.kind);
      if (c.kind === 'up_next' || c.kind === 'waiting') expect(c.match.status).not.toBe('done');
    }
  }
}

function playOut(d0: Draw, rule: Rule): Draw {
  let d = fillCourts(d0, NOW);
  checkBoard(d); checkCards(d);
  for (let guard = 0; guard < 500; guard++) {
    const on = d.matches.filter((m) => m.status === 'on_court').sort((a, b) => (a.court ?? 0) - (b.court ?? 0));
    if (!on.length) break;
    const m = on[guard % on.length];
    const sa = d.entries.find((e) => e.id === m.player1_id)!.seed, sb = d.entries.find((e) => e.id === m.player3_id)!.seed;
    const w = rule(sa, sb, m);
    d = fillCourts(applyResult(d, m.key, w, w === 'a' ? '6-3' : '3-6', { now: NOW }), NOW);
    checkBoard(d); checkCards(d);
  }
  return d;
}

const SIZES: Record<Exclude<DrawKind, 'rr' | 'quads' | 'rr-pools'>, number[]> = {
  'single-elim': [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
  fmlc: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
  ffic: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
  compass: [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
};

for (const [kind, sizes] of Object.entries(SIZES) as [Exclude<DrawKind, 'rr' | 'quads' | 'rr-pools'>, number[]][]) {
  describe(`${kind}`, () => {
    for (const doubles of [false, true]) {
      for (const n of sizes) {
        it(`${doubles ? 'doubles' : 'singles'}, ${n} ${doubles ? 'pairs' : 'players'}: plays out under every result pattern`, () => {
          const fmt = drawFormatFor(kind, doubles);
          expect(isDrawFormat(fmt)).toBe(true);
          const start = buildDraw(fmt, players(doubles ? n * 2 : n), 3, { now: NOW });
          expect(start.entries.filter((e) => !e.bye)).toHaveLength(n);
          if (kind === 'compass') {
            expect(start.entries).toHaveLength(n <= 8 ? 8 : 16);
            // BYEs settle at once: no open match with both sides known has a BYE in it.
            for (const m of start.matches.filter((x) => x.status !== 'done' && x.player1_id && x.player3_id)) {
              for (const id of [m.player1_id, m.player3_id]) expect(start.entries.find((e) => e.id === id)!.bye).toBeFalsy();
            }
          } else {
            expect(start.entries.some((e) => e.bye)).toBe(false);
          }
          for (const [, rule] of RULES) {
            const d = playOut(start, rule);
            expect(d.matches.filter((m) => m.status !== 'done').map((m) => m.key), 'unplayed matches').toEqual([]);
            expect(drawProgress(d).complete).toBe(true);
            const st = standingsFor(d);
            expect(st).toHaveLength(n);
            expect(st.map((s) => s.rank)).toEqual(Array.from({ length: n }, (_, i) => i + 1));
            expect(new Set(st.map((s) => s.id)).size).toBe(n);
            expect(st.filter((s) => s.place === 1)).toHaveLength(1);
            expect(st.filter((s) => s.place === 2)).toHaveLength(1);
            for (const s of st) { expect(s.label).toBeTruthy(); expect(s.place).toBeLessThanOrEqual(s.rank); }
            const champ = d.matches.find((m) => m.bracket === 'main' && !m.winner_feeds_to && (kind !== 'compass' || m.round === (d.entries.length === 8 ? 3 : 4)))!;
            expect(st[0].id).toBe(champ.winner === 'a' ? champ.player1_id : champ.player3_id);
            if (kind === 'compass') {
              // All places decided, and unique.
              expect(st.map((s) => s.place)).toEqual(Array.from({ length: n }, (_, i) => i + 1));
              // Everyone is in 3 (8-draw) or 4 (16-draw) matches, BYEs included.
              const per = d.entries.length === 8 ? 3 : 4;
              for (const e of d.entries) expect(d.matches.filter((m) => m.player1_id === e.id || m.player3_id === e.id)).toHaveLength(per);
            } else {
              expect(st[0].label).toBe('Champion');
              expect(st[1].label).toBe('Finalist');
            }
            // Every finished player sees "done".
            for (const e of d.entries.filter((x) => !x.bye)) expect(nextFor(d, e.rsvpIds[0]).kind).toBe('done');
            const aw = drawAwards(d);
            expect(aw[0].title).toBe('Champion');
            expect(aw.find((a) => a.title === 'Finalist')).toBeTruthy();
            for (const m of d.matches) expect(roundLabel(d, m)).toBeTruthy();
          }
        });
      }
    }
  });
}

describe('placements and labels', () => {
  const run = (kind: DrawKind, n: number, rule = RULES[0][1]) => playOut(buildDraw(drawFormatFor(kind, false), players(n), 4, { now: NOW }), rule);

  it('single elimination 8, seeds hold: champion, finalist, two 3rds, four 5ths', () => {
    const st = standingsFor(run('single-elim', 8));
    expect(st.map((s) => [s.name, s.place, s.label])).toEqual([
      ['P1', 1, 'Champion'], ['P2', 2, 'Finalist'], ['P3', 3, 'Semifinalist'], ['P4', 3, 'Semifinalist'],
      ['P5', 5, 'Quarterfinalist'], ['P6', 5, 'Quarterfinalist'], ['P7', 5, 'Quarterfinalist'], ['P8', 5, 'Quarterfinalist'],
    ]);
  });

  it('FMLC 8: the back draw has a consolation champion and it is an award', () => {
    const d = run('fmlc', 8);
    const st = standingsFor(d);
    expect(st.filter((s) => s.label === 'Consolation champion')).toHaveLength(1);
    expect(st.find((s) => s.label === 'Consolation champion')!.name).toBe('P5');
    expect(drawAwards(d).map((a) => a.title)).toContain('Consolation champion');
  });

  it('FFIC 16: the back draw orders everyone behind the finalists', () => {
    const st = standingsFor(run('ffic', 16));
    expect(st.slice(0, 2).map((s) => s.label)).toEqual(['Champion', 'Finalist']);
    expect(st.every((s) => s.played >= 2)).toBe(true);
  });

  it('compass 16, seeds hold: places 1..16 follow the seeds', () => {
    const st = standingsFor(run('compass', 16));
    expect(st.map((s) => s.name)).toEqual(Array.from({ length: 16 }, (_, i) => `P${i + 1}`));
    expect(st.map((s) => s.label).slice(0, 4)).toEqual(['1st', '2nd', '3rd', '4th']);
  });

  it('compass 8, seeds hold: places 1..8, West winner is the consolation champion', () => {
    const d = run('compass', 8);
    expect(standingsFor(d).map((s) => s.name)).toEqual(['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8']);
    expect(drawAwards(d).find((a) => a.title === 'Consolation champion')!.who).toBe('P5');
  });

  it('while a compass is live, the places still in play show as a range', () => {
    let d = fillCourts(buildDraw('compass-singles', players(8), 4, { now: NOW }), NOW);
    for (const m of d.matches.filter((x) => x.status === 'on_court')) d = applyResult(d, m.key, 'a', '6-1', { now: NOW });
    const st = standingsFor(d);
    expect(st.find((s) => s.name === 'P1')!.label).toBe('1st–4th');
    expect(st.find((s) => s.name === 'P8')!.label).toBe('5th–8th');
  });

  it('biggest upset by seed (never a walkover)', () => {
    let d = fillCourts(buildDraw('single-elim-singles', players(4), 2, { now: NOW }), NOW);
    const [a, b] = d.matches.filter((m) => m.round === 1);
    d = applyResult(d, a.key, 'b', '4-6, 3-6', { now: NOW }); // P4 d. P1
    d = applyResult(d, b.key, 'b', 'W/O', { how: 'W/O', now: NOW }); // P3 by walkover over P2
    const up = drawAwards(d).find((x) => x.title === 'Biggest upset')!;
    expect(up.who).toBe('P4');
    expect(up.why).toBe('No. 4 seed beat No. 1 P1, 6-4, 6-3');
  });
});

describe('field sizes', () => {
  it('clear messages outside each draw’s limits', () => {
    expect(drawSizeProblem('compass-singles', 4)).toMatch(/compass draw needs 5–16 players \(4 players here\)/);
    expect(drawSizeProblem('compass-doubles', 17)).toMatch(/5–16 pairs \(17 pairs here, 34 players\)/);
    expect(drawSizeProblem('fmlc-singles', 3)).toMatch(/First-Match Consolation needs at least 4 players/);
    expect(drawSizeProblem('single-elim-singles', 33)).toMatch(/tops out at 32/);
    expect(drawSizeProblem('single-elim-singles', 2)).toBeNull();
    expect(() => buildDraw('compass-singles', players(4), 2)).toThrow(DrawError);
    expect(() => buildDraw('compass-singles', players(17), 2)).toThrow(/5–16/);
    for (const k of Object.keys(DRAW_LIMITS) as DrawKind[]) expect(drawSizeProblem(drawFormatFor(k, false), DRAW_LIMITS[k].min)).toBeNull();
  });

  it('drawPlan counts real matches (BYEs left out)', () => {
    expect(drawPlan('single-elim-singles', 8)).toEqual({ matches: 7, minEach: 1, maxEach: 3 });
    expect(drawPlan('compass-singles', 8)).toEqual({ matches: 12, minEach: 3, maxEach: 3 });
    expect(drawPlan('compass-singles', 16)).toEqual({ matches: 32, minEach: 4, maxEach: 4 });
    const five = drawPlan('compass-singles', 5);
    expect('matches' in five && five.matches < 12).toBe(true);
    expect(drawPlan('compass-singles', 3)).toHaveProperty('problem');
    expect(drawPlan('rr-singles', 5)).toEqual({ matches: 10, minEach: 4, maxEach: 4 });
  });
});

describe('seeding', () => {
  it('the host’s seed order wins; everyone else follows by level', () => {
    const d = buildDraw('single-elim-singles', players(6), 2, { seeds: ['r5', 'r2'] });
    expect(d.entries.map((e) => e.name)).toEqual(['P5', 'P2', 'P1', 'P3', 'P4', 'P6']);
    // A seeded player who isn't checked in is just skipped.
    expect(buildDraw('single-elim-singles', players(3), 2, { seeds: ['r9', 'r3'] }).entries.map((e) => e.name)).toEqual(['P3', 'P1', 'P2']);
  });

  it('doubles: a pair takes its best-seeded player’s spot', () => {
    const d = buildDraw('single-elim-doubles', players(8), 2, { pairs: [['r1', 'r8'], ['r2', 'r7']], seeds: ['r7'] });
    expect(d.entries[0].name).toBe('P2 / P7');
  });

  it('byes go to the top seeds (single elimination 6: seeds 1 and 2 start in the semis)', () => {
    const d = buildDraw('single-elim-singles', players(6), 2);
    const semis = d.matches.filter((m) => m.round === 2);
    expect(semis.map((m) => m.player1_id).sort()).toEqual(['e1', 'e2']);
    expect(d.matches.filter((m) => m.round === 1)).toHaveLength(2);
  });
});

describe('BYEs and re-scoring', () => {
  it('compass 5: every BYE match is already settled, nothing waits on a ghost', () => {
    const d = fillCourts(buildDraw('compass-singles', players(5), 8, { now: NOW }), NOW);
    expect(d.entries.filter((e) => e.bye)).toHaveLength(3);
    const byes = d.matches.filter((m) => m.bye);
    expect(byes.length).toBeGreaterThan(0);
    for (const m of byes) expect(m.status).toBe('done');
    // R1: only 4 v 5 is real. Seeds 2 and 3 walked through their BYEs straight into an East semi;
    // the top seed waits in the other one for the 4 v 5 winner.
    expect(d.matches.filter((m) => m.status === 'on_court').map((m) => m.key)).toEqual(['main:1:2', 'main:2:2']);
    const top = nextFor(d, 'r1');
    expect(top.kind).toBe('waiting');
    expect(() => applyResult(d, byes[0].key, 'b', '6-0')).toThrow(/bye/);
  });

  it('re-scoring a result re-settles the BYE match the loser walked through', () => {
    let d = fillCourts(buildDraw('compass-singles', players(7), 8, { now: NOW }), NOW);
    // 7 players: seed 8 is a BYE. R1 slot 1 is P1 v BYE (settled). West semi 1 = loser(R1 s1 = BYE) v loser(R1 s2: P4 v P5).
    const r1s2 = d.matches.find((m) => m.key === 'main:1:2')!;
    expect(r1s2.status).toBe('on_court');
    d = applyResult(d, 'main:1:2', 'a', '6-2', { now: NOW }); // P4 wins, P5 to West
    const west = () => d.matches.find((m) => m.key === 'consolation:1:1')!;
    expect(west().bye).toBe(true);
    expect(west().status).toBe('done');
    const loserNow = () => d.matches.find((m) => m.key === 'consolation:2:1')!; // West final
    expect([loserNow().player1_id, loserNow().player3_id]).toContain('e5');
    // Fix: P5 actually won. P4 walks through the West BYE instead, P5 goes East.
    d = applyResult(d, 'main:1:2', 'b', '2-6', { now: NOW });
    expect(west().status).toBe('done');
    expect([west().player1_id, west().player3_id]).toContain('e4');
    expect([loserNow().player1_id, loserNow().player3_id]).toContain('e4');
    expect([loserNow().player1_id, loserNow().player3_id]).not.toContain('e5');
    const east = d.matches.find((m) => m.key === 'main:2:1')!;
    expect([east.player1_id, east.player3_id]).toEqual(['e1', 'e5']);
  });

  it('a re-score is refused when the next real match has started, and nothing changes', () => {
    let d = fillCourts(buildDraw('single-elim-doubles', players(8), 4, { now: NOW }), NOW);
    const [a, b] = d.matches.filter((m) => m.round === 1);
    d = fillCourts(applyResult(d, a.key, 'a', '6-1', { now: NOW }), NOW);
    d = fillCourts(applyResult(d, b.key, 'a', '6-1', { now: NOW }), NOW);
    expect(d.matches.find((m) => m.key === 'main:2:1')!.status).toBe('on_court');
    const before = JSON.stringify(d);
    expect(() => applyResult(d, a.key, 'b', '1-6', { now: NOW })).toThrow(/already started/);
    expect(JSON.stringify(d)).toBe(before);
    // Same winner, new score: fine.
    d = applyResult(d, a.key, 'a', '7-5', { now: NOW });
    expect(d.matches.find((m) => m.key === a.key)!.score).toBe('7-5');
  });

  it('a held match stays off court; the host can put it back', () => {
    let d = fillCourts(buildDraw('ffic-singles', players(8), 4, { now: NOW }), NOW);
    const m = d.matches.find((x) => x.status === 'on_court')!;
    d = fillCourts(moveMatch(d, m.key, null, NOW), NOW);
    expect(d.matches.find((x) => x.key === m.key)!.status).toBe('ready');
    d = fillCourts(moveMatch(d, m.key, 'auto', NOW), NOW);
    expect(d.matches.find((x) => x.key === m.key)!.status).toBe('on_court');
  });

  it('scoreDraw (typed winner-first) runs a compass to the end', () => {
    let d = fillCourts(buildDraw('compass-doubles', players(20), 3, { now: NOW }), NOW);
    for (let g = 0; g < 100; g++) {
      const m = d.matches.find((x) => x.status === 'on_court');
      if (!m) break;
      d = scoreDraw(d, m.key, g % 3 ? 'a' : 'b', '6-4 6-4', null, NOW);
    }
    expect(drawProgress(d).complete).toBe(true);
    expect(standingsFor(d).map((s) => s.place)).toEqual(Array.from({ length: 10 }, (_, i) => i + 1));
  });

  it('resolveByes is a no-op without BYEs', () => {
    const d = buildDraw('single-elim-singles', players(5), 2);
    const c = JSON.stringify(d);
    resolveByes(d, NOW);
    expect(JSON.stringify(d)).toBe(c);
  });
});

describe('late arrivals', () => {
  it('round robin: added before any result, matches already on court stay put', () => {
    let d = fillCourts(buildDraw('rr-singles', players(5), 2, { now: NOW }), NOW);
    const on = d.matches.filter((m) => m.status === 'on_court').map((m) => [m.court, [m.player1_id, m.player3_id].sort().join('|'), m.startedAt]);
    d = addLateEntry(d, [{ id: 'late', name: 'Late', level: 3 }], NOW);
    expect(d.entries).toHaveLength(6);
    expect(d.entries[5]).toMatchObject({ name: 'Late', seed: 6, rsvpIds: ['late'] });
    expect(d.matches).toHaveLength(15);
    const after = d.matches.filter((m) => m.status === 'on_court').map((m) => [m.court, [m.player1_id, m.player3_id].sort().join('|'), m.startedAt]);
    for (const o of on) expect(after).toContainEqual(o);
    expect(nextFor(d, 'late').kind).not.toBe('not_in');
    expect(() => addLateEntry(d, [{ id: 'late', name: 'Late' }], NOW)).toThrow(/already in the draw/);
  });

  it('round robin doubles takes a pair', () => {
    const d = buildDraw('rr-doubles', players(6), 2, { now: NOW });
    expect(() => addLateEntry(d, [{ id: 'x', name: 'X' }], NOW)).toThrow(/pair/);
    const d2 = addLateEntry(d, [{ id: 'x', name: 'X' }, { id: 'y', name: 'Y' }], NOW);
    expect(d2.entries[3].name).toBe('X / Y');
    expect(d2.matches).toHaveLength(6);
  });

  it('refused once a match is done, and always for brackets', () => {
    let d = fillCourts(buildDraw('rr-singles', players(4), 2, { now: NOW }), NOW);
    d = applyResult(d, d.matches.find((m) => m.status === 'on_court')!.key, 'a', '6-0', { now: NOW });
    expect(() => addLateEntry(d, [{ id: 'z', name: 'Z' }], NOW)).toThrow(/already under way/);
    const b = buildDraw('single-elim-singles', players(4), 2, { now: NOW });
    expect(() => addLateEntry(b, [{ id: 'z', name: 'Z' }], NOW)).toThrow(/bracket can’t take late entries/);
    expect(() => addLateEntry(buildDraw('rr-singles', players(16), 2), [{ id: 'z', name: 'Z' }], NOW)).toThrow(/tops out at 16/);
  });
});

it('drawKind / drawFormatFor round-trip', () => {
  for (const k of ['rr', 'single-elim', 'fmlc', 'ffic', 'compass'] as DrawKind[]) for (const dbl of [false, true]) expect(drawKind(drawFormatFor(k, dbl))).toBe(k);
});

describe('results export and sheets', () => {
  it('CSV: places then every real match, winner-first; BYEs left out', async () => {
    const { drawResultsCsv } = await import('./results');
    const { drawSheet, hasBackDraw } = await import('./drawSheet');
    let d = fillCourts(buildDraw('compass-singles', players(6), 4, { now: NOW }), NOW);
    for (let g = 0; g < 50; g++) {
      const m = d.matches.find((x) => x.status === 'on_court');
      if (!m) break;
      d = fillCourts(applyResult(d, m.key, 'b', '3-6, 4-6', { now: NOW }), NOW);
    }
    const csv = drawResultsCsv(d).split('\r\n');
    expect(csv[0]).toBe('Place,Finish,Seed,Player,Played,Wins,Losses,Games won,Games lost');
    expect(csv.slice(1, 7)).toHaveLength(6);
    expect(csv.join('\n')).not.toMatch(/BYE/);
    expect(csv.find((l) => l.startsWith('Round 1,'))).toMatch(/,"6-3, 6-4",,Played$/);
    const sh = drawSheet(d);
    expect(sh.format).toBe('compass-singles');
    expect(sh.entries.find((e) => e.player_name === 'BYE')!.seed).toBeNull();
    expect(hasBackDraw(d)).toBe(false);
    const f = buildDraw('fmlc-doubles', players(16), 2, { now: NOW });
    expect(hasBackDraw(f)).toBe(true);
    expect(drawSheet(f, 'consolation').matches.every((m) => m.bracket === 'consolation')).toBe(true);
    expect(drawSheet(f).format).toBe('single-elim-doubles');
  });

  it('compass round names put the place on the match that decides it', () => {
    const d = buildDraw('compass-singles', players(16), 4);
    expect(roundLabel(d, { bracket: 'main', round: 1 })).toBe('Round 1');
    expect(roundLabel(d, { bracket: 'main', round: 4 })).toBe('East final (1st–2nd)');
    expect(roundLabel(d, { bracket: 'consolation', round: 1 })).toBe('West round 1');
    expect(roundLabel(d, { bracket: 'consolation', round: 8 })).toBe('Northeast playoff (3rd–4th)');
    const s = buildDraw('single-elim-singles', players(8), 4);
    expect(['main:1', 'main:2', 'main:3'].map((k) => roundLabel(s, { bracket: 'main', round: +k.split(':')[1] }))).toEqual(['Quarterfinals', 'Semifinals', 'Final']);
  });
});
