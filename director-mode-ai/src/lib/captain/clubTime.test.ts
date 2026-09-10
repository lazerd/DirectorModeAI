import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

// emails.ts pulls in Resend + Supabase through @/lib/email just to export
// sendAll; the builders themselves are pure.
vi.mock('@/lib/email', () => ({ sendBilledEmails: vi.fn() }));

import {
  CLUB_TZ,
  clubTimeZoneOf,
  isoToZonedWallTime,
  normalizeTimeZone,
  resolveClubTimeZone,
  resolveTeamTimeZone,
  zonedWallTimeToIso,
} from './clubTime';
import { lineupEmail, seasonWhenText, type MatchInfo } from './emails';
import { matchEvent } from './calendar';
import { lineupAsText } from './lineupText';
import { lineupPrintHtml } from './lineupPrint';

const EASTERN = 'America/New_York';

/** A one-row PostgREST stand-in: from().select().eq().maybeSingle(). */
function fakeDb(row: unknown) {
  const calls: string[] = [];
  const db = {
    from: (table: string) => {
      calls.push(table);
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }),
      };
    },
  } as unknown as SupabaseClient;
  return { db, calls };
}

describe('normalizeTimeZone', () => {
  it('keeps a real IANA zone', () => {
    expect(normalizeTimeZone(EASTERN)).toBe(EASTERN);
  });

  it('falls back to club time for null, blank and garbage — never undefined', () => {
    expect(normalizeTimeZone(null)).toBe(CLUB_TZ);
    expect(normalizeTimeZone(undefined)).toBe(CLUB_TZ);
    expect(normalizeTimeZone('  ')).toBe(CLUB_TZ);
    expect(normalizeTimeZone('Mars/Olympus_Mons')).toBe(CLUB_TZ);
  });
});

describe('clubTimeZoneOf — the cc_clubs(timezone) embed', () => {
  it('reads the object and the array shape', () => {
    expect(clubTimeZoneOf({ cc_clubs: { timezone: EASTERN } })).toBe(EASTERN);
    expect(clubTimeZoneOf({ cc_clubs: [{ timezone: EASTERN }] })).toBe(EASTERN);
  });

  it('falls back when the team has no club or the club no zone', () => {
    expect(clubTimeZoneOf(null)).toBe(CLUB_TZ);
    expect(clubTimeZoneOf({ cc_clubs: null })).toBe(CLUB_TZ);
    expect(clubTimeZoneOf({ cc_clubs: { timezone: 'nope' } })).toBe(CLUB_TZ);
  });
});

describe('resolveClubTimeZone / resolveTeamTimeZone', () => {
  it("returns the club's own zone", async () => {
    expect(await resolveClubTimeZone(fakeDb({ timezone: EASTERN }).db, 'club-1')).toBe(EASTERN);
    expect(await resolveTeamTimeZone(fakeDb({ cc_clubs: { timezone: EASTERN } }).db, 'team-1')).toBe(
      EASTERN,
    );
  });

  it('falls back on a null zone, a missing row and a garbage zone', async () => {
    expect(await resolveClubTimeZone(fakeDb({ timezone: null }).db, 'club-1')).toBe(CLUB_TZ);
    expect(await resolveClubTimeZone(fakeDb(null).db, 'club-1')).toBe(CLUB_TZ);
    expect(await resolveClubTimeZone(fakeDb({ timezone: 'Eastern' }).db, 'club-1')).toBe(CLUB_TZ);
    expect(await resolveTeamTimeZone(fakeDb(null).db, 'team-1')).toBe(CLUB_TZ);
  });

  it('does not query at all without an id', async () => {
    const { db, calls } = fakeDb({ timezone: EASTERN });
    expect(await resolveClubTimeZone(db, null)).toBe(CLUB_TZ);
    expect(await resolveTeamTimeZone(db, undefined)).toBe(CLUB_TZ);
    expect(calls).toEqual([]);
  });
});

describe('zonedWallTimeToIso — what the captain typed, at the club', () => {
  it('reads 9:30 as 9:30 in the club zone', () => {
    expect(zonedWallTimeToIso('2026-09-13T09:30', EASTERN)).toBe('2026-09-13T13:30:00.000Z');
    expect(zonedWallTimeToIso('2026-09-13T09:30', CLUB_TZ)).toBe('2026-09-13T16:30:00.000Z');
  });

  it('lands on the right side of the November DST change', () => {
    expect(zonedWallTimeToIso('2026-11-08T09:30', EASTERN)).toBe('2026-11-08T14:30:00.000Z');
    expect(zonedWallTimeToIso('2026-11-08T09:30', CLUB_TZ)).toBe('2026-11-08T17:30:00.000Z');
  });

  it('round-trips with isoToZonedWallTime, and rejects junk', () => {
    expect(isoToZonedWallTime('2026-09-13T13:30:00.000Z', EASTERN)).toBe('2026-09-13T09:30');
    expect(isoToZonedWallTime('2026-09-13T16:30:00.000Z', CLUB_TZ)).toBe('2026-09-13T09:30');
    expect(zonedWallTimeToIso('', EASTERN)).toBeNull();
  });
});

describe('an East Coast team gets East Coast times', () => {
  // 9:30am Eastern = 6:30am Pacific. Before this fix it went out as 6:30.
  const MATCH: MatchInfo = {
    id: 'match-e',
    matchAt: '2026-09-13T13:30:00.000Z',
    isHome: true,
    opponent: 'Westchester',
  };
  const ME = { playerId: 'p1', name: 'Ann Adams', email: 'ann@example.com', token: 'tok' };
  const ROWS = [{ courtNumber: 1, courtType: 'doubles' as const, names: ['Ann Adams', 'Bea Brooks'] }];

  it('lineup email: subject and body say 9:30 AM', () => {
    const e = lineupEmail('Rye 3.5', MATCH, ROWS, ME, true, EASTERN);
    expect(e.subject).toMatch(/9:30\sAM/);
    expect(e.html).toMatch(/9:30\sAM/);
    expect(e.html).not.toMatch(/6:30\sAM/);
  });

  it('Sleepy Hollow (no zone passed) is unchanged: still Pacific', () => {
    expect(lineupEmail('Fall B2/B3', MATCH, ROWS, ME, true).subject).toMatch(/6:30\sAM/);
  });

  it('calendar end time, group text, printout and season line all follow the club', () => {
    // 13:30Z + 2.5h = 16:00Z = noon Eastern.
    expect(matchEvent('Rye 3.5', MATCH, null, { timeZone: EASTERN }).description).toMatch(
      /Ends around 12:00\sPM/,
    );
    const base = { teamName: 'Rye 3.5', matchAt: MATCH.matchAt, isHome: true, courts: [], timeZone: EASTERN };
    expect(lineupAsText(base)).toMatch(/at 9:30\sAM/);
    expect(lineupPrintHtml(base)).toMatch(/9:30\sAM/);
    expect(seasonWhenText([MATCH.matchAt], EASTERN)).toMatch(/^Sundays at 9:30\sAM$/);
  });
});
