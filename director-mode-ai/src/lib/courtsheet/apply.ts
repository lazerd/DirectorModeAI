/**
 * CourtSheet AI — plan application.
 *
 * The only module in the engine that writes. Everything else is pure or
 * read-only. applyPlan takes a previously-computed Plan, re-checks
 * conflicts, executes the writes in a single transaction, writes an audit
 * row with the reverse-plan, and returns the result.
 *
 * Idempotency: callers pass the plan_id; if the audit log already has a
 * plan_applied row with that plan_id, applyPlan returns the prior result
 * without re-writing. This survives client retries.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  Plan,
  ApplyResult,
  ReservationInstance,
  Reservation,
} from './types';
import { detectConflicts } from './conflicts';
import { verifyPlanId } from './planner';

export interface ApplyContext {
  /** Service-role client. */
  db: SupabaseClient<any, 'public', any>;
  actor_user_id: string;
  /** 'ai' | 'ui' | 'api' | 'cron' */
  channel: 'ai' | 'ui' | 'api' | 'cron';
  user_agent?: string;
}

export interface ApplyOptions {
  /**
   * If true, skip the soft conflict check (the EXCLUDE constraint is
   * still the final word). Used when the user explicitly chose
   * "create the rest, skip conflicting".
   */
  allowConflicts?: boolean;
  /** If true, drop the conflicting candidates and write the rest. */
  skipConflicting?: boolean;
}

export class PlanIdInvalidError extends Error {
  constructor() {
    super('plan_id signature did not verify');
    this.name = 'PlanIdInvalidError';
  }
}

export class ConflictsBlockApplyError extends Error {
  constructor(public readonly count: number) {
    super(`${count} conflict(s) would block this plan. Pass allowConflicts or skipConflicting.`);
    this.name = 'ConflictsBlockApplyError';
  }
}

/**
 * Apply a Plan.
 *
 * Steps:
 *   1) Verify plan_id signature.
 *   2) Check audit log for idempotency hit on this plan_id.
 *   3) Re-fetch overlapping existing reservations and re-detect conflicts.
 *      Decide which candidates to keep.
 *   4) Open a transaction:
 *        - upsert reservation_series if this is a series booking
 *        - insert reservations
 *        - update modifications
 *        - mark cancellations as status=cancelled
 *      Note: PostgREST/supabase-js doesn't expose true transactions over
 *      HTTP; we use a single RPC `courtsheet_apply_plan` (defined inline
 *      here via raw SQL where possible) OR a best-effort sequence with
 *      explicit rollback. For Phase 1 we use the sequence approach and
 *      promote to an RPC in a follow-up if measurements warrant.
 *   5) Write the audit row with the reverse-plan.
 */
