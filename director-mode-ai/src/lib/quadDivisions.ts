/**
 * Age divisions for a Quads event, and the allocation logic that decides which
 * registrants actually get a spot.
 *
 * A dated Quads event owns a fixed number of "quads" (groups of four) — that's
 * how many the court block fits. Divisions are advertised up front, but which
 * ones actually RUN depends on who signs up: a division needs 4 players to be
 * viable, and any block a dead division gives back is handed to a division with
 * players still waiting. Everything here is pure so it can be unit-tested and
 * previewed to the director before anyone is charged.
 */

export type QuadDivision = {
  id: string;
  label: string;
  /** Oldest a player may be, inclusive. Undefined = no upper bound. */
  age_max?: number;
  /** Youngest a player may be, inclusive. Undefined = no lower bound. */
  age_min?: number;
  sort: number;
};

export const PLAYERS_PER_QUAD = 4;

/** Read the divisions off an event row, sorted. Returns [] for legacy events. */
export function parseDivisions(raw: unknown): QuadDivision[] {
  if (!Array.isArray(raw)) return [];
  return (raw as any[])
    .filter((d) => d && typeof d.id === 'string' && typeof d.label === 'string')
    .map((d, i) => ({
      id: String(d.id),
      label: String(d.label),
      age_max: typeof d.age_max === 'number' ? d.age_max : undefined,
      age_min: typeof d.age_min === 'number' ? d.age_min : undefined,
      sort: typeof d.sort === 'number' ? d.sort : i,
    }))
    .sort((a, b) => a.sort - b.sort);
}

export function divisionLabel(divisions: QuadDivision[], id: string | null | undefined): string {
  if (!id) return '—';
  return divisions.find((d) => d.id === id)?.label ?? id;
}

/** Age in whole years on a given date. */
export function ageOnDate(dob: Date, on: Date): number {
  let age = on.getFullYear() - dob.getFullYear();
  const m = on.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && on.getDate() < dob.getDate())) age--;
  return age;
}

/**
 * Can a player of this age enter this division?
 *
 * Playing UP is always allowed — a 9-year-old may enter 12 & Under. Playing
 * DOWN is not: age_max is a hard ceiling and age_min a hard floor.
 */
export function isEligibleForDivision(age: number, division: QuadDivision): boolean {
  if (division.age_max !== undefined && age > division.age_max) return false;
  if (division.age_min !== undefined && age < division.age_min) return false;
  return true;
}

export function eligibleDivisions(
  age: number | null,
  divisions: QuadDivision[]
): QuadDivision[] {
  if (age === null) return divisions;
  return divisions.filter((d) => isEligibleForDivision(age, d));
}

export type AllocationEntry = {
  id: string;
  division: string | null;
  /** ISO timestamp — signup order is what earns a spot. */
  registered_at: string;
};

export type DivisionPlan = {
  divisionId: string;
  /** Quads awarded to this division (0 = it doesn't run). */
  quads: number;
  /** Entry ids that get a spot, in signup order. */
  acceptedIds: string[];
  /** Everyone else who asked for this division, in signup order. */
  waitlistIds: string[];
  /** True once the division has enough players to field at least one quad. */
  viable: boolean;
  totalRequests: number;
};

export type AllocationPlan = {
  perDivision: DivisionPlan[];
  /** Quads nobody could use (not enough players anywhere). */
  unusedQuads: number;
  /** Entries whose division isn't on this event — needs a human. */
  orphanIds: string[];
};

/**
 * Decide who's in.
 *
 * 1. Every division holding at least 4 requests provisionally gets one quad,
 *    in the event's own division order.
 * 2. Divisions short of 4 don't run; their requests all go to the waitlist.
 * 3. Leftover quads go to whichever division has the most players still
 *    waiting (needs 4+ waiting to claim one). Repeat until the quads run out
 *    or nobody can fill another.
 * 4. Within a division, spots go in signup order — first come, first served.
 *
 * Worked example (3 quads; 8 sign up at 10U, 3 at 12U, 4 at 13&O):
 *   step 1 → 10U 1 quad, 13&O 1 quad, 12U not viable
 *   step 3 → 10U has 4 still waiting and takes the spare quad
 *   result → two 10U quads, one 13&O quad, 12U cancelled with 3 waitlisted.
 */
