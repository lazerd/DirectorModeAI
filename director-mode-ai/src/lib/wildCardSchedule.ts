/**
 * Writes a Wild Card schedule into rounds + matches.
 *
 * Takes the caller's Supabase client, so from the director's browser every
 * write runs under their session and RLS (owner or club staff) decides.
 *
 * Locked rounds — started, completed, or with any score entered — are never
 * touched. They feed the generator as history, and only the rounds after them
 * are (re)built. So "Re-shuffle" mid-morning keeps what's been played and
 * still avoids those partners.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveCourtList } from '@/lib/quads';
import {
  generateWildCard,
  rowsToWildCardRound,
  wildCardRoundToRows,
  wildCardStats,
  type WildCardMode,
  type WildCardRound,
} from '@/lib/wildCard';

export interface WildCardEventLite {
  id: string;
  num_courts: number;
  court_names?: string[] | null;
}

export interface BuildWildCardArgs {
  mode: WildCardMode;
  /** Total rounds the day should have, including any locked ones. */
  totalRounds: number;
  seed: number;
}

export interface BuildWildCardResult {
  built: number;
  locked: number;
  players: number;
  stats: ReturnType<typeof wildCardStats>;
}

type RoundRow = { id: string; round_number: number; status: string };
type MatchRow = {
  round_id: string;
  court_number: number;
  player1_id: string | null;
  player2_id: string | null;
  player3_id: string | null;
  player4_id: string | null;
  team1_score: number | null;
  team2_score: number | null;
  winner_team: number | null;
};

export async function buildWildCardSchedule(
  supabase: SupabaseClient<any, any, any>,
  event: WildCardEventLite,
  args: BuildWildCardArgs,
): Promise<BuildWildCardResult> {
  const { data: eps, error: epErr } = await supabase
    .from('event_players')
    .select('player_id, players(gender)')
    .eq('event_id', event.id)
    .eq('active', true);
  if (epErr) throw new Error(epErr.message);
  const players = ((eps as any[]) || []).map((ep) => ({
    id: ep.player_id as string,
    gender: (ep.players?.gender as string | null) ?? null,
  }));
  if (players.length < 4) throw new Error('Check in at least 4 players to build a Wild Card.');

  const { data: roundRows, error: rErr } = await supabase
    .from('rounds')
    .select('id, round_number, status')
    .eq('event_id', event.id)
    .order('round_number');
  if (rErr) throw new Error(rErr.message);
  const rounds = (roundRows as RoundRow[]) || [];

  const { data: matchRows, error: mErr } = rounds.length
    ? await supabase
        .from('matches')
        .select('round_id, court_number, player1_id, player2_id, player3_id, player4_id, team1_score, team2_score, winner_team')
        .in('round_id', rounds.map((r) => r.id))
    : { data: [] as MatchRow[], error: null };
  if (mErr) throw new Error(mErr.message);
  const matches = (matchRows as MatchRow[]) || [];

  const isLocked = (r: RoundRow) =>
    r.status !== 'upcoming' ||
    matches.some(
      (m) => m.round_id === r.id && (m.winner_team != null || (m.team1_score ?? 0) > 0 || (m.team2_score ?? 0) > 0),
    );
  // Everything up to the last locked round stays; everything after is rebuilt.
  let lastLocked = -1;
  rounds.forEach((r, i) => {
    if (isLocked(r)) lastLocked = i;
  });
  const keep = rounds.slice(0, lastLocked + 1);
  const replace = rounds.slice(lastLocked + 1);

  const history: WildCardRound[] = keep.map((r) =>
    rowsToWildCardRound(matches.filter((m) => m.round_id === r.id)),
  );
  const toBuild = Math.max(0, args.totalRounds - keep.length);
  const fresh = generateWildCard({
    players,
    courts: event.num_courts,
    rounds: toBuild,
    mode: args.mode,
    seed: args.seed,
    history,
  });

  if (replace.length) {
    const ids = replace.map((r) => r.id);
    const { error: dmErr } = await supabase.from('matches').delete().in('round_id', ids);
    if (dmErr) throw new Error(dmErr.message);
    const { error: drErr } = await supabase.from('rounds').delete().in('id', ids);
    if (drErr) throw new Error(drErr.message);
  }

  const courtList = resolveCourtList({ courtNames: event.court_names, numCourts: event.num_courts });
  const courtFor = (slot: number) => {
    const n = parseInt(courtList[slot], 10);
    return Number.isFinite(n) ? n : slot + 1;
  };

  const startAt = (keep[keep.length - 1]?.round_number ?? 0) + 1;
  for (let i = 0; i < fresh.length; i++) {
    const { data: round, error: insErr } = await supabase
      .from('rounds')
      .insert({ event_id: event.id, round_number: startAt + i, status: 'upcoming' })
      .select('id')
      .single();
    if (insErr || !round) throw new Error(insErr?.message || 'Could not create round');
    const rows = wildCardRoundToRows(fresh[i], courtFor).map((row) => ({ ...row, round_id: (round as any).id }));
    const { error: mInsErr } = await supabase.from('matches').insert(rows);
    if (mInsErr) throw new Error(mInsErr.message);
  }

  const { error: evErr } = await supabase
    .from('events')
    .update({ wild_card_mode: args.mode, wild_card_rounds: args.totalRounds, wild_card_seed: args.seed })
    .eq('id', event.id);
  if (evErr) throw new Error(evErr.message);

  return {
    built: fresh.length,
    locked: keep.length,
    players: players.length,
    stats: wildCardStats([...history, ...fresh]),
  };
}
