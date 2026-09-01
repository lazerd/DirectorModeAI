/**
 * The arithmetic behind Open Lesson Time: turning an instructor's blocked-out
 * calendar time into bookable 30 / 60 / 90-minute lessons.
 *
 * Deliberately free of any Google or database import so the booking page can
 * run exactly this code in the browser — switching between lesson lengths has
 * to be instant, and a second implementation of "what fits" is how a booking
 * page starts offering times that are already taken. The server re-runs these
 * same functions before it writes anything; this copy is for the eyes.
 *
 * All of it is pure and tested. Double-booking someone's Saturday is the
 * failure mode that loses a coach's trust permanently, so the rules that
 * prevent it are not allowed to live inside a route handler.
 */
/** Lesson lengths, in minutes. The client picks one; the window decides which fit. */
export const DEFAULT_DURATIONS = [30, 60, 90];

/** Bookings start on the half hour, measured from the window's own start. */
export const START_STEP_MIN = 30;

export const OPEN_WINDOW_DAYS = 45;

export type Range = { start: string; end: string };

const ms = (iso: string) => new Date(iso).getTime();
const iso = (t: number) => new Date(t).toISOString();
const MIN = 60_000;

/** Minutes in a range. */
export function minutesOf(r: Range): number {
  return Math.round((ms(r.end) - ms(r.start)) / MIN);
}

/**
 * What is left of a window once existing bookings are removed.
 *
 * Returns the gaps in order. A booking that covers the whole window returns
 * nothing; a booking in the middle returns the two ends.
 */
export function freeSegments(window: Range, busy: Range[]): Range[] {
  const overlapping = busy
    .filter((b) => ms(b.end) > ms(window.start) && ms(b.start) < ms(window.end))
    .sort((a, b) => ms(a.start) - ms(b.start));

  const out: Range[] = [];
  let cursor = ms(window.start);
  for (const b of overlapping) {
    const bs = Math.max(ms(b.start), ms(window.start));
    const be = Math.min(ms(b.end), ms(window.end));
    if (bs > cursor) out.push({ start: iso(cursor), end: iso(bs) });
    cursor = Math.max(cursor, be);
  }
  if (cursor < ms(window.end)) out.push({ start: iso(cursor), end: window.end });
  return out;
}

/**
 * Every start time a lesson of `durationMin` could take inside these gaps.
 *
 * Starts land on a `stepMin` grid measured from each gap's own start, so a
 * window that begins at 1:15 offers 1:15 and 1:45 rather than nothing. A start
 * is only offered if the whole lesson fits before the gap ends — this is the
 * rule that makes a 60-minute opening offer 30 and 60 but never 90.
 */
export function candidateStarts(
  free: Range[],
  durationMin: number,
  opts?: { stepMin?: number; notBefore?: string | Date },
): string[] {
  const step = (opts?.stepMin ?? START_STEP_MIN) * MIN;
  const floor = opts?.notBefore
    ? new Date(opts.notBefore).getTime()
    : Number.NEGATIVE_INFINITY;
  const need = durationMin * MIN;

  const out: string[] = [];
  for (const gap of free) {
    const gs = ms(gap.start);
    const ge = ms(gap.end);
    for (let t = gs; t + need <= ge; t += step) {
      if (t >= floor) out.push(iso(t));
    }
  }
  return out;
}

/** Which of the offered lengths fit somewhere in these gaps at all. */
export function durationsThatFit(
  free: Range[],
  durations: number[],
  opts?: { notBefore?: string | Date },
): number[] {
  return durations.filter((d) => candidateStarts(free, d, opts).length > 0);
}

/** The window minus one booking — what stays bookable on the calendar. */
export function remainingAfterBooking(window: Range, booking: Range): Range[] {
  return freeSegments(window, [booking]);
}

/** True when the requested lesson sits entirely inside free time. */
export function bookingFits(free: Range[], booking: Range): boolean {
  return free.some((g) => ms(g.start) <= ms(booking.start) && ms(g.end) >= ms(booking.end));
}

/* -------------------------------------------------- calendar reconciliation */

/** The shape ./googleCalendar returns — declared here so this module stays
 * import-free and safe to run in the browser. */
export type OpenEventLike = {
  eventId: string;
  start: string;
  end: string;
  location: string | null;
};

export type WindowRow = {
  id: string;
  google_event_id: string;
  start_time: string;
  end_time: string;
  location: string | null;
};

export type Reconciliation = {
  upserts: { google_event_id: string; start_time: string; end_time: string; location: string | null }[];
  deleteIds: string[];
  unchanged: number;
};

/**
 * Calendar events in, database rows out.
 *
 * An event that is renamed, deleted or moved is how an instructor takes their
 * time back, so the mirror has to follow it exactly — including removing
 * windows whose event is gone.
 */
export function reconcileWindows(events: OpenEventLike[], existing: WindowRow[]): Reconciliation {
  const byEvent = new Map(existing.map((w) => [w.google_event_id, w]));
  const seen = new Set<string>();
  const upserts: Reconciliation['upserts'] = [];
  let unchanged = 0;

  for (const e of events) {
    seen.add(e.eventId);
    const cur = byEvent.get(e.eventId);
    if (
      cur &&
      ms(cur.start_time) === ms(e.start) &&
      ms(cur.end_time) === ms(e.end) &&
      (cur.location || null) === e.location
    ) {
      unchanged++;
      continue;
    }
    upserts.push({
      google_event_id: e.eventId,
      start_time: e.start,
      end_time: e.end,
      location: e.location,
    });
  }

  return {
    upserts,
    deleteIds: existing.filter((w) => !seen.has(w.google_event_id)).map((w) => w.id),
    unchanged,
  };
}
