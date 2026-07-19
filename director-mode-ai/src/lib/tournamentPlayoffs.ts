import type { getSupabaseAdmin } from '@/lib/supabase/admin';
import {
  detectPools, poolStandings, isPoolComplete, type PoolMatch,
} from './tournamentPools';

type Admin = ReturnType<typeof getSupabaseAdmin>;

type MatchRow = PoolMatch & { id: string; match_type: string };

/**
 * Keep a 2-pool round-robin event's PLACEMENT PLAYOFF in sync with its pools.
 *
 * This runs in two independent steps so the director sees the full bracket up
 * front instead of waiting for every pool to finish:
 *
 *   1. SKELETON — as soon as the two pools are known (i.e. the RR draw exists),
 *      create the placement matches with BOTH sides left as TBD (null players),
 *      one per placement (Pool A rank i vs Pool B rank i). Now the desk shows the
 *      true total match count, including the playoffs still to come.
 *
 *   2. FILL — the moment ONE pool's round-robin is complete, drop that pool's
 *      finishers into their side of each placement match, even if the other pool
 *      is still playing. Pool A → side A, Pool B → side B, independently.
 *
 * Idempotent and safe to call after every score save, and on desk load. Only
 * acts on rr-singles / rr-doubles events with exactly two pools. Placement
 * matches live at round = (RR ceiling)+1, bracket 'main' — cross-pool, so they
 * never pollute any pool's standings and no schema change is needed.
 */
export async function syncPlacementPlayoffs(
  admin: Admin,
  eventId: string,
): Promise<{ created: number; filled: number; reason: string }> {
  const nothing = (reason: string) => ({ created: 0, filled: 0, reason });

  // Placement playoffs only make sense for round-robin events. Elimination /
  // compass / consolation formats advance through their own feed logic, and
  // their match graph must never be mistaken for "two pools".
  const { data: ev } = await admin
    .from('events')
    .select('match_format')
    .eq('id', eventId)
    .maybeSingle();
  const format = (ev as any)?.match_format as string | undefined;
  if (format !== 'rr-singles' && format !== 'rr-doubles') return nothing('not-round-robin');

  const { data: entryRows } = await admin
    .from('tournament_entries')
    .select('id, position')
    .eq('event_id', eventId);
  const entryIds = (entryRows || [])
    .filter((e: any) => e.position === 'in_draw')
    .map((e: any) => e.id as string);
  if (entryIds.length === 0) return nothing('no-entries');

  const { data: matchRows } = await admin
    .from('tournament_matches')
    .select('id, bracket, round, slot, match_type, player1_id, player3_id, status, score, winner_side')
    .eq('event_id', eventId);
  const all = (matchRows || []) as MatchRow[];
  const main = all.filter((m) => m.bracket === 'main');
  if (main.length === 0) return nothing('no-matches');

  const pools = detectPools(entryIds, main);
  if (pools.length !== 2) return nothing('not-two-pools');

  // The RR ceiling is the highest round among WITHIN-pool matches (both players
  // in the same pool). Placement matches sit one round above it. Computing the
  // ceiling from within-pool matches only keeps it stable even after the
  // placement rows (cross-pool / TBD) have been created.
  const poolOf = new Map<string, number>();
  pools.forEach((p, i) => p.forEach((id) => poolOf.set(id, i)));
  const isWithinPool = (m: MatchRow) =>
    !!m.player1_id && !!m.player3_id &&
    poolOf.has(m.player1_id) && poolOf.has(m.player3_id) &&
    poolOf.get(m.player1_id) === poolOf.get(m.player3_id);
  const rrCeiling = main.reduce((mx, m) => (isWithinPool(m) ? Math.max(mx, m.round) : mx), 0);
  const placementRound = rrCeiling + 1;

  // One placement match per rank down to the smaller pool (uneven pools pair to
  // the shorter one; extra players place by pool rank).
  const n = Math.min(pools[0].length, pools[1].length);
  if (n === 0) return nothing('empty-pool');

  const matchType = main[0]?.match_type || 'singles';

  // Existing placement rows live at placementRound. Anything at that round is a
  // placement match (nothing else is scheduled above the RR ceiling).
  const bySlot = new Map<number, MatchRow>();
  for (const m of main) if (m.round === placementRound) bySlot.set(m.slot, m);

  // 1) SKELETON — create any missing placement rows with TBD players.
  const toCreate: Record<string, any>[] = [];
  for (let i = 1; i <= n; i++) {
    if (!bySlot.has(i)) {
      toCreate.push({
        event_id: eventId,
        bracket: 'main',
        round: placementRound,
        slot: i,
        match_type: matchType,
        player1_id: null,
        player3_id: null,
        winner_feeds_to: null,
        loser_feeds_to: null,
      });
    }
  }
  let created = 0;
  if (toCreate.length) {
    const { data: ins, error } = await admin
      .from('tournament_matches')
      .insert(toCreate)
      .select('id, bracket, round, slot, match_type, player1_id, player3_id, status, score, winner_side');
    if (error) return { created: 0, filled: 0, reason: `insert-failed: ${error.message}` };
    created = toCreate.length;
    for (const m of (ins || []) as MatchRow[]) bySlot.set(m.slot, m);
  }

  // 2) FILL — for each COMPLETE pool, seat its finishers into their side. Pool A
  // (index 0) fills side A (player1_id); Pool B (index 1) fills side B
  // (player3_id). Independent: one pool can be seated while the other still plays.
  // Only fill an empty side, so this never overwrites a placement already set.
  let filled = 0;
  for (let k = 0; k < 2; k++) {
    if (!isPoolComplete(pools[k], main)) continue;
    const standings = poolStandings(pools[k], main);
    const sideField = k === 0 ? 'player1_id' : 'player3_id';
    for (let i = 1; i <= n; i++) {
      const row = bySlot.get(i);
      if (!row) continue;
      const current = k === 0 ? row.player1_id : row.player3_id;
      if (current) continue;
      const entryId = standings[i - 1]?.entry_id;
      if (!entryId) continue;
      const { error } = await admin
        .from('tournament_matches')
        .update({ [sideField]: entryId })
        .eq('id', row.id);
      if (!error) {
        filled++;
        if (k === 0) row.player1_id = entryId;
        else row.player3_id = entryId;
      }
    }
  }

  return { created, filled, reason: 'ok' };
}

/** @deprecated Use {@link syncPlacementPlayoffs}. Kept for older imports. */
export const maybeGeneratePlacementPlayoffs = syncPlacementPlayoffs;
