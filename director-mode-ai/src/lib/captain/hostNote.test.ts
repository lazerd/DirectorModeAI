import { describe, it, expect } from 'vitest';
import {
  newInboundToken,
  pickMatch,
  sameClub,
  scheduleWarnings,
  suggestFields,
  tokensFromRecipients,
  withoutOurPeople,
  type HostNoteExtract,
  type MatchLite,
} from './hostNote';

const m = (id: string, match_at: string, opponent: string, over: Partial<MatchLite> = {}): MatchLite => ({
  id,
  match_at,
  is_home: false,
  opponent,
  location: null,
  arrival_note: null,
  opposing_captain_name: null,
  opposing_captain_email: null,
  opposing_captain_phone: null,
  ...over,
});

// 9:30am Pacific = 16:30Z in September.
const season = [
  m('sep16', '2026-09-16T16:30:00Z', 'Diablo Country Club W3.25A', { is_home: true }),
  m('sep22', '2026-09-22T16:30:00Z', 'Crow Canyon'),
  m('oct13', '2026-10-13T16:30:00Z', 'Crow Canyon', { is_home: true }),
];
const now = new Date('2026-09-16T20:00:00Z');

const colleen: HostNoteExtract = {
  about_a_match: true,
  match_date: '2026-09-22',
  start_time: '09:30',
  host_club: 'Crow Canyon',
  address: null,
  arrival_note: 'Warm-up courts open at 9. All four lines start at 9:30. Check in at the front desk. Free parking; water, ice and restrooms courtside.',
  captains: [
    { name: 'Colleen McClure', email: 'lilstew@prodigy.net', phone: null },
    { name: 'Cheryl Moore', email: 'cherylannmoore27@gmail.com', phone: null },
  ],
};

describe('pickMatch', () => {
  it("files Colleen's note on 9/22 by its date", () => {
    expect(pickMatch(season, colleen, now)).toBe('sep22');
  });

  it('with no date, takes the next match against that club', () => {
    expect(pickMatch(season, { match_date: null, host_club: 'Crow Canyon Country Club' }, now)).toBe('sep22');
  });

  it('refuses to guess when nothing lines up', () => {
    expect(pickMatch(season, { match_date: '2026-09-23', host_club: 'Moraga' }, now)).toBeNull();
    expect(pickMatch(season, { match_date: null, host_club: null }, now)).toBeNull();
  });
});

describe('sameClub', () => {
  it('ignores filler words like Country Club', () => {
    expect(sameClub('Crow Canyon Country Club', 'Crow Canyon')).toBe(true);
    expect(sameClub('Diablo Country Club', 'Orinda Country Club W3.25A')).toBe(false);
  });
});

describe('scheduleWarnings', () => {
  it('is quiet when the host agrees with the match', () => {
    expect(scheduleWarnings(season[1], colleen)).toEqual([]);
  });

  it('flags a different start time and date, in club time', () => {
    expect(scheduleWarnings(season[1], { match_date: '2026-09-23', start_time: '10:00' })).toEqual([
      'The host says 9/23/2026; this match is on 9/22/2026.',
      'The host says play starts at 10:00am; this match is set for 9:30am.',
    ]);
  });
});

describe('suggestFields', () => {
  it('fills the arrival note and lead captain, and keeps the location without an address', () => {
    const match = m('sep22', '2026-09-22T16:30:00Z', 'Crow Canyon', {
      location: 'Crow Canyon',
      arrival_note: 'Away at Crow Canyon. Date confirmed by Crow Canyon.',
    });
    expect(suggestFields(match, colleen)).toEqual({
      location: 'Crow Canyon',
      arrival_note: colleen.arrival_note,
      opposing_captain_name: 'Colleen McClure',
      opposing_captain_email: 'lilstew@prodigy.net',
      opposing_captain_phone: null,
    });
  });

  it('never blanks a field the email is silent on', () => {
    const match = m('x', '2026-09-22T16:30:00Z', 'Crow Canyon', { opposing_captain_phone: '925-555-0100' });
    const out = suggestFields(match, { ...colleen, arrival_note: null, captains: [] });
    expect(out.opposing_captain_phone).toBe('925-555-0100');
    expect(out.arrival_note).toBeNull();
  });

  it('uses the address when one is given', () => {
    const out = suggestFields(season[1], { ...colleen, address: '711 Silver Lake Dr, Danville' });
    expect(out.location).toBe('Crow Canyon, 711 Silver Lake Dr, Danville');
  });
});

describe('withoutOurPeople', () => {
  it("keeps Crow Canyon's captains and drops ours", () => {
    const listed = [
      { name: 'Colleen McClure', email: 'lilstew@prodigy.net', phone: null },
      { name: 'Darrin Cohen', email: null, phone: null },
      { name: 'Robyn Rogin', email: 'robyn.rogin@gmail.com', phone: null },
      { name: 'Cheryl Moore', email: 'cherylannmoore27@gmail.com', phone: null },
    ];
    expect(
      withoutOurPeople(listed, { names: ['darrin cohen'], emails: ['Robyn.Rogin@gmail.com'] }).map((c) => c.name),
    ).toEqual(['Colleen McClure', 'Cheryl Moore']);
  });
});

describe('forwarding address', () => {
  it('makes a readable token and finds it in any recipient header', () => {
    const t = newInboundToken('Fall B2/B3 2026', 'K7m2Q9x4zz');
    expect(t).toBe('fall-b2-b3-2026-k7m2q9x4');
    expect(
      tokensFromRecipients(['Darrin <darrin@x.com>', `Team <${t}@mail.clubmode.ai>`], 'mail.clubmode.ai'),
    ).toEqual([t]);
    expect(tokensFromRecipients([`${t}@evil.com`], 'mail.clubmode.ai')).toEqual([]);
  });
});
