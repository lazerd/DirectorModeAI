/**
 * Shared server helpers for authenticated CaptainMode routes.
 * Mirrors the shape of src/lib/courtsheet/routeAuth.ts: return either a
 * context or a ready-made NextResponse error.
 */
import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { getCaptainAccess, gateTeam } from './access';
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
  /** Lines a match is played over. Null falls back to the league default. */
  default_singles_courts: number | null;
  default_doubles_courts: number | null;
  /** The league site's own id for this team. */
  source_team_id: string | null;
  /** Courts we host on — decides how the lines are scheduled. */
  court_format: number | null;
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

  // Co-captains ride on the team owner's subscription, so this is one
  // team-scoped check rather than "does the viewer pay" + "is the viewer on it".
  const gate = await gateTeam(user.id, teamId);
  if (gate === 'needs_subscription') {
    return {
      error: NextResponse.json(
        { error: 'CaptainMode subscription required.', upgrade_url: '/captain/subscribe' },
        { status: 402 },
      ),
    };
  }
  if (gate !== 'ok') {
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

type LineupRow = {
  player1_id: string | null;
  player2_id: string | null;
  match_id: string;
  court_number: number;
};

/**
 * Matches per player — counted once per MATCH, not once per row.
 *
 * For every adult league these are the same number, because a player takes one
 * court in a team match and there is exactly one row naming them. Junior Team
 * Tennis breaks that: a JTT sheet legitimately names the same child on a
 * singles line and two doubles lines, so row-counting credited her with three
 * matches for one Sunday. That is not a display quirk — it feeds the
 * equal-play tier gate and the playoff-eligibility table, so a child who had
 * played once would read as ahead of the field and get benched for it.
 *
 * A defaulted court is skipped either way: the team banks the point, but the
 * players named on it never hit a ball.
 */
function countDistinctMatches(rows: LineupRow[], skip: Set<string>): Record<string, number> {
  const seen = new Set<string>();
  const counts: Record<string, number> = {};
  for (const r of rows || []) {
    if (skip.has(`${r.match_id}:${r.court_number}`)) continue;
    for (const id of [r.player1_id, r.player2_id]) {
      if (!id) continue;
      const once = `${r.match_id}:${id}`;
      if (seen.has(once)) continue;
      seen.add(once);
      counts[id] = (counts[id] ?? 0) + 1;
    }
  }
  return counts;
}

/**
 * Matches each player is already COMMITTED to, per player.
 *
 * This — not playedCounts — is the fairness signal, and the difference is the
 * whole ballgame. A season is planned in advance: when the captain builds the
 * lineup for match 2, match 1 has not happened yet, so nothing has status
 * 'played' and playedCounts returns all zeros. Every player then looks equally
 * rested, equal_play's tier gate has nothing to bite on, and the generator
 * falls straight through to strength — handing the same eight people match
 * after match. A saved lineup is a promise to the player, so it counts from
 * the moment it is saved, not from the moment a score is entered.
 *
 * Cancelled matches never count; nobody played them.
 *
 * `excludeMatchId` is required in practice: regenerating match 2 must not
 * count match 2's own saved lineup, which would penalise exactly the players
 * it just seated and flip the lineup every time the captain pressed the button.
 */
export async function committedCounts(
  db: SupabaseClient,
  teamId: string,
  excludeMatchId?: string,
): Promise<Record<string, number>> {
  const { data: matches } = await db
    .from('captain_matches')
    .select('id')
    .eq('team_id', teamId)
    .neq('status', 'cancelled');

  const ids = ((matches as { id: string }[]) || [])
    .map((m) => m.id)
    .filter((id) => id !== excludeMatchId);
  if (!ids.length) return {};

  const { data: rows } = await db
    .from('captain_lineups')
    .select('player1_id, player2_id, match_id, court_number')
    .in('match_id', ids);

  /**
   * A defaulted court is a result without a match: the point is won or lost,
   * but nobody played. Crediting it would tell a captain that a player is
   * covered for playoff eligibility when they are still on zero, and would
   * push them down the fairness order for a match they never got.
   */
  const { data: defaults } = await db
    .from('captain_results')
    .select('match_id, court_number')
    .in('match_id', ids)
    .eq('defaulted', true);
  const skip = new Set(
    ((defaults as { match_id: string; court_number: number }[]) || []).map(
      (d) => `${d.match_id}:${d.court_number}`,
    ),
  );

  return countDistinctMatches(rows as LineupRow[], skip);
}

/**
 * Matches actually played, per player, from saved lineups.
 * Factual reporting only (the eligibility table and the equal-play panel) —
 * see committedCounts for the number the generator plans against.
 *
 * A defaulted court is skipped, exactly as committedCounts skips it: the team
 * banked a win or a loss but the two players named on it never hit a ball, and
 * crediting them would tell a captain someone is covered for playoff
 * eligibility while they are still on zero. The results route has claimed this
 * was true since defaults were added; it was only true of committedCounts.
 */
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

  const [{ data: rows }, { data: defaults }] = await Promise.all([
    db
      .from('captain_lineups')
      .select('player1_id, player2_id, match_id, court_number')
      .in('match_id', ids),
    db
      .from('captain_results')
      .select('match_id, court_number')
      .in('match_id', ids)
      .eq('defaulted', true),
  ]);
  const skip = new Set(
    ((defaults as { match_id: string; court_number: number }[]) || []).map(
      (d) => `${d.match_id}:${d.court_number}`,
    ),
  );

  return countDistinctMatches(rows as LineupRow[], skip);
}
