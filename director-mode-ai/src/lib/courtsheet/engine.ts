/**
 * CourtSheet AI — public engine entrypoint.
 *
 * The single import surface other modules use. The AI agent, the UI's
 * API routes, and per-tool adapters all call into here — none of them
 * should reach past this file into the internals.
 *
 * Construct with createEngine({ db, club_id }); the engine pre-loads the
 * club and its courts so each method doesn't re-fetch.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  BookingIntent,
  Club,
  Court,
  Mutation,
  Plan,
  ApplyResult,
} from './types';
import { planBooking, planMutation, type PlanOptions } from './planner';
import { applyPlan, undoPlan, type ApplyOptions, type ApplyContext } from './apply';
import { availability, type AvailabilityQuery, type AvailabilitySlot } from './availability';
import {
  openForSignups as openForSignupsInternal,
  signup as signupInternal,
  cancelSignup as cancelSignupInternal,
  confirmSignup as confirmSignupInternal,
  type SignupIdentity,
  type SignupResult,
} from './signups';

export interface EngineConfig {
  db: SupabaseClient<any, 'public', any>;
  club_id: string;
}

export class CourtSheetEngine {
  private constructor(
    private readonly db: SupabaseClient<any, 'public', any>,
    private readonly club: Club,
    private readonly courts: Court[]
  ) {}

  static async load(cfg: EngineConfig): Promise<CourtSheetEngine> {
    const { data: clubRow, error: clubErr } = await cfg.db
      .from('cc_clubs')
      .select('id, slug, name, timezone, operating_hours, is_public, owner_id')
      .eq('id', cfg.club_id)
      .single();
    if (clubErr || !clubRow) throw new Error(`Club not found: ${cfg.club_id}`);

    const { data: courtRows } = await cfg.db
      .from('courts')
      .select('*')
      .eq('club_id', cfg.club_id)
      .neq('status', 'hidden')
      .order('display_order', { ascending: true });

    return new CourtSheetEngine(
      cfg.db,
      clubRow as Club,
      (courtRows ?? []) as Court[]
    );
  }

  getClub(): Club {
    return this.club;
  }

  getCourts(): Court[] {
    return this.courts;
  }

  /** Compute a Plan for creating reservations from a BookingIntent. */
  async computeBookingPlan(intent: BookingIntent, opts?: PlanOptions): Promise<Plan> {
    return planBooking(intent, {
      db: this.db,
      club: { id: this.club.id, timezone: this.club.timezone, operating_hours: this.club.operating_hours },
      courts: this.courts,
    }, opts);
  }

  /** Compute a Plan for a Mutation (cancel / move / modify). */
  async computeMutationPlan(mut: Mutation): Promise<Plan> {
    return planMutation(mut, {
      db: this.db,
      club: { id: this.club.id, timezone: this.club.timezone, operating_hours: this.club.operating_hours },
      courts: this.courts,
    });
  }

  /** Execute a Plan in a transaction. */
  async applyPlan(plan: Plan, ctx: Omit<ApplyContext, 'db'>, opts?: ApplyOptions): Promise<ApplyResult> {
    return applyPlan(plan, { ...ctx, db: this.db }, opts);
  }

  /** Undo a previously-applied plan by replaying its reverse-diff. */
  async undo(original_plan_id: string, ctx: Omit<ApplyContext, 'db'>): Promise<ApplyResult> {
    return undoPlan(original_plan_id, { ...ctx, db: this.db }, this.club.id);
  }

  /** Set of open slots matching a query. */
  async availability(query: Omit<AvailabilityQuery, 'club_id'>): Promise<AvailabilitySlot[]> {
    return availability(
      { ...query, club_id: this.club.id },
      {
        db: this.db,
        club: { id: this.club.id, timezone: this.club.timezone, operating_hours: this.club.operating_hours },
        courts: this.courts,
      }
    );
  }

  // ---- signups ----

  async openForSignups(
    reservation_id: string,
    args: { open: boolean; capacity?: number; pitch?: string },
    actor_user_id: string | null
  ) {
    return openForSignupsInternal(reservation_id, args, { db: this.db, actor_user_id });
  }

  async signup(
    reservation_id: string,
    identity: SignupIdentity,
    note: string | null,
    actor_user_id: string | null
  ): Promise<SignupResult> {
    return signupInternal(reservation_id, identity, note, { db: this.db, actor_user_id });
  }

  async cancelSignup(signup_id: string, actor_user_id: string | null) {
    return cancelSignupInternal(signup_id, { db: this.db, actor_user_id });
  }

  async confirmSignup(signup_id: string, actor_user_id: string | null) {
    return confirmSignupInternal(signup_id, { db: this.db, actor_user_id });
  }
}

/** Convenience for tool adapters: one-shot book without an engine instance. */
export async function bookThrough(
  cfg: EngineConfig,
  intent: BookingIntent,
  apply: { actor_user_id: string; channel: ApplyContext['channel'] }
): Promise<ApplyResult> {
  const engine = await CourtSheetEngine.load(cfg);
  const plan = await engine.computeBookingPlan(intent);
  return engine.applyPlan(plan, apply, { allowConflicts: false });
}
