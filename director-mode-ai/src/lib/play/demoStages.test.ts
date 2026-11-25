import { describe, expect, it } from 'vitest';
import { buildStages, STAGE_COURTS, STAGE_PLAYERS, STAGE_TITLE } from './demoStages';
import { FREE_AT_LAUNCH, PASS_PRICES, PRICING_LINE } from './pricing';

const ins = (e: { rsvps: { status: string }[] }) => e.rsvps.filter((r) => r.status === 'in').length;
const now = new Date('2026-11-22T12:00:00-08:00');

describe('landing demo stages (Friday Night Doubles)', () => {
  for (const sport of ['tennis', 'pickleball', 'padel'] as const) {
    it(`${sport}: the roster fills, then every player lands on a court`, () => {
      const s = buildStages(now, sport);
      expect(s.created.title).toBe(STAGE_TITLE);
      expect(s.created.status).toBe('open');
      expect(ins(s.created)).toBe(1);
      expect(s.created.rsvps[0].is_host).toBe(true);
      expect(ins(s.filling)).toBe(5);
      expect(ins(s.full)).toBe(STAGE_PLAYERS);
      expect(s.full.state.preview?.lines).toHaveLength(STAGE_PLAYERS); // a hype line for everyone who tapped in

      expect(s.live.status).toBe('live');
      const r1 = s.live.state.mixer!.rounds[0];
      expect(r1.matches).toHaveLength(STAGE_COURTS);
      expect(r1.sittingOut).toHaveLength(0); // 8 players, 2 courts: nobody sits
      const onCourt = r1.matches.flatMap((m) => [...m.teamA, ...m.teamB]);
      expect(new Set(onCourt).size).toBe(STAGE_PLAYERS);
      expect(onCourt).toContain(s.mayaId);
    });
  }

  it('round 2 comes with round 1 scored and fresh partners', () => {
    const s = buildStages(now, 'tennis');
    const [r1, r2] = s.next.state.mixer!.rounds;
    expect(r2.number).toBe(2);
    expect(r1.matches.every((m) => m.scoreA != null && m.scoreB != null)).toBe(true);
    const pairs = (r: typeof r1) => new Set(r.matches.flatMap((m) => [m.teamA, m.teamB]).map((t) => [...t].sort().join('+')));
    const before = pairs(r1);
    expect([...pairs(r2)].some((p) => before.has(p))).toBe(false); // nobody repeats a partner
  });

  it('does not mutate earlier stages when later ones are built', () => {
    const s = buildStages(now, 'tennis');
    expect(s.full.status).toBe('open');
    expect(s.live.state.mixer!.rounds).toHaveLength(1);
  });
});

describe('pricing line', () => {
  it('matches the switch: free at launch, or the real Host Pass price', () => {
    if (FREE_AT_LAUNCH) {
      expect(PRICING_LINE).toMatch(/free at launch/i);
      expect(PRICING_LINE).not.toContain('$');
      return;
    }
    expect(PRICING_LINE).toContain(`$${PASS_PRICES.host}`);
    expect(PRICING_LINE).toMatch(/first game is free/i);
    expect(PRICING_LINE).toMatch(/joining is always free/i);
  });
});

describe('landing demo stages are the same on every visit', () => {
  it('two builds pair the same players on the same courts', () => {
    const courts = (s: ReturnType<typeof buildStages>) => s.live.state.mixer!.rounds[0].matches.map((m) => [m.court, m.teamA, m.teamB]);
    expect(courts(buildStages(now, 'tennis'))).toEqual(courts(buildStages(new Date('2027-03-01T10:00:00Z'), 'tennis')));
  });
});

it('puts Math.random back after building', () => {
  const before = Math.random;
  buildStages(now, 'padel');
  expect(Math.random).toBe(before);
});
