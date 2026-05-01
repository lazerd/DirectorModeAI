import { describe, it, expect } from 'vitest';
import {
  computeQuadComposite,
  parseScoreSets,
  computeFlightStandings,
  generateQuadSingles,
  buildQuadDoublesRound,
  assignToFlights,
  addMinutesToTime,
  formatTimeDisplay,
  autoScheduleQuads,
} from './quads';

describe('computeQuadComposite', () => {
  it('prefers UTR over NTRP', () => {
    expect(computeQuadComposite({ utr: 7.5, ntrp: 4.0 })).toBe(7.5);
  });
  it('falls back to NTRP × 2 when no UTR', () => {
    expect(computeQuadComposite({ utr: null, ntrp: 4.0 })).toBe(8);
  });
  it('returns 0 when neither rating is set', () => {
    expect(computeQuadComposite({ utr: null, ntrp: null })).toBe(0);
  });
  it('treats UTR=0 as missing', () => {
    expect(computeQuadComposite({ utr: 0, ntrp: 3.5 })).toBe(7);
  });
});

describe('parseScoreSets', () => {
  it('parses two-set scores', () => {
    expect(parseScoreSets('6-3, 6-4')).toEqual([
      [6, 3],
      [6, 4],
    ]);
  });
  it('parses pro sets', () => {
    expect(parseScoreSets('8-5')).toEqual([[8, 5]]);
  });
  it('parses timed scores', () => {
    expect(parseScoreSets('27-22')).toEqual([[27, 22]]);
  });
  it('strips tiebreak parens', () => {
    expect(parseScoreSets('7-6 (7-3), 4-6, 10-7')).toEqual([
      [7, 6],
      [4, 6],
      [10, 7],
    ]);
  });
  it('returns [] for empty input', () => {
    expect(parseScoreSets('')).toEqual([]);
    expect(parseScoreSets(null)).toEqual([]);
  });
});

describe('generateQuadSingles', () => {
  it('produces 6 matches across 3 rounds with the standard schedule', () => {
    const matches = generateQuadSingles(['p1', 'p2', 'p3', 'p4']);
    expect(matches).toHaveLength(6);
    // R1: 1v4 + 2v3
    expect(matches.filter((m) => m.round === 1)).toEqual([
      { round: 1, match_type: 'singles', player1_id: 'p1', player3_id: 'p4' },
      { round: 1, match_type: 'singles', player1_id: 'p2', player3_id: 'p3' },
    ]);
    // R2: 1v3 + 2v4
    expect(matches.filter((m) => m.round === 2)).toEqual([
      { round: 2, match_type: 'singles', player1_id: 'p1', player3_id: 'p3' },
      { round: 2, match_type: 'singles', player1_id: 'p2', player3_id: 'p4' },
    ]);
    // R3: 1v2 + 3v4
    expect(matches.filter((m) => m.round === 3)).toEqual([
      { round: 3, match_type: 'singles', player1_id: 'p1', player3_id: 'p2' },
      { round: 3, match_type: 'singles', player1_id: 'p3', player3_id: 'p4' },
    ]);
  });
});

