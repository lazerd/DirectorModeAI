import { describe, it, expect, vi } from 'vitest';

// emails.ts builds a Resend client at import; same stub as the other email tests.
vi.mock('@/lib/email', () => ({ sendBilledEmails: vi.fn() }));

import { generateJttLineup, linesByPlayer } from './jttLineup';
import { exhibitionByRound, homeSquadMax, leagueSpec, roundClashes } from './leagues';
import { lineupAsText } from './lineupText';
import { lineupEmail } from './emails';
import type { Player } from './lineup';

const RULES = leagueSpec('jtt').multiLine!;

function kids(n: number, played: number[] = []): Player[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i + 1}`,
    name: `Kid ${String.fromCharCode(65 + i)}`,
    rating: null,
    wtn: 20 + i,
    matchesPlayed: played[i] ?? 0,
    needsEligibility: false,
  }));
}

const home = (available: Player[], courtFormat = 3) =>
  generateJttLineup({
    available,
    rules: RULES,
    singlesCourts: 4,
    doublesCourts: 4,
    courtFormat,
    captainingStyle: 'equal_play',
    exhibition: true,
    squad: { max: homeSquadMax(courtFormat, 4, 4) },
  });

const sheet = (r: ReturnType<typeof home>) =>
  r.courts.map((c) => ({
    courtNumber: c.courtNumber,
    courtType: c.courtType,
    player1Id: c.player1Id,
    player2Id: c.player2Id,
  }));

describe('home squad size', () => {
  it('is 8 in the 3-court format — 4 on the match courts every round + 4 on the exhibition', () => {
    expect(homeSquadMax(3, 4, 4)).toBe(8);
  });
  it('is 7 in the 2-court format — 3 on the match courts per round + 4', () => {
    expect(homeSquadMax(2, 4, 4)).toBe(7);
  });
});

describe('8 kids at a home match (12U, 2026-09-20)', () => {
  // Two of them played last week; equal play hands the spare lines to the other six first.
  const r = home(kids(8, [1, 0, 0, 0, 0, 1, 0, 0]));

  it('brings all eight, sits nobody, fills every line', () => {
    expect(r.sitting ?? []).toHaveLength(0);
    expect(r.courts.every((c) => c.player1Id)).toBe(true);
    expect(Object.keys(linesByPlayer(r.courts))).toHaveLength(8);
  });

  it('shares 12 slots as four on two lines and four on one', () => {
    expect(Object.values(linesByPlayer(r.courts)).sort()).toEqual([1, 1, 1, 1, 2, 2, 2, 2]);
  });

  it('puts nobody on two lines in one round', () => {
    expect(roundClashes(sheet(r), 3)).toEqual([]);
  });

  it('puts exactly four on the exhibition court every round, so nobody waits', () => {
    const ex = exhibitionByRound(sheet(r), 3);
    expect(ex.map((x) => x.round)).toEqual([1, 2, 3]);
    for (const x of ex) expect(x.playerIds).toHaveLength(4);
  });

  it('does not warn that some only get one line — the exhibition covers it', () => {
    expect(r.warnings.join(' ')).not.toMatch(/only get one line/);
  });
});

describe('exhibition from a saved sheet', () => {
  it('is everyone on the sheet not on a line that round', () => {
    // 3-court: R1 = S1,S2,D5 · R2 = S3,S4,D6 · R3 = D7,D8
    const courts = [
      { courtNumber: 1, courtType: 'singles' as const, player1Id: 'a', player2Id: null },
      { courtNumber: 2, courtType: 'singles' as const, player1Id: 'b', player2Id: null },
      { courtNumber: 3, courtType: 'singles' as const, player1Id: 'c', player2Id: null },
      { courtNumber: 4, courtType: 'singles' as const, player1Id: 'd', player2Id: null },
      { courtNumber: 5, courtType: 'doubles' as const, player1Id: 'e', player2Id: 'f' },
      { courtNumber: 6, courtType: 'doubles' as const, player1Id: 'g', player2Id: 'h' },
      { courtNumber: 7, courtType: 'doubles' as const, player1Id: 'a', player2Id: 'c' },
      { courtNumber: 8, courtType: 'doubles' as const, player1Id: 'b', player2Id: 'd' },
    ];
    expect(exhibitionByRound(courts, 3)).toEqual([
      { round: 1, playerIds: ['c', 'd', 'g', 'h'] },
      { round: 2, playerIds: ['a', 'b', 'e', 'f'] },
      { round: 3, playerIds: ['e', 'f', 'g', 'h'] },
    ]);
  });
});

describe('the exhibition court reaches parents', () => {
  const rows = [
    { courtNumber: 1, courtType: 'singles' as const, names: ['Kid A'], round: 1 },
    { courtNumber: 0, courtType: 'exhibition' as const, names: ['Kid C', 'Kid D'], round: 1 },
  ];

  it('in the group-chat text, after the round it belongs to', () => {
    const t = lineupAsText({ teamName: '12U', matchAt: '2026-09-20T23:00:00Z', isHome: true, courts: rows });
    expect(t).toContain('Round 1\n  Singles 1: Kid A\n  Exhibition court: Kid C, Kid D');
  });

  it('in the lineup email, naming the round for a child who is on it', () => {
    const e = lineupEmail(
      '12U',
      { id: 'm', matchAt: '2026-09-20T23:00:00Z', isHome: true } as Parameters<typeof lineupEmail>[1],
      rows,
      { playerId: 'c', name: 'Kid C', email: 'c@example.com', token: 't' },
      true,
    );
    expect(e.html).toContain('Exhibition court');
    expect(e.html).toContain('Exhibition court (round 1)');
  });
});
