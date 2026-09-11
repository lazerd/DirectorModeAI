/**
 * The daily routine — which items are due on a date, and how today is going.
 *
 * Pure: the caller passes the club-local date (and time). A check belongs to
 * (item, date), so there is no reset: a new day simply has no checks yet.
 */
import { addDays, hhmm, time12, weekdayOf } from './dates';
import type { ISODate, RoutineCheck, RoutineItem } from './types';

/** Is this item on the checklist for `date`? */
export function appliesOn(item: RoutineItem, date: ISODate): boolean {
  if (date < item.active_from) return false;
  if (item.archived_on && item.archived_on <= date) return false;
  return (item.days_of_week || []).includes(weekdayOf(date));
}

export type ChecklistState = 'done' | 'skipped' | 'pending' | 'late';

export type ChecklistRow = {
  item: RoutineItem;
  check: RoutineCheck | null;
  state: ChecklistState;
};

function byTargetThenOrder(a: RoutineItem, b: RoutineItem): number {
  const ta = hhmm(a.target_time);
  const tb = hhmm(b.target_time);
  if (ta && tb && ta !== tb) return ta.localeCompare(tb);
  if (ta && !tb) return -1;
  if (!ta && tb) return 1;
  return a.sort_order - b.sort_order || a.title.localeCompare(b.title);
}

/**
 * Today's checklist. `nowHHMM` (club wall-clock) turns a still-pending item
 * with a passed target time into 'late'.
 */
export function checklistFor(
  items: RoutineItem[],
  checks: RoutineCheck[],
  date: ISODate,
  nowHHMM?: string | null,
): ChecklistRow[] {
  const byItem = new Map(
    checks.filter((c) => c.local_date === date).map((c) => [c.item_id, c]),
  );
  return items
    .filter((i) => appliesOn(i, date))
    .sort(byTargetThenOrder)
    .map((item) => {
      const check = byItem.get(item.id) ?? null;
      const target = hhmm(item.target_time);
      const state: ChecklistState = check
        ? check.status
        : nowHHMM && target && nowHHMM > target
          ? 'late'
          : 'pending';
      return { item, check, state };
    });
}

/** Rows grouped under "By 7:00 AM" / "Anytime", in checklist order. */
export function groupChecklist(rows: ChecklistRow[]): { label: string; rows: ChecklistRow[] }[] {
  const groups: { label: string; rows: ChecklistRow[] }[] = [];
  for (const row of rows) {
    const t = hhmm(row.item.target_time);
    const label = t ? `By ${time12(t)}` : 'Anytime';
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.rows.push(row);
    else groups.push({ label, rows: [row] });
  }
  // "Anytime" always last, even if the sort put it elsewhere.
  const anytime = groups.filter((g) => g.label === 'Anytime');
  return [...groups.filter((g) => g.label !== 'Anytime'), ...anytime];
}

/** Items due on `date` that nobody ticked or skipped. */
export function missedOn(items: RoutineItem[], checks: RoutineCheck[], date: ISODate): RoutineItem[] {
  const handled = new Set(checks.filter((c) => c.local_date === date).map((c) => c.item_id));
  return items.filter((i) => appliesOn(i, date) && !handled.has(i.id)).sort(byTargetThenOrder);
}

/**
 * How often each item was missed over the `days` days BEFORE `today`.
 * Skipped counts as handled — a rain day is not a failure.
 */
export function missRecord(
  items: RoutineItem[],
  checks: RoutineCheck[],
  today: ISODate,
  days = 7,
): { item: RoutineItem; due: number; missed: number }[] {
  const handled = new Set(checks.map((c) => `${c.item_id}|${c.local_date}`));
  return items
    .filter((i) => !i.archived_on || i.archived_on > today)
    .map((item) => {
      let due = 0;
      let missed = 0;
      for (let k = 1; k <= days; k++) {
        const d = addDays(today, -k);
        if (!appliesOn(item, d)) continue;
        due++;
        if (!handled.has(`${item.id}|${d}`)) missed++;
      }
      return { item, due, missed };
    });
}

const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** [0..6] → "Every day"; [1..5] → "Weekdays"; [0,6] → "Weekends"; else "Mon, Wed, Fri". */
export function describeDays(days: number[]): string {
  const set = [...new Set(days)].filter((d) => d >= 0 && d <= 6).sort((a, b) => a - b);
  if (set.length === 7) return 'Every day';
  if (set.length === 5 && set.every((d, i) => d === i + 1)) return 'Weekdays';
  if (set.length === 2 && set[0] === 0 && set[1] === 6) return 'Weekends';
  // Week reads Mon→Sun on a club board.
  return [...set.filter((d) => d !== 0), ...set.filter((d) => d === 0)].map((d) => DAY_SHORT[d]).join(', ');
}

export const DAY_PRESETS: Record<'every' | 'weekdays' | 'weekends', number[]> = {
  every: [0, 1, 2, 3, 4, 5, 6],
  weekdays: [1, 2, 3, 4, 5],
  weekends: [0, 6],
};
