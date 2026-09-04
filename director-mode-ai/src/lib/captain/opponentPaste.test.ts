import { describe, it, expect } from 'vitest';
import { parseOpponentPaste, sameDivision } from './opponentPaste';

/**
 * Verbatim rows from the Fall 2026 East Bay / Tri-Valley captain contact list,
 * tab-separated the way Excel puts them on the clipboard — including the cells
 * Excel wraps in quotes and breaks across lines.
 */
const REAL = [
  'Fall 2026 East Bay/Tri-Valley - Captain Contact List',
  'Team ID\tTeam Name/Program\tDivision\tCaptain Name\tUSTA #\tSafe Play Exp.\tEmail\tPhone',
  '5083525932\tArora Tennis\t10U Green Ball\tAkshay Arora\t919699339\t6/7/2027\t"aroratennis@yahoo.com',
  '"\t"925-699-7794',
  '"',
  '5083525640\tCanyon Trail Park\t10U Green Ball\tJeffrey Jaymot\t2020020549\t7/18/27\tcoachjaymot@gmail.com\t"510-205-6512',
  '"',
  '5083524580\tSleepy Hollow Swim & Tennis Club\t10U Green Ball\tDarrin Cohen\t10898042\t1/23/27\tdarrin@sleepyhollowclub.com\t925-788-8058\tAlex Oleksandr Pryshchepa\t2004516021\t2/3/2027\talex_pr123@yahoo.com\t\tChiara Schwab\t2000108694\t12/17/2026\tcccschwab1@yahoo.com\t858-699-8133',
  '5083525258\tMoraga Country Club\t10U Green Ball\tThomas McGee\t11697534\t12/12/26\tthomas@moragacc.com\t925-631-1909\tAnna Marie Gamboa\t2003526172\t11/16/26\tgamboa.tennis@yahoo.com\t925-785-9460\tRonan Reberac\t2019429655\t1/29/27\tronan@moragacc.com\t510-499-5732',
  '5083525256\tHit Elite Tennis\t12U Yellow Ball\tAdi Zilberstein\t2018822452\t1/30/2027\thitelitetennis@gmail.com\t510-890-9599',
].join('\n');

const parse = (opts = {}) => parseOpponentPaste(REAL, opts);

describe('parseOpponentPaste', () => {
  it('ignores the title and header rows without complaining', () => {
    expect(parse().rows.map((r) => r.teamId)).toEqual([
      '5083525932',
      '5083525640',
      '5083524580',
      '5083525258',
      '5083525256',
    ]);
  });

  it("rejoins Excel's quote-wrapped cells that break across lines", () => {
    const arora = parse().rows[0];
    expect(arora.teamName).toBe('Arora Tennis');
    expect(arora.captains[0].email).toBe('aroratennis@yahoo.com');
    expect(arora.captains[0].phone).toBe('925-699-7794');
  });

  it('reads all three captains off a wide row', () => {
    const sh = parse().rows.find((r) => r.teamId === '5083524580')!;
    expect(sh.captains.map((c) => c.name)).toEqual([
      'Darrin Cohen',
      'Alex Oleksandr Pryshchepa',
      'Chiara Schwab',
    ]);
  });

  it('keeps every captain with their own USTA number and Safe Play date', () => {
    const moraga = parse().rows.find((r) => r.teamId === '5083525258')!;
    expect(moraga.captains[1]).toEqual({
      name: 'Anna Marie Gamboa',
      ustaNumber: '2003526172',
      safePlayExpires: '11/16/26',
      email: 'gamboa.tennis@yahoo.com',
      phone: '925-785-9460',
    });
  });

  it('does NOT shift the next captain up when one has no phone', () => {
    // Alex Pryshchepa has an email and an empty phone cell. A fixed 5-wide
    // slice would hand Chiara Schwab's name to Alex's phone field.
    const sh = parse().rows.find((r) => r.teamId === '5083524580')!;
    const alex = sh.captains[1];
    expect(alex.email).toBe('alex_pr123@yahoo.com');
    expect(alex.phone).toBeNull();
    expect(sh.captains[2].phone).toBe('858-699-8133');
  });

  it('never mistakes a USTA number for a phone number', () => {
    const sh = parse().rows.find((r) => r.teamId === '5083524580')!;
    expect(sh.captains[0].ustaNumber).toBe('10898042');
    expect(sh.captains[0].phone).toBe('925-788-8058');
  });

  it('flags the importing captain’s own team rather than importing it', () => {
    const r = parse({ ownTeamId: '5083524580' });
    expect(r.rows.find((x) => x.teamId === '5083524580')!.isSelf).toBe(true);
    expect(r.warnings.join(' ')).toMatch(/your own team/);
  });

  it('marks rows from another division so they can be unticked', () => {
    const r = parse({ division: '10U Green Ball' });
    const hit = r.rows.find((x) => x.teamId === '5083525256')!;
    expect(hit.otherDivision).toBe(true);
    expect(r.rows.find((x) => x.teamId === '5083525640')!.otherDivision).toBeUndefined();
  });

  it('handles a paste that arrived as runs of spaces instead of tabs', () => {
    const spaced =
      '5083526343    Orinda Country Club    10U Green Ball    Brent DeGroot    10545133    8/13/2027    bdegroot@orindacc.org    925-864-0867';
    const r = parseOpponentPaste(spaced);
    expect(r.rows[0].teamName).toBe('Orinda Country Club');
    expect(r.rows[0].captains[0].email).toBe('bdegroot@orindacc.org');
  });

  it('says so plainly when the paste is not a contact list', () => {
    const r = parseOpponentPaste('here are the teams we play this fall');
    expect(r.rows).toEqual([]);
    expect(r.warnings[0]).toMatch(/No team rows found/);
  });

  it('never writes a duplicate team id twice', () => {
    const r = parseOpponentPaste(REAL + '\n' + REAL);
    expect(new Set(r.rows.map((x) => x.teamId)).size).toBe(r.rows.length);
  });
});

describe('sameDivision', () => {
  it('matches across the punctuation the league is inconsistent about', () => {
    expect(sameDivision('10U - Green Ball', '10U Green Ball')).toBe(true);
    expect(sameDivision('14U Yellow Intermediate', '14U Yellow Intermediate')).toBe(true);
  });

  it('keeps genuinely different divisions apart', () => {
    expect(sameDivision('10U Green Ball', '12U Yellow Ball')).toBe(false);
    expect(sameDivision('14U Advanced', '14U Yellow Intermediate')).toBe(false);
    expect(sameDivision('10U Orange Ball', '10U Green Ball')).toBe(false);
  });
});
