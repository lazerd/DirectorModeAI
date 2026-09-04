import { describe, it, expect } from 'vitest';
import { parseRosterPaste, isNotAName, MAX_ROSTER_ROWS } from './rosterPaste';

/** Lines lifted verbatim from the 2026-09-03 EBWT C paste that created 240 rows. */
const REAL_JUNK = [
  'Megan Sullivan   Help  Search',
  'Lessons',
  'Courts/ Reservations',
  'Activity Schedule',
  'Find A Tournament',
  'Meet Players',
  'Calendar',
  'Standings Schedule Availability Practices New QR Code Player Standings Results Print',
  'Sleepy Hollow S&T 18+ C',
  'Click to update',
  'Captain',
  '206-930-8791',
  'meganmariasullivan@gmail.com',
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

/** Real EBWT C players, from the master roster CSV. These must survive. */
const REAL_PLAYERS = [
  'Megan Sullivan',
  'Karen Yoo',
  'Jennifer Walker',
  'Ariel Kurland',
  'Caedmon Patalano',
  'Hedieh Haghighi',
  'Michaela M Katari',
  'Lisa San Vicente',
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
      ['Sandra Fox', 'Team Contact', 'Elaine Hackenkamp', 'Team Contact'].join('\n'),
    );
    const contact = rows.find((r) => r.name === 'Team Contact');
    expect(contact?.confidence).toBe('suspect');
    expect(contact?.reason).toMatch(/more than once/);
    expect(rows.find((r) => r.name === 'Sandra Fox')?.confidence).toBe('ok');
  });

  it('parses the documented "Name, email, rating" line', () => {
    const { rows } = parseRosterPaste('Karen Yoo, karen@example.com, 3.5');
    expect(rows[0]).toMatchObject({
      name: 'Karen Yoo',
      email: 'karen@example.com',
      rating: 3.5,
      confidence: 'ok',
    });
  });

  it('reads a spreadsheet paste with tabs', () => {
    const { rows } = parseRosterPaste('Jenna King\tjenna@example.com\t3.0');
    expect(rows[0]).toMatchObject({ name: 'Jenna King', email: 'jenna@example.com', rating: 3.0 });
  });

  it('takes the email and rating from any column', () => {
    const { rows } = parseRosterPaste('Blair Halsey, 3.5, blair@example.com');
    expect(rows[0]).toMatchObject({ email: 'blair@example.com', rating: 3.5 });
  });

  it('refuses a rating outside the NTRP range instead of storing it', () => {
    // A win-loss column of 8-4 or a WTN of 31 must not become an NTRP rating.
    expect(parseRosterPaste('Emily Stein, 31').rows[0].rating).toBeNull();
    expect(parseRosterPaste('Emily Stein, 8').rows[0].rating).toBeNull();
  });

  it('warns when the paste is page-sized', () => {
    const many = Array.from({ length: 90 }, (_, i) => `Player Number${i}`).join('\n');
    const { warnings } = parseRosterPaste(many);
    expect(warnings.join(' ')).toMatch(/more than a team usually has/);
  });

  it('warns about the unticked lines', () => {
    const { warnings } = parseRosterPaste(['Karen Yoo', 'Calendar', 'Lessons'].join('\n'));
    expect(warnings.join(' ')).toMatch(/don't look like names/);
  });

  it('caps a runaway paste', () => {
    const huge = Array.from({ length: 400 }, (_, i) => `Firstname Lastname${i}`).join('\n');
    const { rows, warnings } = parseRosterPaste(huge);
    expect(rows).toHaveLength(MAX_ROSTER_ROWS);
    expect(warnings.join(' ')).toMatch(/first 200 lines/);
  });

  it('collapses the same name pasted twice', () => {
    const { rows } = parseRosterPaste('Karen Yoo\nKaren Yoo');
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
    expect(isNotAName('meganmariasullivan@gmail.com')).toMatch(/email/);
    expect(isNotAName('206-930-8791')).toMatch(/phone/);
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
    const { rows, warnings } = parseRosterPaste('Sullivan, Megan\nYoo, Karen\nLe, Vi D');
    expect(rows.map((r) => r.name)).toEqual(['Megan Sullivan', 'Karen Yoo', 'Vi D Le']);
    expect(rows.every((r) => r.confidence === 'ok')).toBe(true);
    expect(warnings.join(' ')).toMatch(/Last, First/);
  });

  it('leaves "First Last, email, rating" alone', () => {
    const { rows, warnings } = parseRosterPaste('Megan Sullivan, megan@example.com, 2.5');
    expect(rows[0]).toMatchObject({
      name: 'Megan Sullivan',
      email: 'megan@example.com',
      rating: 2.5,
    });
    expect(warnings.join(' ')).not.toMatch(/Last, First/);
  });

  it('reads "Last, First" with the rest of the columns still attached', () => {
    const { rows } = parseRosterPaste('Sullivan, Megan, megan@example.com, 925-788-8058, 2.5');
    expect(rows[0]).toMatchObject({
      name: 'Megan Sullivan',
      email: 'megan@example.com',
      phone: '925-788-8058',
      rating: 2.5,
    });
  });

  it('picks up a phone in any column and any shape', () => {
    expect(parseRosterPaste('Karen Yoo, (925) 788-8058').rows[0].phone).toBe('(925) 788-8058');
    expect(parseRosterPaste('Karen Yoo, 925.788.8058, k@x.com').rows[0].phone).toBe('925.788.8058');
    expect(parseRosterPaste('Karen Yoo, k@x.com, 3.5').rows[0].phone).toBeNull();
  });

  it('does not mistake a rating or a name for a phone number', () => {
    expect(parseRosterPaste('Karen Yoo, 3.5').rows[0].phone).toBeNull();
    expect(parseRosterPaste('Karen Yoo, 3.5').rows[0].rating).toBe(3.5);
  });
});
