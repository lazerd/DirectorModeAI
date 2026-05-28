/**
 * CourtSheet AI — engine types.
 *
 * Shared shapes for booking intents, plans, conflicts, selectors, and the
 * concrete reservation row. These types are the contract between the AI
 * agent, the UI, the per-tool adapters, and the DB.
 */

export type ReservationType =
  | 'camp'
  | 'lesson'
  | 'event'
  | 'match'
  | 'member'
  | 'maintenance'
  | 'blackout'
  | 'hold';

export type ReservationSource =
  | 'manual'
  | 'ai'
  | 'lessons'
  | 'mixer'
  | 'courtconnect'
  | 'tournaments'
  | 'quads'
  | 'jtt'
  | 'import';

export type ReservationStatus = 'confirmed' | 'tentative' | 'cancelled';

export type CourtStatus = 'active' | 'maintenance' | 'hidden';

/** A bookable court. */
export interface Court {
  id: string;
  club_id: string;
  number: number;
  name: string | null;
  sports: string[];
  surface: string | null;
  indoor: boolean;
  status: CourtStatus;
  display_order: number;
}

/** A concrete claim on a court for a span of time. */
export interface Reservation {
  id: string;
  club_id: string;
  court_id: string;
  series_id: string | null;
  starts_at: string; // ISO timestamptz
  ends_at: string;   // ISO timestamptz
  type: ReservationType;
  source: ReservationSource;
  source_id: string | null;
  title: string;
  status: ReservationStatus;
  color: string | null;
  signups_open: boolean;
  signups_capacity: number | null;
  signups_pitch: string | null;
  meta: Record<string, unknown>;
  created_by: string;
  created_at: string;
  updated_at: string;
}

/** Days of week — Postgres DOW: 0=Sun..6=Sat. */
export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/**
 * The structured intent the AI agent emits for `book`. The backend turns
 * this into concrete ReservationInstances via expandSeries().
 *
 * Times are in CLUB-LOCAL HH:MM. Dates are ISO YYYY-MM-DD.
 */
export interface BookingIntent {
  club_id: string;
  /** Court numbers OR names. Resolved against the club's courts at plan time. */
  courts: Array<number | string>;
  /** Inclusive ISO date range, club-local. Single day = same value twice. */
  date_range: { start: string; end: string };
  /** Empty array = every day in range. */
  days_of_week?: DayOfWeek[];
  /** HH:MM local. */
  time_range: { start: string; end: string };
  /** ISO YYYY-MM-DD to skip. */
  exclusions?: string[];
  type: ReservationType;
  title: string;
  /** Open this reservation for player signups? */
  signups?: {
    open: boolean;
    capacity?: number;
    pitch?: string;
  };
  /** Free-form metadata to copy onto every materialized reservation. */
  meta?: Record<string, unknown>;
  color?: string;
}

/** A reservation that would be created. Pre-write, in UTC. */
export interface ReservationInstance {
  court_id: string;
  /** UTC ISO. */
  starts_at: string;
  ends_at: string;
  type: ReservationType;
  title: string;
  meta: Record<string, unknown>;
  color: string | null;
  signups_open: boolean;
  signups_capacity: number | null;
  signups_pitch: string | null;
}

/**
 * Selector — a reusable structured filter for cancel/move/modify.
 * The AI and the UI describe "which reservations" the same way.
 */
export interface Selector {
  club_id: string;
  /** Match these courts only. */
  courts?: Array<number | string>;
  /** Inclusive ISO date range (club-local). */
  date_range?: { start: string; end: string };
  days_of_week?: DayOfWeek[];
  /** HH:MM local. */
  time_range?: { start: string; end: string };
  type?: ReservationType;
  source?: ReservationSource;
  /** Substring match against title. */
  title_match?: string;
  /** Resolve a specific series. */
  series_id?: string;
  /** Resolve a specific instance. */
  reservation_id?: string;
}

/** Scope semantics for mutations (calendar-grade "this event" / "this and following"). */
export type MutationScope = 'instance' | 'future' | 'series' | 'range';

export interface CancelMutation {
  kind: 'cancel';
  selector: Selector;
  scope: MutationScope;
}

export interface MoveMutation {
  kind: 'move';
  selector: Selector;
  target: {
    courts?: Array<number | string>;
    date?: string;        // YYYY-MM-DD club-local
    time_start?: string;  // HH:MM
    time_end?: string;    // HH:MM
  };
}

export interface ModifyMutation {
  kind: 'modify';
  selector: Selector;
  changes: Partial<{
    title: string;
    color: string;
    type: ReservationType;
    meta: Record<string, unknown>;
    signups_open: boolean;
    signups_capacity: number;
    signups_pitch: string;
  }>;
}

export type Mutation = CancelMutation | MoveMutation | ModifyMutation;

/** A description of one collision found during planning. */
export interface Conflict {
  /** The candidate that can't be written. */
  candidate: {
    court_id: string;
    court_label: string;
    starts_at: string;
    ends_at: string;
    title: string;
  };
  /** The existing reservation it would collide with (or null if same-batch). */
  against:
    | {
        kind: 'existing';
        reservation_id: string;
        title: string;
        starts_at: string;
        ends_at: string;
        source: ReservationSource;
      }
    | {
        kind: 'same-batch';
        court_id: string;
        starts_at: string;
        ends_at: string;
      };
  /** Out-of-hours, maintenance, hidden — non-overlap reasons. */
  warning?: 'outside_operating_hours' | 'court_maintenance' | 'court_hidden';
}

/**
 * The result of computePlan() — a dry-run that the UI shows and the user
 * confirms. Never writes. The plan_id is a signed token the confirm step
 * verifies before calling applyPlan().
 */
export interface Plan {
  plan_id: string;
  club_id: string;
  toCreate: ReservationInstance[];
  toModify: Array<{ reservation_id: string; changes: Partial<Reservation> }>;
  toCancel: Array<{ reservation_id: string }>;
  conflicts: Conflict[];
  /** Human-readable summary line(s) for the preview. */
  summary: {
    instance_count: number;
    court_count: number;
    day_count: number;
    spans: string; // e.g. "Mon–Fri, Jun 1 – Jul 31, 8:00–12:00"
  };
  /**
   * The original BookingIntent that produced this plan, if any. Apply uses
   * it to populate reservation_series rows with real recurrence shape so
   * Phase 2's "edit this and following" can replay it cleanly. Null for
   * Mutations (cancel/move/modify).
   */
  intent?: BookingIntent;
  /**
   * Reverse-plan: what to apply to undo this plan. Stored on the audit
   * row at apply time. Empty before apply.
   */
  reverse?: Pick<Plan, 'toCreate' | 'toModify' | 'toCancel'>;
}

export interface ApplyResult {
  plan_id: string;
  applied_at: string;
  created_ids: string[];
  modified_ids: string[];
  cancelled_ids: string[];
  failed: Array<{ index: number; reason: string }>;
  series_id: string | null;
}

/** A signup join row. */
export interface Signup {
  id: string;
  reservation_id: string;
  user_id: string | null;
  vault_player_id: string | null;
  guest_name: string | null;
  guest_email: string | null;
  status: 'requested' | 'confirmed' | 'waitlist' | 'cancelled';
  note: string | null;
  signed_up_at: string;
  status_changed_at: string;
}

/** Operating hours JSON shape on cc_clubs. */
export type OperatingHours = Partial<
  Record<`${DayOfWeek}`, Array<{ open: string; close: string }> | null>
>;

export interface Club {
  id: string;
  slug: string;
  name: string;
  timezone: string;
  operating_hours: OperatingHours;
  is_public: boolean;
  owner_id: string;
}
