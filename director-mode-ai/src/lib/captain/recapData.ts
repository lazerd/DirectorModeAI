/**
 * Everything a recap needs about one played match, in one round of queries.
 *
 * Shared by the send route and the AI drafting route so the two can never
 * disagree about what happened: the model writes to the same scoreline and
 * season record the email will print underneath it.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { formatMatchWhen, type MatchInfo, type RecapCourtRow } from './emails';
import { CLUB_TZ } from './clubTime';
import {
  firstName,
  seasonRecord,
  tallyCourts,
  type RecapOutcome,
  type RecapVars,
  type TemplateRow,
} from './recap';

export const RECAP_MATCH_COLUMNS =
  'id, team_id, match_at, is_home, opponent, location, arrival_note, status, recap_sent_at';

export type RecapPlayer = {
  id: string;
  name: string;
  email: string | null;
  player_token: string;
};

type LineupRow = {
  court_number: number;
  court_type: 'singles' | 'doubles';
  player1_id: string | null;
  player2_id: string | null;
};

type ResultRow = {
  court_number: number;
  score: string | null;
  won: boolean | null;
  defaulted: boolean | null;
};

export type RecapContext = {
  match: MatchInfo;
  /** Active players with an email — everyone the recap would go to. */
  roster: RecapPlayer[];
  courts: RecapCourtRow[];
  tally: { won: number; lost: number; outcome: RecapOutcome; scoreline: string };
  record: { wins: number; losses: number; ties: number; label: string };
  nextMatch: MatchInfo | null;
  templates: TemplateRow[];
  /** False when no court scores have been saved — nothing to recap yet. */
  hasResults: boolean;
};

export function recapMatchInfo(m: Record<string, unknown>): MatchInfo {
  return {
    id: m.id as string,
    matchAt: m.match_at as string,
    isHome: m.is_home as boolean,
    opponent: (m.opponent as string) || null,
    location: (m.location as string) || null,
    arrivalNote: (m.arrival_note as string) || null,
    opposingCaptainName: null,
    opposingCaptainPhone: null,
  };
}

export async function loadRecapContext(
  db: SupabaseClient,
  matchRow: Record<string, unknown>,
  teamId: string,
): Promise<RecapContext> {
  const matchId = matchRow.id as string;

  const [{ data: players }, { data: lineups }, { data: results }, { data: templates }] =
    await Promise.all([
      db
        .from('captain_players')
        .select('id, name, email, player_token')
        .eq('team_id', teamId)
        .eq('active', true)
        .order('name'),
      db
        .from('captain_lineups')
        .select('court_number, court_type, player1_id, player2_id')
        .eq('match_id', matchId)
        .order('court_number'),
      db
        .from('captain_results')
        .select('court_number, score, won, defaulted')
        .eq('match_id', matchId),
      db.from('captain_recap_templates').select('outcome, subject, body').eq('team_id', teamId),
    ]);

  const all = (players as RecapPlayer[]) || [];
  const nameOf = (id: string | null) => (id ? (all.find((p) => p.id === id)?.name ?? '—') : '—');

  /**
   * Courts come from the LINEUP, so the recap names who played. A score row
   * with no matching court (a line scored before the lineup was built) still
   * shows up rather than vanishing off the scoreboard.
   */
  const lineupRows = (lineups as LineupRow[]) || [];
  const resultRows = (results as ResultRow[]) || [];
  const courtNumbers = [
    ...new Set([...lineupRows.map((l) => l.court_number), ...resultRows.map((r) => r.court_number)]),
  ].sort((a, b) => a - b);

  const courts: RecapCourtRow[] = courtNumbers.map((n) => {
    const l = lineupRows.find((x) => x.court_number === n) || null;
    const res = resultRows.find((x) => x.court_number === n) || null;
    const ids = l
      ? ([l.player1_id, l.court_type === 'doubles' ? l.player2_id : null].filter(
          Boolean,
        ) as string[])
      : [];
    return {
      courtNumber: n,
      courtType: (l?.court_type ?? 'doubles') as 'singles' | 'doubles',
      names: ids.length ? ids.map(nameOf) : ['—'],
      playerIds: ids,
      score: res?.score ?? null,
      won: res?.won ?? null,
      defaulted: res?.defaulted === true,
    };
  });

  // Season record, this match included, counted per match rather than per court.
  const { data: seasonMatches } = await db
    .from('captain_matches')
    .select('id')
    .eq('team_id', teamId)
    .eq('status', 'played');
  const playedIds = [
    ...new Set([...(((seasonMatches as { id: string }[]) || []).map((m) => m.id)), matchId]),
  ];
  const { data: seasonResults } = await db
    .from('captain_results')
    .select('match_id, won')
    .in('match_id', playedIds);
  const seasonRows = (seasonResults as { match_id: string; won: boolean | null }[]) || [];

  // Next fixture, so the recap ends looking forward instead of stopping dead.
  const { data: nextRow } = await db
    .from('captain_matches')
    .select('id, match_at, is_home, opponent, location, arrival_note')
    .eq('team_id', teamId)
    .eq('status', 'scheduled')
    .gt('match_at', matchRow.match_at as string)
    .order('match_at')
    .limit(1)
    .maybeSingle();

  return {
    match: recapMatchInfo(matchRow),
    roster: all.filter((p) => !!p.email),
    courts,
    tally: tallyCourts(courts),
    record: seasonRecord(
      playedIds.map((id) => ({ matchId: id, courts: seasonRows.filter((r) => r.match_id === id) })),
    ),
    nextMatch: nextRow ? recapMatchInfo(nextRow as Record<string, unknown>) : null,
    templates: (templates as TemplateRow[]) || [],
    hasResults: resultRows.length > 0,
  };
}

/** The substitution set for one reader. */
export function recapVars(ctx: RecapContext, teamName: string, playerName: string): RecapVars {
  return {
    team: teamName,
    name: firstName(playerName),
    opponent: ctx.match.opponent || 'them',
    when: formatMatchWhen(ctx.match.matchAt, CLUB_TZ),
    home_away: ctx.match.isHome ? 'home' : 'away',
    score: ctx.tally.scoreline,
    result: ctx.tally.outcome,
    record: ctx.record.label,
  };
}
