/**
 * Server-side loader for a rotating-partner mixer's public board: round-by-
 * round courts, sit-outs and individual standings, keyed by the event code
 * players already have.
 *
 * Reads through the service-role client on purpose. `matches` has no anon
 * grant (RLS lockdown), so a player's phone can't read the schedule directly —
 * which also left the "Courts & Matches" tab on /event/[code] empty for anyone
 * not signed in. This returns only what the printed sheet on the club board
 * would show — names, courts, scores — and only for the formats in
 * lib/mixerBoard, so it doesn't widen what any other format exposes.
 *
 * Server only: imports the admin client.
 */

import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { computeIndividualStandings, isRotatingPartnerFormat, type IndividualStanding } from '@/lib/mixerBoard';

export interface BoardPerson {
  id: string;
  name: string;
}

export interface BoardCourt {
  court_number: number;
  teamA: BoardPerson[];
  teamB: BoardPerson[];
  scoreA: number | null;
  scoreB: number | null;
  scored: boolean;
}

export interface BoardRound {
  round_number: number;
  status: string;
  start_time: string | null;
  timer_paused_at: string | null;
  courts: BoardCourt[];
  sitOuts: BoardPerson[];
}

export interface EventBoard {
  event: {
    name: string;
    event_code: string;
    event_date: string;
    start_time: string | null;
    venue: string | null;
    match_format: string;
    scoring_format: string;
    round_length_minutes: number | null;
  };
  players: BoardPerson[];
  rounds: BoardRound[];
  standings: IndividualStanding[];
  anyScores: boolean;
}

export const FORMAT_NAMES: Record<string, string> = {
  doubles: 'Doubles mixer',
  'mixed-doubles': 'Mixed doubles mixer',
  'maximize-courts': 'Mixer',
};

export async function loadEventBoard(eventCode: string): Promise<EventBoard | null> {
  const admin = getSupabaseAdmin();
  const { data: ev } = await admin
    .from('events')
    .select('id, name, event_code, event_date, start_time, venue, match_format, scoring_format, round_length_minutes')
    .eq('event_code', eventCode.toUpperCase())
    .maybeSingle();
  if (!ev || !isRotatingPartnerFormat((ev as any).match_format)) return null;
  const e = ev as any;

  const [{ data: eps }, { data: rounds }] = await Promise.all([
    admin.from('event_players').select('player_id, players(name)').eq('event_id', e.id),
    admin
      .from('rounds')
      .select('id, round_number, status, start_time, timer_paused_at')
      .eq('event_id', e.id)
      .order('round_number', { ascending: true }),
  ]);

  const players: BoardPerson[] = ((eps as any[]) || [])
    .map((ep) => ({ id: ep.player_id as string, name: (ep.players?.name as string) || 'Player' }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const nameOf = new Map(players.map((p) => [p.id, p.name]));
  const person = (id: string | null): BoardPerson | null =>
    id ? { id, name: nameOf.get(id) || 'Player' } : null;

  const roundIds = ((rounds as any[]) || []).map((r) => r.id);
  const { data: matches } = roundIds.length
    ? await admin
        .from('matches')
        .select('round_id, court_number, player1_id, player2_id, player3_id, player4_id, team1_score, team2_score, winner_team')
        .in('round_id', roundIds)
    : { data: [] as any[] };
  const allMatches = (matches as any[]) || [];

  const boardRounds: BoardRound[] = ((rounds as any[]) || []).map((r) => {
    const rows = allMatches
      .filter((m) => m.round_id === r.id)
      .sort((a, b) => a.court_number - b.court_number);
    const courts: BoardCourt[] = [];
    const sitOuts: BoardPerson[] = [];
    for (const m of rows) {
      if (m.player1_id && !m.player2_id && !m.player3_id && !m.player4_id) {
        sitOuts.push(person(m.player1_id)!);
        continue;
      }
      const scored = m.winner_team != null || (m.team1_score ?? 0) > 0 || (m.team2_score ?? 0) > 0;
      courts.push({
        court_number: m.court_number,
        teamA: [person(m.player1_id), person(m.player3_id)].filter((p): p is BoardPerson => !!p),
        teamB: [person(m.player2_id), person(m.player4_id)].filter((p): p is BoardPerson => !!p),
        scoreA: scored ? m.team1_score ?? 0 : null,
        scoreB: scored ? m.team2_score ?? 0 : null,
        scored,
      });
    }
    sitOuts.sort((a, b) => a.name.localeCompare(b.name));
    return {
      round_number: r.round_number,
      status: r.status,
      start_time: r.start_time ?? null,
      timer_paused_at: r.timer_paused_at ?? null,
      courts,
      sitOuts,
    };
  });

  return {
    event: {
      name: e.name,
      event_code: e.event_code,
      event_date: e.event_date,
      start_time: e.start_time,
      venue: e.venue ?? null,
      match_format: e.match_format,
      scoring_format: e.scoring_format,
      round_length_minutes: e.round_length_minutes ?? null,
    },
    players,
    rounds: boardRounds,
    standings: computeIndividualStandings(players, allMatches),
    anyScores: boardRounds.some((r) => r.courts.some((c) => c.scored)),
  };
}
