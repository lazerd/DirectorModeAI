/**
 * CalendarMode — whole-year placement.
 *
 * Placing one event is scoring. Placing a year is a constraint problem: every
 * event you place changes the score of every event you haven't placed yet,
 * because cadence, audience fatigue, and staff load are all relative to what's
 * already on the calendar.
 *
 * Strategy — most-constrained-first, then local improvement:
 *
 *   1. Order items by how little freedom they have. A July 4th event has
 *      exactly one option; a floating social has fifty. Placing the rigid ones
 *      first means the flexible ones absorb the compromises, which is also how
 *      a director does it on a whiteboard.
 *   2. Greedily give each item its best open date given everything placed so far.
 *   3. Sweep back through and let any item move if a better date opened up once
 *      the rest of the calendar existed. Ordering artefacts from step 2 mostly
 *      dissolve here.
 *
 * Anything that cannot be placed comes back in `unplaced` with a reason. The
 * engine never silently drops an event — a director who asked for eighteen
 * events and gets sixteen needs to know which two and why.
 */

import { resolveAnchor } from './anchors';
import { generateSlots } from './slots';
import { rankSlots, scoreSlot } from './score';
import { daysApart, monthOf } from './dates';
import type {
  ISODate, PlanItem, ScoreContext, ScoreReason, Slot, YearPlanResult,
} from './types';

export interface BuildOptions {
  /** Candidate days of week. Defaults to Fri/Sat/Sun (+ holiday Mondays). */
  daysOfWeek?: number[];
  /** How much better a move must be before the improvement pass takes it. */
  improvementThreshold?: number;
  /** Improvement sweeps. Two is plenty; more rarely changes anything. */
  passes?: number;
}

/**
 * Place every item that has no date yet. Items that already carry a
 * `target_date` are treated as fixed and become context for the rest — that's
 * what makes "add three events to the year I already have" work.
 */
export function buildYearPlan(
  items: PlanItem[],
  ctx: ScoreContext,
  opts: BuildOptions = {},
): YearPlanResult {
  const threshold = opts.improvementThreshold ?? 12;
  const passes = opts.passes ?? 2;

  const allSlots = generateSlots(ctx.year, {
    daysOfWeek: opts.daysOfWeek,
    notBefore: ctx.notBefore,
  });

  const fixed = items.filter((i) => !!i.target_date);
  const toPlace = items.filter((i) => !i.target_date);

  // Everything already on the calendar counts as context from the start.
  const placed: PlanItem[] = [...ctx.placed, ...fixed];
  const results = new Map<string, { date: ISODate; score: number; reasons: ScoreReason[] }>();
  const unplaced: YearPlanResult['unplaced'] = [];

  // ---- 1. Order by how little freedom each item has ----
  const ordered = [...toPlace].sort((a, b) => freedom(a, ctx.year) - freedom(b, ctx.year));

  // ---- 2. Greedy placement ----
  for (const item of ordered) {
    const candidates = candidateSlots(item, allSlots);
    const ranked = rankSlots(item, candidates, { ...ctx, placed });
    const best = ranked.find((r) => !r.blocked);

    if (!best) {
      unplaced.push({
        itemId: item.id,
        title: item.title,
        reason: ranked[0]?.reasons.find((r) => r.code === 'blocked')?.detail
          ?? 'No date in the year satisfies this event\'s constraints.',
      });
      continue;
    }

    results.set(item.id, { date: best.date, score: best.score, reasons: best.reasons });
    placed.push({ ...item, target_date: best.date });
  }

  // ---- 3. Local improvement ----
  for (let pass = 0; pass < passes; pass++) {
    let moved = false;

    for (const item of ordered) {
      const current = results.get(item.id);
      if (!current) continue;

      // Score this item against a calendar that doesn't include it.
      const without = placed.filter((p) => p.id !== item.id);
      const candidates = candidateSlots(item, allSlots);
      const ranked = rankSlots(item, candidates, { ...ctx, placed: without });
      const best = ranked.find((r) => !r.blocked);
      if (!best || best.date === current.date) continue;

      // Re-score the current date under the same context for a fair comparison —
      // the original score was computed against a partial calendar.
      const currentSlot = candidates.find((s) => s.date === current.date);
      const currentNow = currentSlot
        ? scoreSlot(item, currentSlot, { ...ctx, placed: without })
        : null;
      const currentScore = currentNow?.score ?? current.score;

      if (best.score - currentScore >= threshold) {
        results.set(item.id, { date: best.date, score: best.score, reasons: best.reasons });
        const idx = placed.findIndex((p) => p.id === item.id);
        if (idx >= 0) placed[idx] = { ...placed[idx], target_date: best.date };
        moved = true;
      } else if (currentNow) {
        // Keep the date, but refresh the explanation against the finished
        // calendar so the UI never shows reasons from a half-built year.
        results.set(item.id, { date: current.date, score: currentNow.score, reasons: currentNow.reasons });
      }
    }

    if (!moved) break;
  }

  return {
    placements: [...results.entries()].map(([itemId, r]) => ({
      itemId,
      date: r.date,
      score: r.score,
      reasons: r.reasons,
    })).sort((a, b) => (a.date < b.date ? -1 : 1)),
    unplaced,
  };
}

