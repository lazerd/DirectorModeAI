import { describe, it, expect } from 'vitest';
import {
  blockProgramCourts,
  clearProgramBlocks,
  describeBlockResult,
  resyncProgramBlocks,
  type BlockableProgram,
} from './courtBlocks';

/**
 * A stand-in for the Supabase client, recording what the real one would be
 * asked to do.
 *
 * Worth the fake rather than hitting a database: what matters here is the
 * DECISIONS — how many holds, on which courts, cleared first, and what happens
 * when a court is taken — and those are invisible in a pass/fail against live
 * rows.
 */
function fakeDb(opts: {
  courts: { id: string }[];
  /** Court ids that refuse an insert, as a taken court does (23P01). */
  taken?: Set<string>;
  /** Refuse only on these dates (YYYY-MM-DD found in starts_at). */
  takenOnDates?: string[];
}) {
  const inserted: Record<string, unknown>[] = [];
  const deleted: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];

  const db = {
    from(table: string) {
      if (table === 'courts') {
        return {
          select: () => ({
            eq: () => ({
              neq: () => ({
                neq: () => ({
                  order: () => ({
                    order: () => ({ data: opts.courts }),
                  }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === 'reservations') {
        return {
          insert(row: Record<string, unknown>) {
            const courtId = row.court_id as string;
            const day = String(row.starts_at).slice(0, 10);
            const courtTaken = opts.taken?.has(courtId);
            const dateTaken = opts.takenOnDates?.some((d) => String(row.starts_at).includes(d));
            if (courtTaken || dateTaken) {
              return Promise.resolve({ error: { code: '23P01', message: 'conflict' } });
            }
            inserted.push({ ...row, _day: day });
            return Promise.resolve({ error: null });
          },
          delete: () => ({
            eq: () => ({
              eq: () => ({
                select: () => {
                  const removed = inserted.splice(0, inserted.length);
                  deleted.push(...removed);
                  return Promise.resolve({ data: removed.map((_, i) => ({ id: `r${i}` })) });
                },
              }),
            }),
          }),
        };
      }
      if (table === 'club_programs') {
        return {
          update(patch: Record<string, unknown>) {
            updates.push(patch);
            return { eq: () => Promise.resolve({ error: null }) };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };

  return { db: db as never, inserted, deleted, updates };
}

/** A Tue/Thu class over three weeks: 6 meetings. */
const program: BlockableProgram = {
  id: 'p1',
  club_id: 'c1',
  title: 'After-School Juniors',
  range_start: '2026-09-15',
  range_end: '2026-10-01',
  days_of_week: [2, 4],
  exclusions: [],
  time_start: '15:30',
  time_end: '17:00',
  court_count: 2,
  blocks_courts: true,
};

const TZ = 'America/Los_Angeles';
const courts = [{ id: 'ct1' }, { id: 'ct2' }, { id: 'ct3' }];

describe('blockProgramCourts', () => {
  it('holds court_count courts on every meeting date', async () => {
    const { db, inserted } = fakeDb({ courts });
    const r = await blockProgramCourts(db, program, { timeZone: TZ, createdBy: 'u1' });

    // 6 meetings x 2 courts.
    expect(r.blocked).toBe(12);
    expect(inserted).toHaveLength(12);
    expect(r.courtsUsed).toBe(2);
    expect(r.clashes).toEqual([]);
    expect(r.unmetDates).toEqual([]);
  });

  it('takes the first free courts in order and stops at what the class needs', async () => {
    const { db, inserted } = fakeDb({ courts });
    await blockProgramCourts(db, program, { timeZone: TZ, createdBy: 'u1' });
    const onFirstDay = inserted.filter((r) => r._day === '2026-09-15');
    expect(onFirstDay.map((r) => r.court_id)).toEqual(['ct1', 'ct2']);
    // Never grabs a third court for a two-court class.
    expect(onFirstDay).toHaveLength(2);
  });

  it('attributes every hold to the class so it can be removed as a set', async () => {
    const { db, inserted } = fakeDb({ courts });
    await blockProgramCourts(db, program, { timeZone: TZ, createdBy: 'u1' });
    expect(inserted.every((r) => r.source === 'programs' && r.source_id === 'p1')).toBe(true);
  });

  it('skips the dates the class skips', async () => {
    const { db, inserted } = fakeDb({ courts });
    const r = await blockProgramCourts(
      db,
      { ...program, exclusions: ['2026-09-17'] },
      { timeZone: TZ, createdBy: 'u1' },
    );
    expect(r.blocked).toBe(10);
    expect(inserted.some((x) => x._day === '2026-09-17')).toBe(false);
  });

  it('clears the old holds first, so running it twice is a rebuild', async () => {
    const { db, inserted } = fakeDb({ courts });
    await blockProgramCourts(db, program, { timeZone: TZ, createdBy: 'u1' });
    const first = inserted.length;
    await blockProgramCourts(db, program, { timeZone: TZ, createdBy: 'u1' });
    // Not 24. Diffing "which meetings moved" is where this goes wrong; a
    // rebuild cannot leave a ghost hold behind.
    expect(inserted.length).toBe(first);
  });

  it('reports getting fewer courts than the class needs, rather than pretending', async () => {
    // Only one court in the whole club, for a class that needs two.
    const { db } = fakeDb({ courts: [{ id: 'ct1' }] });
    const r = await blockProgramCourts(db, program, { timeZone: TZ, createdBy: 'u1' });
    expect(r.blocked).toBe(6);
    expect(r.clashes).toHaveLength(6);
    expect(r.clashes[0]).toMatchObject({ wanted: 2, got: 1 });
    expect(r.unmetDates).toEqual([]);
  });

  it('names the dates it could not hold at all', async () => {
    const { db } = fakeDb({ courts, taken: new Set(['ct1', 'ct2', 'ct3']) });
    const r = await blockProgramCourts(db, program, { timeZone: TZ, createdBy: 'u1' });
    expect(r.blocked).toBe(0);
    expect(r.unmetDates).toHaveLength(6);
  });

  it('holds what it can when one date is busy and the rest are free', async () => {
    const { db } = fakeDb({ courts, takenOnDates: ['2026-09-22'] });
    const r = await blockProgramCourts(db, program, { timeZone: TZ, createdBy: 'u1' });
    expect(r.blocked).toBe(10);
    expect(r.unmetDates).toEqual(['2026-09-22']);
  });

  it('does nothing at all without a court count', async () => {
    // Guessing 1 would be worse than refusing: a class that needs three courts
    // and holds one looks handled and is not.
    const { db, inserted } = fakeDb({ courts });
    const r = await blockProgramCourts(
      db,
      { ...program, court_count: null },
      { timeZone: TZ, createdBy: 'u1' },
    );
    expect(r).toEqual({ blocked: 0, clashes: [], unmetDates: [], courtsUsed: 0 });
    expect(inserted).toHaveLength(0);
  });

  it('stamps courts_blocked_at so the editor can say the sheet is in step', async () => {
    const { db, updates } = fakeDb({ courts });
    await blockProgramCourts(db, program, { timeZone: TZ, createdBy: 'u1' });
    expect(updates.some((u) => typeof u.courts_blocked_at === 'string')).toBe(true);
  });

  it('writes the club-local time, not the server’s', async () => {
    const { db, inserted } = fakeDb({ courts });
    await blockProgramCourts(db, program, { timeZone: TZ, createdBy: 'u1' });
    // 15:30 Pacific on 2026-09-15 (PDT, UTC-7) is 22:30Z the same day. A naive
    // implementation writes 15:30Z and blocks the courts at 8:30am.
    const first = inserted.find((r) => r._day === '2026-09-15');
    expect(String(first?.starts_at)).toBe('2026-09-15T22:30:00.000Z');
  });
});

describe('clearProgramBlocks', () => {
  it('removes every hold the class owns and says how many', async () => {
    const { db } = fakeDb({ courts });
    await blockProgramCourts(db, program, { timeZone: TZ, createdBy: 'u1' });
    const removed = await clearProgramBlocks(db, 'p1');
    expect(removed).toBe(12);
  });
});

describe('resyncProgramBlocks', () => {
  it('does nothing for a class that is not holding courts', async () => {
    const { db, inserted } = fakeDb({ courts });
    const r = await resyncProgramBlocks(
      db,
      { ...program, blocks_courts: false },
      { timeZone: TZ, createdBy: 'u1' },
    );
    expect(r).toBeNull();
    expect(inserted).toHaveLength(0);
  });

  it('rebuilds for a class that is', async () => {
    const { db } = fakeDb({ courts });
    const r = await resyncProgramBlocks(db, program, { timeZone: TZ, createdBy: 'u1' });
    expect(r?.blocked).toBe(12);
  });
});

describe('describeBlockResult', () => {
  it('says what happened in one sentence', () => {
    expect(
      describeBlockResult({ blocked: 12, clashes: [], unmetDates: [], courtsUsed: 2 }),
    ).toBe('Holding 2 courts across 12 slots.');
  });

  it('owns up to the dates it could not take', () => {
    const s = describeBlockResult({
      blocked: 10,
      clashes: [{ date: '2026-09-22', wanted: 2, got: 1 }],
      unmetDates: ['2026-09-24'],
      courtsUsed: 2,
    });
    expect(s).toMatch(/1 date has no free court at all/);
    expect(s).toMatch(/1 date got fewer courts/);
  });

  it('has something to say when there is nothing to hold', () => {
    expect(describeBlockResult({ blocked: 0, clashes: [], unmetDates: [], courtsUsed: 0 })).toBe(
      'No dates to hold.',
    );
  });
});
