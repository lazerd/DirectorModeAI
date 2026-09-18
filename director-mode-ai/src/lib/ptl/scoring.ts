/**
 * Writing scores, and resolving what they mean.
 *
 * The rules themselves live in ./meeting.ts, which is pure and tested. This
 * module is the thin layer that reads the rows, asks that function, and writes
 * the answer back — so the match-night screen, the standings page and any
 * future recap all reach the same verdict from the same code.
 *
 * The important property: a meeting is NEVER resolved by whoever happens to be
 * typing. Entering a line score recomputes the whole meeting from scratch,
 * every time. That means a corrected score three days later produces a correct
 * meeting, and a meeting that needs a tiebreak stays unresolved and says so
 * rather than quietly picking a winner while two pairs stand on court.
 */

import 'server-only';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import {
  parseGames,
  resolveMeeting,
  type LineFormat,
  type LineInput,
  type LineKind,
  type MeetingOutcome,
  type ShootoutInput,
  type ShootoutKind,
  type TiebreakMode,
} from './meeting';

export type NightMeeting = {
  id: string;
  round_no: number;
  home_team_id: string;
  away_team_id: string;
  result: string;
  status: string;
  decided_at_level: number | null;
  home_games: number;
  away_games: number;
  lines: Array<{
    id: string;
    line_type: 'singles' | 'doubles';
    line_kind: LineKind;
    is_decider: boolean;
    score: string | null;
    home_games: number | null;
    away_games: number | null;
    winner: 'home' | 'away' | null;
    court_label: string | null;
    status: string;
  }>;
  shootouts: Array<{ kind: ShootoutKind; home_pts: number; away_pts: number }>;
  /** What resolveMeeting says right now — including what is still needed. */
  outcome: MeetingOutcome;
};

export type NightView = {
  id: string;
  token: string;
  week_no: number | null;
  play_date: string;
  start_time: string | null;
  site_name: string | null;
  courts: number;
  is_finals: boolean;
  status: string;
  seasonId: string;
  seasonName: string;
  seasonSlug: string;
  isDemo: boolean;
  demoNote: string | null;
  divisionName: string;
  teams: Array<{ id: string; name: string; short_code: string; color: string | null }>;
  meetings: NightMeeting[];
};

function toLineInputs(lines: NightMeeting['lines']): LineInput[] {
  return lines.map((l) => ({
    lineType: l.line_type,
    lineKind: l.line_kind,
    isDecider: l.is_decider,
    winner: l.winner,
    homeGames: l.home_games,
    awayGames: l.away_games,
  }));
}

function toShootoutInputs(rows: NightMeeting['shootouts']): ShootoutInput[] {
  return rows.map((s) => ({ kind: s.kind, homePts: s.home_pts, awayPts: s.away_pts }));
}