/**
 * How many dates an item could plausibly take. Lower = place it earlier.
 * Exact anchors score 0 and go first; a floating year-round social scores in
 * the hundreds and goes last.
 */
export function freedom(item: PlanItem, year: number): number {
  const anchor = resolveAnchor(item.anchor_rule, year);
  if (anchor?.strength === 'exact') return 0;
  if (anchor) return 1 + daysApart(anchor.start, anchor.end);

  let base = item.idealMonths.length > 0 ? item.idealMonths.length * 12 : 200;
  // Big events are harder to slot, so give them a head start over small ones
  // with equally open calendars.
  if (item.effort === 'flagship') base -= 60;
  else if (item.effort === 'heavy') base -= 30;
  return Math.max(2, base);
}

/**
 * Narrow the candidate set before scoring. Scoring every day of the year for
 * every item is wasteful when an event states its months, and it also stops a
 * February slot from ever beating a July one on a technicality.
 */
function candidateSlots(item: PlanItem, all: Slot[]): Slot[] {
  const anchor = resolveAnchor(item.anchor_rule, yearOfSlots(all));
  if (anchor) {
    // Widen slightly past the stated window so a blocked anchor weekend can
    // spill to the neighbouring one rather than failing outright.
    const within = all.filter((s) => s.date >= pad(anchor.start, -10) && s.date <= pad(anchor.end, 10));
    if (within.length > 0) return within;
  }
  if (item.idealMonths.length > 0) {
    const within = all.filter((s) => item.idealMonths.includes(monthOf(s.date)));
    if (within.length > 0) return within;
  }
  return all;
}

function yearOfSlots(all: Slot[]): number {
  return all.length > 0 ? Number(all[0].date.slice(0, 4)) : new Date().getUTCFullYear();
}

/** Shift an ISO date by n days without importing the whole date module twice. */
function pad(iso: ISODate, n: number): ISODate {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Summary stats for the board packet and the year-grid header.
 * Kept here so the same numbers back the UI and the printed plan.
 */
export interface PlanSummary {
  total: number;
  byMonth: number[]; // 12 entries, Jan..Dec
  byDepartment: Record<string, number>;
  byAudience: Record<string, number>;
  projectedRevenueCents: number;
  flagshipCount: number;
  /** Months with no events at all — the gaps a director should see. */
  emptyMonths: number[];
  /** Weeks carrying two or more events. */
  crowdedWeeks: number;
}

export function summarizePlan(items: PlanItem[]): PlanSummary {
  const dated = items.filter((i) => i.target_date && i.status !== 'dropped');
  const byMonth = new Array(12).fill(0);
  const byDepartment: Record<string, number> = {};
  const byAudience: Record<string, number> = {};
  const weekCounts = new Map<string, number>();
  let revenue = 0;
  let flagship = 0;

  for (const i of dated) {
    const m = monthOf(i.target_date!);
    byMonth[m - 1]++;
    byDepartment[i.department] = (byDepartment[i.department] ?? 0) + 1;
    for (const a of i.audience) byAudience[a] = (byAudience[a] ?? 0) + 1;
    revenue += i.expected_revenue_cents ?? 0;
    if (i.effort === 'flagship') flagship++;
    const wk = i.target_date!.slice(0, 7) + ':' + Math.floor(Number(i.target_date!.slice(8, 10)) / 7);
    weekCounts.set(wk, (weekCounts.get(wk) ?? 0) + 1);
  }

  return {
    total: dated.length,
    byMonth,
    byDepartment,
    byAudience,
    projectedRevenueCents: revenue,
    flagshipCount: flagship,
    emptyMonths: byMonth.map((n, i) => (n === 0 ? i + 1 : 0)).filter(Boolean),
    crowdedWeeks: [...weekCounts.values()].filter((n) => n >= 2).length,
  };
}