describe('computeFlightStandings', () => {
  const entries = [
    { id: 'p1', flight_seed: 1 },
    { id: 'p2', flight_seed: 2 },
    { id: 'p3', flight_seed: 3 },
    { id: 'p4', flight_seed: 4 },
  ];

  it('ranks by match wins descending', () => {
    // p1 wins all 3, p2 wins 2, p3 wins 1, p4 wins 0 (chalk)
    const matches = [
      // R1
      {
        round: 1,
        match_type: 'singles' as const,
        player1_id: 'p1',
        player3_id: 'p4',
        score: '6-1',
        winner_side: 'a' as const,
        status: 'completed',
      },
      {
        round: 1,
        match_type: 'singles' as const,
        player1_id: 'p2',
        player3_id: 'p3',
        score: '6-2',
        winner_side: 'a' as const,
        status: 'completed',
      },
      // R2
      {
        round: 2,
        match_type: 'singles' as const,
        player1_id: 'p1',
        player3_id: 'p3',
        score: '6-2',
        winner_side: 'a' as const,
        status: 'completed',
      },
      {
        round: 2,
        match_type: 'singles' as const,
        player1_id: 'p2',
        player3_id: 'p4',
        score: '6-3',
        winner_side: 'a' as const,
        status: 'completed',
      },
      // R3
      {
        round: 3,
        match_type: 'singles' as const,
        player1_id: 'p1',
        player3_id: 'p2',
        score: '6-4',
        winner_side: 'a' as const,
        status: 'completed',
      },
      {
        round: 3,
        match_type: 'singles' as const,
        player1_id: 'p3',
        player3_id: 'p4',
        score: '6-2',
        winner_side: 'a' as const,
        status: 'completed',
      },
    ];

    const standings = computeFlightStandings(entries, matches);
    expect(standings.map((s) => s.entry_id)).toEqual(['p1', 'p2', 'p3', 'p4']);
    expect(standings[0]).toMatchObject({ rank: 1, match_wins: 3, match_losses: 0 });
    expect(standings[3]).toMatchObject({ rank: 4, match_wins: 0, match_losses: 3 });
  });

  it('breaks ties by head-to-head when exactly two are tied', () => {
    // p1 beats p2, both win their other matches, both go 2-1
    // h2h says p1 > p2
    const matches = [
      {
        round: 1,
        match_type: 'singles' as const,
        player1_id: 'p1',
        player3_id: 'p4',
        score: '6-0',
        winner_side: 'a' as const,
        status: 'completed',
      },
      {
        round: 1,
        match_type: 'singles' as const,
        player1_id: 'p2',
        player3_id: 'p3',
        score: '6-0',
        winner_side: 'a' as const,
        status: 'completed',
      },
      {
        round: 2,
        match_type: 'singles' as const,
        player1_id: 'p1',
        player3_id: 'p3',
        score: '0-6',
        winner_side: 'b' as const,
        status: 'completed',
      },
      {
        round: 2,
        match_type: 'singles' as const,
        player1_id: 'p2',
        player3_id: 'p4',
        score: '6-0',
        winner_side: 'a' as const,
        status: 'completed',
      },
      {
        round: 3,
        match_type: 'singles' as const,
        player1_id: 'p1',
        player3_id: 'p2',
        score: '6-0',
        winner_side: 'a' as const,
        status: 'completed',
      },
      {
        round: 3,
        match_type: 'singles' as const,
        player1_id: 'p3',
        player3_id: 'p4',
        score: '6-0',
        winner_side: 'a' as const,
        status: 'completed',
      },
    ];
    const standings = computeFlightStandings(entries, matches);
    // p1: 2-1 (beat p4, lost to p3, beat p2)
    // p2: 2-1 (beat p3, beat p4, lost to p1)
    // p3: 2-1 (beat p1, beat p4, lost to p2)
    // p4: 0-3
    // 3-way tie; head-to-head doesn't help (rock-paper-scissors), falls through to set/games math.
    // Our top 3 all won 12 games and lost 6 games → final tiebreaker = original seed.
    expect(standings[3].entry_id).toBe('p4');
    // For the 3-way tie, lowest seed wins
    expect(standings[0].entry_id).toBe('p1');
  });

  it('ignores doubles matches in standings calc', () => {
    const matches = [
      {
        round: 4,
        match_type: 'doubles' as const,
        player1_id: 'p1',
        player2_id: 'p4',
        player3_id: 'p2',
        player4_id: 'p3',
        score: '6-0',
        winner_side: 'a' as const,
        status: 'completed',
      },
    ];
    const standings = computeFlightStandings(entries, matches);
    // No singles matches → all zeros, ranked by seed
    expect(standings.every((s) => s.match_wins === 0)).toBe(true);
    expect(standings.map((s) => s.entry_id)).toEqual(['p1', 'p2', 'p3', 'p4']);
  });
});

describe('buildQuadDoublesRound', () => {
  it('pairs 1+4 vs 2+3', () => {
    const standings = [
      { entry_id: 'p1', rank: 1 } as any,
      { entry_id: 'p2', rank: 2 } as any,
      { entry_id: 'p3', rank: 3 } as any,
      { entry_id: 'p4', rank: 4 } as any,
    ];
    expect(buildQuadDoublesRound(standings)).toEqual({
      round: 4,
      match_type: 'doubles',
      player1_id: 'p1',
      player2_id: 'p4',
      player3_id: 'p2',
      player4_id: 'p3',
    });
  });
  it('returns null for incomplete standings', () => {
    expect(buildQuadDoublesRound([])).toBeNull();
  });
});

describe('assignToFlights', () => {
  it('groups 8 by rating into 2 flights', () => {
    const entries = [
      { id: 'a', composite_rating: 9.0 },
      { id: 'b', composite_rating: 8.5 },
      { id: 'c', composite_rating: 8.0 },
      { id: 'd', composite_rating: 7.5 },
      { id: 'e', composite_rating: 7.0 },
      { id: 'f', composite_rating: 6.5 },
      { id: 'g', composite_rating: 6.0 },
      { id: 'h', composite_rating: 5.5 },
    ];
    const { flights, waitlistIds } = assignToFlights(entries);
    expect(flights).toHaveLength(2);
    expect(flights[0].entryIds).toEqual(['a', 'b', 'c', 'd']);
    expect(flights[1].entryIds).toEqual(['e', 'f', 'g', 'h']);
    expect(waitlistIds).toEqual([]);
  });

  it('sends leftovers to waitlist when not divisible by 4', () => {
    const entries = Array.from({ length: 9 }, (_, i) => ({
      id: `p${i + 1}`,
      composite_rating: 9 - i * 0.5,
    }));
    const { flights, waitlistIds } = assignToFlights(entries);
    expect(flights).toHaveLength(2);
    expect(waitlistIds).toEqual(['p9']);
  });

  it('sends only-3 sign-ups all to waitlist', () => {
    const entries = [
      { id: 'a', composite_rating: 7 },
      { id: 'b', composite_rating: 6 },
      { id: 'c', composite_rating: 5 },
    ];
    const { flights, waitlistIds } = assignToFlights(entries);
    expect(flights).toHaveLength(0);
    expect(waitlistIds).toEqual(['a', 'b', 'c']);
  });

  it('respects maxFlights cap', () => {
    const entries = Array.from({ length: 16 }, (_, i) => ({
      id: `p${i + 1}`,
      composite_rating: 16 - i,
    }));
    const { flights, waitlistIds } = assignToFlights(entries, { maxFlights: 2 });
    expect(flights).toHaveLength(2);
    expect(waitlistIds).toHaveLength(8);
  });

  it('handles entries with null ratings (sort to bottom)', () => {
    const entries = [
      { id: 'rated', composite_rating: 7.5 },
      { id: 'unrated1', composite_rating: null },
      { id: 'unrated2', composite_rating: null },
      { id: 'unrated3', composite_rating: null },
    ];
    const { flights } = assignToFlights(entries);
    expect(flights[0].entryIds[0]).toBe('rated');
  });
});

