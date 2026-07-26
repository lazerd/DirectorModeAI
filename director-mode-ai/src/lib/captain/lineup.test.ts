import { describe, it, expect } from 'vitest';
import {
  generateLineup,
  eligibilityReport,
  pairRecordsFrom,
  type Player,
  type LineupInput,
} from './lineup';

const p = (
  id: string,
  name: string,
  rating: number,
  extra: Partial<Player> = {},
): Player => ({
  id,
  name,
  rating,
  matchesPlayed: 0,
  needsEligibility: false,
  ...extra,
});

const base = (over: Partial<LineupInput> = {}): LineupInput => ({
  available: [],
  singlesCourts: 2,
  doublesCourts: 3,
  leagueType: 'usta_adult',
  ...over,
});

const roster = () => [
  p('a', 'Alice', 4.5),
  p('b', 'Bree', 4.0),
  p('c', 'Cara', 4.0),
  p('d', 'Dana', 3.5),
  p('e', 'Eve', 3.5),
  p('f', 'Faye', 3.5),
  p('g', 'Gwen', 3.0),
  p('h', 'Hana', 3.0),
];

const idsOn = (courts: ReturnType<typeof generateLineup>['courts']) =>
  courts.flatMap((c) => [c.player1Id, c.player2Id]).filter(Boolean) as string[];

const pairedTogether = (
  courts: ReturnType<typeof generateLineup>['courts'],
  x: string,
  y: string,
) =>
  courts.some(
    (c) =>
      (c.player1Id === x && c.player2Id === y) || (c.player1Id === y && c.player2Id === x),
  );

