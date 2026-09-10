import { describe, it, expect } from 'vitest';
import { clubPartOf, normalizeClub, pickOpponentRow } from './opponentMatch';

const row = (opponent: string) => ({ opponent, captain_email: 'x@y.com' });

describe('clubPartOf', () => {
  it('drops the division a fixture appends', () => {
    expect(clubPartOf('Orinda Country Club - 10U Green')).toBe('Orinda Country Club');
    expect(clubPartOf('Arora Tennis (Team A) - 12U Yellow')).toBe('Arora Tennis (Team A)');
  });

  it('leaves a club that has no division suffix alone', () => {
    expect(clubPartOf('Crow Canyon')).toBe('Crow Canyon');
  });

  it('keeps a hyphen that is part of the club name', () => {
    // Only the LAST " - " segment is the division.
    expect(clubPartOf('Tri-Bluey KidzTennis - 12U Yellow')).toBe('Tri-Bluey KidzTennis');
    expect(clubPartOf('Tri-Bluey KidzTennis')).toBe('Tri-Bluey KidzTennis');
  });
});

describe('normalizeClub', () => {
  it('reads & and "and" as the same word', () => {
    expect(normalizeClub('Meadow Swim & Tennis')).toBe(normalizeClub('meadow swim and tennis'));
  });

  it('ignores case, spacing and punctuation', () => {
    expect(normalizeClub('YTA  East-Bay')).toBe(normalizeClub('yta east bay'));
  });
});

describe('pickOpponentRow', () => {
  it('still matches the whole string exactly — how adult leagues are stored', () => {
    const rows = [row('Diablo Country Club W3.25A'), row('Crow Canyon')];
    expect(pickOpponentRow('Crow Canyon', rows)?.opponent).toBe('Crow Canyon');
  });

  it('matches the club when the fixture carries the division', () => {
    const rows = [row('Orinda Country Club'), row('Moraga Country Club')];
    expect(pickOpponentRow('Orinda Country Club - 10U Green', rows)?.opponent).toBe(
      'Orinda Country Club',
    );
  });

  it('keeps two teams from the same club apart', () => {
    const rows = [row('Arora Tennis'), row('Arora Tennis (Team A)')];
    expect(pickOpponentRow('Arora Tennis (Team A) - 12U Yellow', rows)?.opponent).toBe(
      'Arora Tennis (Team A)',
    );
    expect(pickOpponentRow('Arora Tennis - 10U Green', rows)?.opponent).toBe('Arora Tennis');
  });

  it('falls back to a normalized club name', () => {
    const rows = [row('YTA  East Bay')];
    expect(pickOpponentRow('YTA East-Bay - 14U Yellow', rows)?.opponent).toBe('YTA  East Bay');
  });

  it('prefers an exact club match over a normalized one', () => {
    const rows = [row('meadow tennis  club'), row('Meadow Tennis Club')];
    expect(pickOpponentRow('Meadow Tennis Club - 10U Green', rows)?.opponent).toBe(
      'Meadow Tennis Club',
    );
  });

  it('refuses to guess when two rows normalize the same way and neither is exact', () => {
    const rows = [row('meadow tennis  club'), row('MEADOW TENNIS CLUB')];
    expect(pickOpponentRow('Meadow Tennis Club - 10U Green', rows)).toBeNull();
  });

  it('returns null rather than the wrong club', () => {
    const rows = [row('Moraga Country Club')];
    expect(pickOpponentRow('Meadow Tennis Club - 10U Green', rows)).toBeNull();
  });

  it('handles empty input', () => {
    expect(pickOpponentRow('', [row('Anything')])).toBeNull();
    expect(pickOpponentRow(null, [row('Anything')])).toBeNull();
    expect(pickOpponentRow('Orinda Country Club - 10U Green', [])).toBeNull();
  });
});
