/**
 * Shared server helpers for authenticated CaptainMode routes.
 * Mirrors the shape of src/lib/courtsheet/routeAuth.ts: return either a
 * context or a ready-made NextResponse error.
 */
import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { getCaptainAccess, canAccessTeam } from './access';
import {
  pairRecordsFrom,
  type CaptainingStyle,
  type EligibilityRules,
  type PairRecord,
} from './lineup';
import type { SupabaseClient } from '@supabase/supabase-js';

export type CaptainCtx = {
  userId: string;
  teamId: string;
  team: TeamRow;
  db: SupabaseClient;
};

export type TeamRow = {
  id: string;
  captain_user_id: string;
  club_id: string | null;
  name: string;
  league_type: string;
  level: string | null;
  eligibility_enabled: boolean;
  min_matches_default: number;
  min_matches_self_rated: number;
  season_start: string | null;
  season_end: string | null;
  captaining_style: string | null;
  poll_lead_days: number | null;
  lineup_lead_days: number | null;
};

export type RouteError = { error: NextResponse };

export function isError<T>(v: T | RouteError): v is RouteError {
  return !!v && typeof v === 'object' && 'error' in (v as object);
}

/** Auth + subscription + team-membership in one call. */
export async function requireTeam(teamId: string): Promise<CaptainCtx | RouteError> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: NextResponse.json({ error: 'Not signed in.' }, { status: 401 }) };
  }

  const access = await getCaptainAccess(user.id);
  if (!access.active) {
    return {
      error: NextResponse.json(
        { error: 'CaptainMode subscription required.', upgrade_url: '/captain/subscribe' },
        { status: 402 },
      ),
    };
  }

  if (!(await canAccessTeam(user.id, teamId))) {
    return { error: NextResponse.json({ error: 'Team not found.' }, { status: 404 }) };
  }

  const db = await createServiceClient();
  const { data } = await db.from('captain_teams').select('*').eq('id', teamId).maybeSingle();
  if (!data) return { error: NextResponse.json({ error: 'Team not found.' }, { status: 404 }) };

  return { userId: user.id, teamId, team: data as TeamRow, db };
}

/** Auth + subscription only (for routes that create a team). */
export async function requireCaptain(): Promise<
  { userId: string; db: SupabaseClient } | RouteError
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: NextResponse.json({ error: 'Not signed in.' }, { status: 401 }) };
  }
  const access = await getCaptainAccess(user.id);
  if (!access.active) {
    return {
      error: NextResponse.json(
        { error: 'CaptainMode subscription required.', upgrade_url: '/captain/subscribe' },
        { status: 402 },
      ),
    };
  }
  return { userId: user.id, db: await createServiceClient() };
}

/** Combined-rating cap for combo/mixed levels like "7.5" or "8.5 combo". */
export function capForTeam(team: { league_type: string; level: string | null }): number | null {
  if (team.league_type !== 'usta_combo' && team.league_type !== 'usta_mixed') return null;
  const m = (team.level || '').match(/(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = Number(m[1]);
  // Combined caps are 6.0–11.0; anything else is a single-player NTRP level.
  return n >= 6 && n <= 11 ? n : null;
}

/** Default lead times, matching the constants the cron used to hardcode. */
export const DEFAULT_POLL_LEAD_DAYS = 21;
export const DEFAULT_LINEUP_LEAD_DAYS = 7;

/**
 * How the captain wants the season distributed. Anything unrecognised falls
 * back to play_to_win, which is the historical behaviour — a bad value in the
 * column must never silently start benching people.
 */
export function styleFor(team: { captaining_style?: string | null }): CaptainingStyle {
  return team.captaining_style === 'equal_play' ? 'equal_play' : 'play_to_win';
}

/**
 * Scheduling lead times. Read from the team so a captain whose league wants a
 * 10-day lineup isn't stuck on the built-in 7, and clamped because these drive
 * automatic email sends — a negative or absurd value would either spam or
 * silently never fire.
 */
export function leadDaysFor(team: {
  poll_lead_days?: number | null;
  lineup_lead_days?: number | null;
}): { poll: number; lineup: number } {
  const clamp = (v: number | null | undefined, dflt: number) => {
    const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : dflt;
    return Math.min(120, Math.max(1, n));
  };
  const lineup = clamp(team.lineup_lead_days, DEFAULT_LINEUP_LEAD_DAYS);
  const poll = clamp(team.poll_lead_days, DEFAULT_POLL_LEAD_DAYS);
  // Asking for availability after the lineup has gone out is meaningless.
  return { poll: Math.max(poll, lineup), lineup };
}

/**
 * Eligibility rules as the generator wants them. Defaults to disabled so a
 * league with no playoffs (East Bay Women's, most flex leagues) shows nothing.
 */
export function rulesFor(team: {
  eligibility_enabled?: boolean | null;
  min_matches_default?: number | null;
  min_matches_self_rated?: number | null;
}): EligibilityRules {
  return {
    enabled: !!team.eligibility_enabled,
    minMatchesDefault: team.min_matches_default ?? 2,
    minMatchesSelfRated: team.min_matches_self_rated ?? 3,
  };
}

/**
 * Win/loss record for every partnership on this team, from entered scores.
 * Feeds the generator's chemistry signal.
 */
export async function pairRecords(
  db: SupabaseClient,
  teamId: string,
): Promise<PairRecord[]> {
  const { data: played } = await db
    .from('captain_matches')
    .select('id')
    .eq('team_id', teamId)
    .eq('status', 'played');
  const ids = ((played as { id: string }[]) || []).map((m) => m.id);
  if (!ids.length) return [];

  const [{ data: lineups }, { data: results }] = await Promise.all([
    db
      .from('captain_lineups')
      .select('match_id, court_number, player1_id, player2_id')
      .in('match_id', ids),
    db.from('captain_results').select('match_id, court_number, won').in('match_id', ids),
  ]);

  const wonBy = new Map<string, boolean | null>();
  for (const r of (results as { match_id: string; court_number: number; won: boolean | null }[]) ||
    []) {
    wonBy.set(`${r.match_id}:${r.court_number}`, r.won);
  }

  return pairRecordsFrom(
    ((lineups as {
      match_id: string;
      court_number: number;
      player1_id: string | null;
      player2_id: string | null;
    }[]) || []).map((l) => ({
      player1Id: l.player1_id,
      player2Id: l.player2_id,
      won: wonBy.get(`${l.match_id}:${l.court_number}`) ?? null,
    })),
  );
}

/** Matches actually played, per player, from saved lineups. */
export async function playedCounts(
  db: SupabaseClient,
  teamId: string,
): Promise<Record<string, number>> {
  const { data: played } = await db
    .from('captain_matches')
    .select('id')
    .eq('team_id', teamId)
    .eq('status', 'played');
  const ids = ((played as { id: string }[]) || []).map((m) => m.id);
  if (!ids.length) return {};

  const { data: rows } = await db
    .from('captain_lineups')
    .select('player1_id, player2_id, match_id')
    .in('match_id', ids);

  const counts: Record<string, number> = {};
  for (const r of (rows as { player1_id: string | null; player2_id: string | null }[]) || []) {
    for (const id of [r.player1_id, r.player2_id]) {
      if (id) counts[id] = (counts[id] ?? 0) + 1;
    }
  }
  return counts;
}
