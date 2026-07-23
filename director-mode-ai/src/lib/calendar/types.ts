/**
 * CalendarMode — shared types for the year-planning engine.
 *
 * These shapes are the contract between the pure engine (score/plan/anchors),
 * the API routes, the UI, and the assistant pack. Everything in this folder is
 * pure: no I/O, no Supabase, no Date.now() — callers pass `today` in when they
 * need it so the whole engine is deterministic and testable.
 */

/** ISO date, 'YYYY-MM-DD'. Club-local, never a timestamp. */
export type ISODate = string;

/** The department that RUNS an event (who it's FOR lives in `audience`). */
export type Department =
  | 'tennis'
  | 'pickleball'
  | 'swim'
  | 'fitness'
  | 'social'
  | 'other';

export const DEPARTMENTS: readonly Department[] = [
  'tennis', 'pickleball', 'swim', 'fitness', 'social', 'other',
];

/**
 * Who an event is for. Used for collision detection — running three ladies
 * events in a month burns out the same forty people even though the calendar
 * looks pleasantly full.
 */
export type Audience =
  | 'adult'
  | 'junior'
  | 'family'
  | 'ladies'
  | 'men'
  | 'mixed'
  | 'member-guest'
  | 'senior'
  | 'all';

export const AUDIENCES: readonly Audience[] = [
  'adult', 'junior', 'family', 'ladies', 'men', 'mixed', 'member-guest', 'senior', 'all',
];

/** How much lift an event is to run. Drives staffing warnings and pacing. */
export type Effort = 'easy' | 'medium' | 'heavy' | 'flagship';

/** How the event makes (or costs) money. */
export type RevenueModel =
  | 'entry-fee'
  | 'entry-fee-plus-fb'
  | 'ticketed'
  | 'included'      // member benefit, no charge
  | 'sponsored'
  | 'fundraiser';

export type ItemStatus = 'idea' | 'scheduled' | 'promoted' | 'done' | 'dropped';

/**
 * Signed impact. A constraint is not simply "bad" — spring break is favorable
 * for family events and heavy for junior programs, and expressing that
 * difference is most of what separates an informed recommendation from a
 * mechanical one.
 */
export type ConstraintImpact = 'blocking' | 'heavy' | 'light' | 'favorable';

export type ConstraintSource =
  | 'school'
  | 'club'
  | 'holiday'
  | 'usta'
  | 'clubmode'
  | 'manual';

/** Something that blocks or shades a range of dates. */
export interface CalendarConstraint {
  id: string;
  source: ConstraintSource;
  title: string;
  starts_on: ISODate;
  ends_on: ISODate;
  impact: ConstraintImpact;
  /** Which audiences this drains (or favors). Empty = everyone. */
  audience_tags: Audience[];
}

/**
 * A catalog entry — one seeded event concept. The catalog is the creative
 * core of CalendarMode and is deliberately plain data: deterministic, free to
 * run, and reviewable. The AI layer riffs on top of it rather than replacing it.
 */
export interface CatalogEntry {
  key: string;
  title: string;
  tagline: string;
  description: string;
  department: Department;
  audience: Audience[];
  /**
   * How this event wants to be placed. See anchors.ts for the grammar.
   * null = floating; the engine puts it wherever it scores best.
   */
  anchor: string | null;
  /** 1-12. Months where this concept makes sense at all. Empty = any month. */
  idealMonths: number[];
  /** Maps to `events.match_format` on promote. null = not a draw event. */
  formatHint: string | null;
  durationMinutes: number;
  courtsNeeded: number;
  staffNeeded: number;
  effort: Effort;
  revenueModel: RevenueModel;
  /** Typical per-head entry fee in cents. 0 = free/included. */
  typicalFeeCents: number;
  typicalAttendance: number;
  /** Whether the event needs outdoor-viable weather. */
  outdoor: boolean;
  /** Food & beverage note — the part directors always forget to plan. */
  fb: string | null;
  /** Suggested prize / trophy structure. */
  prize: string | null;
  /** Free-text hints surfaced in the UI and fed to the AI as grounding. */
  tips: string[];
}

/** A planned event, as the engine sees it. Mirrors the calendar_items row. */
export interface PlanItem {
  id: string;
  title: string;
  catalog_key: string | null;
  department: Department;
  audience: Audience[];
  anchor_rule: string | null;
  /** null until placed. */
  target_date: ISODate | null;
  target_end_date: ISODate | null;
  duration_minutes: number | null;
  courts_needed: number | null;
  staff_needed: number | null;
  expected_attendance: number | null;
  expected_revenue_cents: number | null;
  effort: Effort;
  outdoor: boolean;
  idealMonths: number[];
  status: ItemStatus;
}

/** A candidate date the engine may place an event on. */
export interface Slot {
  /** The date itself. */
  date: ISODate;
  /** 0=Sun..6=Sat. */
  dow: number;
  /** True for Sat/Sun and observed holiday Mondays. */
  isWeekend: boolean;
  /** Set when this slot is a holiday (or its observed day). */
  holiday: string | null;
  /** ISO week-ish bucket used for cadence spacing. */
  weekIndex: number;
}

/** One line of the itemized explanation behind a score. */
export interface ScoreReason {
  /** Stable id so the UI can icon/colour it. */
  code:
    | 'anchor'
    | 'season'
    | 'climate'
    | 'holiday'
    | 'constraint'
    | 'cadence'
    | 'audience'
    | 'staff'
    | 'courts'
    | 'revenue'
    | 'dow'
    | 'blocked';
  /** Points added (or subtracted). 0 for pure-information reasons. */
  points: number;
  /** Human sentence shown verbatim in the UI. */
  detail: string;
}

export interface ScoredSlot {
  date: ISODate;
  score: number;
  /** True when a hard block rules this date out entirely. */
  blocked: boolean;
  reasons: ScoreReason[];
}

/** Court availability on a given date, as far as CourtSheet knows. */
export interface CourtLoad {
  /** Total bookable courts at the club. */
  total: number;
  /** Courts already claimed for a meaningful part of that day. */
  busy: number;
}

/** Everything the scorer needs that isn't the item or the slot. */
export interface ScoreContext {
  year: number;
  /** Club location, for climate. null = skip climate scoring entirely. */
  climateRegion: import('./climate').ClimateRegion | null;
  constraints: CalendarConstraint[];
  /** Already-placed items (including the rest of this plan). */
  placed: PlanItem[];
  /** date → court load. Missing dates are treated as fully available. */
  courtLoad?: Record<ISODate, CourtLoad>;
  /** Planning targets from calendar_plans.goals. */
  goals?: PlanGoals;
  /** Windows the club can host in, as MM-DD strings. Empty = year-round. */
  seasonWindows?: Array<{ label: string; start: string; end: string }>;
  /** Items must be placed on or after this date. Pass explicitly — no clocks here. */
  notBefore?: ISODate;
}

export interface PlanGoals {
  events_per_month?: number;
  revenue_target_cents?: number;
  department_mix?: Partial<Record<Department, number>>;
  /** Minimum days between any two events. Defaults to 10. */
  min_days_between?: number;
}

/** Result of placing a whole year. */
export interface YearPlanResult {
  placements: Array<{ itemId: string; date: ISODate; score: number; reasons: ScoreReason[] }>;
  /** Items the engine could not place, each with the reason — never silent. */
  unplaced: Array<{ itemId: string; title: string; reason: string }>;
}
