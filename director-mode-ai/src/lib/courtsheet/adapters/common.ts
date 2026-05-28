/**
 * CourtSheet adapter — shared infrastructure.
 *
 * The adapters are wrappers around the engine that other tools call to
 * keep CourtSheet in sync with their state. Mixer events, Quads matches,
 * Tournament matches, etc. → reservations via these.
 *
 * Design:
 *   - Adapter writes are gated by ENABLE_COURTSHEET_WRITES=true. Off by
 *     default so a Phase 3 deploy doesn't activate cross-tool writes until
 *     explicitly opted in (per [[feedback_dont_break_live_systems]]).
 *   - Each adapter is idempotent: called with the same (source, source_id)
 *     it upserts the reservation rather than creating duplicates.
 *   - Failures are LOGGED, never thrown back to the calling tool — a broken
 *     adapter must not break the underlying tool's flow.
 */

import { getSupabaseAdmin } from '@/lib/supabase/admin';
import type { SupabaseClient } from '@supabase/supabase-js';

export const ADAPTERS_ENABLED = process.env.ENABLE_COURTSHEET_WRITES === 'true';

export interface AdapterContext {
  db: SupabaseClient<any, 'public', any>;
}

export function getAdapterContext(): AdapterContext {
  return { db: getSupabaseAdmin() };
}

/**
 * Resolve a user's "primary" cc_clubs row — the one this tool's writes
 * should land into. Mirrors the requireStaffForClub() logic but for
 * server-to-server adapter use (no auth header).
 */
export async function resolveUserClubId(
  db: SupabaseClient<any, 'public', any>,
  user_id: string
): Promise<string | null> {
  const { data } = await db
    .from('cc_clubs')
    .select('id')
    .eq('owner_id', user_id)
    .order('name', { ascending: true })
    .limit(1)
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

/**
 * Resolve a court label (number-as-string or name) against a club's
 * courts table. Wraps the SQL function from migration 008.
 */
export async function resolveCourtId(
  db: SupabaseClient<any, 'public', any>,
  club_id: string,
  label: string | number
): Promise<string | null> {
  const labelStr = String(label);
  const { data } = await db.rpc('courtsheet_resolve_court', {
    p_club_id: club_id,
    p_label: labelStr,
  });
  return (data as string | null) ?? null;
}

/**
 * Idempotent upsert keyed by (source, source_id). Wraps the SQL function
 * from migration 008. Returns the reservation_id, or null if the EXCLUDE
 * constraint rejected (caller should log + surface).
 */
export async function upsertReservation(
  db: SupabaseClient<any, 'public', any>,
  args: {
    club_id: string;
    court_id: string;
    starts_at: string;
    ends_at: string;
    type: string;
    source: string;
    source_id: string;
    title: string;
    created_by: string;
    meta?: Record<string, unknown>;
  }
): Promise<{ ok: true; reservation_id: string } | { ok: false; reason: string }> {
  const { data, error } = await db.rpc('courtsheet_upsert_reservation', {
    p_club_id: args.club_id,
    p_court_id: args.court_id,
    p_starts_at: args.starts_at,
    p_ends_at: args.ends_at,
    p_type: args.type,
    p_source: args.source,
    p_source_id: args.source_id,
    p_title: args.title,
    p_created_by: args.created_by,
    p_meta: args.meta ?? {},
  });
  if (error) return { ok: false, reason: error.message };
  return { ok: true, reservation_id: data as string };
}

/**
 * Cancel any reservations linked to a (source, source_id) tuple. Used
 * when the source row is deleted/cancelled in its own tool.
 */
export async function cancelReservationsBySource(
  db: SupabaseClient<any, 'public', any>,
  source: string,
  source_id: string
): Promise<number> {
  const { data } = await db
    .from('reservations')
    .update({ status: 'cancelled' })
    .eq('source', source)
    .eq('source_id', source_id)
    .neq('status', 'cancelled')
    .select('id');
  return data?.length ?? 0;
}

/**
 * Write an audit row for an adapter run.
 */
export async function logAdapterRun(
  db: SupabaseClient<any, 'public', any>,
  args: {
    club_id: string;
    actor_user_id: string | null;
    action: 'plan_applied' | 'reservation_edit' | 'reservation_cancel';
    intent: Record<string, unknown>;
    diff: Record<string, unknown>;
    channel: 'api';
  }
): Promise<void> {
  await db.from('courtsheet_audit_log').insert({
    club_id: args.club_id,
    actor_user_id: args.actor_user_id,
    action: args.action,
    intent: args.intent,
    diff: args.diff,
    channel: args.channel,
  });
}

/**
 * Wrap an adapter run with the standard try/log/no-throw semantics.
 * Returns the function's value on success, or null on any failure
 * (failures are logged to console but never thrown back to the caller).
 */
export async function safeRun<T>(
  name: string,
  fn: () => Promise<T>
): Promise<T | null> {
  if (!ADAPTERS_ENABLED) return null;
  try {
    return await fn();
  } catch (err) {
    console.error(`[courtsheet adapter] ${name} failed:`, err);
    return null;
  }
}
