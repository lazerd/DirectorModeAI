import { describe, expect, it } from 'vitest';
import { isInstructorRole, isStaffRole, pickPrimaryClub } from './clubRoles';

describe('isStaffRole / isInstructorRole', () => {
  it('treats a plain member as neither — the join code grants this', () => {
    expect(isStaffRole('member')).toBe(false);
    expect(isInstructorRole('member')).toBe(false);
  });

  it('counts owner, director and coach as instructors', () => {
    for (const r of ['owner', 'director', 'coach']) expect(isInstructorRole(r)).toBe(true);
  });

  it('front desk is staff but not an instructor — they do not teach', () => {
    expect(isStaffRole('front_desk')).toBe(true);
    expect(isInstructorRole('front_desk')).toBe(false);
  });

  it('is safe on nothing at all', () => {
    expect(isStaffRole(null)).toBe(false);
    expect(isInstructorRole(undefined)).toBe(false);
  });
});

describe('pickPrimaryClub', () => {
  const SH = 'sleepy-hollow-id';
  const OTHER = 'other-club-id';

  it('picks the only club someone belongs to', () => {
    expect(pickPrimaryClub([{ club_id: SH, role: 'coach' }], null)).toBe(SH);
  });

  it('prefers where they are staff over where they are just a member', () => {
    expect(
      pickPrimaryClub(
        [
          { club_id: OTHER, role: 'member', created_at: '2026-01-01' },
          { club_id: SH, role: 'coach', created_at: '2026-06-01' },
        ],
        null,
      ),
    ).toBe(SH);
  });

  it('breaks a tie by who they joined first, not by row order', () => {
    const rows = [
      { club_id: OTHER, role: 'coach', created_at: '2026-06-01' },
      { club_id: SH, role: 'coach', created_at: '2026-01-01' },
    ];
    expect(pickPrimaryClub(rows, null)).toBe(SH);
    expect(pickPrimaryClub([...rows].reverse(), null)).toBe(SH);
  });

  it("does NOT let a club they created outrank the club they teach at", () => {
    // The failure this exists to stop: a coach wanders into "create a club",
    // and silently detaches from the club whose page they are meant to be on.
    expect(pickPrimaryClub([{ club_id: SH, role: 'coach' }], 'their-own-empty-club')).toBe(SH);
  });

  it('falls back to an owned club when they have no membership row', () => {
    expect(pickPrimaryClub([], 'their-own-club')).toBe('their-own-club');
  });

  it('returns null when there is nothing to pick', () => {
    expect(pickPrimaryClub([], null)).toBe(null);
    expect(pickPrimaryClub(null, undefined)).toBe(null);
  });
});