describe('generateLineup — structure', () => {
  it('fills every court and never seats a player twice', () => {
    const r = generateLineup(base({ available: roster() }));
    expect(r.courts).toHaveLength(5);
    expect(r.courts.filter((c) => c.courtType === 'singles')).toHaveLength(2);
    expect(r.courts.filter((c) => c.courtType === 'doubles')).toHaveLength(3);

    const seated = idsOn(r.courts);
    expect(seated).toHaveLength(8);
    expect(new Set(seated).size).toBe(8);
  });

  it('numbers courts uniquely and contiguously', () => {
    const r = generateLineup(base({ available: roster() }));
    expect(r.courts.map((c) => c.courtNumber).sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5]);
  });

  it('is deterministic — same input, same lineup', () => {
    const a = generateLineup(base({ available: roster() }));
    const b = generateLineup(base({ available: roster() }));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('warns and degrades gracefully when short-handed', () => {
    const r = generateLineup(base({ available: roster().slice(0, 4) }));
    expect(r.warnings.some((w) => w.includes('short'))).toBe(true);
    expect(idsOn(r.courts).length).toBeLessThanOrEqual(4);
    expect(new Set(idsOn(r.courts)).size).toBe(idsOn(r.courts).length);
  });
});

describe('generateLineup — court strength order', () => {
  it('puts the strongest players on the lowest singles courts', () => {
    const r = generateLineup(base({ available: roster() }));
    const singles = r.courts.filter((c) => c.courtType === 'singles');
    expect(singles[0].player1Id).toBe('a');
    expect(singles[0].courtNumber).toBeLessThan(singles[1].courtNumber);
  });

  it('orders doubles courts by combined strength', () => {
    const r = generateLineup(base({ available: roster() }));
    const doubles = r.courts.filter((c) => c.courtType === 'doubles');
    const strength = (c: (typeof doubles)[number]) => {
      const find = (id: string | null) => roster().find((x) => x.id === id)?.rating ?? 0;
      return find(c.player1Id) + find(c.player2Id);
    };
    for (let i = 1; i < doubles.length; i++) {
      expect(strength(doubles[i - 1])).toBeGreaterThanOrEqual(strength(doubles[i]));
    }
  });
});

describe('generateLineup — hard constraints are never violated', () => {
  it('never pairs a never-pair couple', () => {
    const r = generateLineup(
      base({
        available: roster(),
        neverPairs: [{ playerAId: 'b', playerBId: 'c' }],
        partnerPrefs: [
          { playerId: 'b', preferredPlayerId: 'c', rank: 1 },
          { playerId: 'c', preferredPlayerId: 'b', rank: 1 },
        ],
      }),
    );
    expect(pairedTogether(r.courts, 'b', 'c')).toBe(false);
  });

  it('will not honour a never-pair couple even with a winning record together', () => {
    const r = generateLineup(
      base({
        available: roster(),
        neverPairs: [{ playerAId: 'g', playerBId: 'h' }],
        pairHistory: [{ playerAId: 'g', playerBId: 'h', wins: 9, losses: 0 }],
      }),
    );
    expect(pairedTogether(r.courts, 'g', 'h')).toBe(false);
  });

  it('keeps a singles-only player out of doubles', () => {
    const players = roster();
    players[3] = p('d', 'Dana', 3.5, { courtLimit: 'singles_only' });
    const r = generateLineup(base({ available: players }));
    const inDoubles = r.courts.some(
      (c) => c.courtType === 'doubles' && (c.player1Id === 'd' || c.player2Id === 'd'),
    );
    expect(inDoubles).toBe(false);
  });

  it('keeps a doubles-only player out of singles', () => {
    const players = roster();
    players[0] = p('a', 'Alice', 4.5, { courtLimit: 'doubles_only' });
    const r = generateLineup(base({ available: players }));
    const inSingles = r.courts.some((c) => c.courtType === 'singles' && c.player1Id === 'a');
    expect(inSingles).toBe(false);
  });

  it('never exceeds a combined rating cap', () => {
    const players = roster();
    const r = generateLineup(
      base({
        available: players,
        leagueType: 'usta_combo',
        singlesCourts: 0,
        doublesCourts: 3,
        combinedRatingCap: 7.5,
      }),
    );
    for (const c of r.courts) {
      const find = (id: string | null) => players.find((x) => x.id === id)?.rating ?? 0;
      expect(find(c.player1Id) + find(c.player2Id)).toBeLessThanOrEqual(7.5 + 1e-9);
    }
  });

  it('pairs only one man with one woman in mixed', () => {
    const players = [
      p('m1', 'Mark', 4.0, { gender: 'M' }),
      p('m2', 'Mike', 3.5, { gender: 'M' }),
      p('m3', 'Milo', 3.5, { gender: 'M' }),
      p('f1', 'Fran', 4.0, { gender: 'F' }),
      p('f2', 'Faye', 3.5, { gender: 'F' }),
      p('f3', 'Fern', 3.5, { gender: 'F' }),
    ];
    const r = generateLineup(
      base({
        available: players,
        leagueType: 'usta_mixed',
        singlesCourts: 0,
        doublesCourts: 3,
      }),
    );
    expect(r.courts).toHaveLength(3);
    for (const c of r.courts) {
      const g = (id: string | null) => players.find((x) => x.id === id)?.gender;
      expect(g(c.player1Id)).not.toBe(g(c.player2Id));
    }
  });

  it('moves a "never court 1" player off court 1 when possible', () => {
    const players = roster();
    players[1] = p('b', 'Bree', 4.0, { courtLimit: 'no_court_1' });
    players[2] = p('c', 'Cara', 4.0, { courtLimit: 'no_court_1' });
    const r = generateLineup(base({ available: players, singlesCourts: 0, doublesCourts: 3 }));
    const court1 = r.courts.find((c) => c.courtNumber === 1)!;
    expect([court1.player1Id, court1.player2Id]).not.toContain('b');
  });
});

describe('generateLineup — preferences', () => {
  it('honours a mutual partner preference', () => {
    const r = generateLineup(
      base({
        available: roster(),
        singlesCourts: 0,
        doublesCourts: 4,
        partnerPrefs: [
          { playerId: 'g', preferredPlayerId: 'h', rank: 1 },
          { playerId: 'h', preferredPlayerId: 'g', rank: 1 },
        ],
      }),
    );
    expect(pairedTogether(r.courts, 'g', 'h')).toBe(true);
  });

  it('prefers complementary return sides, all else equal', () => {
    const players = [
      p('w', 'Wendy', 3.5, { returnSide: 'ad' }),
      p('s', 'Sally', 3.5, { returnSide: 'deuce' }),
      p('x', 'Xena', 3.5, { returnSide: 'deuce' }),
      p('y', 'Yara', 3.5, { returnSide: 'ad' }),
    ];
    const r = generateLineup(base({ available: players, singlesCourts: 0, doublesCourts: 2 }));
    for (const c of r.courts) {
      const side = (id: string | null) => players.find((x) => x.id === id)?.returnSide;
      expect(side(c.player1Id)).not.toBe(side(c.player2Id));
    }
  });

  it('explains its reasoning in court notes', () => {
    const r = generateLineup(
      base({
        available: roster(),
        singlesCourts: 0,
        doublesCourts: 4,
        partnerPrefs: [
          { playerId: 'g', preferredPlayerId: 'h', rank: 1 },
          { playerId: 'h', preferredPlayerId: 'g', rank: 1 },
        ],
      }),
    );
    const gh = r.courts.find(
      (c) =>
        (c.player1Id === 'g' && c.player2Id === 'h') ||
        (c.player1Id === 'h' && c.player2Id === 'g'),
    )!;
    expect(gh.notes.join(' ')).toContain('mutual partner preference');
  });
});

describe('generateLineup — partnership chemistry from results', () => {
  it('re-pairs a partnership with a winning record', () => {
    const players = [
      p('w1', 'Winner One', 3.5),
      p('w2', 'Winner Two', 3.5),
      p('o1', 'Other One', 3.5),
      p('o2', 'Other Two', 3.5),
    ];
    const r = generateLineup(
      base({
        available: players,
        singlesCourts: 0,
        doublesCourts: 2,
        pairHistory: [{ playerAId: 'w1', playerBId: 'w2', wins: 5, losses: 0 }],
      }),
    );
    expect(pairedTogether(r.courts, 'w1', 'w2')).toBe(true);
  });

  it('splits up a partnership that keeps losing', () => {
    const players = [
      p('l1', 'Loser One', 3.5),
      p('l2', 'Loser Two', 3.5),
      p('n1', 'Neutral One', 3.5),
      p('n2', 'Neutral Two', 3.5),
    ];
    const r = generateLineup(
      base({
        available: players,
        singlesCourts: 0,
        doublesCourts: 2,
        pairHistory: [{ playerAId: 'l1', playerBId: 'l2', wins: 0, losses: 5 }],
      }),
    );
    expect(pairedTogether(r.courts, 'l1', 'l2')).toBe(false);
  });

  it('does not let one lucky win outweigh a mutual stated preference', () => {
    const players = [
      p('a1', 'Ann', 3.5),
      p('b1', 'Bea', 3.5),
      p('c1', 'Cyd', 3.5),
      p('d1', 'Dot', 3.5),
    ];
    const r = generateLineup(
      base({
        available: players,
        singlesCourts: 0,
        doublesCourts: 2,
        partnerPrefs: [
          { playerId: 'a1', preferredPlayerId: 'b1', rank: 1 },
          { playerId: 'b1', preferredPlayerId: 'a1', rank: 1 },
        ],
        pairHistory: [{ playerAId: 'a1', playerBId: 'c1', wins: 1, losses: 0 }],
      }),
    );
    expect(pairedTogether(r.courts, 'a1', 'b1')).toBe(true);
  });

  it('treats an even record as neutral', () => {
    const players = () => [p('x', 'Xan', 3.5), p('y', 'Yves', 3.5)];
    const even = generateLineup(
      base({
        available: players(),
        singlesCourts: 0,
        doublesCourts: 1,
        pairHistory: [{ playerAId: 'x', playerBId: 'y', wins: 2, losses: 2 }],
      }),
    );
    const none = generateLineup(
      base({ available: players(), singlesCourts: 0, doublesCourts: 1 }),
    );
    expect(JSON.stringify(even.courts)).toBe(JSON.stringify(none.courts));
  });
});

describe('generateLineup — fairness and eligibility', () => {
  it('seats the player who needs playoff eligibility over an equal who does not', () => {
    const players = [
      p('n', 'Needy', 3.5, { needsEligibility: true, matchesPlayed: 0 }),
      p('r', 'Regular', 3.5, { matchesPlayed: 5 }),
      p('q', 'Quinn', 3.5, { matchesPlayed: 5 }),
    ];
    const r = generateLineup(base({ available: players, singlesCourts: 0, doublesCourts: 1 }));
    expect(idsOn(r.courts)).toContain('n');
  });

  it('warns when someone needing eligibility could not be seated', () => {
    const players = [
      p('a2', 'Ace', 4.5),
      p('b2', 'Bolt', 4.5),
      p('n', 'Needy', 3.0, { needsEligibility: true, courtLimit: 'singles_only' }),
    ];
    const r = generateLineup(base({ available: players, singlesCourts: 0, doublesCourts: 1 }));
    expect(r.warnings.some((w) => w.includes('Needy'))).toBe(true);
  });

  it('favours the player with fewer matches when nothing else separates them', () => {
    const players = [
      p('busy', 'Busy', 3.5, { matchesPlayed: 8 }),
      p('rested', 'Rested', 3.5, { matchesPlayed: 1 }),
      p('mid', 'Mid', 3.5, { matchesPlayed: 4 }),
    ];
    const r = generateLineup(base({ available: players, singlesCourts: 0, doublesCourts: 1 }));
    expect(idsOn(r.courts)).toContain('rested');
    expect(idsOn(r.courts)).not.toContain('busy');
  });
});

describe('pairRecordsFrom', () => {
  it('tallies wins and losses per partnership regardless of slot order', () => {
    const recs = pairRecordsFrom([
      { player1Id: 'a', player2Id: 'b', won: true },
      { player1Id: 'b', player2Id: 'a', won: true },
      { player1Id: 'a', player2Id: 'b', won: false },
      { player1Id: 'c', player2Id: 'd', won: false },
    ]);
    const ab = recs.find((r) => [r.playerAId, r.playerBId].sort().join() === 'a,b')!;
    expect(ab.wins).toBe(2);
    expect(ab.losses).toBe(1);
    const cd = recs.find((r) => [r.playerAId, r.playerBId].sort().join() === 'c,d')!;
    expect(cd.wins).toBe(0);
    expect(cd.losses).toBe(1);
  });

  it('ignores singles courts and courts with no score entered', () => {
    const recs = pairRecordsFrom([
      { player1Id: 'a', player2Id: null, won: true },
      { player1Id: 'a', player2Id: 'b', won: null },
    ]);
    expect(recs).toHaveLength(0);
  });
});

describe('eligibilityReport', () => {
  const players = [
    { id: 'a', name: 'Alice' },
    { id: 'b', name: 'Bree' },
    { id: 'c', name: 'Cara' },
  ];
  const rules = { enabled: true, minMatchesDefault: 2, minMatchesSelfRated: 3 };

  it('returns nothing when the league has no playoffs', () => {
    const rep = eligibilityReport({
      players,
      playedByPlayer: { a: 0 },
      rules: { enabled: false, minMatchesDefault: 2, minMatchesSelfRated: 3 },
      matchesRemaining: 5,
    });
    expect(rep).toEqual([]);
  });

  it('marks players short of the minimum as ineligible', () => {
    const rep = eligibilityReport({
      players,
      playedByPlayer: { a: 2, b: 1, c: 0 },
      rules,
      matchesRemaining: 4,
    });
    expect(rep.find((r) => r.playerId === 'a')!.eligible).toBe(true);
    expect(rep.find((r) => r.playerId === 'b')!.short).toBe(1);
    expect(rep.find((r) => r.playerId === 'c')!.short).toBe(2);
  });

  it('holds self-rated and appeal players to the higher bar', () => {
    const rep = eligibilityReport({
      players: [
        { id: 'comp', name: 'Computer', ratingType: 'computer' as const },
        { id: 'self', name: 'Self', ratingType: 'self' as const },
        { id: 'app', name: 'Appeal', ratingType: 'appeal' as const },
      ],
      playedByPlayer: { comp: 2, self: 2, app: 2 },
      rules,
      matchesRemaining: 4,
    });
    expect(rep.find((r) => r.playerId === 'comp')!.eligible).toBe(true);
    expect(rep.find((r) => r.playerId === 'self')!.eligible).toBe(false);
    expect(rep.find((r) => r.playerId === 'self')!.required).toBe(3);
    expect(rep.find((r) => r.playerId === 'app')!.required).toBe(3);
  });

  it('handles a 4-line league where self-rated players need four matches', () => {
    const rep = eligibilityReport({
      players: [{ id: 'self', name: 'Self', ratingType: 'self' as const }],
      playedByPlayer: { self: 3 },
      rules: { enabled: true, minMatchesDefault: 2, minMatchesSelfRated: 4 },
      matchesRemaining: 2,
    });
    expect(rep[0].required).toBe(4);
    expect(rep[0].short).toBe(1);
    expect(rep[0].eligible).toBe(false);
  });

  it('flags at-risk when remaining matches barely cover the shortfall', () => {
    const rep = eligibilityReport({
      players,
      playedByPlayer: { a: 2, b: 1, c: 0 },
      rules,
      matchesRemaining: 1,
    });
    expect(rep.find((r) => r.playerId === 'a')!.atRisk).toBe(false);
    expect(rep.find((r) => r.playerId === 'b')!.atRisk).toBe(true);
    expect(rep.find((r) => r.playerId === 'c')!.atRisk).toBe(true);
  });

  it('treats an unseen player as zero matches played', () => {
    const rep = eligibilityReport({
      players,
      playedByPlayer: {},
      rules,
      matchesRemaining: 3,
    });
    expect(rep.every((r) => r.played === 0 && r.short === 2)).toBe(true);
  });
});
