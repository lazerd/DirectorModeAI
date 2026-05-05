/**
 * Multi-day tournament scheduler — pure functions, no I/O.
 *
 * Top-level entry point: `optimizeTournamentSchedule()` takes the full set
 * of matches plus the tournament's daily window, courts, and timing
 * constraints, and returns a (date, time, court) assignment per match.
 *
 * Algorithm: topological sort by bracket dependency, then greedy fit into
 * the earliest viable slot that respects:
 *   - Predecessors must end (+ buffer) before the dependent match starts
 *   - The same player can't be in two matches at the same time
 *   - The same player needs `playerRestMinutes` between their matches
 *   - Each court runs at most one match at any given moment
 *   - All matches fit within the daily start/end window across the
 *     tournament's date range
 *
 * Court fairness: prefer courts with fewer assigned matches so far.
 */

export type SchedulerMatch = {
  /** Unique id used to address the match in the output. */
  id: string;
  /** All player ids present in this match (1-2 for singles, 1-4 for doubles). */
  player_ids: Array<string | null>;
  /** Match-completion dependencies — these match ids must finish before this match can start. */
  predecessor_match_ids: string[];
};

export type SchedulerInput = {
  matches: SchedulerMatch[];
  /** Court labels in stable order. Output uses these strings verbatim. */
  courts: string[];
  /** First date of the tournament window, ISO 'YYYY-MM-DD'. */
  startDate: string;
  /** Last date of the tournament window, ISO 'YYYY-MM-DD'. Inclusive. */
  endDate: string;
  /** Daily start time, 'HH:MM'. */
  dailyStartTime: string;
  /** Daily end time, 'HH:MM'. Last match must FINISH by this time. */
  dailyEndTime: string;
  /** Estimated minutes per match. */
  matchLengthMinutes: number;
  /** Minimum gap between two of the same player's matches. */
  playerRestMinutes: number;
  /** Gap between a predecessor's end and this match's start (warm-up + transitions). */
  matchBufferMinutes: number;
  /**
   * Slot granularity — how often the scheduler considers a candidate start
   * time within the daily window. 15 min is a good default; finer means
   * better packing but more compute.
   */
  slotGranularityMinutes?: number;
};

export type ScheduledAssignment = {
  scheduled_date: string; // 'YYYY-MM-DD'
  scheduled_at: string; // 'HH:MM'
  court: string;
};

export type SchedulerOutput = {
  assignments: Map<string, ScheduledAssignment>;
  /** Match ids that couldn't fit in the available window. */
  unscheduled: string[];
};

// ---------------------------------------------------------------------------
// Time helpers (pure)
// ---------------------------------------------------------------------------

export function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map((s) => parseInt(s, 10));
  return h * 60 + (m || 0);
}

export function minutesToTime(total: number): string {
  const h = Math.floor(total / 60).toString().padStart(2, '0');
  const m = (total % 60).toString().padStart(2, '0');
  return `${h}:${m}`;
}

export function dateToYmd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function ymdToDate(ymd: string): Date {
  return new Date(`${ymd}T00:00:00Z`);
}

