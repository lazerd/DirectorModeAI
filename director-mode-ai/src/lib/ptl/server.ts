/**
 * PTL server-side reads.
 *
 * Every PTL table except ptl_drafts and ptl_draft_picks is closed to anon, so
 * all reads go through getSupabaseAdmin() — the true service-role client.
 * NOTE: not createServiceClient(), which forwards the visitor's cookie and is
 * therefore still RLS-scoped; on a page with no signed-in visitor that returns
 * nothing at all.
 *
 * Columns are named explicitly, never select('*'). ptl_entries carries email
 * and phone for people who are not members of anything, and a public standings
 * page has no business shipping those to the browser.
 */

import 'server-only';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { computePtlStandings, type PtlMeetingRow, type PtlStandingRow, type PtlTeamRef } from './standings';

export type PtlSeason = {
  id: string;
  name: string;
  slug: string;
  status: string;
  entry_cents: number;
  roster_size: number;
  pick_seconds: number;
  courts_per_division: number;
  tagline: string | null;
  blurb: string | null;
  enroll_opens_at: string | null;
  enroll_closes_at: string | null;
  is_demo: boolean;
  demo_note: string | null;
};

export type PtlDivision = {
  id: string;
  name: string;
  short_code: string;
  tier: number;
  nightly_prize_cents: number;
  finals_prize_cents: number;
  day_of_week: number | null;
  start_time: string | null;
  end_time: string | null;
  line_format: 'open_two' | 'gendered_four';
  tiebreak_mode: 'cascade' | 'mixed';
};

export type PtlTeam = {
  id: string;
  name: string;
  short_code: string;
  color: string | null;
  division_id: string | null;
  draft_slot: number | null;
  captain_name: string | null;
  captain_is_playing: boolean;
};

const SEASON_COLS =
  'id, name, slug, status, entry_cents, roster_size, pick_seconds, courts_per_division, tagline, blurb, enroll_opens_at, enroll_closes_at, is_demo, demo_note';
const DIVISION_COLS =
  'id, name, short_code, tier, nightly_prize_cents, finals_prize_cents, day_of_week, start_time, end_time, line_format, tiebreak_mode';
const TEAM_COLS =
  'id, name, short_code, color, division_id, draft_slot, captain_name, captain_is_playing';

/** The season a public page is about. Falls back to the newest live season. */
export async function getSeason(slug?: string): Promise<PtlSeason | null> {
  const db = getSupabaseAdmin();
  let q = db.from('ptl_seasons').select(SEASON_COLS);
  if (slug) {
    q = q.eq('slug', slug);
  } else {
    // No slug means "whatever season is current" — anything that isn't a
    // scratch draft or archived, newest first.
    q = q.in('status', ['enrolling', 'drafting', 'running', 'complete']).order('created_at', { ascending: false });
  }
  const { data, error } = await q.limit(1).maybeSingle();
  if (error) {
    console.error('[ptl] getSeason', error.message);
    return null;
  }
  return (data as PtlSeason) || null;
}

export async function getDivisions(seasonId: string): Promise<PtlDivision[]> {
  const db = getSupabaseAdmin();
  const { data } = await db
    .from('ptl_divisions')
    .select(DIVISION_COLS)
    .eq('season_id', seasonId)
    .order('tier', { ascending: true });
  return (data as PtlDivision[]) || [];
}

export async function getTeams(seasonId: string): Promise<PtlTeam[]> {
  const db = getSupabaseAdmin();
  const { data } = await db
    .from('ptl_teams')
    .select(TEAM_COLS)
    .eq('season_id', seasonId)
    .order('draft_slot', { ascending: true, nullsFirst: false });
  return (data as PtlTeam[]) || [];
}

/**
 * Standings for every division in a season.
 *
 * One query for the meetings, then the pure computePtlStandings per division —
 * so the public table and the commissioner's table can never diverge.
 */
