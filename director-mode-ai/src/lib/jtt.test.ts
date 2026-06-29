import { describe, it, expect } from 'vitest';
import { autoAssignMashupRound, type MashupRoster } from './jtt';

// ----- helpers -----

type Line = {
  id: string;
  line_type: 'singles' | 'doubles';
  line_number: number;
  home_player1_id: string | null;
  home_player2_id: string | null;
  away_player1_id: string | null;
  away_player2_id: string | null;
};

function emptyLine(id: string, type: 'singles' | 'doubles', n: number): Line {
  return {
    id,
    line_type: type,
    line_number: n,
    home_player1_id: null,
    home_player2_id: null,
    away_player1_id: null,
    away_player2_id: null,
  };
}

// Build a pool: e.g. roster('SH', 3) -> SH1, SH2, SH3 with ladder 1..3
function roster(club: string, n: number, startLadder = 1): MashupRoster[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `${club}${i + 1}`,
    club_id: club,
    ladder_position: startLadder + i,
    status: 'active',
  }));
}

const clubOf = new Map<string, string>();
function indexClubs(pool: MashupRoster[]) {
  for (const r of pool) clubOf.set(r.id, r.club_id);
}
function club(id: string | null): string | undefined {
  return id ? clubOf.get(id) : undefined;
}

describe('autoAssignMashupRound — singles', () => {
  it('pairs the two players on a singles court from different clubs', () => {
    const pool = [...roster('SH', 2), ...roster('MCC', 2)];
    indexClubs(pool);
    const lines = [emptyLine('l1', 'singles', 1), emptyLine('l2', 'singles', 2)];
    const patches = autoAssignMashupRound(lines, pool);
    expect(patches).toHaveLength(2);
    for (const p of patches) {
      expect(p.home_player1_id).toBeTruthy();
      expect(p.away_player1_id).toBeTruthy();
      // the two sides of every court are different clubs
      expect(club(p.home_player1_id)).not.toBe(club(p.away_player1_id));
      expect(p.counts_for_team).toBe(false);
    }
    // every one of the 4 players is used exactly once
    const used = patches.flatMap(p => [p.home_player1_id, p.away_player1_id]);
    expect(new Set(used).size).toBe(4);
  });

  it('mixes three clubs so nobody faces their own club', () => {
    const pool = [...roster('SH', 2), ...roster('MCC', 2), ...roster('MDW', 2)];
    indexClubs(pool);
    const lines = [
      emptyLine('l1', 'singles', 1),
      emptyLine('l2', 'singles', 2),
      emptyLine('l3', 'singles', 3),
    ];
    const patches = autoAssignMashupRound(lines, pool);
    expect(patches).toHaveLength(3);
    for (const p of patches) {
      expect(club(p.home_player1_id)).not.toBe(club(p.away_player1_id));
    }
  });

  it('falls back to a same-club pairing only when one club is all that remains', () => {
    // 3 SH, 1 MCC over 2 singles courts -> court 1 cross-club, court 2 must be SH v SH
    const pool = [...roster('SH', 3), ...roster('MCC', 1)];
    indexClubs(pool);
    const lines = [emptyLine('l1', 'singles', 1), emptyLine('l2', 'singles', 2)];
    const patches = autoAssignMashupRound(lines, pool);
    const crossClub = patches.filter(p => club(p.home_player1_id) !== club(p.away_player1_id));
    expect(crossClub).toHaveLength(1); // exactly one court could be cross-club
    // all 4 players placed
    const used = patches.flatMap(p => [p.home_player1_id, p.away_player1_id]).filter(Boolean);
    expect(new Set(used).size).toBe(4);
  });
});

describe('autoAssignMashupRound — doubles', () => {
  it('makes a doubles court 2-from-one-club vs 2-from-another', () => {
    const pool = [...roster('SH', 2), ...roster('MCC', 2)];
    indexClubs(pool);
    const lines = [emptyLine('d1', 'doubles', 1)];
    const patches = autoAssignMashupRound(lines, pool);
    expect(patches).toHaveLength(1);
    const p = patches[0];
    const sideA = [club(p.home_player1_id), club(p.home_player2_id)];
    const sideB = [club(p.away_player1_id), club(p.away_player2_id)];
    // each side is a single club...
    expect(new Set(sideA).size).toBe(1);
    expect(new Set(sideB).size).toBe(1);
    // ...and the two sides are different clubs
    expect(sideA[0]).not.toBe(sideB[0]);
    expect(p.counts_for_team).toBe(false);
  });

  it('mixes the four strongest when no two clubs can each field a pair', () => {
    // SH has 3, MCC has 1 -> only one club has a clean pair, so it mixes
    const pool = [...roster('SH', 3), ...roster('MCC', 1)];
    indexClubs(pool);
    const lines = [emptyLine('d1', 'doubles', 1)];
    const patches = autoAssignMashupRound(lines, pool);
    expect(patches).toHaveLength(1);
    const p = patches[0];
    const four = [p.home_player1_id, p.home_player2_id, p.away_player1_id, p.away_player2_id];
    expect(four.filter(Boolean)).toHaveLength(4); // court is full
    expect(new Set(four).size).toBe(4);
  });

  it('leaves a doubles court empty rather than seating fewer than four', () => {
    const pool = roster('SH', 3); // only 3 players, can't fill a doubles court
    indexClubs(pool);
    const lines = [emptyLine('d1', 'doubles', 1)];
    const patches = autoAssignMashupRound(lines, pool);
    expect(patches).toHaveLength(0);
  });
});

describe('autoAssignMashupRound — mixed round + manual respect', () => {
  it('claims same-club pairs for doubles before singles consumes them', () => {
    // 1 doubles + 1 singles, pool 2 SH + 2 MCC -> doubles becomes SH/SH vs MCC/MCC,
    // leaving nobody for singles.
    const pool = [...roster('SH', 2), ...roster('MCC', 2)];
    indexClubs(pool);
    const lines = [emptyLine('d1', 'doubles', 1), emptyLine('s1', 'singles', 2)];
    const patches = autoAssignMashupRound(lines, pool);
    const dbl = patches.find(p => p.id === 'd1')!;
    expect([
      club(dbl.home_player1_id),
      club(dbl.home_player2_id),
    ].every(c => c === club(dbl.home_player1_id))).toBe(true);
  });

  it('never reuses a player already placed manually in the round', () => {
    const pool = [...roster('SH', 2), ...roster('MCC', 2)];
    indexClubs(pool);
    const filled = emptyLine('s1', 'singles', 1);
    filled.home_player1_id = 'SH1';
    filled.away_player1_id = 'MCC1';
    const lines = [filled, emptyLine('s2', 'singles', 2)];
    const patches = autoAssignMashupRound(lines, pool);
    // only the empty court is touched
    expect(patches).toHaveLength(1);
    expect(patches[0].id).toBe('s2');
    const used = [patches[0].home_player1_id, patches[0].away_player1_id];
    expect(used).not.toContain('SH1');
    expect(used).not.toContain('MCC1');
  });
});
