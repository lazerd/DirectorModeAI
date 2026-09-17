import { describe, it, expect } from 'vitest';
import { expectedWin, gamesFrom, playerForm, proposeOrder, type FormMatch, type FormPlayer } from './formOrder';

// The real 10U Green team and its first match day, 9/13 vs Orinda.
const TEAM: FormPlayer[] = [
  { id: 'miles', name: 'Miles Peter', seed: 1 },
  { id: 'gavin', name: 'Gavin Cohen', seed: 2 },
  { id: 'noelle', name: 'Noelle Boone', seed: 3 },
  { id: 'shaelyn', name: 'Shaelyn Kelley', seed: 4 },
  { id: 'anna', name: 'Anna Sullivan', seed: 5 },
  { id: 'paloma', name: 'Paloma Branson', seed: 6 },
  { id: 'aidan', name: 'Aidan Akhtar-Fan', seed: 7 },
];

const SEP13: FormMatch = {
  matchId: 'm913',
  lines: [
    { lineNumber: 1, courtType: 'singles', playerIds: ['miles'], won: false, score: '4-1' },
    { lineNumber: 2, courtType: 'singles', playerIds: ['gavin'], won: false, score: '4-2' },
    { lineNumber: 3, courtType: 'singles', playerIds: ['noelle'], won: true, score: '3-2' },
    { lineNumber: 4, courtType: 'singles', playerIds: ['paloma'], won: false, score: '4-0' },
    { lineNumber: 1, courtType: 'doubles', playerIds: ['gavin', 'noelle'], won: true, score: null },
    { lineNumber: 2, courtType: 'doubles', playerIds: ['noelle', 'paloma'], won: true, score: '4-3' },
    { lineNumber: 3, courtType: 'doubles', playerIds: ['paloma', 'miles'], won: false, score: '4-2' },
    { lineNumber: 4, courtType: 'doubles', playerIds: ['gavin', 'miles'], won: false, score: '4-1' },
  ],
};

describe('gamesFrom', () => {
  it('reads the margin from the result, not from the typed order', () => {
    // '4-1' recorded as a loss means we got 1; as a win, we got 4.
    expect(gamesFrom('4-1', false)).toEqual({ for: 1, against: 4 });
    expect(gamesFrom('4-1', true)).toEqual({ for: 4, against: 1 });
  });

  it('adds up sets and ignores an unreadable score', () => {
    expect(gamesFrom('6-4, 3-6', true)).toEqual({ for: 12, against: 7 });
    expect(gamesFrom(null, true)).toBeNull();
  });
});

describe('expectedWin', () => {
  it('is a coin flip on your own line, and long odds above it', () => {
    expect(expectedWin(3, 3)).toBeCloseTo(0.5);
    expect(expectedWin(3, 1)).toBeLessThan(0.2);
    expect(expectedWin(1, 3)).toBeGreaterThan(0.8);
  });
});