/** Days in [start, end] inclusive, in ISO YYYY-MM-DD form. */
export function dayRange(startDate: string, endDate: string): string[] {
  const start = ymdToDate(startDate);
  const end = ymdToDate(endDate);
  if (end < start) return [];
  const days: string[] = [];
  const cur = new Date(start);
  while (cur <= end) {
    days.push(dateToYmd(cur));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return days;
}

/**
 * Convert (date, time) into an absolute "minutes since startDate at midnight"
 * value. Used to compare moments across days uniformly.
 */
function absoluteMinutes(startDate: string, date: string, time: string): number {
  const dayIdx = dayRange(startDate, date).length - 1;
  return dayIdx * 24 * 60 + timeToMinutes(time);
}

// ---------------------------------------------------------------------------
// Topological sort with deterministic tie-break
// ---------------------------------------------------------------------------

/**
 * Topologically sort matches so each match comes after all its predecessors.
 * Tie-breaks on input order so the same input always produces the same plan.
 *
 * Throws if there's a cycle (shouldn't happen for tournament brackets).
 */
export function topologicallySortMatches(matches: SchedulerMatch[]): SchedulerMatch[] {
  const byId = new Map(matches.map((m) => [m.id, m]));
  const indeg = new Map<string, number>();
  for (const m of matches) indeg.set(m.id, 0);
  for (const m of matches) {
    for (const p of m.predecessor_match_ids) {
      // Only count predecessors that exist in the input
      if (byId.has(p)) {
        indeg.set(m.id, (indeg.get(m.id) ?? 0) + 1);
      }
    }
  }

  // Kahn's algorithm with stable order — process in original input order
  const ready = matches.filter((m) => (indeg.get(m.id) ?? 0) === 0);
  const out: SchedulerMatch[] = [];

  while (ready.length > 0) {
    const next = ready.shift()!;
    out.push(next);
    for (const m of matches) {
      if (m.predecessor_match_ids.includes(next.id)) {
        const newIndeg = (indeg.get(m.id) ?? 0) - 1;
        indeg.set(m.id, newIndeg);
        if (newIndeg === 0) ready.push(m);
      }
    }
  }

  if (out.length !== matches.length) {
    throw new Error('Cycle detected in match dependencies');
  }
  return out;
}

// ---------------------------------------------------------------------------
// Main scheduler
// ---------------------------------------------------------------------------

export function optimizeTournamentSchedule(input: SchedulerInput): SchedulerOutput {
  const {
    matches,
    courts,
    startDate,
    endDate,
    dailyStartTime,
    dailyEndTime,
    matchLengthMinutes,
    playerRestMinutes,
    matchBufferMinutes,
    slotGranularityMinutes = 15,
  } = input;

  if (courts.length === 0 || matches.length === 0) {
    return { assignments: new Map(), unscheduled: matches.map((m) => m.id) };
  }

  const days = dayRange(startDate, endDate);
  if (days.length === 0) {
    return { assignments: new Map(), unscheduled: matches.map((m) => m.id) };
  }

  const dailyStartMin = timeToMinutes(dailyStartTime);
  const dailyEndMin = timeToMinutes(dailyEndTime);

  // For each (day, court), track when that court is next available (in HH:MM minutes within that day).
  // Initialize each court to the daily start.
  const courtNextFreeByDay = new Map<string, number[]>(); // dayYmd → court index → next free min within day
  for (const day of days) {
    courtNextFreeByDay.set(day, new Array(courts.length).fill(dailyStartMin));
  }

  // For each player id, the absolute end-time minute of their last scheduled match.
  const playerLastEnd = new Map<string, number>();

  // Match end time (absolute minutes) by match id — used by successors
  const matchEndAbsolute = new Map<string, number>();

  // Match assignment count per court — for fairness
  const courtLoad = new Array(courts.length).fill(0);

  const ordered = topologicallySortMatches(matches);
  const assignments = new Map<string, ScheduledAssignment>();
  const unscheduled: string[] = [];

  for (const match of ordered) {
    // Compute earliest-allowed start time across:
    // - All predecessors finished + buffer
    // - All players in match are rested
    let earliestAbs = 0;

    for (const pid of match.predecessor_match_ids) {
      const predEnd = matchEndAbsolute.get(pid);
      if (predEnd !== undefined) {
        earliestAbs = Math.max(earliestAbs, predEnd + matchBufferMinutes);
      }
    }

    for (const playerId of match.player_ids) {
      if (!playerId) continue;
      const lastEnd = playerLastEnd.get(playerId);
      if (lastEnd !== undefined) {
        earliestAbs = Math.max(earliestAbs, lastEnd + playerRestMinutes);
      }
    }

    // Find the earliest (day, time, court) slot >= earliestAbs that fits
    // a `matchLengthMinutes` block within the daily window.
    let placed = false;

    for (let dayIdx = 0; dayIdx < days.length && !placed; dayIdx++) {
      const day = days[dayIdx];
      const dayBaseAbs = dayIdx * 24 * 60;

      // Compute the min start within this day given the earliest constraint
      const minWithinDay = Math.max(dailyStartMin, earliestAbs - dayBaseAbs);
      // Round up to slot granularity
      const startWithinDay =
        Math.ceil(minWithinDay / slotGranularityMinutes) * slotGranularityMinutes;
      if (startWithinDay + matchLengthMinutes > dailyEndMin) continue;

      // Build candidate court list, sorted by load (fewest first), then index
      const courtOrder = courts
        .map((_, i) => i)
        .sort((a, b) => courtLoad[a] - courtLoad[b] || a - b);

      const courtFreeMins = courtNextFreeByDay.get(day)!;

      for (const courtIdx of courtOrder) {
        const courtFree = courtFreeMins[courtIdx];
        const candidateStart = Math.max(startWithinDay, courtFree);
        if (candidateStart + matchLengthMinutes > dailyEndMin) continue;

        // Found a slot — assign
        const scheduled_at = minutesToTime(candidateStart);
        assignments.set(match.id, {
          scheduled_date: day,
          scheduled_at,
          court: courts[courtIdx],
        });
        const matchEndWithinDay = candidateStart + matchLengthMinutes;
        courtFreeMins[courtIdx] = matchEndWithinDay;
        courtLoad[courtIdx]++;

        const matchEndAbs = dayBaseAbs + matchEndWithinDay;
        matchEndAbsolute.set(match.id, matchEndAbs);
        for (const playerId of match.player_ids) {
          if (!playerId) continue;
          playerLastEnd.set(playerId, matchEndAbs);
        }

        placed = true;
        break;
      }
    }

    if (!placed) {
      unscheduled.push(match.id);
    }
  }

  return { assignments, unscheduled };
}
