import { describe, it, expect } from 'vitest';
import { zonedWallTimeToIso } from '@/lib/captain/clubTime';
import { changeTellsPlayers, clockLabel, clubDate, gameChanges, gameTitle, maxSpotsFor, publicLine, ratingLabel, shortName } from './format';
import { levelFits } from './server';

describe('names', () => {
  it('is first name and last initial, never the full surname', () => {
    expect(shortName('Mary Beth Jones')).toBe('Mary J.');
    expect(shortName('cher')).toBe('cher');
    expect(shortName('  ')).toBe('A member');
    expect(shortName(null)).toBe('A member');
  });
});

describe('levels', () => {
  it('reads a range the way a member would say it', () => {
    expect(ratingLabel(3, 3.5)).toBe('3.0–3.5');
    expect(ratingLabel('3.5', '3.5')).toBe('3.5');
    expect(ratingLabel(4, null)).toBe('4.0+');
    expect(ratingLabel(null, 3)).toBe('up to 3.0');
    expect(ratingLabel(null, null)).toBe('');
  });

  it('lets unrated members in only when the poster allowed it', () => {
    const g = { rating_min: 3, rating_max: 3.5, include_unrated: false };
    expect(levelFits(g, 3.5)).toBe(true);
    expect(levelFits(g, 4)).toBe(false);
    expect(levelFits(g, null)).toBe(false);
    expect(levelFits({ ...g, include_unrated: true }, null)).toBe(true);
    expect(levelFits({ rating_min: null, rating_max: null, include_unrated: false }, null)).toBe(true);
  });
});

describe('club time', () => {
  // The whole point: a 9am game at a Pacific club is 9am in every rendering,
  // no matter that the server runs UTC.
  const tz = 'America/Los_Angeles';
  const nineAm = zonedWallTimeToIso('2026-09-22T09:00', tz)!;

  it('stores a club-local 9am as the right instant', () => {
    expect(nineAm).toBe('2026-09-22T16:00:00.000Z');
  });

  it('renders it back as 9:00am on the right day', () => {
    expect(clockLabel(nineAm, tz)).toBe('9:00am');
    expect(gameTitle({ starts_at: nineAm, format: 'doubles' }, tz)).toBe('Tue Sep 22 · 9:00am doubles');
  });

  it('keeps an evening game on its own date', () => {
    const late = zonedWallTimeToIso('2026-09-22T19:30', tz)!;
    expect(clubDate(late, tz)).toBe('2026-09-22');
    expect(clockLabel(late, tz)).toBe('7:30pm');
  });

  it('holds across the November DST change', () => {
    const nov = zonedWallTimeToIso('2026-11-03T09:00', tz)!;
    expect(clockLabel(nov, tz)).toBe('9:00am');
  });

  it('builds the non-identifying line for signed-out visitors', () => {
    expect(
      publicLine({ starts_at: nineAm, format: 'doubles', spots_needed: 2, rating_min: 3, rating_max: 3.5 }, 1, tz),
    ).toBe('Tue Sep 22 · 9:00am doubles · needs 1 · 3.0–3.5');
  });
});

describe('editing a game', () => {
  const tz = 'America/Los_Angeles';
  const before = {
    starts_at: zonedWallTimeToIso('2026-09-22T13:00', tz)!,
    duration_min: 90,
    court: '6',
    note: 'Looking for two guys.',
    spots_needed: 2,
  };

  it('says nothing changed when nothing did', () => {
    expect(gameChanges(before, { ...before, court: ' 6 ' }, tz)).toEqual([]);
  });

  it('reads a move in the club time, old then new', () => {
    const moved = { ...before, starts_at: zonedWallTimeToIso('2026-09-23T10:00', tz)! };
    const changes = gameChanges(before, moved, tz);
    expect(changes).toEqual([{ field: 'when', label: 'When', from: 'Tue Sep 22, 1:00pm', to: 'Wed Sep 23, 10:00am' }]);
    expect(changeTellsPlayers(changes)).toBe(true);
  });

  it('treats a court left blank as "To be decided", and setting one is news', () => {
    const changes = gameChanges({ ...before, court: null }, { ...before, court: '3' }, tz);
    expect(changes[0]).toMatchObject({ field: 'court', from: 'To be decided', to: '3' });
    expect(changeTellsPlayers(changes)).toBe(true);
  });

  it('counts players in court terms, and a new note or size emails nobody', () => {
    const changes = gameChanges(before, { ...before, spots_needed: 3, note: '' }, tz);
    expect(changes.map((c) => c.field)).toEqual(['note', 'spots']);
    expect(changes[1]).toMatchObject({ from: '3 in all', to: '4 in all' });
    expect(changeTellsPlayers(changes)).toBe(false);
  });

  it('never lets singles ask for more than one', () => {
    expect(maxSpotsFor('singles')).toBe(1);
    expect(maxSpotsFor('doubles')).toBe(3);
  });
});
