import { describe, it, expect } from 'vitest';
import { isClubPublicPath } from './publicPaths';

describe('isClubPublicPath', () => {
  it("treats a club's own pages as public", () => {
    expect(isClubPublicPath('/c/lafayette-tennis-club')).toBe(true);
    expect(isClubPublicPath('/courtsheet/lafayette-tennis-club')).toBe(true);
    expect(isClubPublicPath('/calendar/lafayette-tennis-club')).toBe(true);
  });

  it("keeps the director's own tools under the same prefixes", () => {
    expect(isClubPublicPath('/courtsheet/staff')).toBe(false);
    expect(isClubPublicPath('/courtsheet/staff/print')).toBe(false);
    expect(isClubPublicPath('/calendar')).toBe(false);
    expect(isClubPublicPath('/calendar/board')).toBe(false);
    expect(isClubPublicPath('/calendar/ideas')).toBe(false);
    expect(isClubPublicPath('/calendar/import')).toBe(false);
  });

  it('does not match look-alike paths', () => {
    expect(isClubPublicPath('/courts')).toBe(false);
    expect(isClubPublicPath('/club-site')).toBe(false);
    expect(isClubPublicPath('/courtsheet')).toBe(false);
  });
});
