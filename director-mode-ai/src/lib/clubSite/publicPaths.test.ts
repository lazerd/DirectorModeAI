import { describe, it, expect } from 'vitest';
import { isClubPublicPath, clubSlugFromAppPath } from './publicPaths';

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

  it('treats the QR check-in phone pages and kiosk board as public', () => {
    expect(isClubPublicPath('/q/k7m2q9xdpa')).toBe(true);
    expect(isClubPublicPath('/q/s/0123456789abcdef0123456789abcdef0123')).toBe(true);
    expect(isClubPublicPath('/checkin/rossmoor-tennis-club/board')).toBe(true);
    expect(isClubPublicPath('/run/checkin')).toBe(false);
    expect(isClubPublicPath('/quads')).toBe(false);
  });

  it('does not match look-alike paths', () => {
    expect(isClubPublicPath('/courts')).toBe(false);
    expect(isClubPublicPath('/club-site')).toBe(false);
    expect(isClubPublicPath('/courtsheet')).toBe(false);
  });
});

describe('clubSlugFromAppPath', () => {
  it('reads the slug off a club court sheet or calendar', () => {
    expect(clubSlugFromAppPath('/courtsheet/sleepy-hollow')).toBe('sleepy-hollow');
    expect(clubSlugFromAppPath('/calendar/sleepy-hollow')).toBe('sleepy-hollow');
  });
  it('ignores director tools and the club website', () => {
    expect(clubSlugFromAppPath('/courtsheet/staff')).toBe(null);
    expect(clubSlugFromAppPath('/calendar/board')).toBe(null);
    expect(clubSlugFromAppPath('/c/sleepy-hollow')).toBe(null);
    expect(clubSlugFromAppPath('/member')).toBe(null);
  });
});
