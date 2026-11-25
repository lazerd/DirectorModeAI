import { describe, it, expect } from 'vitest';
import { parseCsv, parseRoster, matchMember, buildCharges, chargesCsv, proSummary, CE_HEADER, type LessonLine } from './charges';

const ROSTER_CSV = `Member Number,Last Name,First Name,Status
ALE010,Alvarez,Maria,Active
BRO220,Brown,Sam,Active
BRO221,Brown,Samantha,Active
CHE300,Chen,Wei,Active
DAV410,"Davis, Jr",Tom,Active
`;

const setup = { area: 'Tennis', items: { private: 'Member Tennis Lessons', semi: 'Member Tennis Lessons', clinic: 'Member Clinics' }, employees: { Carrie: 'Smith, Carrie' }, taxExempt: true };
const line = (o: Partial<LessonLine>): LessonLine => ({ date: '2026-11-18', student: 'Maria Alvarez', pro: 'Carrie', kind: 'private', minutes: 60, qty: 1, price: 110, ...o });

describe('clubessential charges', () => {
  it('parses quoted CSV', () => {
    expect(parseCsv('a,"b, c","d ""e"""\r\n1,2,3')).toEqual([['a', 'b, c', 'd "e"'], ['1', '2', '3']]);
  });
  it('reads a member export', () => {
    const r = parseRoster(ROSTER_CSV);
    expect(r.error).toBeUndefined();
    expect(r.members).toHaveLength(5);
    expect(r.members[0]).toMatchObject({ memberNumber: 'ALE010', full: 'Maria Alvarez' });
  });
  it('matches exactly one member, never guesses', () => {
    const { members } = parseRoster(ROSTER_CSV);
    expect('member' in matchMember('maria alvarez', members)).toBe(true);
    expect('member' in matchMember('Alvarez, Maria', members)).toBe(true);
    const sam = matchMember('Sam Brown', members);
    expect('member' in sam && sam.member.memberNumber).toBe('BRO220');
    const samm = matchMember('Sammy Brown', members);
    expect('member' in samm).toBe(false);
    const wei = matchMember('Wei', members);
    expect('member' in wei).toBe(false);
    expect(matchMember('Nobody Here', members)).toMatchObject({ reason: expect.stringContaining('No member') });
  });
  it('builds the import file in the template columns', () => {
    const { members } = parseRoster(ROSTER_CSV);
    const { charges, needsYou } = buildCharges([
      line({}),
      line({}), // exact duplicate
      line({ student: 'Sammy Brown', price: 60, kind: 'semi' }),
      line({ student: 'Wei Chen', kind: 'other', price: 30 }), // no item for "other"
      line({ student: 'Wei Chen', kind: 'clinic', price: 30, minutes: 90 }),
    ], members, setup);
    expect(charges).toHaveLength(2);
    expect(needsYou.map((n) => n.reason)).toEqual([
      expect.stringContaining('duplicate'),
      expect.stringContaining('Did you mean'),
      expect.stringContaining('No Clubessential item'),
    ]);
    const csv = chargesCsv(charges).split('\r\n');
    expect(csv[0]).toBe(CE_HEADER.join(','));
    expect(csv[1]).toBe('ALE010,Tennis,Member Tennis Lessons,Private lesson w/ Carrie 11/18 (60 min),1,110.00,"Smith, Carrie",1');
    expect(csv[2]).toBe('CHE300,Tennis,Member Clinics,Clinic w/ Carrie 11/18 (90 min),1,30.00,"Smith, Carrie",1');
  });
  it('totals each pro', () => {
    expect(proSummary([line({}), line({ minutes: 30, price: 60 }), line({ pro: 'Alex', price: 90 })])).toEqual([
      { pro: 'Alex', lessons: 1, hours: 1, billed: 90 },
      { pro: 'Carrie', lessons: 2, hours: 1.5, billed: 170 },
    ]);
  });
});
