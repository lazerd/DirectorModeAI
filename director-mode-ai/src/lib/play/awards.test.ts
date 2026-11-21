import { describe, it, expect } from 'vitest';
import { awards, giantSlayer, mostConsistent } from './core';
import { resultsCsv } from './results';
import type { GuestMixer, GuestMatch, GuestPlayer } from '@/lib/mixer/guestMixer';

const mixer = (players: GuestPlayer[], rounds: GuestMatch[][]): GuestMixer => ({
  version: 1, name: 't', courts: 2, format: 'doubles', players, createdAt: '2026-11-21T00:00:00Z',
  rounds: rounds.map((matches, i) => ({ number: i + 1, matches, sittingOut: [] })),
});
const P = (id: string, level?: number | null): GuestPlayer => ({ id, name: id.toUpperCase(), ...(level !== undefined ? { level } : {}) });
const M = (teamA: string[], teamB: string[], scoreA: number, scoreB: number, court = 1): GuestMatch => ({ court, teamA, teamB, scoreA, scoreB });

describe('Giant Slayer', () => {
  it('names the side that beat a clearly stronger side, biggest gap first', () => {
    const m = mixer([P('a', 3), P('b', 3), P('c', 4), P('d', 4), P('e', 3.5), P('f', 3.5), P('g', 4), P('h', 3.5)], [
      [M(['a', 'b'], ['c', 'd'], 6, 4), M(['e', 'f'], ['g', 'h'], 6, 3, 2)],
    ]);
    expect(giantSlayer(m)).toMatchObject({ ids: ['a', 'b'], gap: 1, a: 6, b: 4 });
    const aw = awards(m).find((x) => x.title === 'Giant Slayer');
    expect(aw?.who).toBe('A & B');
    expect(aw?.why).toContain('rated 1 higher');
  });

  it('skips a small level gap and the favourite winning', () => {
    const m = mixer([P('a', 3.5), P('b', 3.5), P('c', 3.75), P('d', 3.5)], [
      [M(['a', 'b'], ['c', 'd'], 6, 2)], // gap 0.125: noise
      [M(['c', 'd'], ['a', 'b'], 6, 2)], // the stronger side won
    ]);
    expect(giantSlayer(m)).toBeNull();
    expect(awards(m).some((x) => x.title === 'Giant Slayer')).toBe(false);
  });

  it('is skipped when anyone in the match has no level', () => {
    const m = mixer([P('a', 3), P('b'), P('c', 4.5), P('d', 4.5)], [[M(['a', 'b'], ['c', 'd'], 6, 1)]]);
    expect(giantSlayer(m)).toBeNull();
  });
});

describe('Most Consistent', () => {
  it('picks the smallest spread of game differential over 3+ matches', () => {
    const m = mixer([P('a'), P('b'), P('c'), P('d')], [
      [M(['a'], ['b'], 6, 4), M(['c'], ['d'], 6, 0, 2)],
      [M(['a'], ['c'], 6, 4), M(['b'], ['d'], 6, 5, 2)],
      [M(['a'], ['d'], 6, 4), M(['b'], ['c'], 6, 2, 2)],
    ]);
    // a: +2,+2,+2 (sd 0) beats everyone else's swings
    expect(mostConsistent(m)).toMatchObject({ id: 'a', n: 3, sd: 0, min: 2, max: 2 });
    const aw = awards(m).find((x) => x.title === 'Most Consistent');
    expect(aw?.who).toBe('A');
    expect(aw?.why).toBe('game diff +2 to +2 over 3 matches');
  });

  it('needs at least 3 scored matches', () => {
    const m = mixer([P('a'), P('b')], [[M(['a'], ['b'], 6, 4)], [M(['a'], ['b'], 6, 4)], [{ court: 1, teamA: ['a'], teamB: ['b'], scoreA: null, scoreB: null }]]);
    expect(mostConsistent(m)).toBeNull();
    expect(awards(m).some((x) => x.title === 'Most Consistent')).toBe(false);
  });

  it('breaks a spread tie by the better average', () => {
    const m = mixer([P('a'), P('b')], [[M(['a'], ['b'], 6, 3)], [M(['a'], ['b'], 6, 3)], [M(['a'], ['b'], 6, 3)]]);
    expect(mostConsistent(m)?.id).toBe('a'); // a is +3 every time, b is -3 every time
  });
});

describe('resultsCsv', () => {
  it('writes standings then every match with court labels and tiebreaks', () => {
    const m = mixer([P('a'), { id: 'b', name: 'Bo, Jr.' }], [[M(['a'], ['b'], 6, 6)]]);
    m.rounds[0].matches[0].tiebreak = 'B';
    m.courtLabels = ['7'];
    const csv = resultsCsv(m).split('\r\n');
    expect(csv[0]).toBe('Rank,Player,Played,Wins,Losses,Games won,Games lost,Win %');
    expect(csv[1]).toBe('1,"Bo, Jr.",1,1,0,6,6,100%');
    expect(csv[2]).toBe('2,A,1,0,1,6,6,0%');
    expect(csv[5]).toBe('1,7,A,"Bo, Jr.",6,6,"Bo, Jr."');
  });
});