/** Everything the match-night console renders, by its night token. */
export async function getNightByToken(token: string): Promise<NightView | null> {
  if (!token || token.length < 16) return null;
  const db = getSupabaseAdmin();

  const { data: night } = await db
    .from('ptl_nights')
    .select(
      'id, night_token, division_id, week_no, play_date, start_time, site_name, courts, is_finals, status',
    )
    .eq('night_token', token)
    .maybeSingle();
  if (!night) return null;
  const n = night as any;

  const { data: division } = await db
    .from('ptl_divisions')
    .select('id, name, season_id, line_format, tiebreak_mode')
    .eq('id', n.division_id)
    .maybeSingle();
  if (!division) return null;

  const { data: season } = await db
    .from('ptl_seasons')
    .select('id, name, slug, is_demo, demo_note')
    .eq('id', (division as any).season_id)
    .maybeSingle();
  if (!season) return null;

  const [{ data: teams }, { data: meetingRows }] = await Promise.all([
    db
      .from('ptl_teams')
      .select('id, name, short_code, color')
      .eq('division_id', (division as any).id),
    db
      .from('ptl_meetings')
      .select('id, round_no, home_team_id, away_team_id, result, status, decided_at_level, home_games, away_games')
      .eq('night_id', n.id)
      // round_no then id: two meetings share each round, so round alone leaves
      // their order to the database and the console can reshuffle between
      // refetches while someone is mid-score.
      .order('round_no', { ascending: true })
      .order('id', { ascending: true }),
  ]);

  const meetingIds = ((meetingRows as any[]) || []).map((m) => m.id);
  const [{ data: lineRows }, { data: shootoutRows }] = await Promise.all([
    meetingIds.length
      ? db
          .from('ptl_lines')
          .select('id, meeting_id, line_type, line_kind, is_decider, score, home_games, away_games, winner, court_label, status')
          .in('meeting_id', meetingIds)
          .order('line_type', { ascending: true })
      : Promise.resolve({ data: [] as any[] }),
    meetingIds.length
      ? db
          .from('ptl_shootouts')
          .select('meeting_id, kind, home_pts, away_pts')
          .in('meeting_id', meetingIds)
      : Promise.resolve({ data: [] as any[] }),
  ]);

  const meetings: NightMeeting[] = ((meetingRows as any[]) || []).map((m) => {
    const lines = ((lineRows as any[]) || []).filter((l) => l.meeting_id === m.id);
    const shootouts = ((shootoutRows as any[]) || []).filter((s) => s.meeting_id === m.id);
    return {
      id: m.id,
      round_no: m.round_no,
      home_team_id: m.home_team_id,
      away_team_id: m.away_team_id,
      result: m.result,
      status: m.status,
      decided_at_level: m.decided_at_level,
      home_games: m.home_games,
      away_games: m.away_games,
      lines,
      shootouts,
      outcome: resolveMeeting(
        toLineInputs(lines),
        toShootoutInputs(shootouts),
        ((division as any).tiebreak_mode as TiebreakMode) ?? 'cascade',
        ((division as any).line_format as LineFormat) ?? 'open_two',
      ),
    };
  });

  return {
    id: n.id,
    token: n.night_token,
    week_no: n.week_no,
    play_date: n.play_date,
    start_time: n.start_time,
    site_name: n.site_name,
    courts: n.courts,
    is_finals: n.is_finals,
    status: n.status,
    seasonId: (season as any).id,
    seasonName: (season as any).name,
    seasonSlug: (season as any).slug,
    isDemo: (season as any).is_demo,
    demoNote: (season as any).demo_note,
    divisionName: (division as any).name,
    teams: (teams as any[]) || [],
    meetings,
  };
}

/**
 * Recompute one meeting from whatever is currently recorded against it.
 *
 * Called after every write. Idempotent by design — running it twice on
 * unchanged rows produces the same answer — so a double-tapped Save cannot
 * corrupt a result.
 */
export async function recomputeMeeting(meetingId: string): Promise<MeetingOutcome> {
  const db = getSupabaseAdmin();

  /*
   * The division's format has to come along. Resolving without it silently
   * falls back to the two-line cascade, which on a gendered meeting would
   * count the mixed decider as a fifth line and settle a 2-2 that was supposed
   * to go to it.
   */
  const { data: meeting } = await db
    .from('ptl_meetings')
    .select('division_id')
    .eq('id', meetingId)
    .maybeSingle();
  const { data: division } = meeting
    ? await db
        .from('ptl_divisions')
        .select('line_format, tiebreak_mode')
        .eq('id', (meeting as any).division_id)
        .maybeSingle()
    : { data: null };

  const mode = (((division as any)?.tiebreak_mode as TiebreakMode) ?? 'cascade');
  const format = (((division as any)?.line_format as LineFormat) ?? 'open_two');

  const [{ data: lines }, { data: shootouts }] = await Promise.all([
    db
      .from('ptl_lines')
      .select('line_type, line_kind, is_decider, winner, home_games, away_games')
      .eq('meeting_id', meetingId),
    db.from('ptl_shootouts').select('kind, home_pts, away_pts').eq('meeting_id', meetingId),
  ]);

  const lineInputs: LineInput[] = ((lines as any[]) || []).map((l) => ({
    lineType: l.line_type,
    lineKind: l.line_kind,
    isDecider: l.is_decider,
    winner: l.winner,
    homeGames: l.home_games,
    awayGames: l.away_games,
  }));
  const shootoutInputs: ShootoutInput[] = ((shootouts as any[]) || []).map((s) => ({
    kind: s.kind,
    homePts: s.home_pts,
    awayPts: s.away_pts,
  }));

  const outcome = resolveMeeting(lineInputs, shootoutInputs, mode, format);

  if (outcome.state === 'decided') {
    await db
      .from('ptl_meetings')
      .update({
        result: outcome.winner,
        home_games: outcome.homeGames,
        away_games: outcome.awayGames,
        home_lines_won: outcome.homeLines,
        away_lines_won: outcome.awayLines,
        decided_at_level: outcome.level,
        status: 'complete',
      })
      .eq('id', meetingId);
  } else {
    // Not decided: clear any previous verdict rather than leaving a stale one.
    // A corrected score that un-decides a meeting must un-decide the table too.
    const counted = lineInputs.filter((l) => !l.isDecider);
    const homeGames = counted.reduce((n, l) => n + (l.homeGames ?? 0), 0);
    const awayGames = counted.reduce((n, l) => n + (l.awayGames ?? 0), 0);
    await db
      .from('ptl_meetings')
      .update({
        result: 'pending',
        home_games: homeGames,
        away_games: awayGames,
        home_lines_won: counted.filter((l) => l.winner === 'home').length,
        away_lines_won: counted.filter((l) => l.winner === 'away').length,
        decided_at_level: null,
        status: outcome.state === 'awaiting_lines' && homeGames + awayGames === 0 ? 'pending' : 'live',
      })
      .eq('id', meetingId);
  }

  return outcome;
}

