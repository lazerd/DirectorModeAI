import { describe, it, expect } from 'vitest';
import { parseRosterPaste, isNotAName, MAX_ROSTER_ROWS } from './rosterPaste';

/**
 * Page furniture shaped line-for-line like the 2026-09-03 league-site paste
 * that created 240 rows. The person, phone and email in it are made up.
 */
const REAL_JUNK = [
  'Robin Castellano   Help  Search',
  'Lessons',
  'Courts/ Reservations',
  'Activity Schedule',
  'Find A Tournament',
  'Meet Players',
  'Calendar',
  'Standings Schedule Availability Practices New QR Code Player Standings Results Print',
  'Hillcrest S&T 18+ C',
  'Click to update',
  'Captain',
  '206-555-0191',
  'robinmcastellano@example.com',
  'League',
  '2026/27 East Bay Division 18+',
  'Season Dates',
  '8/31/2026 - 5/3/2027',
  'Coordinators',
  'President',
  'Home Club',
  'Phone',
  'Preferred Time',
];

/** Fictional players with the same shapes as a real roster. These must survive. */
const REAL_PLAYERS = [
  'Robin Castellano',
  'Dana Kowalski',
  'Jennifer Albright',
  'Ariel Brennan',
  'Caspian Moretti',
  'Leila Farahani',
  'Joanna R Whitcomb',
  'Rosa San Martin',
];

const ok = (text: string) => parseRosterPaste(text).rows.filter((r) => r.confidence === 'ok');

