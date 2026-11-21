import { describe, expect, it } from 'vitest';
import { generateFMLCBracket, generateFFICBracket, type GeneratedMatch } from './tournamentFormats';

/**
 * FMLC / FFIC wiring for every field size 2-32 (11/21/26 fix: odd R1 counts dropped a
 * loser, FFIC left unfed slots, FMLC crashed on 13+). Every side of every match must have
 * exactly one feeder, and a simulated tournament must fill and play every match.
 */
const key = (m: GeneratedMatch) => `${m.bracket}:${m.round}:${m.slot}`;

function simulate(ms: GeneratedMatch[], aWins: (a: string, b: string, m: GeneratedMatch) => boolean) {
  const slots = new Map(ms.map((m) => [key(m), { a: m.player1_id, b: m.player3_id }]));
  const played = new Map<string, number>();
  const done = new Set<string>();
  for (let progress = true; progress;) {
    progress = false;
    for (const m of ms) {
      const st = slots.get(key(m))!;
      if (done.has(key(m)) || !st.a || !st.b) continue;
      const w = aWins(st.a, st.b, m) ? st.a : st.b, l = w === st.a ? st.b : st.a;
      for (const p of [st.a, st.b]) played.set(p, (played.get(p) ?? 0) + 1);
      for (const [f, p] of [[m.winner_feeds_to, w], [m.loser_feeds_to, l]] as const) {
        if (!f) continue;
        const [b, r, s, side] = f.split(':');
        const t = slots.get(`${b}:${r}:${s}`)!;
        expect(t[side as 'a' | 'b']).toBeNull();
        t[side as 'a' | 'b'] = p;
      }
      done.add(key(m)); progress = true;
    }
  }
  return { done, played };
}

const num = (id: string) => Number(id.slice(1));
const rules = [
  (a: string, b: string) => num(a) < num(b), // seeds hold
  (a: string, b: string) => num(a) > num(b), // upsets everywhere
  (a: string, b: string, m: GeneratedMatch) => (num(a) + num(b) + m.round) % 2 === 0,
];

describe.each([['FMLC', generateFMLCBracket], ['FFIC', generateFFICBracket]] as const)('%s', (name, gen) => {
  for (let n = 2; n <= 32; n++) {
    it(`${n} entrants: every slot fed once and every match gets played`, () => {
      const ids = Array.from({ length: n }, (_, i) => `e${i + 1}`);
      const ms = gen(ids);
      const byKey = new Set(ms.map(key));
      const incoming = new Map<string, number>();
      for (const m of ms) for (const f of [m.winner_feeds_to, m.loser_feeds_to]) if (f) {
        expect(byKey.has(f.split(':').slice(0, 3).join(':'))).toBe(true);
        incoming.set(f, (incoming.get(f) ?? 0) + 1);
      }
      for (const m of ms) for (const side of ['a', 'b'] as const) {
        const pre = side === 'a' ? m.player1_id : m.player3_id;
        expect((pre ? 1 : 0) + (incoming.get(`${key(m)}:${side}`) ?? 0)).toBe(1);
      }
      for (const rule of rules) {
        const { done, played } = simulate(ms, rule);
        expect(done.size).toBe(ms.length);
        // FFIC promise: everyone plays at least twice (3 entrants can't: the bye seed's only match is the final)
        if (name === 'FFIC' && n >= 4) for (const id of ids) expect(played.get(id) ?? 0).toBeGreaterThanOrEqual(2);
        // FMLC: every first-round loser gets a consolation match
        // (a single first-round loser has nobody to play, so no consolation then)
        const r1 = ms.filter((x) => x.bracket === 'main' && x.round === 1);
        if (name === 'FMLC' && r1.length >= 2) for (const m of r1) expect(m.loser_feeds_to).toBeTruthy();
      }
    });
  }
});