export async function getStandingsByDivision(
  seasonId: string,
): Promise<Map<string, PtlStandingRow[]>> {
  const db = getSupabaseAdmin();
  const teams = await getTeams(seasonId);

  const { data: meetings } = await db
    .from('ptl_meetings')
    .select('division_id, home_team_id, away_team_id, result, home_games, away_games')
    .eq('status', 'complete')
    .in('division_id', (await getDivisions(seasonId)).map((d) => d.id));

  const rows = (meetings as Array<{
    division_id: string;
    home_team_id: string;
    away_team_id: string;
    result: PtlMeetingRow['result'];
    home_games: number;
    away_games: number;
  }>) || [];

  const out = new Map<string, PtlStandingRow[]>();
  const divisions = await getDivisions(seasonId);
  for (const d of divisions) {
    const divTeams: PtlTeamRef[] = teams
      .filter((t) => t.division_id === d.id)
      .map((t) => ({ id: t.id, name: t.name, shortCode: t.short_code, divisionId: t.division_id }));
    const divMeetings: PtlMeetingRow[] = rows
      .filter((m) => m.division_id === d.id)
      .map((m) => ({
        homeTeamId: m.home_team_id,
        awayTeamId: m.away_team_id,
        result: m.result,
        homeGames: m.home_games,
        awayGames: m.away_games,
      }));
    out.set(d.id, computePtlStandings(divTeams, divMeetings));
  }
  return out;
}

export type PtlNight = {
  id: string;
  division_id: string;
  week_no: number | null;
  play_date: string;
  start_time: string | null;
  end_time: string | null;
  site_name: string | null;
  courts: number;
  is_finals: boolean;
  status: string;
  meetings: Array<{
    id: string;
    round_no: number;
    home_team_id: string;
    away_team_id: string;
    result: string;
    home_games: number;
    away_games: number;
    decided_at_level: number | null;
    status: string;
  }>;
};

/** The published grid — every night of the season with its meetings. */
export async function getSchedule(seasonId: string): Promise<PtlNight[]> {
  const db = getSupabaseAdmin();
  const divisionIds = (await getDivisions(seasonId)).map((d) => d.id);
  if (!divisionIds.length) return [];

  const { data: nights } = await db
    .from('ptl_nights')
    .select('id, division_id, week_no, play_date, start_time, end_time, site_name, courts, is_finals, status')
    .in('division_id', divisionIds)
    .order('play_date', { ascending: true });

  const nightRows = (nights as Omit<PtlNight, 'meetings'>[]) || [];
  if (!nightRows.length) return [];

  const { data: meetings } = await db
    .from('ptl_meetings')
    .select('id, night_id, round_no, home_team_id, away_team_id, result, home_games, away_games, decided_at_level, status')
    .in('night_id', nightRows.map((n) => n.id))
    .order('round_no', { ascending: true })
    .order('id', { ascending: true });

  const byNight = new Map<string, PtlNight['meetings']>();
  for (const m of (meetings as Array<PtlNight['meetings'][number] & { night_id: string }>) || []) {
    const { night_id, ...rest } = m;
    const list = byNight.get(night_id);
    if (list) list.push(rest);
    else byNight.set(night_id, [rest]);
  }

  return nightRows.map((n) => ({ ...n, meetings: byNight.get(n.id) || [] }));
}

/** Rosters keyed by team, with the player names the public pages show. */
export async function getRosters(
  seasonId: string,
): Promise<Map<string, Array<{ rosterId: string; name: string; acquired: string; ladder: number | null; composite: number | null }>>> {
  const db = getSupabaseAdmin();
  const { data } = await db
    .from('ptl_roster')
    .select('id, team_id, acquired, ladder_position, pick_no, ptl_entries(name, composite_score)')
    .eq('season_id', seasonId)
    .order('pick_no', { ascending: true, nullsFirst: true });

  const out = new Map<string, Array<{ rosterId: string; name: string; acquired: string; ladder: number | null; composite: number | null }>>();
  for (const r of (data as any[]) || []) {
    const entry = Array.isArray(r.ptl_entries) ? r.ptl_entries[0] : r.ptl_entries;
    const row = {
      rosterId: r.id as string,
      name: (entry?.name as string) || 'TBD',
      acquired: r.acquired as string,
      ladder: (r.ladder_position as number) ?? null,
      composite: (entry?.composite_score as number) ?? null,
    };
    const list = out.get(r.team_id);
    if (list) list.push(row);
    else out.set(r.team_id, [row]);
  }
  return out;
}

// ============================================
// Draft
// ============================================

export type PtlDraftState = {
  draft_id: string;
  season_id: string;
  status: 'pending' | 'live' | 'paused' | 'complete';
  pick_seconds: number;
  rounds: number;
  teams: number;
  current_pick_no: number | null;
  current_round_no: number | null;
  current_slot_no: number | null;
  on_the_clock_team_id: string | null;
  current_deadline_at: string | null;
  picks_made: number;
};

/** Reads the draft's authoritative state straight from the database function. */
export async function getDraftState(draftId: string): Promise<PtlDraftState | null> {
  const db = getSupabaseAdmin();
  const { data, error } = await db.rpc('ptl_draft_state', { p_draft: draftId });
  if (error) {
    console.error('[ptl] getDraftState', error.message);
    return null;
  }
  return data as PtlDraftState;
}