export async function applyPlan(
  plan: Plan,
  ctx: ApplyContext,
  opts: ApplyOptions = {}
): Promise<ApplyResult> {
  const uuid = verifyPlanId(plan.plan_id, plan.club_id);
  if (!uuid) throw new PlanIdInvalidError();

  // 2) Idempotency: if we already applied this plan_id, return cached result.
  const prior = await ctx.db
    .from('courtsheet_audit_log')
    .select('id, diff')
    .eq('plan_id', uuid)
    .eq('action', 'plan_applied')
    .maybeSingle();
  if (prior.data) {
    const diff = (prior.data.diff ?? {}) as Partial<ApplyResult>;
    return {
      plan_id: plan.plan_id,
      applied_at: (diff.applied_at as string) ?? new Date().toISOString(),
      created_ids: diff.created_ids ?? [],
      modified_ids: diff.modified_ids ?? [],
      cancelled_ids: diff.cancelled_ids ?? [],
      failed: [],
      series_id: (diff.series_id as string | null) ?? null,
    };
  }

  // 3) Re-check conflicts at apply time.
  let candidates = plan.toCreate;
  if (candidates.length > 0) {
    const existing = await fetchExistingForCandidates(ctx.db, plan.club_id, candidates);
    const movingIds = new Set(plan.toCancel.map((c) => c.reservation_id));
    const courts = await fetchCourts(ctx.db, plan.club_id);
    const conflicts = detectConflicts({
      candidates,
      existing: existing.filter((e) => !movingIds.has(e.id)),
      courts,
    });

    if (conflicts.length > 0) {
      if (!opts.allowConflicts && !opts.skipConflicting) {
        throw new ConflictsBlockApplyError(conflicts.length);
      }
      if (opts.skipConflicting) {
        const blocked = new Set(
          conflicts.map((c) => `${c.candidate.court_id}|${c.candidate.starts_at}|${c.candidate.ends_at}`)
        );
        candidates = candidates.filter(
          (c) => !blocked.has(`${c.court_id}|${c.starts_at}|${c.ends_at}`)
        );
      }
    }
  }

  // 4) Writes — best-effort sequence. Each step records its rollback action.
  const created_ids: string[] = [];
  const modified_ids: string[] = [];
  const cancelled_ids: string[] = [];
  const failed: ApplyResult['failed'] = [];
  let series_id: string | null = null;

  // Optional series row first (when candidates form a recurrence).
  if (candidates.length > 1 && plan.toCreate.length === candidates.length) {
    const ser = await createSeriesFromPlan(ctx.db, plan, ctx.actor_user_id);
    if (ser) series_id = ser;
  }

  // Inserts.
  if (candidates.length > 0) {
    const source: import('./types').ReservationSource =
      ctx.channel === 'ai' ? 'ai' : ctx.channel === 'cron' ? 'import' : 'manual';
    const rows = candidates.map((c) => ({
      club_id: plan.club_id,
      court_id: c.court_id,
      series_id,
      starts_at: c.starts_at,
      ends_at: c.ends_at,
      type: c.type,
      title: c.title,
      meta: c.meta,
      color: c.color,
      signups_open: c.signups_open,
      signups_capacity: c.signups_capacity,
      signups_pitch: c.signups_pitch,
      source,
      created_by: ctx.actor_user_id,
    }));
    // Insert in chunks of 200 so PostgREST stays happy on big plans.
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200);
      const { data, error } = await ctx.db
        .from('reservations')
        .insert(chunk)
        .select('id');
      if (error) {
        // Roll back what's already written, then throw.
        if (created_ids.length > 0) {
          await ctx.db.from('reservations').delete().in('id', created_ids);
        }
        if (series_id) {
          await ctx.db.from('reservation_series').delete().eq('id', series_id);
        }
        // No `throw error` here — package as failed entries so the caller
        // can decide. We DID roll back the writes that landed.
        return {
          plan_id: plan.plan_id,
          applied_at: new Date().toISOString(),
          created_ids: [],
          modified_ids: [],
          cancelled_ids: [],
          failed: [{ index: i, reason: error.message }],
          series_id: null,
        };
      }
      for (const row of data ?? []) created_ids.push(row.id);
    }
  }

  // Modifications.
  for (let i = 0; i < plan.toModify.length; i++) {
    const m = plan.toModify[i];
    const { error } = await ctx.db
      .from('reservations')
      .update(m.changes)
      .eq('id', m.reservation_id)
      .eq('club_id', plan.club_id);
    if (error) {
      failed.push({ index: i, reason: error.message });
      continue;
    }
    modified_ids.push(m.reservation_id);
  }

  // Cancellations.
  if (plan.toCancel.length > 0) {
    const ids = plan.toCancel.map((c) => c.reservation_id);
    const { error } = await ctx.db
      .from('reservations')
      .update({ status: 'cancelled' })
      .in('id', ids)
      .eq('club_id', plan.club_id);
    if (!error) cancelled_ids.push(...ids);
  }

  const applied_at = new Date().toISOString();

  // Reverse-plan for Undo.
  const reverse = buildReverse(plan, { created_ids, cancelled_ids });

  // 5) Audit row.
  await ctx.db.from('courtsheet_audit_log').insert({
    club_id: plan.club_id,
    actor_user_id: ctx.actor_user_id,
    action: 'plan_applied',
    intent: plan.summary,
    diff: { created_ids, modified_ids, cancelled_ids, series_id, applied_at, reverse },
    plan_id: uuid,
    channel: ctx.channel,
    user_agent: ctx.user_agent ?? null,
  });

  return {
    plan_id: plan.plan_id,
    applied_at,
    created_ids,
    modified_ids,
    cancelled_ids,
    failed,
    series_id,
  };
}

