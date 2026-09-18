import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  buildPlayers,
  detectMapping,
  fieldForHeader,
  normalizeMembershipStatus,
  parseCSV,
  planImport,
  summarizePlan,
  vaultColumns,
} from './csvImport';

const WA = readFileSync(path.resolve(__dirname, '../../../scripts/fixtures/wildapricot-sample.csv'), 'utf8');

describe('fieldForHeader', () => {
  it('recognises Wild Apricot headers', () => {
    expect(fieldForHeader('First name')).toBe('first_name');
    expect(fieldForHeader('Last name')).toBe('last_name');
    expect(fieldForHeader('e-Mail')).toBe('email');
    expect(fieldForHeader('Email')).toBe('email');
    expect(fieldForHeader('Mobile phone')).toBe('phone');
    expect(fieldForHeader('Cell Phone')).toBe('phone');
    expect(fieldForHeader('Membership level')).toBe('membership_level');
    expect(fieldForHeader('Membership status')).toBe('membership_status');
    expect(fieldForHeader('Member since')).toBe('member_since');
    expect(fieldForHeader('Gender')).toBe('gender');
  });
  it('recognises other common exports', () => {
    expect(fieldForHeader('Full Name')).toBe('full_name');
    expect(fieldForHeader('Email Address')).toBe('email');
    expect(fieldForHeader('NTRP Rating')).toBe('usta_rating');
    expect(fieldForHeader('DUPR')).toBe('dupr_rating');
    expect(fieldForHeader('Birth Date')).toBe('date_of_birth');
    expect(fieldForHeader('User ID')).toBeNull();
  });
});

describe('detectMapping', () => {
  it('reads a Wild Apricot export by header', () => {
    const rows = parseCSV(WA);
    const d = detectMapping(rows[0]);
    expect(d.hasHeader).toBe(true);
    expect(d.source).toBe('wildapricot');
    // "Phone" claims the phone field; "Mobile phone" is left unmapped.
    expect(d.mapping[5]).toBe('phone');
    expect(d.mapping[6]).toBeNull();
    expect(d.mapping[0]).toBeNull(); // User ID
  });

  it('still reads the old header-less template by position', () => {
    const rows = parseCSV('John Smith,john@example.com,555-123-4567,M,35,4.0,8.5,tennis,Plays doubles\n');
    const d = detectMapping(rows[0]);
    expect(d.hasHeader).toBe(false);
    expect(d.source).toBe('positional');
    const [p] = buildPlayers(rows, d.mapping, d.hasHeader);
    expect(p).toMatchObject({
      full_name: 'John Smith',
      email: 'john@example.com',
      gender: 'male',
      age: '35',
      usta_rating: '4.0',
      utr_rating: '8.5',
      primary_sport: 'tennis',
      notes: 'Plays doubles',
      valid: true,
    });
  });

  it('knows the template header row', () => {
    expect(detectMapping(['name', 'email', 'phone', 'gender', 'age', 'ntrp', 'utr', 'sport', 'notes']).source).toBe(
      'template',
    );
  });
});

describe('the Wild Apricot sample, end to end', () => {
  const rows = parseCSV(WA);
  const d = detectMapping(rows[0]);
  const players = buildPlayers(rows, d.mapping, d.hasHeader);

  it('combines first and last name and keeps membership in notes', () => {
    expect(players).toHaveLength(8);
    expect(players[0]).toMatchObject({
      full_name: 'Avery Quill',
      email: 'avery.quill@example.com',
      phone: '555-010-0101',
      gender: 'female',
      membership_status: 'active',
    });
    expect(players[0].notes).toBe('Membership: Full Member (Active) · Member since 2019-03-01');
    expect(players[4].notes).toContain('Membership: Couple, Full (Pending - Renewal)');
  });

  it('lowercases email so a re-import matches', () => {
    expect(players[2].email).toBe('celine.marrow@example.com');
    expect(players[2].membership_status).toBe('inactive');
  });

  it('plans new, updated and skipped with a readable summary', () => {
    const existing = new Map([['celine.marrow@example.com', 'vault-row-1']]);
    const plan = planImport(players, existing);
    expect(plan.inserts.map((p) => p.full_name)).toEqual([
      'Avery Quill',
      'Bram Oakshott',
      'Dov Pennywhistle',
      'Esme Tollbridge',
      'Greta Hollowell',
    ]);
    expect(plan.updates).toEqual([{ id: 'vault-row-1', player: players[2] }]);
    expect(plan.skippedNoEmail.map((p) => p.full_name)).toEqual(['Fenwick Ashgrove']);
    expect(plan.skippedDuplicateInFile).toHaveLength(1);
    expect(summarizePlan(plan)).toBe(
      '5 new, 1 updated, 1 skipped: no email, 1 skipped: email repeated in the file',
    );
  });

  it('can include people with no email when asked', () => {
    const plan = planImport(players, new Map(), { includeNoEmail: true });
    expect(plan.inserts.map((p) => p.full_name)).toContain('Fenwick Ashgrove');
  });
});

describe('membership status and columns', () => {
  it('maps the statuses the vault can hold', () => {
    expect(normalizeMembershipStatus('Active')).toBe('active');
    expect(normalizeMembershipStatus('Lapsed')).toBe('inactive');
    expect(normalizeMembershipStatus('Suspended')).toBe('inactive');
    expect(normalizeMembershipStatus('Pending - New')).toBe('guest');
    expect(normalizeMembershipStatus('Pending - Renewal')).toBe('active');
    expect(normalizeMembershipStatus('')).toBeNull();
  });

  it('never blanks a hand-entered field on update', () => {
    const rows = parseCSV(WA);
    const d = detectMapping(rows[0]);
    const [p] = buildPlayers(rows, d.mapping, d.hasHeader);
    const update = vaultColumns(p, 'update');
    expect(update).not.toHaveProperty('usta_rating');
    expect(update).not.toHaveProperty('notes');
    expect(update).not.toHaveProperty('primary_sport');
    expect(update).toMatchObject({ full_name: 'Avery Quill', membership_status: 'active' });
    const insert = vaultColumns(p, 'insert');
    expect(insert).toMatchObject({ rating_source: 'manual', primary_sport: 'tennis', usta_rating: null });
  });
});

describe('a pickleball club typing DUPR in', () => {
  const file = 'name,email,sport,dupr\nRae Ortiz,rae@example.com,pickleball,3.412\n';

  it('reads a DUPR column into the doubles rating', () => {
    const rows = parseCSV(file);
    const d = detectMapping(rows[0]);
    const [p] = buildPlayers(rows, d.mapping, d.hasHeader);
    expect(p).toMatchObject({ full_name: 'Rae Ortiz', primary_sport: 'pickleball', dupr_rating: '3.412', valid: true });
    expect(vaultColumns(p, 'insert')).toMatchObject({ dupr_doubles: 3.412 });
  });

  it('refuses a number outside DUPR\'s band — that is a UTR in the wrong column', () => {
    const rows = parseCSV('name,email,dupr\nRae Ortiz,rae@example.com,9.5\n');
    const d = detectMapping(rows[0]);
    const [p] = buildPlayers(rows, d.mapping, d.hasHeader);
    expect(p.valid).toBe(false);
    expect(p.error).toContain('DUPR');
  });
});