/**
 * Record a line score.
 *
 * `score` is what the person typed ("4-2 4-1"); games are parsed from it and
 * the winner is taken from the games rather than asked for separately — one
 * fewer thing to get wrong at 9pm, and it makes "winner" and "score" incapable
 * of disagreeing.
 */
export async function applyLineScore(
  lineId: string,
  score: string,
  reportedBy?: string | null,
): Promise<{ ok: true; meetingId: string; outcome: MeetingOutcome } | { ok: false; error: string }> {
  const db = getSupabaseAdmin();

  const { data: line } = await db
    .from('ptl_lines')
    .select('id, meeting_id')
    .eq('id', lineId)
    .maybeSingle();
  if (!line) return { ok: false, error: 'That line does not exist.' };

  const trimmed = score.trim();
  if (!trimmed) {
    // Clearing a score is legitimate — a mistyped result has to be removable.
    await db
      .from('ptl_lines')
      .update({ score: null, home_games: null, away_games: null, winner: null, status: 'pending' })
      .eq('id', lineId);
    const outcome = await recomputeMeeting((line as any).meeting_id);
    return { ok: true, meetingId: (line as any).meeting_id, outcome };
  }

  const [homeGames, awayGames] = parseGames(trimmed);
  if (homeGames === 0 && awayGames === 0) {
    return { ok: false, error: 'Write the score as games, like "4-2 4-1".' };
  }
  if (homeGames === awayGames) {
    return { ok: false, error: 'A line cannot finish level on games — check the score.' };
  }

  await db
    .from('ptl_lines')
    .update({
      score: trimmed,
      home_games: homeGames,
      away_games: awayGames,
      winner: homeGames > awayGames ? 'home' : 'away',
      status: 'complete',
      reported_at: new Date().toISOString(),
      reported_by_name: reportedBy || null,
    })
    .eq('id', lineId);

  const outcome = await recomputeMeeting((line as any).meeting_id);
  return { ok: true, meetingId: (line as any).meeting_id, outcome };
}

/** Record a tiebreak the players have just come off court from. */
export async function applyShootout(
  meetingId: string,
  kind: ShootoutKind,
  homePts: number,
  awayPts: number,
): Promise<{ ok: true; outcome: MeetingOutcome } | { ok: false; error: string }> {
  if (!Number.isInteger(homePts) || !Number.isInteger(awayPts) || homePts < 0 || awayPts < 0) {
    return { ok: false, error: 'Points must be whole numbers.' };
  }
  if (homePts === awayPts) {
    return { ok: false, error: 'A tiebreak cannot finish level — check the points.' };
  }

  const db = getSupabaseAdmin();
  const { error } = await db
    .from('ptl_shootouts')
    .upsert(
      { meeting_id: meetingId, kind, home_pts: homePts, away_pts: awayPts },
      { onConflict: 'meeting_id,kind' },
    );
  if (error) return { ok: false, error: 'Could not save that tiebreak.' };

  return { ok: true, outcome: await recomputeMeeting(meetingId) };
}

/**
 * A night is complete when every meeting on it is. Called after each write so
 * the schedule page flips from "Upcoming" to "Played" on its own.
 */
export async function refreshNightStatus(nightId: string): Promise<void> {
  const db = getSupabaseAdmin();
  const { data } = await db.from('ptl_meetings').select('status').eq('night_id', nightId);
  const rows = (data as { status: string }[]) || [];
  if (!rows.length) return;
  const allDone = rows.every((m) => m.status === 'complete');
  const anyStarted = rows.some((m) => m.status !== 'pending');
  await db
    .from('ptl_nights')
    .update({ status: allDone ? 'complete' : anyStarted ? 'live' : 'scheduled' })
    .eq('id', nightId);
}
