import type { getSupabaseAdmin } from '@/lib/supabase/admin';
import {
  detectPools, poolStandings, readyForPlayoffs, planPlacementPlayoffs, type PoolMatch,
} from './tournamentPools';

type Admin = ReturnType<typeof getSupabaseAdmin>;

type MatchRow = PoolMatch & { id: string; match_type: string };

// Auto-generate a multi-pool event's placement playoff the moment its pools
// finish. Idempotent and safe to call after every score save: it only acts on a
// 2-pool round-robin event whose pool matches are all complete and whose
// placement matches don't exist yet. Placement matches are cross-pool (Pool A
// rank i vs Pool B rank i), stored at round = maxRR+1 — no schema change needed.
export async function maybeGeneratePlacementPlayoffs(
  admin: Admin,
  eventId: string,
): Promise<{ generated: number; reason: string }> {
  // Placement playoffs only make sense for round-robin events. Elimination /
  // compass / consolation formats advance through their own feed logic, and
  // their match graph must never be mistaken for "two pools".
  const { data: ev } = await admin
    .from('events')
    .select('match_format')
    .eq('id', eventId)
    .maybeSingle();
  const format = (ev as any)?.match_format as string | undefined;
  if (format !== 'rr-singles' && format !== 'rr-doubles') {
    return { generated: 0, reason: 'not-round-robin' };
  }

  const { data: entryRows } = await admin
    .from('tournament_entries')
    .select('id, position')
    .eq('event_id', eventId);
  const entryIds = (entryRows || []).filter((e: any) => e.position === 'in_draw').map((e: any) => e.id as string);
  if (entryIds.length === 0) return { generated: 0, reason: 'no-entries' };

  const { data: matchRows } = await admin
    .from('tournament_matches')
    .select('id, bracket, round, slot, match_type, player1_id, player3_id, status, score, winner_side')
    .eq('event_id', eventId);
  const all = (matchRows || []) as MatchRow[];
  const main = all.filter((m) => m.bracket === 'main');
  if (main.length === 0) return { generated: 0, reason: 'no-matches' };

  const pools = detectPools(entryIds, main);
  if (pools.length !== 2) return { generated: 0, reason: 'not-two-pools' };

  // Idempotency: any cross-pool match means the playoff is already generated.
  const poolOf = new Map<string, number>();
  pools.forEach((p, i) => p.forEach((id) => poolOf.set(id, i)));
  const crossPoolExists = main.some(
    (m) => m.player1_id && m.player3_id &&
      poolOf.has(m.player1_id) && poolOf.has(m.player3_id) &&
      poolOf.get(m.player1_id) !== poolOf.get(m.player3_id),
  );
  if (crossPoolExists) return { generated: 0, reason: 'already-generated' };

  if (!readyForPlayoffs(pools, main)) return { generated: 0, reason: 'rr-incomplete' };

  const standings = pools.map((p) => poolStandings(p, main));
  const { pairs } = planPlacementPlayoffs(pools, standings);
  if (pairs.length === 0) return { generated: 0, reason: 'no-pairs' };

  const maxRound = main.reduce((mx, m) => Math.max(mx, m.round), 0);
  const playoffRound = maxRound + 1;
  const matchType = main[0]?.match_type || 'singles';

  const rows = pairs.map((p) => ({
    event_id: eventId,
    bracket: 'main',
    round: playoffRound,
    slot: p.slot,
    match_type: matchType,
    player1_id: p.sideA,
    player3_id: p.sideB,
    winner_feeds_to: null,
    loser_feeds_to: null,
  }));

  const { error } = await admin.from('tournament_matches').insert(rows);
  if (error) return { generated: 0, reason: `insert-failed: ${error.message}` };
  return { generated: rows.length, reason: 'ok' };
}
