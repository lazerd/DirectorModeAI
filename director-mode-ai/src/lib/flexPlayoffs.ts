import type { getSupabaseAdmin } from '@/lib/supabase/admin';
import {
  allPairs, groupStandings, isGroupComplete, pairKey,
  flexDivisionBySlug, type FlexDivisionCfg, type FlexPlayoffCfg,
} from '@/lib/flexDivisions';

type Admin = ReturnType<typeof getSupabaseAdmin>;

/**
 * Auto-populate Summer Flex League PLACEMENT PLAYOFFS.
 *
 * Every flex division that runs two parallel flights/pools finishes with a
 * placement playoff: flight A's #1 plays flight B's #1 for the title, #2 plays
 * #2 for 3rd, #3 plays #3 for 5th, and so on down to the shorter flight.
 *
 * Two independent steps, so the board shows the bracket the moment it can:
 *
 *   1. SKELETON — as soon as EITHER feeder flight is finished, create the
 *      placement rows with both sides TBD.
 *   2. FILL — seat each finished flight's finishers into its own side
 *      (flight A -> side a, flight B -> side b), independently of the other.
 *
 * Idempotent: rows are keyed by (event_id, bracket, round, slot) and a side is
 * only ever written when it is still empty, so this never clobbers a played
 * match or a manual correction. Safe to call on every page load and after every
 * score save.
 *
 * NOTE: `bracket` is CHECK-constrained to 'main' | 'consolation', so playoff
 * rows live on 'main' at a dedicated high round (90+) that no round-robin or
 * compass round can reach.
 */
export async function syncFlexPlayoffs(
  admin: Admin,
  eventId: string,
  cfg: FlexDivisionCfg,
): Promise<{ created: number; filled: number; reason: string }> {
  const nothing = (reason: string) => ({ created: 0, filled: 0, reason });
  if (!cfg.playoffs?.length || !cfg.groups) return nothing('no-playoffs-configured');

  const { data: entryRows } = await admin
    .from('tournament_entries')
    .select('id, player_name, partner_name')
    .eq('event_id', eventId);
  const entries = (entryRows as Array<{ id: string; player_name: string; partner_name: string | null }>) || [];
  if (entries.length === 0) return nothing('no-entries');

  const nameById = new Map(
    entries.map((e) => [e.id, e.partner_name ? `${e.player_name} / ${e.partner_name}` : e.player_name] as const)
  );
  const idByName = new Map([...nameById.entries()].map(([id, name]) => [name, id] as const));
  const isDoubles = entries.some((e) => !!e.partner_name);

  const { data: matchRows } = await admin
    .from('tournament_matches')
    .select('id, round, slot, player1_id, player3_id, score, winner_side, status')
    .eq('event_id', eventId)
    .eq('bracket', 'main');
  const rows = (matchRows as Array<Record<string, unknown>>) || [];

  // Scored view keyed by name pair — the same shape the /flex board reads, so
  // "complete" and "standings" here mean exactly what the board displays.
  const scored = rows.map((m) => ({
    a: nameById.get(m.player1_id as string) || 'TBD',
    b: nameById.get(m.player3_id as string) || 'TBD',
    score: (m.score as string) || '',
    winner_side: (m.winner_side as 'a' | 'b' | null) || null,
    status: m.status as string,
  }));
  const byPair = new Map(scored.map((m) => [pairKey(m.a, m.b), m] as const));
  /** Only the pairings that belong to this flight — never cross-flight rows. */
  const matchesOf = (members: string[]) =>
    allPairs(members)
      .map(([a, b]) => byPair.get(pairKey(a, b)))
      .filter((m): m is NonNullable<typeof m> => !!m);

  let created = 0;
  let filled = 0;

  for (const po of cfg.playoffs) {
    const res = await syncOne(admin, eventId, cfg, po, matchesOf, idByName, rows, isDoubles);
    created += res.created;
    filled += res.filled;
  }

  return { created, filled, reason: 'ok' };
}

async function syncOne(
  admin: Admin,
  eventId: string,
  cfg: FlexDivisionCfg,
  po: FlexPlayoffCfg,
  matchesOf: (members: string[]) => { a: string; b: string; score: string; winner_side: 'a' | 'b' | null; status: string }[],
  idByName: Map<string, string>,
  rows: Array<Record<string, unknown>>,
  isDoubles: boolean,
): Promise<{ created: number; filled: number }> {
  const sides = po.from.map((title) => cfg.groups![title] || []);
  if (sides.some((s) => s.length === 0)) return { created: 0, filled: 0 };

  const complete = sides.map((members) => isGroupComplete(members, matchesOf(members)));
  // Nothing to show until at least one flight has actually finished.
  if (!complete[0] && !complete[1]) return { created: 0, filled: 0 };

  // Uneven flights pair down to the shorter one; the extras place by flight rank.
  const n = Math.min(sides[0].length, sides[1].length);
  if (n === 0) return { created: 0, filled: 0 };

  const existing = new Map<number, Record<string, unknown>>();
  for (const r of rows) if ((r.round as number) === po.round) existing.set(r.slot as number, r);

  // 1) SKELETON
  const toCreate: Record<string, unknown>[] = [];
  for (let i = 1; i <= n; i++) {
    if (!existing.has(i)) {
      toCreate.push({
        event_id: eventId,
        bracket: 'main',
        round: po.round,
        slot: i,
        match_type: isDoubles ? 'doubles' : 'singles',
        player1_id: null,
        player3_id: null,
      });
    }
  }
  let created = 0;
  if (toCreate.length) {
    const { data: ins, error } = await admin
      .from('tournament_matches')
      .insert(toCreate)
      .select('id, round, slot, player1_id, player3_id, status');
    if (error) return { created: 0, filled: 0 };
    created = toCreate.length;
    for (const m of (ins as Array<Record<string, unknown>>) || []) existing.set(m.slot as number, m);
  }

  // 2) FILL — seat each finished flight into its own side, only where empty.
  let filled = 0;
  for (let k = 0; k < 2; k++) {
    if (!complete[k]) continue;
    const standings = groupStandings(sides[k], matchesOf(sides[k]));
    const field = k === 0 ? 'player1_id' : 'player3_id';
    for (let i = 1; i <= n; i++) {
      const row = existing.get(i);
      if (!row || row[field]) continue;
      const entryId = idByName.get(standings[i - 1]?.name || '');
      if (!entryId) continue;
      const { error } = await admin
        .from('tournament_matches')
        .update({ [field]: entryId })
        .eq('id', row.id as string);
      if (!error) { row[field] = entryId; filled++; }
    }
  }

  return { created, filled };
}

/** Convenience wrapper: resolve the division config from the event's slug. */
export async function syncFlexPlayoffsForEvent(admin: Admin, eventId: string) {
  const { data: ev } = await admin.from('events').select('slug').eq('id', eventId).maybeSingle();
  const slug = (ev as { slug?: string } | null)?.slug;
  if (!slug) return null;
  const cfg = flexDivisionBySlug(slug);
  if (!cfg) return null;
  return syncFlexPlayoffs(admin, eventId, cfg);
}
