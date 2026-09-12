/**
 * Which courts are free, when, and what it costs.
 *
 * Pure over rows the caller has already fetched, so it is testable without a
 * database and cannot accidentally do I/O inside a loop over 9 courts × 28
 * slots.
 *
 * Everything here works in CLUB-LOCAL minutes past midnight. Times only become
 * instants at the edges — the caller converts when it writes a reservation.
 * Doing the arithmetic in UTC is how a 9am slot ends up offered at 2am.
 */

import {
  bookingRules,
  priceBooking,
  toHHMM,
  toMinutes,
  type PriceSegment,
  type RateCard,
} from './pricing';

export type Court = { id: string; name: string | null; number: number | null; status: string };

/** A non-cancelled claim on a court, in club-local minutes. */
export type BusyBlock = { court_id: string; startMinute: number; endMinute: number };

export type OperatingWindow = { open: string; close: string };

export type Slot = {
  /** Club-local 'HH:MM'. */
  time: string;
  startMinute: number;
  endMinute: number;
  /** Courts free for the whole duration. */
  courts: { id: string; name: string }[];
  cents: number;
  segments: PriceSegment[];
};

export type AvailabilityResult = {
  slots: Slot[];
  /** Why there is nothing to show, when there is nothing to show. */
  note: string | null;
  audience: 'member' | 'public';
  advanceDays: number;
};

const courtLabel = (c: Court): string => c.name || (c.number != null ? `Court ${c.number}` : 'Court');

/**
 * Free slots for one day.
 *
 * `slotStep` is how often a booking may start — 30 minutes, so a club is not
 * offering 8:07. `openWindows` empty means the club has not set hours, which
 * CourtSheet treats as 24/7; here that would offer 3am tennis, so a day with
 * no hours set falls back to a sane 7am–10pm and says so.
 */
export function availableSlots(opts: {
  courts: Court[];
  busy: BusyBlock[];
  openWindows: OperatingWindow[];
  rateCards: RateCard[];
  audience: 'member' | 'public';
  dayOfWeek: number;
  minutes: number;
  /**
   * Club-local minutes past midnight to treat as "now" when the requested date
   * is today; null for a future date. Stops a club offering a slot that has
   * already started.
   */
  nowMinute: number | null;
  slotStep?: number;
}): AvailabilityResult {
  const step = opts.slotStep ?? 30;
  const rules = bookingRules(opts.rateCards, opts.audience);

  const bookableCourts = opts.courts.filter((c) => c.status !== 'hidden' && c.status !== 'maintenance');
  if (bookableCourts.length === 0) {
    return { slots: [], note: 'No courts are bookable.', audience: opts.audience, advanceDays: rules.advanceDays };
  }

  const windows: OperatingWindow[] = opts.openWindows.length
    ? opts.openWindows
    : // Not 24/7: a club with no hours set should not be offering 3am tennis.
      [{ open: '07:00', close: '22:00' }];

  const busyByCourt = new Map<string, BusyBlock[]>();
  for (const b of opts.busy) {
    busyByCourt.set(b.court_id, [...(busyByCourt.get(b.court_id) ?? []), b]);
  }

  const slots: Slot[] = [];
  let anyWindowTooShort = false;

  for (const w of windows) {
    const open = toMinutes(w.open);
    const close = toMinutes(w.close);
    if (close - open < opts.minutes) {
      anyWindowTooShort = true;
      continue;
    }

    // Start on the step grid from the opening time, so a club that opens at
    // 06:30 offers 6:30 and 7:00 rather than 6:30 and 7:30.
    for (let start = open; start + opts.minutes <= close; start += step) {
      const end = start + opts.minutes;

      // A slot that has already begun is not available, and neither is one
      // starting in the next few minutes — nobody books a court for now.
      if (opts.nowMinute !== null && start <= opts.nowMinute) continue;

      const free = bookableCourts.filter((court) => {
        const blocks = busyByCourt.get(court.id) ?? [];
        // Half-open ranges, matching the no_double_booking constraint's
        // '[)' — a booking ending at 5:00 does not clash with one starting
        // at 5:00.
        return !blocks.some((b) => b.startMinute < end && start < b.endMinute);
      });
      if (free.length === 0) continue;

      const price = priceBooking(opts.rateCards, {
        audience: opts.audience,
        dayOfWeek: opts.dayOfWeek,
        startTime: toHHMM(start),
        minutes: opts.minutes,
      });
      // An unpriceable slot is not offered. Better a shorter list than a
      // parent picking a time and being told at checkout there is no rate.
      if (!price.ok) continue;

      slots.push({
        time: toHHMM(start),
        startMinute: start,
        endMinute: end,
        courts: free.map((c) => ({ id: c.id, name: courtLabel(c) })),
        cents: price.cents,
        segments: price.segments,
      });
    }
  }

  slots.sort((a, b) => a.startMinute - b.startMinute);

  let note: string | null = null;
  if (slots.length === 0) {
    if (anyWindowTooShort) note = `The club is not open long enough for ${opts.minutes} minutes.`;
    else if (opts.nowMinute !== null) note = 'Nothing left today.';
    else note = 'Every court is booked.';
  }

  return { slots, note, audience: opts.audience, advanceDays: rules.advanceDays };
}

/**
 * May this audience book this date at all?
 *
 * Inclusive of the last day: "3 days in advance" means today, tomorrow, the day
 * after, and the day after that — which is what a club means when they say it,
 * and what a member will argue if told otherwise.
 */
export function withinAdvanceWindow(
  todayYmd: string,
  targetYmd: string,
  advanceDays: number,
): { ok: true } | { ok: false; reason: 'past' | 'too_far'; lastBookable: string } {
  const day = (ymd: string) => Date.parse(`${ymd}T12:00:00Z`);
  const last = new Date(day(todayYmd) + advanceDays * 86_400_000).toISOString().slice(0, 10);

  if (targetYmd < todayYmd) return { ok: false, reason: 'past', lastBookable: last };
  if (targetYmd > last) return { ok: false, reason: 'too_far', lastBookable: last };
  return { ok: true };
}

/** The dates a booking page should offer as tabs. */
export function bookableDates(todayYmd: string, advanceDays: number): string[] {
  const out: string[] = [];
  const base = Date.parse(`${todayYmd}T12:00:00Z`);
  for (let i = 0; i <= advanceDays; i += 1) {
    out.push(new Date(base + i * 86_400_000).toISOString().slice(0, 10));
  }
  return out;
}

/**
 * Read the club's windows for one weekday out of cc_clubs.operating_hours.
 *
 * Shape is {"1":[{open,close}], …} keyed by Postgres DOW, and `{}` means the
 * club never set them.
 */
export function windowsForDay(
  operatingHours: Record<string, OperatingWindow[]> | null | undefined,
  dayOfWeek: number,
): OperatingWindow[] {
  if (!operatingHours || Object.keys(operatingHours).length === 0) return [];
  return operatingHours[String(dayOfWeek)] ?? [];
}
