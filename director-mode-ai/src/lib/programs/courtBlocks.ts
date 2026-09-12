/**
 * Putting a class onto the court sheet.
 *
 * Online court booking opened a hole: a class lived in club_programs and
 * nowhere else, so nothing stopped somebody booking court 1 at 3:30 on Tuesday
 * on top of the after-school juniors. Blocking closes it by writing the class's
 * meetings into `reservations` — the one table the no_double_booking EXCLUDE
 * constraint protects, so once held, a class cannot be booked over through any
 * path, including a buggy one.
 *
 * REBUILD, NOT PATCH. Every time a class's dates change, its blocks are thrown
 * away and remade from the current dates. Diffing "which meetings moved" is
 * where this kind of code goes wrong — an off-by-one leaves a ghost block on a
 * court nobody can use and no screen explains. Cancelled-then-recreated is
 * idempotent and can be reasoned about.
 *
 * PARTIAL SUCCESS IS NORMAL and is reported, never swallowed. A club adding
 * blocking to a class that has been running for a month will hit dates where
 * somebody already has the court, and the honest answer is "held 14 of 16, here
 * are the two that clash" — not a silent 500, and not quietly stealing a court
 * out from under an existing booking.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { localToUtc } from '@/lib/courtsheet/timezones';
import { programSessions, type ProgramSchedule } from './sessions';

export type BlockableProgram = ProgramSchedule & {
  id: string;
  club_id: string;
  title: string;
  time_start: string;
  time_end: string;
  court_count: number | null;
  blocks_courts: boolean;
};

export type BlockResult = {
  /** Meetings now held on the court sheet. */
  blocked: number;
  /** Court-slots that could not be taken, because something else has them. */
  clashes: { date: string; wanted: number; got: number }[];
  /** Meetings the class needs but has no court for at all. */
  unmetDates: string[];
  courtsUsed: number;
};

/**
 * Drop every reservation this class owns.
 *
 * Deletes rather than cancels: a cancelled row is a record that somebody's
 * plans changed, and these were never anybody's plans — they are a projection
 * of the class's dates. Leaving hundreds of cancelled rows behind every date
 * edit would bury the real cancellations in the audit trail.
 */
export async function clearProgramBlocks(
  db: SupabaseClient,
  programId: string,
): Promise<number> {
  const { data } = await db
    .from('reservations')
    .delete()
    .eq('source', 'programs')
    .eq('source_id', programId)
    .select('id');
  return (data as { id: string }[] | null)?.length ?? 0;
}

/**
 * Hold the courts this class needs, for every date it meets.
 *
 * Courts are chosen by display order and taken greedily per date: a class
 * needing 3 courts gets the first 3 free that day, not the same 3 every week.
 * A club cares that the class has room, not which numbers.
 */
export async function blockProgramCourts(
  db: SupabaseClient,
  program: BlockableProgram,
  opts: { timeZone: string; createdBy: string },
): Promise<BlockResult> {
  const need = program.court_count ?? 0;
  if (need <= 0) {
    return { blocked: 0, clashes: [], unmetDates: [], courtsUsed: 0 };
  }

  // Start clean, so this is a rebuild and running it twice changes nothing.
  await clearProgramBlocks(db, program.id);

  const { data: courtRows } = await db
    .from('courts')
    .select('id, name, number, status')
    .eq('club_id', program.club_id)
    .neq('status', 'hidden')
    .neq('status', 'maintenance')
    .order('display_order')
    .order('number');
  const courts = (courtRows as { id: string }[] | null) ?? [];

  const sessions = programSessions(program, opts.timeZone);
  const clashes: BlockResult['clashes'] = [];
  const unmetDates: string[] = [];
  let blocked = 0;
  let maxCourtsOnADate = 0;

  for (const date of sessions.dates) {
    const startsAt = localToUtc(date, program.time_start.slice(0, 5), opts.timeZone);
    const endsAt = localToUtc(date, program.time_end.slice(0, 5), opts.timeZone);

    let got = 0;
    for (const court of courts) {
      if (got >= need) break;

      const { error } = await db.from('reservations').insert({
        club_id: program.club_id,
        court_id: court.id,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        type: 'camp',
        source: 'programs',
        source_id: program.id,
        title: program.title,
        status: 'confirmed',
        created_by: opts.createdBy,
        meta: { program_id: program.id, program_title: program.title },
      });

      if (!error) {
        got += 1;
        blocked += 1;
        continue;
      }
      // 23P01 is the exclusion violation: that court is taken at that time.
      // Any other error is real and stops the attempt for this date rather
      // than being retried against every court in the club.
      if ((error as { code?: string }).code !== '23P01') break;
    }

    maxCourtsOnADate = Math.max(maxCourtsOnADate, got);
    if (got === 0) unmetDates.push(date);
    else if (got < need) clashes.push({ date, wanted: need, got });
  }

  await db
    .from('club_programs')
    .update({ courts_blocked_at: new Date().toISOString() })
    .eq('id', program.id);

  return { blocked, clashes, unmetDates, courtsUsed: maxCourtsOnADate };
}

/**
 * Re-hold a class's courts after its dates or times changed — but only if it
 * was already holding them.
 *
 * Called from the class PATCH route so a skip date does two things at once:
 * the public page loses the date, and the court sheet gives the court back.
 * That pairing is the point. A director who removes Thanksgiving week and then
 * finds the courts still blocked has not been saved any work.
 *
 * Deliberately silent about failure to the caller's happy path: the save
 * already succeeded, and a clash here is information, not a reason to reject
 * the edit.
 */
export async function resyncProgramBlocks(
  db: SupabaseClient,
  program: BlockableProgram,
  opts: { timeZone: string; createdBy: string },
): Promise<BlockResult | null> {
  if (!program.blocks_courts) return null;
  try {
    return await blockProgramCourts(db, program, opts);
  } catch {
    return null;
  }
}

/** A sentence about the result, for the one screen that has to explain it. */
export function describeBlockResult(result: BlockResult): string {
  if (result.blocked === 0 && result.unmetDates.length === 0) {
    return 'No dates to hold.';
  }
  const parts = [`Holding ${result.blocked} court slots`];
  if (result.courtsUsed > 0) {
    parts[0] = `Holding ${result.courtsUsed} ${result.courtsUsed === 1 ? 'court' : 'courts'} across ${
      result.blocked
    } slots`;
  }
  if (result.unmetDates.length) {
    parts.push(
      `${result.unmetDates.length} ${
        result.unmetDates.length === 1 ? 'date has' : 'dates have'
      } no free court at all`,
    );
  }
  if (result.clashes.length) {
    parts.push(
      `${result.clashes.length} ${
        result.clashes.length === 1 ? 'date got' : 'dates got'
      } fewer courts than the class needs`,
    );
  }
  return `${parts.join(' · ')}.`;
}
