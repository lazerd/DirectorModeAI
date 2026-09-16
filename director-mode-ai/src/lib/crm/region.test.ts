/**
 * The region backfill.
 *
 * These cases are the real strings in crm_orgs.notes after
 * scripts/import-dca.mjs ran: 272 East, 82 Central, 32 West, 16 International
 * and 117 that say the region was not recorded. The SQL in
 * supabase/migrations/crm_region.sql uses the same pattern, so a change to one
 * that is not made to the other shows up here as a region that stops matching.
 */

import { describe, expect, it } from 'vitest';
import { DCA_REGIONS, regionFromNotes, regionOf, regionsPresent } from './region';

const REAL_NOTE = (region: string) =>
  `DCA ${region} region. From the members-only directory, scraped 2026-06-29. No contact has been approached yet.`;

describe('regionFromNotes', () => {
  it('pulls every DCA region out of the note the import wrote', () => {
    for (const r of DCA_REGIONS) {
      expect(regionFromNotes(REAL_NOTE(r))).toBe(r);
    }
  });

  it('leaves the 117 clubs with no region recorded alone', () => {
    const note =
      'DCA member club (region not recorded). From the members-only directory, scraped 2026-06-29. No contact has been approached yet.';
    expect(regionFromNotes(note)).toBeNull();
  });

  it('is null for notes that are not from the import at all', () => {
    expect(regionFromNotes(null)).toBeNull();
    expect(regionFromNotes(undefined)).toBeNull();
    expect(regionFromNotes('')).toBeNull();
    expect(regionFromNotes('Met the pro at the DCA conference. West coast club.')).toBeNull();
    // A region word without the sentence shape is not a region.
    expect(regionFromNotes('They are in the East')).toBeNull();
  });

  it('title-cases, so the migration initcap() and this agree', () => {
    expect(regionFromNotes('DCA east region.')).toBe('East');
    expect(regionFromNotes('DCA WEST region.')).toBe('West');
  });

  it('does not match a sentence that only mentions the word region', () => {
    expect(regionFromNotes('Their region is competitive.')).toBeNull();
  });
});

describe('regionOf', () => {
  it('prefers the column', () => {
    expect(regionOf({ region: 'West', notes: REAL_NOTE('East') })).toBe('West');
  });

  it('falls back to the note for a row written before the column existed', () => {
    expect(regionOf({ region: null, notes: REAL_NOTE('Central') })).toBe('Central');
    expect(regionOf({ notes: REAL_NOTE('East') })).toBe('East');
  });

  it('treats an empty column as no column', () => {
    expect(regionOf({ region: '   ', notes: REAL_NOTE('West') })).toBe('West');
  });

  it('is null when there is nothing to go on', () => {
    expect(regionOf({ region: null, notes: null })).toBeNull();
  });
});

describe('regionsPresent', () => {
  it('lists only the regions that are actually there, in DCA order', () => {
    const orgs = [
      { region: 'West', notes: null },
      { region: 'East', notes: null },
      { region: null, notes: REAL_NOTE('East') },
      { region: null, notes: null },
    ];
    expect(regionsPresent(orgs)).toEqual(['East', 'West']);
  });

  it('keeps a region a rep typed by hand, after the known ones', () => {
    const orgs = [{ region: 'Pacific Northwest', notes: null }, { region: 'East', notes: null }];
    expect(regionsPresent(orgs)).toEqual(['East', 'Pacific Northwest']);
  });

  it('is empty when nothing has a region', () => {
    expect(regionsPresent([{ region: null, notes: null }])).toEqual([]);
  });
});