export function planQuadAllocation(input: {
  divisions: QuadDivision[];
  entries: AllocationEntry[];
  totalQuads: number;
}): AllocationPlan {
  const { divisions, totalQuads } = input;
  const validIds = new Set(divisions.map((d) => d.id));

  const orphanIds = input.entries
    .filter((e) => !e.division || !validIds.has(e.division))
    .map((e) => e.id);

  const byDivision = new Map<string, AllocationEntry[]>();
  for (const d of divisions) byDivision.set(d.id, []);
  for (const e of input.entries) {
    if (!e.division || !validIds.has(e.division)) continue;
    byDivision.get(e.division)!.push(e);
  }
  // Signup order decides the spots; ties fall back to id so the plan is stable.
  for (const list of byDivision.values()) {
    list.sort(
      (a, b) =>
        Date.parse(a.registered_at) - Date.parse(b.registered_at) ||
        a.id.localeCompare(b.id)
    );
  }

  const quadsFor = new Map<string, number>(divisions.map((d) => [d.id, 0]));
  let remaining = Math.max(0, totalQuads);

  // Step 1 — one quad each to every viable division, in the director's order.
  for (const d of divisions) {
    if (remaining === 0) break;
    if ((byDivision.get(d.id)?.length ?? 0) >= PLAYERS_PER_QUAD) {
      quadsFor.set(d.id, 1);
      remaining -= 1;
    }
  }

  // Step 3 — hand spare quads to whoever still has a full group waiting.
  while (remaining > 0) {
    let best: { id: string; waiting: number } | null = null;
    for (const d of divisions) {
      const total = byDivision.get(d.id)?.length ?? 0;
      const seated = (quadsFor.get(d.id) ?? 0) * PLAYERS_PER_QUAD;
      // Only divisions already running can grow — one that couldn't field a
      // first quad can't field a second.
      if ((quadsFor.get(d.id) ?? 0) === 0) continue;
      const waiting = total - seated;
      if (waiting >= PLAYERS_PER_QUAD && (!best || waiting > best.waiting)) {
        best = { id: d.id, waiting };
      }
    }
    if (!best) break;
    quadsFor.set(best.id, (quadsFor.get(best.id) ?? 0) + 1);
    remaining -= 1;
  }

  const perDivision: DivisionPlan[] = divisions.map((d) => {
    const list = byDivision.get(d.id) ?? [];
    const quads = quadsFor.get(d.id) ?? 0;
    const seats = quads * PLAYERS_PER_QUAD;
    return {
      divisionId: d.id,
      quads,
      acceptedIds: list.slice(0, seats).map((e) => e.id),
      waitlistIds: list.slice(seats).map((e) => e.id),
      viable: quads > 0,
      totalRequests: list.length,
    };
  });

  return { perDivision, unusedQuads: remaining, orphanIds };
}

/**
 * Format a payment deadline for a parent-facing email. Vercel runs UTC, so the
 * timezone has to be explicit or 9:30am renders as 4:30 PM.
 */
export function formatDeadline(iso: string, timeZone = 'America/Los_Angeles'): string {
  return new Date(iso).toLocaleString('en-US', {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

// ---------------------------------------------------------------------------
// Stretch capacity + waves
// ---------------------------------------------------------------------------

export type QuadCapacity = {
  /** Quads currently open — what the allocator seats against. */
  openQuads: number;
  /** Ceiling we could stretch to if the waitlist justifies it. */
  maxQuads: number;
  openSpots: number;
  maxSpots: number;
  /** True when more quads could still be opened. */
  canGrow: boolean;
  /** Quads that fit in one wave, given the courts available. */
  quadsPerWave: number;
  /** How many time waves the ceiling implies (1 or 2). */
  wavesNeeded: number;
};

/**
 * Each quad occupies two courts for its whole block (R1-R3 run two matches at
 * once), so a wave holds floor(courts / 2) quads. Anything above that has to
 * spill into a second wave.
 */
export function computeQuadCapacity(input: {
  totalQuads: number | null | undefined;
  maxTotalQuads?: number | null;
  numCourts: number | null | undefined;
  hasWave2: boolean;
}): QuadCapacity {
  const courts = Math.max(0, input.numCourts ?? 0);
  const quadsPerWave = Math.max(1, Math.floor(courts / 2));
  const openQuads = Math.max(0, input.totalQuads ?? 0);
  // Without a second wave the ceiling can't exceed what one wave holds.
  const rawMax = Math.max(openQuads, input.maxTotalQuads ?? openQuads);
  const maxQuads = input.hasWave2 ? rawMax : Math.min(rawMax, quadsPerWave);

  return {
    openQuads,
    maxQuads,
    openSpots: openQuads * PLAYERS_PER_QUAD,
    maxSpots: maxQuads * PLAYERS_PER_QUAD,
    canGrow: maxQuads > openQuads,
    quadsPerWave,
    wavesNeeded: maxQuads > quadsPerWave ? 2 : 1,
  };
}

/**
 * Which wave a quad index lands in (0-based index in, 1-based wave out).
 * Wave 1 fills first; the overflow runs in wave 2.
 */
export function waveForQuadIndex(index: number, quadsPerWave: number): 1 | 2 {
  return index < Math.max(1, quadsPerWave) ? 1 : 2;
}

/**
 * How many MORE quads a division's waitlist could fill, in whole groups of
 * four. Drives the "we'd add another quad if 2 more sign up" nudge.
 */
export function quadsWaitlistCouldFill(waitingCount: number): number {
  return Math.floor(Math.max(0, waitingCount) / PLAYERS_PER_QUAD);
}

/** Players still needed to unlock one more quad in a division. */
export function playersNeededForNextQuad(waitingCount: number): number {
  const remainder = Math.max(0, waitingCount) % PLAYERS_PER_QUAD;
  return remainder === 0 && waitingCount > 0 ? 0 : PLAYERS_PER_QUAD - remainder;
}