describe('playerForm on the real 9/13 match', () => {
  const form = playerForm(TEAM, [SEP13]);
  const of = (id: string) => form.find((f) => f.playerId === id)!;

  it('rates Noelle up and Gavin and Miles down', () => {
    expect(of('noelle').form).toBeGreaterThan(0);
    expect(of('gavin').form).toBeLessThan(0);
    expect(of('miles').form).toBeLessThan(0);
    expect(of('noelle').form).toBeGreaterThan(of('gavin').form);
  });

  it('counts each line as a win or a loss and the day once', () => {
    expect(of('noelle')).toMatchObject({ wins: 3, losses: 0, days: 1 });
    expect(of('gavin')).toMatchObject({ wins: 1, losses: 2, days: 1 });
    expect(of('miles')).toMatchObject({ wins: 0, losses: 3, days: 1 });
  });

  it('leaves players who did not play at zero, with no day', () => {
    expect(of('shaelyn')).toMatchObject({ form: 0, days: 0, wins: 0, losses: 0 });
  });

  it('says where each result happened, in plain words', () => {
    expect(of('noelle').reasons[0]).toBe('Won at singles #3 3-2');
    expect(of('miles').reasons[0]).toBe('Lost at singles #1 1-4');
  });

  it('costs a tight loss less than a bagel', () => {
    const tight = playerForm(TEAM, [
      { matchId: 'x', lines: [{ lineNumber: 2, courtType: 'singles', playerIds: ['gavin'], won: false, score: '4-3' }] },
    ]);
    const bagel = playerForm(TEAM, [
      { matchId: 'x', lines: [{ lineNumber: 2, courtType: 'singles', playerIds: ['gavin'], won: false, score: '4-0' }] },
    ]);
    const f = (rows: ReturnType<typeof playerForm>) => rows.find((r) => r.playerId === 'gavin')!.form;
    expect(f(tight)).toBeGreaterThan(f(bagel));
  });

  it('weighs a singles result more than a doubles one', () => {
    const single = playerForm(TEAM, [
      { matchId: 'x', lines: [{ lineNumber: 3, courtType: 'singles', playerIds: ['noelle'], won: true, score: '4-0' }] },
    ]);
    const dubs = playerForm(TEAM, [
      { matchId: 'x', lines: [{ lineNumber: 3, courtType: 'doubles', playerIds: ['noelle', 'paloma'], won: true, score: '4-0' }] },
    ]);
    const f = (rows: ReturnType<typeof playerForm>, id: string) => rows.find((r) => r.playerId === id)!.form;
    expect(f(single, 'noelle')).toBeGreaterThan(f(dubs, 'noelle'));
  });

  it('ignores a defaulted line and one with no result', () => {
    const rows = playerForm(TEAM, [
      {
        matchId: 'x',
        lines: [
          { lineNumber: 1, courtType: 'singles', playerIds: ['miles'], won: true, score: null, defaulted: true },
          { lineNumber: 2, courtType: 'singles', playerIds: ['gavin'], won: null, score: null },
        ],
      },
    ]);
    expect(rows.find((r) => r.playerId === 'miles')).toMatchObject({ form: 0, days: 0 });
    expect(rows.find((r) => r.playerId === 'gavin')).toMatchObject({ form: 0, days: 0 });
  });
});

describe('proposeOrder', () => {
  const { proposals, order } = proposeOrder(TEAM, [SEP13]);

  it('moves Noelle up and nobody more than one place after one day', () => {
    const noelle = proposals.find((p) => p.playerId === 'noelle');
    expect(noelle).toMatchObject({ from: 3, to: 2 });
    for (const p of proposals) expect(Math.abs(p.from - p.to)).toBeLessThanOrEqual(1);
  });

  it('leaves the players who did not play where they were', () => {
    expect(proposals.some((p) => ['shaelyn', 'anna', 'aidan'].includes(p.playerId))).toBe(false);
    expect(order.indexOf('shaelyn')).toBe(3);
    expect(order[6]).toBe('aidan');
  });

  it('returns a full order with every player exactly once', () => {
    expect(order).toHaveLength(TEAM.length);
    expect(new Set(order).size).toBe(TEAM.length);
  });

  it('proposes nothing when there are no results yet', () => {
    expect(proposeOrder(TEAM, []).proposals).toEqual([]);
  });

  it('lets a player climb two places over two match days', () => {
    const day = (id: string): FormMatch => ({
      matchId: id,
      lines: [
        { lineNumber: 4, courtType: 'singles', playerIds: ['paloma'], won: true, score: '4-0' },
        { lineNumber: 1, courtType: 'singles', playerIds: ['miles'], won: false, score: '4-0' },
        { lineNumber: 2, courtType: 'singles', playerIds: ['gavin'], won: false, score: '4-0' },
        { lineNumber: 3, courtType: 'singles', playerIds: ['noelle'], won: false, score: '4-0' },
      ],
    });
    const two = proposeOrder(TEAM, [day('d1'), day('d2')]);
    const paloma = two.proposals.find((p) => p.playerId === 'paloma');
    expect(paloma).toBeTruthy();
    expect((paloma?.from ?? 0) - (paloma?.to ?? 0)).toBeGreaterThanOrEqual(2);
  });

  it('can move a winner past a teammate who has not played, without moving them elsewhere', () => {
    const day: FormMatch = {
      matchId: 'd1',
      lines: [{ lineNumber: 4, courtType: 'singles', playerIds: ['paloma'], won: true, score: '4-0' }],
    };
    const { order, proposals } = proposeOrder(TEAM, [day]);
    // Paloma (6th) climbs one; Anna (5th) is displaced but never credited.
    expect(proposals.find((p) => p.playerId === 'paloma')).toMatchObject({ from: 6, to: 5 });
    expect(order.indexOf('anna')).toBe(5);
    expect(order.indexOf('aidan')).toBe(6);
  });
});
