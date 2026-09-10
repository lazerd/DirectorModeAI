import { describe, it, expect } from 'vitest';
import { parseOpponentPaste, sameDivision } from './opponentPaste';

/**
 * Fictional rows shaped exactly like the Fall 2026 East Bay / Tri-Valley
 * captain contact list, tab-separated the way Excel puts them on the
 * clipboard — including the cells Excel wraps in quotes and breaks across
 * lines. Names, emails, phones (555-01xx) and USTA numbers are all made up.
 */
const REAL = [
  'Fall 2026 East Bay/Tri-Valley - Captain Contact List',
  'Team ID\tTeam Name/Program\tDivision\tCaptain Name\tUSTA #\tSafe Play Exp.\tEmail\tPhone',
  '5083590101\tRidgeline Tennis\t10U Green Ball\tArjun Mehta\t912345678\t6/7/2027\t"ridgelinetennis@example.com',
  '"\t"925-555-0101',
  '"',
  '5083590102\tCanyon Trail Park\t10U Green Ball\tMarcus Webber\t2020000549\t7/18/27\tcoachwebber@example.com\t"510-555-0102',
  '"',
  '5083590103\tHillcrest Swim & Tennis Club\t10U Green Ball\tJordan Hale\t10800042\t1/23/27\tjordan@hillcrestclub.example.com\t925-555-0158\tAlex Viktor Demchenko\t2004500021\t2/3/2027\talex_dv123@example.com\t\tNina Castellanos\t2000100694\t12/17/2026\tncastellanos1@example.com\t858-555-0133',
  '5083590104\tLakeview Country Club\t10U Green Ball\tThomas Reilly\t11600534\t12/12/26\tthomas@lakeviewcc.example.com\t925-555-0109\tAnna Marie Delgado\t2003500172\t11/16/26\tdelgado.tennis@example.com\t925-555-0160\tRonan Fairley\t2019400655\t1/29/27\tronan@lakeviewcc.example.com\t510-555-0132',
  '5083590105\tSummit Elite Tennis\t12U Yellow Ball\tAdi Rosenfeld\t2018800452\t1/30/2027\tsummitelitetennis@example.com\t510-555-0199',
].join('\n');

const parse = (opts = {}) => parseOpponentPaste(REAL, opts);

describe('parseOpponentPaste', () => {
  it('ignores the title and header rows without complaining', () => {
    expect(parse().rows.map((r) => r.teamId)).toEqual([
      '5083590101',
      '5083590102',
      '5083590103',
      '5083590104',
      '5083590105',
    ]);
  });

  it("rejoins Excel's quote-wrapped cells that break across lines", () => {
    const ridgeline = parse().rows[0];
    expect(ridgeline.teamName).toBe('Ridgeline Tennis');
    expect(ridgeline.captains[0].email).toBe('ridgelinetennis@example.com');
    expect(ridgeline.captains[0].phone).toBe('925-555-0101');
  });

  it('reads all three captains off a wide row', () => {
    const hc = parse().rows.find((r) => r.teamId === '5083590103')!;
    expect(hc.captains.map((c) => c.name)).toEqual([
      'Jordan Hale',
      'Alex Viktor Demchenko',
      'Nina Castellanos',
    ]);
  });

  it('keeps every captain with their own USTA number and Safe Play date', () => {
    const lakeview = parse().rows.find((r) => r.teamId === '5083590104')!;
    expect(lakeview.captains[1]).toEqual({
      name: 'Anna Marie Delgado',
      ustaNumber: '2003500172',
      safePlayExpires: '11/16/26',
      email: 'delgado.tennis@example.com',
      phone: '925-555-0160',
    });
  });

  it('does NOT shift the next captain up when one has no phone', () => {
    // Alex Demchenko has an email and an empty phone cell. A fixed 5-wide
    // slice would hand Nina Castellanos's name to Alex's phone field.
    const hc = parse().rows.find((r) => r.teamId === '5083590103')!;
    const alex = hc.captains[1];
    expect(alex.email).toBe('alex_dv123@example.com');
    expect(alex.phone).toBeNull();
    expect(hc.captains[2].phone).toBe('858-555-0133');
  });

  it('never mistakes a USTA number for a phone number', () => {
    const hc = parse().rows.find((r) => r.teamId === '5083590103')!;
    expect(hc.captains[0].ustaNumber).toBe('10800042');
    expect(hc.captains[0].phone).toBe('925-555-0158');
  });

  it('flags the importing captain’s own team rather than importing it', () => {
    const r = parse({ ownTeamId: '5083590103' });
    expect(r.rows.find((x) => x.teamId === '5083590103')!.isSelf).toBe(true);
    expect(r.warnings.join(' ')).toMatch(/your own team/);
  });

  it('marks rows from another division so they can be unticked', () => {
    const r = parse({ division: '10U Green Ball' });
    const summit = r.rows.find((x) => x.teamId === '5083590105')!;
    expect(summit.otherDivision).toBe(true);
    expect(r.rows.find((x) => x.teamId === '5083590102')!.otherDivision).toBeUndefined();
  });

  it('handles a paste that arrived as runs of spaces instead of tabs', () => {
    const spaced =
      '5083590106    Oakmont Country Club    10U Green Ball    Brent Halvorsen    10500133    8/13/2027    bhalvorsen@oakmontcc.example.org    925-555-0167';
    const r = parseOpponentPaste(spaced);
    expect(r.rows[0].teamName).toBe('Oakmont Country Club');
    expect(r.rows[0].captains[0].email).toBe('bhalvorsen@oakmontcc.example.org');
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

describe('duplicate captains on one row', () => {
  /**
   * Shaped like a real row where one program names the same person in two of
   * its five captain columns. Left as two entries, the import died with
   * "ON CONFLICT DO UPDATE command cannot affect row a second time" and the
   * whole 46-team paste wrote nothing.
   */
  const LIFETIME =
    '5083590107\tLifetime Tennis\t10U Green Ball\tSamuel Tesfaye\t2010600965\t1/27/2027\tlifetimetennis@example.com\t980-555-0187\tSamuel Tesfaye\t2010600965\t1/27/2027\tlifetimetennis@example.com\t980-555-0187';

  it('lists the person once', () => {
    const r = parseOpponentPaste(LIFETIME);
    expect(r.rows[0].captains).toHaveLength(1);
    expect(r.rows[0].captains[0].name).toBe('Samuel Tesfaye');
  });

  it('merges details rather than keeping only the first copy', () => {
    // One club lists someone with an email in one column and a phone in
    // another; first-wins would drop whichever came second.
    const split =
      '5083590108\tSplit Contact Club\t10U Green Ball\tJamie Lee\t2010600966\t1/27/2027\tjamie@example.com\t\tJamie Lee\t\t\t\t925-555-0148';
    const c = parseOpponentPaste(split).rows[0].captains;
    expect(c).toHaveLength(1);
    expect(c[0].email).toBe('jamie@example.com');
    expect(c[0].phone).toBe('925-555-0148');
  });

  it('keeps two genuinely different people apart', () => {
    const two =
      '5083590104\tLakeview\t10U Green Ball\tThomas Reilly\t11600534\t12/12/26\tthomas@lakeviewcc.example.com\t925-555-0109\tRonan Fairley\t2019400655\t1/29/27\tronan@lakeviewcc.example.com\t510-555-0132';
    expect(parseOpponentPaste(two).rows[0].captains).toHaveLength(2);
  });
});
