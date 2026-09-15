/**
 * The public court sheet: every court, every half hour, booked or open — and
 * what an open one costs THIS visitor.
 *
 * `availableSlots` answers "when can I get A court"; this answers "what is on
 * court 4 at 6pm". A visitor deciding whether to drive over wants the second,
 * and a member looking for a partner wants to see the club is busy.
 *
 * Pure, same frame as availability.ts: club-local minutes past midnight. It
 * never reports WHO has a court — a public page saying "Smith lesson, Ct 3"
 * tells a stranger where a child will be at 4pm.
 */

import { priceBooking, toHHMM, toMinutes, type RateCard } from './pricing';
import type { BusyBlock, Court, OperatingWindow } from './availability';

export type SheetCellState = 'open' | 'booked' | 'past' | 'maintenance';

export type SheetCell = {
  state: SheetCellState;
  /**
   * Per-hour price for this audience at this time, when the cell is open and
   * the club has a rate covering it. Null means "open, no online price" — a
   * club not taking bookings still shows which courts are free.
   */
  centsPerHour: number | null;
};

export type SheetRow = {
  time: string;
  startMinute: number;
  /** This half hour has already ended (today only). The page folds these away. */
  past: boolean;
  cells: SheetCell[];
};

export type SheetGrid = {
  courts: { id: string; name: string }[];
  rows: SheetRow[];
  /** True when the club set no hours and 7am–10pm is being assumed. */
  assumedHours: boolean;
};

const courtLabel = (c: Court): string => c.name || (c.number != null ? `Court ${c.number}` : 'Court');

export function sheetGrid(opts: {
  courts: Court[];
  busy: BusyBlock[];
  openWindows: OperatingWindow[];
  rateCards: RateCard[];
  audience: 'member' | 'public';
  dayOfWeek: number;
  /** Club-local minute for "now" when the date is today, else null. */
  nowMinute: number | null;
  step?: number;
}): SheetGrid {
  const step = opts.step ?? 30;
  const courts = opts.courts.filter((c) => c.status !== 'hidden');
  const assumedHours = opts.openWindows.length === 0;
  const windows = assumedHours ? [{ open: '07:00', close: '22:00' }] : opts.openWindows;

  const busyByCourt = new Map<string, BusyBlock[]>();
  for (const b of opts.busy) {
    busyByCourt.set(b.court_id, [...(busyByCourt.get(b.court_id) ?? []), b]);
  }

  const rows: SheetRow[] = [];
  for (const w of windows) {
    const close = toMinutes(w.close);
    for (let start = toMinutes(w.open); start + step <= close; start += step) {
      const end = start + step;
      // One price per row: rates vary by time of day, never by court.
      const price = priceBooking(opts.rateCards, {
        audience: opts.audience,
        dayOfWeek: opts.dayOfWeek,
        startTime: toHHMM(start),
        minutes: step,
      });
      const centsPerHour = price.ok ? Math.round((price.cents * 60) / step) : null;
      // A row that has already ENDED is history; the one in progress still
      // tells a visitor whether a court is free right now.
      const past = opts.nowMinute !== null && end <= opts.nowMinute;

      rows.push({
        time: toHHMM(start),
        startMinute: start,
        past,
        cells: courts.map((court) => {
          if (court.status === 'maintenance') return { state: 'maintenance', centsPerHour: null };
          // Half-open, matching no_double_booking's '[)'.
          const taken = (busyByCourt.get(court.id) ?? []).some(
            (b) => b.startMinute < end && start < b.endMinute,
          );
          if (taken) return { state: 'booked', centsPerHour: null };
          if (past) return { state: 'past', centsPerHour: null };
          return { state: 'open', centsPerHour };
        }),
      });
    }
  }

  rows.sort((a, b) => a.startMinute - b.startMinute);
  return { courts: courts.map((c) => ({ id: c.id, name: courtLabel(c) })), rows, assumedHours };
}