export async function getDraftForSeason(seasonId: string): Promise<{ id: string } | null> {
  const db = getSupabaseAdmin();
  const { data } = await db.from('ptl_drafts').select('id').eq('season_id', seasonId).maybeSingle();
  return (data as { id: string }) || null;
}

export type PtlPick = {
  pick_no: number;
  round_no: number;
  slot_no: number;
  team_id: string;
  entry_id: string;
  is_auto: boolean;
  player_name: string;
  composite: number | null;
};

export async function getPicks(draftId: string): Promise<PtlPick[]> {
  const db = getSupabaseAdmin();
  const { data } = await db
    .from('ptl_draft_picks')
    .select('pick_no, round_no, slot_no, team_id, entry_id, is_auto, ptl_entries(name, composite_score)')
    .eq('draft_id', draftId)
    .order('pick_no', { ascending: true });

  return ((data as any[]) || []).map((p) => {
    const entry = Array.isArray(p.ptl_entries) ? p.ptl_entries[0] : p.ptl_entries;
    return {
      pick_no: p.pick_no,
      round_no: p.round_no,
      slot_no: p.slot_no,
      team_id: p.team_id,
      entry_id: p.entry_id,
      is_auto: p.is_auto,
      player_name: (entry?.name as string) || 'Unknown',
      composite: (entry?.composite_score as number) ?? null,
    };
  });
}

export type PtlPoolPlayer = {
  id: string;
  name: string;
  gender: 'm' | 'f' | null;
  home_club: string | null;
  ntrp: number | null;
  utr: number | null;
  wtn: number | null;
  composite: number | null;
  rating_confidence: string | null;
};

/**
 * Players still available to draft, best first.
 *
 * Contact details are deliberately not selected: the pool is rendered in a
 * draft room whose only credential is a shareable token, so it must not carry
 * a hundred people's phone numbers.
 */
export async function getAvailablePool(seasonId: string): Promise<PtlPoolPlayer[]> {
  const db = getSupabaseAdmin();
  const { data: taken } = await db.from('ptl_roster').select('entry_id').eq('season_id', seasonId);
  const takenIds = new Set(((taken as { entry_id: string }[]) || []).map((r) => r.entry_id));

  const { data } = await db
    .from('ptl_entries')
    .select('id, name, gender, home_club, ntrp, utr, wtn, composite_score, rating_confidence')
    .eq('season_id', seasonId)
    .eq('status', 'confirmed')
    .order('composite_score', { ascending: false, nullsFirst: false });

  return ((data as any[]) || [])
    .filter((e) => !takenIds.has(e.id))
    .map((e) => ({
      id: e.id,
      name: e.name,
      gender: e.gender ?? null,
      home_club: e.home_club,
      ntrp: e.ntrp,
      utr: e.utr,
      wtn: e.wtn,
      composite: e.composite_score,
      rating_confidence: e.rating_confidence,
    }));
}

/**
 * Resolve a captain's draft-room token.
 *
 * The token IS the credential — the same pattern CaptainMode uses so a captain
 * at a club that has never heard of us can do their job without an account.
 */
export async function getTeamByToken(token: string): Promise<{
  team: PtlTeam & { season_id: string };
  season: PtlSeason;
  draftId: string | null;
} | null> {
  if (!token || token.length < 8) return null;
  const db = getSupabaseAdmin();

  const { data: team } = await db
    .from('ptl_teams')
    .select(`${TEAM_COLS}, season_id`)
    .eq('team_token', token)
    .maybeSingle();
  if (!team) return null;

  const { data: season } = await db
    .from('ptl_seasons')
    .select(SEASON_COLS)
    .eq('id', (team as any).season_id)
    .maybeSingle();
  if (!season) return null;

  const draft = await getDraftForSeason((team as any).season_id);
  return {
    team: team as PtlTeam & { season_id: string },
    season: season as PtlSeason,
    draftId: draft?.id ?? null,
  };
}

/** A captain's private wishlist, in their order. */
export async function getQueue(draftId: string, teamId: string): Promise<string[]> {
  const db = getSupabaseAdmin();
  const { data } = await db
    .from('ptl_draft_queue')
    .select('entry_id, rank')
    .eq('draft_id', draftId)
    .eq('team_id', teamId)
    .order('rank', { ascending: true });
  return ((data as { entry_id: string }[]) || []).map((r) => r.entry_id);
}