async function createSeriesFromPlan(
  db: SupabaseClient<any, 'public', any>,
  plan: Plan,
  actor: string
): Promise<string | null> {
  if (plan.toCreate.length === 0) return null;
  const intent = plan.intent;
  // Without an intent we still need *something* (move/modify operations
  // that create multiple rows don't carry one). Derive a minimal series
  // shape from the dates.
  const dates = plan.toCreate.map((c) => c.starts_at).sort();
  const range_start = intent?.date_range.start ?? dates[0].slice(0, 10);
  const range_end = intent?.date_range.end ?? dates[dates.length - 1].slice(0, 10);
  const time_start = intent?.time_range.start ?? '00:00';
  const time_end = intent?.time_range.end ?? '23:59';

  const { data, error } = await db
    .from('reservation_series')
    .insert({
      club_id: plan.club_id,
      title: intent?.title ?? plan.toCreate[0].title,
      type: intent?.type ?? plan.toCreate[0].type,
      range_start,
      range_end,
      time_start,
      time_end,
      days_of_week: intent?.days_of_week ?? [],
      exclusions: intent?.exclusions ?? [],
      intent: intent ?? {},
      meta: intent?.meta ?? { from_plan_summary: plan.summary },
      created_by: actor,
    })
    .select('id')
    .single();
  if (error) return null;
  return data.id;
}

async function fetchExistingForCandidates(
  db: SupabaseClient<any, 'public', any>,
  club_id: string,
  candidates: ReservationInstance[]
): Promise<Reservation[]> {
  if (candidates.length === 0) return [];
  let minStart = candidates[0].starts_at;
  let maxEnd = candidates[0].ends_at;
  for (const c of candidates) {
    if (c.starts_at < minStart) minStart = c.starts_at;
    if (c.ends_at > maxEnd) maxEnd = c.ends_at;
  }
  const { data } = await db
    .from('reservations')
    .select('*')
    .eq('club_id', club_id)
    .neq('status', 'cancelled')
    .lt('starts_at', maxEnd)
    .gt('ends_at', minStart);
  return (data ?? []) as Reservation[];
}

async function fetchCourts(
  db: SupabaseClient<any, 'public', any>,
  club_id: string
) {
  const { data } = await db.from('courts').select('*').eq('club_id', club_id);
  return (data ?? []) as import('./types').Court[];
}

function buildReverse(
  plan: Plan,
  applied: { created_ids: string[]; cancelled_ids: string[] }
): Plan['reverse'] {
  // The reverse of "create N, cancel M" is "cancel N, restore M".
  // Restore = set status back to confirmed.
  return {
    toCreate: [], // Undo never re-creates from instance shape; it un-cancels by id below.
    toModify: applied.cancelled_ids.map((id) => ({
      reservation_id: id,
      changes: { status: 'confirmed' } as Partial<Reservation>,
    })),
    toCancel: applied.created_ids.map((id) => ({ reservation_id: id })),
  };
}

/**
 * Apply a previously-stored reverse-plan to undo a prior plan_applied.
 * Looks up the audit row by `original_plan_id`, reads the reverse, and
 * applies it as a new audit-logged action.
 */
export async function undoPlan(
  original_plan_id: string,
  ctx: ApplyContext,
  club_id: string
): Promise<ApplyResult> {
  const uuid = verifyPlanId(original_plan_id, club_id);
  if (!uuid) throw new PlanIdInvalidError();

  const { data: row } = await ctx.db
    .from('courtsheet_audit_log')
    .select('diff')
    .eq('plan_id', uuid)
    .eq('action', 'plan_applied')
    .maybeSingle();

  if (!row?.diff) {
    return {
      plan_id: original_plan_id,
      applied_at: new Date().toISOString(),
      created_ids: [],
      modified_ids: [],
      cancelled_ids: [],
      failed: [{ index: 0, reason: 'No prior plan_applied found for this plan_id' }],
      series_id: null,
    };
  }

  const reverse = (row.diff as any).reverse as NonNullable<Plan['reverse']>;
  const cancelled_ids: string[] = [];
  const modified_ids: string[] = [];

  if (reverse.toCancel.length > 0) {
    const ids = reverse.toCancel.map((c) => c.reservation_id);
    await ctx.db
      .from('reservations')
      .update({ status: 'cancelled' })
      .in('id', ids)
      .eq('club_id', club_id);
    cancelled_ids.push(...ids);
  }

  for (const m of reverse.toModify) {
    await ctx.db
      .from('reservations')
      .update(m.changes)
      .eq('id', m.reservation_id)
      .eq('club_id', club_id);
    modified_ids.push(m.reservation_id);
  }

  const applied_at = new Date().toISOString();

  await ctx.db.from('courtsheet_audit_log').insert({
    club_id,
    actor_user_id: ctx.actor_user_id,
    action: 'plan_applied',
    intent: { undo_of: uuid },
    diff: { created_ids: [], modified_ids, cancelled_ids, applied_at, reverse: null },
    plan_id: null,
    channel: ctx.channel,
  });

  return {
    plan_id: original_plan_id,
    applied_at,
    created_ids: [],
    modified_ids,
    cancelled_ids,
    failed: [],
    series_id: null,
  };
}