describe('parseRosterPaste', () => {
  it('ticks real player names', () => {
    const names = ok(REAL_PLAYERS.join('\n')).map((r) => r.name);
    expect(names).toEqual(REAL_PLAYERS);
  });

  it('does not tick page furniture from the real paste', () => {
    for (const line of REAL_JUNK) {
      const rows = parseRosterPaste(line).rows;
      expect(rows, line).toHaveLength(1);
      expect(rows[0].confidence, `${line} -> ${rows[0].reason ?? 'ok'}`).toBe('suspect');
    }
  });

  it('keeps suspect lines visible with a reason rather than dropping them', () => {
    const { rows } = parseRosterPaste('Calendar');
    expect(rows[0].name).toBe('Calendar');
    expect(rows[0].reason).toBeTruthy();
  });

  it('doubts a line that repeats, because labels repeat and people do not', () => {
    const { rows } = parseRosterPaste(
      ['Nora Vance', 'Team Contact', 'Greta Lindqvist', 'Team Contact'].join('\n'),
    );
    const contact = rows.find((r) => r.name === 'Team Contact');
    expect(contact?.confidence).toBe('suspect');
    expect(contact?.reason).toMatch(/more than once/);
    expect(rows.find((r) => r.name === 'Nora Vance')?.confidence).toBe('ok');
  });

  it('parses the documented "Name, email, rating" line', () => {
    const { rows } = parseRosterPaste('Dana Kowalski, dana@example.com, 3.5');
    expect(rows[0]).toMatchObject({
      name: 'Dana Kowalski',
      email: 'dana@example.com',
      rating: 3.5,
      confidence: 'ok',
    });
  });

  it('reads a spreadsheet paste with tabs', () => {
    const { rows } = parseRosterPaste('Jill Marsh\tjill@example.com\t3.0');
    expect(rows[0]).toMatchObject({ name: 'Jill Marsh', email: 'jill@example.com', rating: 3.0 });
  });

  it('takes the email and rating from any column', () => {
    const { rows } = parseRosterPaste('Blair Tolliver, 3.5, blair@example.com');
    expect(rows[0]).toMatchObject({ email: 'blair@example.com', rating: 3.5 });
  });

  it('refuses a rating outside the NTRP range instead of storing it', () => {
    // A win-loss column of 8-4 or a WTN of 31 must not become an NTRP rating.
    expect(parseRosterPaste('Emma Stroud, 31').rows[0].rating).toBeNull();
    expect(parseRosterPaste('Emma Stroud, 8').rows[0].rating).toBeNull();
  });

  it('warns when the paste is page-sized', () => {
    const many = Array.from({ length: 90 }, (_, i) => `Player Number${i}`).join('\n');
    const { warnings } = parseRosterPaste(many);
    expect(warnings.join(' ')).toMatch(/more than a team usually has/);
  });

  it('warns about the unticked lines', () => {
    const { warnings } = parseRosterPaste(['Dana Kowalski', 'Calendar', 'Lessons'].join('\n'));
    expect(warnings.join(' ')).toMatch(/don't look like names/);
  });

  it('caps a runaway paste', () => {
    const huge = Array.from({ length: 400 }, (_, i) => `Firstname Lastname${i}`).join('\n');
    const { rows, warnings } = parseRosterPaste(huge);
    expect(rows).toHaveLength(MAX_ROSTER_ROWS);
    expect(warnings.join(' ')).toMatch(/first 200 lines/);
  });

  it('collapses the same name pasted twice', () => {
    const { rows } = parseRosterPaste('Dana Kowalski\nDana Kowalski');
    expect(rows).toHaveLength(1);
  });

  it('on the whole real paste, ticks almost nothing', () => {
    const { rows } = parseRosterPaste([...REAL_JUNK, ...REAL_PLAYERS].join('\n'));
    const ticked = rows.filter((r) => r.confidence === 'ok').map((r) => r.name);
    // Every ticked row is a real person; no page furniture slips through.
    for (const name of ticked) expect(REAL_PLAYERS, `${name} was ticked`).toContain(name);
  });
});

describe('isNotAName (server guard)', () => {
  it('lets real names through, including the awkward ones', () => {
    for (const n of [...REAL_PLAYERS, "Sarah O'Connor-Smith", 'Jean-Luc de la Cruz', 'Ng Wei']) {
      expect(isNotAName(n), n).toBeNull();
    }
  });

  it('refuses what can never be a name', () => {
    expect(isNotAName('robinmcastellano@example.com')).toMatch(/email/);
    expect(isNotAName('206-555-0191')).toMatch(/phone/);
    expect(isNotAName('https://topdoglive.com/team')).toMatch(/web address/);
    expect(isNotAName('8/31/2026 - 5/3/2027')).toMatch(/date/);
    expect(isNotAName('   ')).toBeTruthy();
  });

  it('still allows a row the captain deliberately unticked back in', () => {
    // "suspect" in the preview is a nudge, not a ban — the endpoint must accept
    // it if the captain insists, or overruling would silently do nothing.
    expect(isNotAName('Calendar')).toBeNull();
    expect(isNotAName('Lessons')).toBeNull();
  });
});

describe('shapes captains actually paste', () => {
  it('flips "Last, First" instead of importing everyone by surname', () => {
    const { rows, warnings } = parseRosterPaste('Castellano, Robin\nKowalski, Dana\nHo, Mi J');
    expect(rows.map((r) => r.name)).toEqual(['Robin Castellano', 'Dana Kowalski', 'Mi J Ho']);
    expect(rows.every((r) => r.confidence === 'ok')).toBe(true);
    expect(warnings.join(' ')).toMatch(/Last, First/);
  });

  it('leaves "First Last, email, rating" alone', () => {
    const { rows, warnings } = parseRosterPaste('Robin Castellano, robin@example.com, 2.5');
    expect(rows[0]).toMatchObject({
      name: 'Robin Castellano',
      email: 'robin@example.com',
      rating: 2.5,
    });
    expect(warnings.join(' ')).not.toMatch(/Last, First/);
  });

  it('reads "Last, First" with the rest of the columns still attached', () => {
    const { rows } = parseRosterPaste('Castellano, Robin, robin@example.com, 925-555-0142, 2.5');
    expect(rows[0]).toMatchObject({
      name: 'Robin Castellano',
      email: 'robin@example.com',
      phone: '925-555-0142',
      rating: 2.5,
    });
  });

  it('picks up a phone in any column and any shape', () => {
    expect(parseRosterPaste('Dana Kowalski, (925) 555-0142').rows[0].phone).toBe('(925) 555-0142');
    expect(parseRosterPaste('Dana Kowalski, 925.555.0142, k@x.com').rows[0].phone).toBe('925.555.0142');
    expect(parseRosterPaste('Dana Kowalski, k@x.com, 3.5').rows[0].phone).toBeNull();
  });

  it('does not mistake a rating or a name for a phone number', () => {
    expect(parseRosterPaste('Dana Kowalski, 3.5').rows[0].phone).toBeNull();
    expect(parseRosterPaste('Dana Kowalski, 3.5').rows[0].rating).toBe(3.5);
  });
});
