import { describe, it, expect } from 'vitest';
import { lockedMatchesNeedingCourtUpdate, matchesNeedingCourtUpdate } from './courtBackfill';

const m = (id: string, singles: number, doubles: number) => ({
  id,
  singles_courts: singles,
  doubles_courts: doubles,
});

describe('matchesNeedingCourtUpdate', () => {
  it('picks the matches still stamped with the old shape', () => {
    // The reported bug: a 4-doubles team whose schedule was imported while the
    // team still carried the USTA Adult default of 2 singles + 3 doubles.
    const matches = [m('a', 2, 3), m('b', 2, 3), m('c', 0, 4)];
    expect(matchesNeedingCourtUpdate(matches, [], { singles: 0, doubles: 4 })).toEqual(['a', 'b']);
  });

  it('leaves a match whose lineup is already saved alone', () => {
    const matches = [m('a', 2, 3), m('b', 2, 3)];
    expect(matchesNeedingCourtUpdate(matches, ['a'], { singles: 0, doubles: 4 })).toEqual(['b']);
  });

  it('returns nothing when every match already matches', () => {
    const matches = [m('a', 0, 4), m('b', 0, 4)];
    expect(matchesNeedingCourtUpdate(matches, [], { singles: 0, doubles: 4 })).toEqual([]);
  });

  it('counts a change on either side alone', () => {
    const matches = [m('a', 2, 4), m('b', 0, 3)];
    expect(matchesNeedingCourtUpdate(matches, [], { singles: 0, doubles: 4 })).toEqual(['a', 'b']);
  });

  it('treats zero singles as a real value rather than a missing one', () => {
    // 0 is the whole point of the bug — a doubles-only team. Going 0+4 -> 2+3
    // has to be seen as a change in both directions.
    const matches = [m('a', 0, 4)];
    expect(matchesNeedingCourtUpdate(matches, [], { singles: 2, doubles: 3 })).toEqual(['a']);
  });

  it('survives an empty or absent list', () => {
    expect(matchesNeedingCourtUpdate([], [], { singles: 0, doubles: 4 })).toEqual([]);
    expect(
      matchesNeedingCourtUpdate(
        undefined as unknown as ReturnType<typeof m>[],
        [],
        { singles: 0, doubles: 4 },
      ),
    ).toEqual([]);
  });
});

describe('lockedMatchesNeedingCourtUpdate', () => {
  it('reports the locked matches the restamp had to skip', () => {
    // 'a' has a lineup saved and the wrong shape — the captain has to be told,
    // since the save now silently fixes everything else.
    const matches = [m('a', 2, 3), m('b', 2, 3), m('c', 0, 4)];
    expect(lockedMatchesNeedingCourtUpdate(matches, ['a', 'c'], { singles: 0, doubles: 4 })).toEqual(
      ['a'],
    );
  });

  it('says nothing about a locked match that is already the right shape', () => {
    expect(
      lockedMatchesNeedingCourtUpdate([m('a', 0, 4)], ['a'], { singles: 0, doubles: 4 }),
    ).toEqual([]);
  });

  it('is empty when nothing is locked', () => {
    expect(lockedMatchesNeedingCourtUpdate([m('a', 2, 3)], [], { singles: 0, doubles: 4 })).toEqual(
      [],
    );
  });
});