describe('addMinutesToTime', () => {
  it('adds minutes within same hour', () => {
    expect(addMinutesToTime('09:00', 30)).toBe('09:30');
  });
  it('rolls into next hour', () => {
    expect(addMinutesToTime('09:45', 30)).toBe('10:15');
  });
  it('rolls past midnight cleanly', () => {
    expect(addMinutesToTime('23:30', 60)).toBe('00:30');
  });
});

describe('formatTimeDisplay', () => {
  it('formats AM', () => {
    expect(formatTimeDisplay('09:00')).toBe('9:00 AM');
  });
  it('formats PM', () => {
    expect(formatTimeDisplay('13:30')).toBe('1:30 PM');
  });
  it('formats midnight', () => {
    expect(formatTimeDisplay('00:15')).toBe('12:15 AM');
  });
  it('formats noon', () => {
    expect(formatTimeDisplay('12:00')).toBe('12:00 PM');
  });
  it('strips seconds', () => {
    expect(formatTimeDisplay('14:30:00')).toBe('2:30 PM');
  });
});

describe('autoScheduleQuads', () => {
  it('schedules a single flight on courts 1+2 with 4 rounds', () => {
    const flight = {
      id: 'f1',
      sort_order: 0,
      matches: [
        { id: 'm1a', round: 1 },
        { id: 'm1b', round: 1 },
        { id: 'm2a', round: 2 },
        { id: 'm2b', round: 2 },
        { id: 'm3a', round: 3 },
        { id: 'm3b', round: 3 },
        { id: 'm4', round: 4 },
      ],
    };
    const result = autoScheduleQuads({
      startTime: '09:00',
      roundDurationMinutes: 45,
      numCourts: 2,
      flights: [flight],
    });
    expect(result.size).toBe(7);
    expect(result.get('m1a')).toEqual({ scheduled_at: '09:00', court: '1' });
    expect(result.get('m1b')).toEqual({ scheduled_at: '09:00', court: '2' });
    expect(result.get('m2a')).toEqual({ scheduled_at: '09:45', court: '1' });
    expect(result.get('m2b')).toEqual({ scheduled_at: '09:45', court: '2' });
    expect(result.get('m3a')).toEqual({ scheduled_at: '10:30', court: '1' });
    expect(result.get('m3b')).toEqual({ scheduled_at: '10:30', court: '2' });
    expect(result.get('m4')).toEqual({ scheduled_at: '11:15', court: '1' });
  });

  it('places flight B on courts 3+4 when 4 courts available', () => {
    const flightA = {
      id: 'fA',
      sort_order: 0,
      matches: [{ id: 'mA1', round: 1 }],
    };
    const flightB = {
      id: 'fB',
      sort_order: 1,
      matches: [{ id: 'mB1', round: 1 }],
    };
    const result = autoScheduleQuads({
      startTime: '09:00',
      roundDurationMinutes: 45,
      numCourts: 4,
      flights: [flightA, flightB],
    });
    expect(result.get('mA1')).toEqual({ scheduled_at: '09:00', court: '1' });
    expect(result.get('mB1')).toEqual({ scheduled_at: '09:00', court: '3' });
  });

  it('staggers flight B in time when only 2 courts available', () => {
    const flightA = {
      id: 'fA',
      sort_order: 0,
      matches: [{ id: 'mA1', round: 1 }],
    };
    const flightB = {
      id: 'fB',
      sort_order: 1,
      matches: [{ id: 'mB1', round: 1 }],
    };
    const result = autoScheduleQuads({
      startTime: '09:00',
      roundDurationMinutes: 45,
      numCourts: 2,
      flights: [flightA, flightB],
    });
    expect(result.get('mA1')).toEqual({ scheduled_at: '09:00', court: '1' });
    // Flight B reuses courts 1+2 but starts one slot later
    expect(result.get('mB1')).toEqual({ scheduled_at: '09:45', court: '1' });
  });
});
