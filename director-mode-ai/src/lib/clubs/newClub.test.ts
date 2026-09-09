import { describe, it, expect } from 'vitest';
import {
  newClubRow,
  makeJoinCode,
  uniqueJoinCode,
  isValidTimezone,
  DEFAULT_TIMEZONE,
} from './newClub';

const base = { ownerId: 'u1', name: 'Sleepy Hollow', slug: 'sleepy-hollow' };

describe('makeJoinCode', () => {
  it('is six characters', () => {
    expect(makeJoinCode()).toHaveLength(6);
  });

  it('never uses the characters people misread', () => {
    // O/0 and I/1 are the whole reason for the custom alphabet: these codes get
    // read down a phone line and typed by members.
    for (let i = 0; i < 200; i++) {
      expect(makeJoinCode()).not.toMatch(/[O0I1]/);
    }
  });

  it('is deterministic when given a deterministic source', () => {
    expect(makeJoinCode(() => 0)).toBe('AAAAAA');
  });
});

describe('isValidTimezone', () => {
  it('accepts real IANA zones', () => {
    for (const tz of ['America/Los_Angeles', 'America/New_York', 'Europe/London', 'UTC']) {
      expect(isValidTimezone(tz)).toBe(true);
    }
  });

  it('rejects nonsense, blanks and non-strings', () => {
    for (const tz of ['Mars/Olympus', '', '   ', null, undefined, 42, {}]) {
      expect(isValidTimezone(tz)).toBe(false);
    }
  });
});

describe('newClubRow', () => {
  it('always issues a join code', () => {
    // The bug this module exists to prevent: three of the four creation paths
    // produced a club with no code, and no screen could add one afterwards.
    expect(newClubRow(base).join_code).toHaveLength(6);
  });

  it("keeps a caller's valid timezone", () => {
    expect(newClubRow({ ...base, timezone: 'America/New_York' }).timezone).toBe('America/New_York');
  });

  it('falls back when the timezone is missing or bogus', () => {
    expect(newClubRow(base).timezone).toBe(DEFAULT_TIMEZONE);
    expect(newClubRow({ ...base, timezone: null }).timezone).toBe(DEFAULT_TIMEZONE);
    expect(newClubRow({ ...base, timezone: 'Not/AZone' }).timezone).toBe(DEFAULT_TIMEZONE);
  });

  it('lets a caller opt into a private club without losing the other defaults', () => {
    const row = newClubRow({ ...base, isPublic: false, acceptJoinRequests: false });
    expect(row.is_public).toBe(false);
    expect(row.accept_join_requests).toBe(false);
    expect(row.join_code).toHaveLength(6);
    expect(row.timezone).toBe(DEFAULT_TIMEZONE);
  });

  it('distinguishes an explicit false from an omitted value', () => {
    expect(newClubRow(base).is_public).toBe(true);
    expect(newClubRow({ ...base, isPublic: false }).is_public).toBe(false);
  });

  it('trims the name so a stray space does not become the club identity', () => {
    expect(newClubRow({ ...base, name: '  Sleepy Hollow  ' }).name).toBe('Sleepy Hollow');
  });
});

describe('uniqueJoinCode', () => {
  it('returns the first code nobody holds', async () => {
    const code = await uniqueJoinCode(async () => false);
    expect(code).toHaveLength(6);
  });

  it('keeps trying past a collision', async () => {
    // A collision is not cosmetic: /api/clubs/join resolves with
    // .ilike().maybeSingle(), which throws on two matches — breaking joining
    // for BOTH clubs.
    const taken = new Set(['AAAAAA']);
    let call = 0;
    const random = () => (call++ < 6 ? 0 : 0.5); // first code AAAAAA, then something else
    const code = await uniqueJoinCode(async (c) => taken.has(c), random);
    expect(code).not.toBe('AAAAAA');
  });

  it('asks about every candidate it generates', async () => {
    const seen: string[] = [];
    await uniqueJoinCode(async (c) => {
      seen.push(c);
      return seen.length < 3;
    });
    expect(seen).toHaveLength(3);
  });

  it('widens the code rather than failing when the space looks saturated', async () => {
    const code = await uniqueJoinCode(async () => true, Math.random, 3);
    expect(code).toHaveLength(8);
  });
});

describe('newClubRow join code', () => {
  it('uses a caller-supplied code when given one', () => {
    expect(newClubRow({ ...base, joinCode: 'ABC234' }).join_code).toBe('ABC234');
  });

  it('mints one when the caller does not supply it', () => {
    expect(newClubRow(base).join_code).toHaveLength(6);
  });
});
