import type Anthropic from '@anthropic-ai/sdk';
import type { DomainPack, ToolDef, ToolResult } from '../framework';
import { resolveClubCtx, MANAGER_ROLES } from '../clubContext';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { CLUB_TZ } from '@/lib/captain/clubTime';
import {
  autoAssignRoundBalanced,
  computeDivisionStandings,
  computePlayerRecords,
  optimizeLines,
  recomputeLadder,
} from '@/lib/jtt';
import { isValidWtn, setWtnForPerson, MIN_WTN, MAX_WTN } from '@/lib/ratings/wtn';

/*
 * Leagues pack — the team-format leagues (JTT-style: clubs, divisions,
 * matchups, lines) that this user DIRECTS, from any page.
 *
 * Complements the JTT match-day pack (packs/jtt.ts), which only works on a
 * matchup page and only on TODAY's matchups (check-in/out, quick roster add).
 * This pack works on any date: lineups, moving players between lines, scores,
 * standings, rosters with parent contacts, ratings, fairness, rescheduling.
 *
 * SCOPE. Only leagues with leagues.director_id = this user — the same check
 * every /api/leagues write route makes. Every division, matchup, line and
 * roster row is reached through those league ids, so another director's data
 * is unreachable even though the client is service-role.
 *
 * SAME PATHS AS THE APP.
 *   - Lineups use optimizeLines + autoAssignRoundBalanced, as the matchup page.
 *   - Scores write the exact line patch the coach scoring routes write
 *     (/api/leagues/line/[token], matchday submitScore) and then re-ladder both
 *     clubs with recomputeLadder, as they do. The team result is the DB
 *     trigger's job (recompute_matchup_from_lines) — never written here.
 *   - WTN goes to the PERSON (master_players) via setWtnForPerson, which
 *     pushes it to every mirror; the league roster copy is refreshed too.
 *
 * WHAT IT DELIBERATELY CANNOT DO: send any email/SMS, touch TennisLink/TopDog
 * or any outside system, set a team score by hand, or touch CaptainMode teams.
 * Every write previews first; preview and run share one prepare step.
 */

type Admin = ReturnType<typeof getSupabaseAdmin>;

export interface LeagueRow {
  id: string;
  name: string;
  status: string;
  start_date: string | null;
  end_date: string | null;
  club_id: string | null;
}

export interface LeaguesCtx {
  userId: string;
  db: Admin;
  /** Team-format leagues this user directs. Never empty (resolve returns null). */
  leagues: LeagueRow[];
  /** The ClubMode club they're running, if any — names "us" and scopes PlayerVault. */
  club: { id: string; name: string; role: string } | null;
  /** ClubMode club name each league belongs to (leagues.club_id) — the fallback for "us". */
  leagueClubNames?: Record<string, string>;
  timeZone: string;
}

type Ctx = LeaguesCtx;

// ------------------------------------------------------------------ rows

type Div = {
  id: string;
  league_id: string;
  name: string;
  short_code: string;
  day_of_week: number | null;
  start_time: string | null;
  line_format: string;
  sort_order: number | null;
};
type LClub = { id: string; league_id: string; name: string; short_code: string; courts_available: number | null };
type Matchup = {
  id: string;
  division_id: string;
  match_date: string;
  start_time: string | null;
  home_club_id: string;
  away_club_id: string;
  home_lines_won: number;
  away_lines_won: number;
  winner: 'home' | 'away' | 'tie' | null;
  status: string;
  notes: string | null;
  courts_override: number | null;
};
type Line = {
  id: string;
  matchup_id: string;
  line_type: 'singles' | 'doubles';
  line_number: number;
  round_number: number | null;
  home_player1_id: string | null;
  home_player2_id: string | null;
  away_player1_id: string | null;
  away_player2_id: string | null;
  score: string | null;
  winner: 'home' | 'away' | null;
  status: string;
  counts_for_team: boolean | null;
  court_label: string | null;
};
type Roster = {
  id: string;
  division_id: string;
  club_id: string;
  player_name: string;
  ladder_position: number | null;
  status: string;
  master_player_id?: string | null;
  wtn?: number | null;
  ntrp?: number | null;
  player_email?: string | null;
  player_phone?: string | null;
  parent_name?: string | null;
  parent_email?: string | null;
  parent_phone?: string | null;
};

const SLOTS = ['home_player1_id', 'home_player2_id', 'away_player1_id', 'away_player2_id'] as const;
type Slot = (typeof SLOTS)[number];

// ------------------------------------------------------------------ utilities

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const HM = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const norm = (s: unknown) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const digits = (s: unknown) => String(s ?? '').replace(/\D/g, '');
const ymd = (d: unknown) => String(d ?? '').slice(0, 10);
const weekday = (d: string) => DOW[new Date(`${d}T12:00:00Z`).getUTCDay()];
const dateLabel = (d: string) => `${weekday(d).slice(0, 3)} ${d}`;
const hhmm = (t: string | null | undefined) => (t ? String(t).slice(0, 5) : null);
const looksLikeEmail = (s: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);
const clean = (v: unknown, max = 120) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

const todayIn = (tz: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

const isMashup = (m: Pick<Matchup, 'notes'>) => /MASHUP\[[^\]]+\]/i.test(m.notes ?? '');
const isScored = (l: Pick<Line, 'status' | 'winner' | 'score'>) => l.status === 'completed' || !!l.winner || !!l.score;
const countsForTeam = (l: Pick<Line, 'counts_for_team'>) => l.counts_for_team !== false;

// ------------------------------------------------------------------ structure

interface Structure {
  leagues: LeagueRow[];
  divs: Div[];
  clubs: LClub[];
}

function pickLeagues(ctx: Ctx, ref: unknown): LeagueRow[] | { error: string } {
  const key = norm(ref);
  if (!key) return ctx.leagues;
  const hit = ctx.leagues.filter((l) => l.id === String(ref).trim() || norm(l.name).includes(key));
  if (hit.length) return hit;
  return { error: `You don't direct a league matching "${ref}". Yours: ${ctx.leagues.map((l) => l.name).join('; ')}.` };
}

async function loadStructure(ctx: Ctx, leagueRef?: unknown): Promise<Structure | { error: string }> {
  const leagues = pickLeagues(ctx, leagueRef);
  if ('error' in leagues) return leagues;
  const ids = leagues.map((l) => l.id);
  const [d, c] = await Promise.all([
    ctx.db
      .from('league_divisions')
      .select('id, league_id, name, short_code, day_of_week, start_time, line_format, sort_order')
      .in('league_id', ids)
      .order('sort_order'),
    ctx.db.from('league_clubs').select('id, league_id, name, short_code, courts_available').in('league_id', ids),
  ]);
  return { leagues, divs: (d.data as Div[] | null) ?? [], clubs: (c.data as LClub[] | null) ?? [] };
}

const leagueName = (s: Structure, leagueId: string) => s.leagues.find((l) => l.id === leagueId)?.name ?? '';

/** A division by "10U" / "10" / "12&U" / name. Prefers running leagues; never guesses between two. */
function pickDivision(s: Structure, ref: unknown): Div | { error: string; candidates?: unknown } {
  const key = norm(ref);
  if (!key) return { error: 'Which division (e.g. 10U, 12U)?' };
  let hit = s.divs.filter((d) => d.id === String(ref).trim() || norm(d.short_code) === key || norm(d.name) === key);
  if (!hit.length && digits(key)) {
    hit = s.divs.filter((d) => digits(d.short_code) === digits(key) || digits(d.name) === digits(key));
  }
  if (!hit.length) hit = s.divs.filter((d) => norm(d.name).includes(key));
  if (hit.length > 1) {
    const running = hit.filter((d) => s.leagues.find((l) => l.id === d.league_id)?.status === 'running');
    if (running.length === 1) hit = running;
  }
  if (hit.length === 1) return hit[0];
  if (!hit.length) {
    return { error: `No division matches "${ref}". Divisions: ${s.divs.map((d) => `${d.short_code} (${leagueName(s, d.league_id)})`).join(', ')}.` };
  }
  return {
    error: `"${ref}" matches ${hit.length} divisions. Ask which league, then pass league.`,
    candidates: hit.map((d) => ({ division: d.short_code, league: leagueName(s, d.league_id) })),
  };
}

function pickClub(s: Structure, leagueId: string, ref: unknown): LClub | null {
  const key = norm(ref);
  if (!key) return null;
  const pool = s.clubs.filter((c) => c.league_id === leagueId);
  return (
    pool.find((c) => c.id === String(ref).trim()) ||
    pool.find((c) => norm(c.short_code) === key) ||
    pool.find((c) => norm(c.name) === key) ||
    pool.find((c) => norm(c.name).includes(key) || key.includes(norm(c.name))) ||
    null
  );
}

/** "Us" in a league: the our_club override, else the league club named like the director's ClubMode club. */
function ourClub(ctx: Ctx, s: Structure, leagueId: string, override?: unknown): LClub | null {
  if (clean(override)) return pickClub(s, leagueId, override);
  const mine = norm(ctx.leagueClubNames?.[leagueId] ?? ctx.club?.name);
  if (!mine) return null;
  return (
    s.clubs.find(
      (c) => c.league_id === leagueId && norm(c.name).length >= 3 && (mine.includes(norm(c.name)) || norm(c.name).includes(mine)),
    ) ?? null
  );
}

const clubShort = (s: Structure, id: string | null | undefined) => s.clubs.find((c) => c.id === id)?.short_code ?? '?';

/** A matchup by id, or by division + date (+ opponent). Only inside directed leagues. */
async function findMatchup(
  ctx: Ctx,
  s: Structure,
  input: Record<string, unknown>,
): Promise<{ matchup: Matchup; div: Div; us: LClub | null } | { error: string; candidates?: unknown }> {
  const divIds = s.divs.map((d) => d.id);
  if (!divIds.length) return { error: 'Your leagues have no divisions yet.' };
  const finish = (m: Matchup) => {
    const div = s.divs.find((d) => d.id === m.division_id)!;
    const us = ourClub(ctx, s, div.league_id, input.our_club);
    return { matchup: m, div, us: us && (us.id === m.home_club_id || us.id === m.away_club_id) ? us : null };
  };

  const id = clean(input.matchup_id);
  if (id) {
    if (!UUID.test(id)) return { error: `"${id}" is not a matchup id. Use division + date instead.` };
    const { data } = await ctx.db.from('league_team_matchups').select('*').eq('id', id).maybeSingle();
    const m = data as Matchup | null;
    if (!m || !divIds.includes(m.division_id)) return { error: 'No matchup with that id in a league you direct.' };
    return finish({ ...m, match_date: ymd(m.match_date) });
  }

  let divs = s.divs;
  if (clean(input.division)) {
    const d = pickDivision(s, input.division);
    if ('error' in d) return d;
    divs = [d];
  }
  const date = clean(input.date);
  if (date && !YMD.test(date)) return { error: `Date must be YYYY-MM-DD (got "${date}").` };
  if (!date) return { error: 'Which match? Give the date (YYYY-MM-DD) and division, or a matchup_id from league_matchups.' };

  const { data } = await ctx.db
    .from('league_team_matchups')
    .select('*')
    .in('division_id', divs.map((d) => d.id))
    .eq('match_date', date);
  let rows = ((data as Matchup[] | null) ?? []).map((m) => ({ ...m, match_date: ymd(m.match_date) }));

  if (clean(input.opponent)) {
    rows = rows.filter((m) => {
      const div = s.divs.find((d) => d.id === m.division_id)!;
      const opp = pickClub(s, div.league_id, input.opponent);
      return !!opp && (opp.id === m.home_club_id || opp.id === m.away_club_id);
    });
  }
  if (rows.length > 1) {
    const withUs = rows.filter((m) => {
      const div = s.divs.find((d) => d.id === m.division_id)!;
      const us = ourClub(ctx, s, div.league_id, input.our_club);
      return !!us && (us.id === m.home_club_id || us.id === m.away_club_id);
    });
    if (withUs.length) rows = withUs;
  }
  if (rows.length === 1) return finish(rows[0]);
  if (!rows.length) {
    const { data: near } = await ctx.db
      .from('league_team_matchups')
      .select('id, division_id, match_date, home_club_id, away_club_id')
      .in('division_id', divs.map((d) => d.id))
      .order('match_date');
    const dates = [...new Set(((near as Matchup[] | null) ?? []).map((m) => ymd(m.match_date)))];
    const around = dates.filter((d) => d >= date).slice(0, 4);
    return {
      error: `No ${divs.length === 1 ? divs[0].short_code + ' ' : ''}matchup on ${dateLabel(date)}${clean(input.opponent) ? ` against ${input.opponent}` : ''}.${around.length ? ` Next dates: ${around.join(', ')}.` : ''}`,
    };
  }
  return {
    error: `${rows.length} matchups fit. Ask which, then pass matchup_id.`,
    candidates: rows.map((m) => ({
      matchup_id: m.id,
      division: s.divs.find((d) => d.id === m.division_id)?.short_code,
      match: `${clubShort(s, m.away_club_id)} @ ${clubShort(s, m.home_club_id)}`,
    })),
  };
}

interface Detail {
  lines: Line[];
  rosters: Roster[];
  checkins: Set<string>;
  rsvp: Map<string, 'yes' | 'no'>;
}

async function loadDetail(ctx: Ctx, m: Matchup): Promise<Detail> {
  const [l, r, c, a] = await Promise.all([
    ctx.db.from('league_matchup_lines').select('*').eq('matchup_id', m.id).order('line_number'),
    ctx.db
      .from('league_team_rosters')
      .select('id, division_id, club_id, player_name, ladder_position, status, master_player_id, wtn')
      .eq('division_id', m.division_id)
      .in('club_id', [m.home_club_id, m.away_club_id])
      .order('ladder_position'),
    ctx.db.from('league_matchup_checkins').select('roster_id').eq('matchup_id', m.id),
    ctx.db.from('league_player_availability').select('roster_id, status').eq('matchup_id', m.id),
  ]);
  const lines = ((l.data as Line[] | null) ?? [])
    .map((x) => ({ ...x, round_number: x.round_number ?? 1 }))
    .sort((x, y) => x.line_number - y.line_number);
  return {
    lines,
    rosters: ((r.data as Roster[] | null) ?? []).sort((x, y) => (x.ladder_position ?? 9999) - (y.ladder_position ?? 9999)),
    checkins: new Set(((c.data as { roster_id: string }[] | null) ?? []).map((x) => x.roster_id)),
    rsvp: new Map(((a.data as { roster_id: string; status: 'yes' | 'no' }[] | null) ?? []).map((x) => [x.roster_id, x.status])),
  };
}

function nameOf(rosters: Roster[], id: string | null | undefined): string | null {
  if (!id) return null;
  return rosters.find((r) => r.id === id)?.player_name ?? '(removed player)';
}

/** One line as a reader would say it. */
function describeLine(s: Structure, m: Matchup, d: Detail, l: Line, us: LClub | null, roundLines: Line[]) {
  const sideName = (side: 'home' | 'away') => {
    const ids = side === 'home' ? [l.home_player1_id, l.home_player2_id] : [l.away_player1_id, l.away_player2_id];
    const names = ids.map((i) => nameOf(d.rosters, i)).filter(Boolean);
    return names.length ? names.join(' & ') : '(empty)';
  };
  const singlesRank = l.line_type === 'singles' && countsForTeam(l)
    ? roundLines.filter((x) => x.line_type === 'singles' && countsForTeam(x) && x.line_number <= l.line_number).length
    : null;
  const doublesRank = l.line_type === 'doubles' && countsForTeam(l)
    ? roundLines.filter((x) => x.line_type === 'doubles' && countsForTeam(x) && x.line_number <= l.line_number).length
    : null;
  const label = (side: 'home' | 'away') => {
    const cid = side === 'home' ? m.home_club_id : m.away_club_id;
    return `${clubShort(s, cid)}${us ? (us.id === cid ? ' (us)' : ' (them)') : ''}`;
  };
  return {
    line: l.line_number,
    round: l.round_number ?? 1,
    court: roundLines.findIndex((x) => x.id === l.id) + 1,
    type: l.line_type,
    position: singlesRank ? `#${singlesRank} singles` : doublesRank ? `#${doublesRank} doubles` : 'exhibition',
    label: l.court_label,
    counts_for_team: countsForTeam(l),
    home: `${label('home')}: ${sideName('home')}`,
    away: `${label('away')}: ${sideName('away')}`,
    score: l.score,
    winner: l.winner ? label(l.winner) : null,
    status: l.status,
  };
}

function describeLines(s: Structure, m: Matchup, d: Detail, us: LClub | null, lines: Line[] = d.lines) {
  return lines.map((l) =>
    describeLine(s, m, d, l, us, lines.filter((x) => (x.round_number ?? 1) === (l.round_number ?? 1))),
  );
}

function matchupHeader(s: Structure, m: Matchup, div: Div, us: LClub | null) {
  const side = (cid: string) => `${clubShort(s, cid)}${us ? (us.id === cid ? ' (us)' : '') : ''}`;
  return {
    matchup_id: m.id,
    league: leagueName(s, div.league_id),
    division: div.short_code,
    date: dateLabel(ymd(m.match_date)),
    time: hhmm(m.start_time) ?? hhmm(div.start_time),
    match: `${side(m.away_club_id)} @ ${side(m.home_club_id)}`,
    we_are: us ? (us.id === m.home_club_id ? 'home' : 'away') : undefined,
    status: m.status,
    team_score: `${clubShort(s, m.home_club_id)} ${m.home_lines_won} – ${m.away_lines_won} ${clubShort(s, m.away_club_id)}`,
    winner: m.winner ? (m.winner === 'tie' ? 'tie' : clubShort(s, m.winner === 'home' ? m.home_club_id : m.away_club_id)) : null,
  };
}

/**
 * Re-ladder both clubs in the matchup's division from every completed line —
 * the same best-effort block both coach scoring routes run after a score.
 */
async function reladder(db: Admin, m: Pick<Matchup, 'division_id' | 'home_club_id' | 'away_club_id'>) {
  try {
    const { data: divMatchups } = await db.from('league_team_matchups').select('id').eq('division_id', m.division_id);
    const ids = ((divMatchups as { id: string }[] | null) ?? []).map((x) => x.id);
    const { data: allLines } = await db
      .from('league_matchup_lines')
      .select('home_player1_id, home_player2_id, away_player1_id, away_player2_id, winner, status')
      .in('matchup_id', ids)
      .eq('status', 'completed');
    for (const cid of [m.home_club_id, m.away_club_id]) {
      const { data: rosters } = await db
        .from('league_team_rosters')
        .select('id, ladder_position, status')
        .eq('club_id', cid)
        .eq('division_id', m.division_id);
      if (!rosters?.length) continue;
      for (const u of recomputeLadder(rosters as never[], (allLines ?? []) as never[])) {
        await db.from('league_team_rosters').update({ ladder_position: u.newPosition }).eq('id', u.rosterId);
      }
    }
  } catch {
    // best-effort, as in the routes
  }
}

// ------------------------------------------------------------------ score parsing

export type ParsedSet = { a: number; b: number; tb?: number; superTb?: boolean };

/**
 * "6-3 6-2", "6-3, 2-6, (10-8)", "7-6(4) 6-4", "4-1". Returns the sets as
 * written (a = the first number). Never guesses: anything it can't read is an
 * error the director sees in the preview.
 */
export function parseScore(raw: string): { sets: ParsedSet[] } | { error: string } {
  const text = String(raw ?? '').replace(/[–—]/g, '-');
  const re = /([[(]\s*)?(\d{1,2})\s*-\s*(\d{1,2})(\s*[\])])?(?:\s*\((\d{1,2})\))?/g;
  const sets: ParsedSet[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const a = Number(m[2]);
    const b = Number(m[3]);
    const superTb = !!m[1] && !!m[4];
    if (!superTb && (a > 13 || b > 13)) return { error: `"${m[0].trim()}" isn't a set score.` };
    if (a === b && !superTb) return { error: `"${m[0].trim()}" is level — a set needs a winner.` };
    sets.push({ a, b, ...(m[5] ? { tb: Number(m[5]) } : {}), ...(superTb ? { superTb } : {}) });
  }
  if (!sets.length) return { error: `Couldn't read a score in "${raw}".` };
  const leftover = text.replace(re, '').replace(/retired|ret\.?|and|[\s,;/&]/gi, '');
  if (leftover.length) return { error: `Couldn't read "${raw}" — expected sets like 6-3 6-2.` };
  return { sets };
}

export function flipSets(sets: ParsedSet[]): ParsedSet[] {
  return sets.map((x) => ({ ...x, a: x.b, b: x.a }));
}

export function formatSets(sets: ParsedSet[]): string {
  return sets
    .map((x) => (x.superTb ? `(${x.a}-${x.b})` : `${x.a}-${x.b}${x.tb != null ? `(${x.tb})` : ''}`))
    .join(', ');
}

/** 'a' | 'b' | null — sets first, then games. */
export function setsWinner(sets: ParsedSet[]): 'a' | 'b' | null {
  const aw = sets.filter((x) => x.a > x.b).length;
  const bw = sets.filter((x) => x.b > x.a).length;
  if (aw !== bw) return aw > bw ? 'a' : 'b';
  const ag = sets.reduce((n, x) => n + x.a, 0);
  const bg = sets.reduce((n, x) => n + x.b, 0);
  return ag === bg ? null : ag > bg ? 'a' : 'b';
}

// ------------------------------------------------------------------ schemas

const LEAGUE = { type: 'string', description: 'League name or id. Omit when they direct one league.' };
const DIVISION = { type: 'string', description: 'Division, e.g. "10U", "12U", "OPEN".' };
const OUR_CLUB = {
  type: 'string',
  description: 'Which league club is "us" (short code), only if the default (named like their ClubMode club) is wrong.',
};
const MATCH_REF = {
  matchup_id: { type: 'string', description: 'Matchup id (from league_matchups). Or give division + date.' },
  division: DIVISION,
  date: { type: 'string', description: 'Match date YYYY-MM-DD (work out "Sunday" etc. yourself).' },
  opponent: { type: 'string', description: 'Opponent club short code or name, if several matches that day.' },
  league: LEAGUE,
  our_club: OUR_CLUB,
};

const T_OVERVIEW: Anthropic.Messages.Tool = {
  name: 'league_overview',
  description:
    'The team leagues this director runs: divisions (day, time, format), clubs (short codes, courts, which is "us"), and the next matchups. Call first when names or codes are unclear.',
  input_schema: { type: 'object', properties: { league: LEAGUE } },
};

const T_MATCHUPS: Anthropic.Messages.Tool = {
  name: 'league_matchups',
  description: 'List matchups (with ids, dates, home/away, status, team score) in a date window, optionally by division and club.',
  input_schema: {
    type: 'object',
    properties: {
      league: LEAGUE,
      division: DIVISION,
      club: { type: 'string', description: 'Only matchups involving this club (short code). "us" for our club.' },
      from: { type: 'string', description: 'YYYY-MM-DD. Default: 7 days ago.' },
      to: { type: 'string', description: 'YYYY-MM-DD. Default: 28 days ahead.' },
      our_club: OUR_CLUB,
    },
  },
};

const T_LINEUP: Anthropic.Messages.Tool = {
  name: 'league_matchup_lineup',
  description:
    'One matchup in full: every line by round and court (#1 singles, #2 doubles…), who played/plays on each side (us/them), scores, plus who is available (RSVP / check-in). Answers "who played #1 singles for them on Sunday".',
  input_schema: { type: 'object', properties: { ...MATCH_REF } },
};

const T_STANDINGS: Anthropic.Messages.Tool = {
  name: 'league_standings',
  description: 'Standings (2 pts win, 1 tie) and completed results for a division, optionally with individual player records.',
  input_schema: {
    type: 'object',
    properties: {
      division: DIVISION,
      league: LEAGUE,
      include_players: { type: 'boolean', description: 'Also return each player\'s singles/doubles W-L.' },
    },
    required: ['division'],
  },
};

const T_PARTICIPATION: Anthropic.Messages.Tool = {
  name: 'league_participation',
  description:
    'Fairness: per kid, how many matches and lines (singles / doubles / exhibition) they have played this season, W-L, and times they were available but did not play. Fewest first.',
  input_schema: {
    type: 'object',
    properties: {
      division: { type: 'string', description: 'Division; omit for every division.' },
      club: { type: 'string', description: 'Club short code; default our club; "all" for every club.' },
      league: LEAGUE,
      our_club: OUR_CLUB,
    },
  },
};

const T_MISSING_WTN: Anthropic.Messages.Tool = {
  name: 'league_missing_wtn',
  description: 'Active roster players with no WTN on their person record (or roster). Optionally by division / club.',
  input_schema: {
    type: 'object',
    properties: {
      division: { type: 'string', description: 'Division; omit for every division.' },
      club: { type: 'string', description: 'Club short code; default our club; "all" for every club.' },
      league: LEAGUE,
      our_club: OUR_CLUB,
    },
  },
};

const T_BUILD: Anthropic.Messages.Tool = {
  name: 'league_build_lineup',
  description:
    'Build (or rebuild) a matchup\'s lineup: scored singles/doubles lines on the match courts by ladder strength, balanced across rounds, and — by default — every available kid left over goes on an exhibition court (not counted for the team) so nobody sits. Available = checked in, else RSVP yes, else the active roster. Replaces the matchup\'s unscored lines; refuses if any line is scored.',
  input_schema: {
    type: 'object',
    properties: {
      ...MATCH_REF,
      rounds: { type: 'integer', description: 'Rounds to build (default: existing rounds, else 1).' },
      courts: { type: 'integer', description: 'Scored match courts (default: the matchup/home-club setting). The exhibition court is extra.' },
      singles: { type: 'integer', description: 'Force N singles lines per round (else the optimizer decides).' },
      doubles: { type: 'integer', description: 'Force N doubles lines per round.' },
      exhibition: { type: 'boolean', description: 'Put kids not on a scored line on an exhibition court. Default true.' },
      away_cap: { type: 'integer', description: 'Max players for the AWAY side only (e.g. 6). Never applied to the home side.' },
      include: { type: 'array', items: { type: 'string' }, description: 'Names to count as available regardless of RSVP.' },
      exclude: { type: 'array', items: { type: 'string' }, description: 'Names to leave out.' },
    },
  },
};

const T_MOVE: Anthropic.Messages.Tool = {
  name: 'league_move_players',
  description:
    'Move players between lines on a matchup (any date). Each move puts the player on a line (by line number) on their own side; whoever was there swaps into the mover\'s old spot in that round (or comes off court if the mover wasn\'t playing that round). line 0 = take off court. Scored lines cannot change.',
  input_schema: {
    type: 'object',
    properties: {
      ...MATCH_REF,
      moves: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            player: { type: 'string' },
            line: { type: 'integer', description: 'Target line number (league_matchup_lineup "line"); 0 = off court.' },
            round: { type: 'integer', description: 'Round, when the player is on several rounds (default the target line\'s round).' },
            position: { type: 'integer', description: '1 or 2 (doubles partner slot). Default: first empty, else 1.' },
          },
          required: ['player', 'line'],
        },
      },
    },
    required: ['moves'],
  },
};

const T_SCORES: Anthropic.Messages.Tool = {
  name: 'league_enter_scores',
  description:
    'Enter line results for a matchup, the same way coach scoring does (then re-ladders). Preview shows each parsed line and the resulting team score. The team score is lines won — it is computed, never typed in; pass team_total only to cross-check.',
  input_schema: {
    type: 'object',
    properties: {
      ...MATCH_REF,
      score_from: {
        type: 'string',
        enum: ['us', 'them', 'home', 'away'],
        description: 'Whose games come first in the scores given. Default "us" when we play in it, else "home".',
      },
      lines: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            line: { type: 'integer', description: 'Line number. Or round + court, or player.' },
            round: { type: 'integer' },
            court: { type: 'integer', description: 'Court position within the round (1 = first).' },
            player: { type: 'string', description: 'A player on the line, to find it.' },
            score: { type: 'string', description: 'e.g. "6-3 6-2", "4-6 6-3 (10-7)".' },
            winner: { type: 'string', enum: ['us', 'them', 'home', 'away'], description: 'Only if said or no score.' },
          },
        },
      },
      team_total: {
        type: 'object',
        description: 'What the director said the team result was, e.g. {us:8, them:4}. Checked, not saved.',
        properties: { us: { type: 'number' }, them: { type: 'number' }, home: { type: 'number' }, away: { type: 'number' } },
      },
    },
  },
};

const T_ADD: Anthropic.Messages.Tool = {
  name: 'league_add_player',
  description:
    'Add a kid to a club\'s team in a division (bottom of the ladder) with player/parent contacts — or, if already on it, update those contacts. No email is sent.',
  input_schema: {
    type: 'object',
    properties: {
      player: { type: 'string', description: 'Full name.' },
      division: DIVISION,
      club: { type: 'string', description: 'Club short code; default our club.' },
      league: LEAGUE,
      our_club: OUR_CLUB,
      parent_name: { type: 'string' },
      parent_email: { type: 'string' },
      parent_phone: { type: 'string' },
      player_email: { type: 'string' },
      player_phone: { type: 'string' },
    },
    required: ['player', 'division'],
  },
};

const T_REMOVE: Anthropic.Messages.Tool = {
  name: 'league_remove_player',
  description:
    'Take a kid off a team. If they have played any line, they are marked withdrawn (results kept) and taken off future unscored lines; otherwise the roster row is deleted.',
  input_schema: {
    type: 'object',
    properties: {
      player: { type: 'string' },
      division: DIVISION,
      club: { type: 'string', description: 'Club short code; default our club.' },
      league: LEAGUE,
      our_club: OUR_CLUB,
    },
    required: ['player', 'division'],
  },
};

const T_RATING: Anthropic.Messages.Tool = {
  name: 'league_record_rating',
  description:
    'Record a player\'s WTN (singles/doubles; 1–40, lower is stronger) and/or NTRP (1.0–7.0) on their PERSON record so it follows them across ClubMode; also refreshes league roster copies. Finds them in your league rosters and your club\'s PlayerVault.',
  input_schema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Player name (full or unambiguous part).' },
      wtn_singles: { type: 'number' },
      wtn_doubles: { type: 'number' },
      ntrp: { type: 'number' },
    },
    required: ['name'],
  },
};

const T_RESCHEDULE: Anthropic.Messages.Tool = {
  name: 'league_reschedule_matchup',
  description:
    'Move a matchup to a new date and/or start time in ClubMode only. Preview lists what changes and what is attached (RSVPs, check-ins, lineup). Sends nothing; does not touch court bookings or outside systems.',
  input_schema: {
    type: 'object',
    properties: {
      ...MATCH_REF,
      new_date: { type: 'string', description: 'YYYY-MM-DD.' },
      new_time: { type: 'string', description: 'HH:MM 24h. Omit to keep; "default" to use the division time.' },
    },
  },
};

// ------------------------------------------------------------------ reads

async function overview(input: Record<string, unknown>, ctx: Ctx): Promise<ToolResult> {
  const s = await loadStructure(ctx, input.league);
  if ('error' in s) return { ok: false, ...s };
  const today = todayIn(ctx.timeZone);
  const { data } = s.divs.length
    ? await ctx.db
        .from('league_team_matchups')
        .select('id, division_id, match_date, start_time, home_club_id, away_club_id, status')
        .in('division_id', s.divs.map((d) => d.id))
        .gte('match_date', today)
        .order('match_date')
    : { data: [] };
  const upcoming = ((data as Matchup[] | null) ?? []).slice(0, 12);
  return {
    ok: true,
    today,
    leagues: s.leagues.map((l) => {
      const us = ourClub(ctx, s, l.id, input.our_club);
      return {
        league: l.name,
        status: l.status,
        dates: [l.start_date, l.end_date].filter(Boolean).join(' – '),
        us: us ? `${us.short_code} (${us.name})` : null,
        divisions: s.divs
          .filter((d) => d.league_id === l.id)
          .map((d) => ({
            division: d.short_code,
            name: d.name,
            day: d.day_of_week == null ? null : DOW[d.day_of_week],
            time: hhmm(d.start_time),
            format: d.line_format,
          })),
        clubs: s.clubs
          .filter((c) => c.league_id === l.id)
          .map((c) => ({ code: c.short_code, name: c.name, courts: c.courts_available })),
      };
    }),
    upcoming: upcoming.map((m) => ({
      matchup_id: m.id,
      division: s.divs.find((d) => d.id === m.division_id)?.short_code,
      date: dateLabel(ymd(m.match_date)),
      match: `${clubShort(s, m.away_club_id)} @ ${clubShort(s, m.home_club_id)}`,
      status: m.status,
    })),
  };
}

async function listMatchups(input: Record<string, unknown>, ctx: Ctx): Promise<ToolResult> {
  const s = await loadStructure(ctx, input.league);
  if ('error' in s) return { ok: false, ...s };
  let divs = s.divs;
  if (clean(input.division)) {
    const d = pickDivision(s, input.division);
    if ('error' in d) return { ok: false, ...d };
    divs = [d];
  }
  if (!divs.length) return { ok: true, matchups: [] };
  const today = todayIn(ctx.timeZone);
  const shift = (n: number) => {
    const d = new Date(`${today}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const from = YMD.test(String(input.from ?? '')) ? String(input.from) : shift(-7);
  const to = YMD.test(String(input.to ?? '')) ? String(input.to) : shift(28);
  const { data } = await ctx.db
    .from('league_team_matchups')
    .select('*')
    .in('division_id', divs.map((d) => d.id))
    .gte('match_date', from)
    .lte('match_date', to)
    .order('match_date');
  let rows = ((data as Matchup[] | null) ?? []).map((m) => ({ ...m, match_date: ymd(m.match_date) }));
  const clubRef = clean(input.club);
  if (clubRef) {
    rows = rows.filter((m) => {
      const div = s.divs.find((d) => d.id === m.division_id)!;
      const c = norm(clubRef) === 'us' ? ourClub(ctx, s, div.league_id, input.our_club) : pickClub(s, div.league_id, clubRef);
      return !!c && (c.id === m.home_club_id || c.id === m.away_club_id);
    });
  }
  return {
    ok: true,
    window: `${from} – ${to}`,
    matchups: rows.slice(0, 60).map((m) => {
      const div = s.divs.find((d) => d.id === m.division_id)!;
      return matchupHeader(s, m, div, ourClub(ctx, s, div.league_id, input.our_club));
    }),
  };
}

async function matchupLineup(input: Record<string, unknown>, ctx: Ctx): Promise<ToolResult> {
  const s = await loadStructure(ctx, input.league);
  if ('error' in s) return { ok: false, ...s };
  const f = await findMatchup(ctx, s, input);
  if ('error' in f) return { ok: false, ...f };
  const { matchup: m, div, us } = f;
  const d = await loadDetail(ctx, m);
  const availability = (cid: string) => {
    const team = d.rosters.filter((r) => r.club_id === cid && r.status === 'active');
    return {
      checked_in: team.filter((r) => d.checkins.has(r.id)).map((r) => r.player_name),
      rsvp_yes: team.filter((r) => d.rsvp.get(r.id) === 'yes').map((r) => r.player_name),
      rsvp_no: team.filter((r) => d.rsvp.get(r.id) === 'no').map((r) => r.player_name),
      no_reply: team.filter((r) => !d.rsvp.has(r.id)).map((r) => r.player_name),
    };
  };
  return {
    ok: true,
    ...matchupHeader(s, m, div, us),
    mish_mash: isMashup(m) || undefined,
    lines: describeLines(s, m, d, us),
    availability: {
      [clubShort(s, m.home_club_id)]: availability(m.home_club_id),
      [clubShort(s, m.away_club_id)]: availability(m.away_club_id),
    },
    note: d.lines.length ? undefined : 'No lineup saved for this matchup yet.',
  };
}

async function standings(input: Record<string, unknown>, ctx: Ctx): Promise<ToolResult> {
  const s = await loadStructure(ctx, input.league);
  if ('error' in s) return { ok: false, ...s };
  const div = pickDivision(s, input.division);
  if ('error' in div) return { ok: false, ...div };
  const { data: dc } = await ctx.db.from('league_division_clubs').select('club_id').eq('division_id', div.id);
  const inDiv = new Set(((dc as { club_id: string }[] | null) ?? []).map((x) => x.club_id));
  const { data } = await ctx.db.from('league_team_matchups').select('*').eq('division_id', div.id).order('match_date');
  const matchups = ((data as Matchup[] | null) ?? []).map((m) => ({ ...m, match_date: ymd(m.match_date) }));
  for (const m of matchups) inDiv.add(m.home_club_id).add(m.away_club_id);
  const clubs = s.clubs.filter((c) => inDiv.has(c.id));
  const table = computeDivisionStandings(clubs, matchups);
  const out: ToolResult = {
    ok: true,
    league: leagueName(s, div.league_id),
    division: div.short_code,
    standings: table.map((r, i) => ({
      rank: i + 1,
      club: r.club_short,
      played: r.matchups_played,
      w: r.matchups_won,
      l: r.matchups_lost,
      t: r.matchups_tied,
      lines: `${r.lines_won}-${r.lines_lost}`,
      points: r.points,
    })),
    results: matchups
      .filter((m) => m.status === 'completed')
      .map((m) => ({
        date: m.match_date,
        match: `${clubShort(s, m.away_club_id)} @ ${clubShort(s, m.home_club_id)}`,
        score: `${clubShort(s, m.home_club_id)} ${m.home_lines_won} – ${m.away_lines_won} ${clubShort(s, m.away_club_id)}`,
        winner: m.winner === 'tie' ? 'tie' : m.winner ? clubShort(s, m.winner === 'home' ? m.home_club_id : m.away_club_id) : null,
      })),
    remaining: matchups.filter((m) => m.status !== 'completed' && m.status !== 'cancelled').length,
  };
  if (input.include_players === true && matchups.length) {
    const [{ data: rost }, { data: lines }] = await Promise.all([
      ctx.db.from('league_team_rosters').select('id, player_name, club_id').eq('division_id', div.id),
      ctx.db.from('league_matchup_lines').select('*').in('matchup_id', matchups.map((m) => m.id)),
    ]);
    const recs = computePlayerRecords(
      (rost as Roster[] | null) ?? [],
      new Map(s.clubs.map((c) => [c.id, { short_code: c.short_code }])),
      (lines as Line[] | null) ?? [],
    );
    out.players = recs
      .filter((r) => r.total_wins + r.total_losses > 0)
      .map((r) => ({
        player: r.player_name,
        club: r.club_short,
        singles: `${r.singles_wins}-${r.singles_losses}`,
        doubles: `${r.doubles_wins}-${r.doubles_losses}`,
      }));
  }
  return out;
}

/** The divisions + clubs a roster-wide read covers. */
function rosterScope(ctx: Ctx, s: Structure, input: Record<string, unknown>): { divs: Div[]; clubIds: Set<string> | null } | { error: string; candidates?: unknown } {
  let divs = s.divs;
  if (clean(input.division)) {
    const d = pickDivision(s, input.division);
    if ('error' in d) return d;
    divs = [d];
  }
  const clubRef = clean(input.club);
  if (clubRef && norm(clubRef) === 'all') return { divs, clubIds: null };
  const ids = new Set<string>();
  for (const l of s.leagues) {
    const c = clubRef && norm(clubRef) !== 'us' ? pickClub(s, l.id, clubRef) : ourClub(ctx, s, l.id, input.our_club);
    if (c) ids.add(c.id);
  }
  if (!ids.size) {
    return {
      error: clubRef
        ? `No club "${clubRef}" in your leagues.`
        : 'Which club? I can\'t tell which league club is yours — pass club (short code) or "all".',
    };
  }
  return { divs, clubIds: ids };
}

async function participation(input: Record<string, unknown>, ctx: Ctx): Promise<ToolResult> {
  const s = await loadStructure(ctx, input.league);
  if ('error' in s) return { ok: false, ...s };
  const scope = rosterScope(ctx, s, input);
  if ('error' in scope) return { ok: false, ...scope };
  const divIds = scope.divs.map((d) => d.id);
  if (!divIds.length) return { ok: true, players: [] };
  const today = todayIn(ctx.timeZone);
  const [{ data: rost }, { data: mus }] = await Promise.all([
    ctx.db.from('league_team_rosters').select('id, division_id, club_id, player_name, status').in('division_id', divIds),
    ctx.db.from('league_team_matchups').select('id, division_id, match_date, home_club_id, away_club_id, status').in('division_id', divIds).lte('match_date', today),
  ]);
  const rosters = ((rost as Roster[] | null) ?? []).filter((r) => !scope.clubIds || scope.clubIds.has(r.club_id));
  const played = ((mus as Matchup[] | null) ?? []).filter((m) => m.status !== 'cancelled');
  const mIds = played.map((m) => m.id);
  const [{ data: lines }, { data: cis }] = mIds.length
    ? await Promise.all([
        ctx.db.from('league_matchup_lines').select('*').in('matchup_id', mIds),
        ctx.db.from('league_matchup_checkins').select('roster_id, matchup_id').in('matchup_id', mIds),
      ])
    : [{ data: [] }, { data: [] }];
  const allLines = (lines as Line[] | null) ?? [];
  const checkins = (cis as { roster_id: string; matchup_id: string }[] | null) ?? [];
  const rows = rosters.map((r) => {
    const mine = allLines.filter((l) => SLOTS.some((k) => l[k] === r.id));
    const homeSide = (l: Line) => l.home_player1_id === r.id || l.home_player2_id === r.id;
    const won = mine.filter((l) => l.status === 'completed' && l.winner && (l.winner === 'home') === homeSide(l)).length;
    const lost = mine.filter((l) => l.status === 'completed' && l.winner && (l.winner === 'home') !== homeSide(l)).length;
    const matchesPlayed = new Set(mine.map((l) => l.matchup_id));
    const sat = checkins.filter((c) => c.roster_id === r.id && !matchesPlayed.has(c.matchup_id)).length;
    return {
      player: r.player_name,
      club: clubShort(s, r.club_id),
      division: s.divs.find((d) => d.id === r.division_id)?.short_code,
      status: r.status,
      matches: matchesPlayed.size,
      lines: mine.length,
      singles: mine.filter((l) => l.line_type === 'singles' && countsForTeam(l)).length,
      doubles: mine.filter((l) => l.line_type === 'doubles' && countsForTeam(l)).length,
      exhibition: mine.filter((l) => !countsForTeam(l)).length,
      record: `${won}-${lost}`,
      checked_in_but_sat: sat || undefined,
    };
  });
  rows.sort((a, b) => a.matches - b.matches || a.lines - b.lines || a.player.localeCompare(b.player));
  return { ok: true, through: today, matchups_so_far: played.length, players: rows };
}

async function missingWtn(input: Record<string, unknown>, ctx: Ctx): Promise<ToolResult> {
  const s = await loadStructure(ctx, input.league);
  if ('error' in s) return { ok: false, ...s };
  const scope = rosterScope(ctx, s, input);
  if ('error' in scope) return { ok: false, ...scope };
  if (!scope.divs.length) return { ok: true, missing: [] };
  const { data } = await ctx.db
    .from('league_team_rosters')
    .select('id, division_id, club_id, player_name, status, master_player_id, wtn')
    .in('division_id', scope.divs.map((d) => d.id))
    .eq('status', 'active');
  const rosters = ((data as Roster[] | null) ?? []).filter((r) => !scope.clubIds || scope.clubIds.has(r.club_id));
  const mids = [...new Set(rosters.map((r) => r.master_player_id).filter(Boolean))] as string[];
  const hub = new Map<string, { wtn: number | null; wtn_doubles: number | null }>();
  if (mids.length) {
    const { data: mp } = await ctx.db.from('master_players').select('id, wtn, wtn_doubles').in('id', mids);
    for (const p of (mp as { id: string; wtn: number | null; wtn_doubles: number | null }[] | null) ?? []) hub.set(p.id, p);
  }
  const missing = rosters.filter((r) => {
    const h = r.master_player_id ? hub.get(r.master_player_id) : undefined;
    return !isValidWtn(h?.wtn ?? null) && !isValidWtn(h?.wtn_doubles ?? null) && !isValidWtn(r.wtn ?? null);
  });
  return {
    ok: true,
    checked: rosters.length,
    missing_count: missing.length,
    missing: missing.map((r) => ({
      player: r.player_name,
      club: clubShort(s, r.club_id),
      division: s.divs.find((d) => d.id === r.division_id)?.short_code,
      person_record: r.master_player_id ? 'linked' : 'not linked yet (nightly sync)',
    })),
  };
}

// ------------------------------------------------------------------ writes: lineup

type NewLine = Omit<Line, 'id' | 'matchup_id' | 'score' | 'winner' | 'status'> & { tmp: string };

interface BuildPlan {
  matchup: Matchup;
  rows: NewLine[];
  replaceIds: string[];
  summary: Record<string, unknown>;
}

async function prepareBuild(input: Record<string, unknown>, ctx: Ctx): Promise<BuildPlan | { error: string; candidates?: unknown }> {
  const s = await loadStructure(ctx, input.league);
  if ('error' in s) return s;
  const f = await findMatchup(ctx, s, input);
  if ('error' in f) return f;
  const { matchup: m, div, us } = f;
  if (isMashup(m)) return { error: 'This is a mish-mash day (clubs mixed on every court). Build it on the matchup page.' };
  const d = await loadDetail(ctx, m);
  const scored = d.lines.filter(isScored);
  if (scored.length) {
    return { error: `${scored.length} line(s) on this matchup already have a score, so I won't rebuild it. Use league_move_players for changes.` };
  }

  const excl = ((input.exclude as unknown[]) ?? []).map(norm).filter(Boolean);
  const incl = ((input.include as unknown[]) ?? []).map(norm).filter(Boolean);
  const unknown = [...excl, ...incl].filter((n) => !d.rosters.some((r) => norm(r.player_name) === n || norm(r.player_name).includes(n)));
  if (unknown.length) return { error: `Not on either roster for this matchup: ${unknown.join(', ')}.` };
  const matches = (r: Roster, list: string[]) => list.some((n) => norm(r.player_name) === n || norm(r.player_name).includes(n));

  const side = (cid: string, away: boolean) => {
    const team = d.rosters.filter((r) => r.club_id === cid && r.status === 'active');
    const anyCheckin = team.some((r) => d.checkins.has(r.id));
    const anyRsvp = team.some((r) => d.rsvp.has(r.id));
    const basis = anyCheckin ? 'checked in' : anyRsvp ? 'RSVP yes' : 'active roster (no RSVPs or check-ins yet)';
    const left: { player: string; why: string }[] = [];
    let avail = team.filter((r) => {
      if (matches(r, incl)) return true;
      if (matches(r, excl)) return left.push({ player: r.player_name, why: 'excluded' }), false;
      if (anyCheckin && !d.checkins.has(r.id)) return left.push({ player: r.player_name, why: 'not checked in' }), false;
      if (!anyCheckin && anyRsvp && d.rsvp.get(r.id) !== 'yes') {
        return left.push({ player: r.player_name, why: d.rsvp.get(r.id) === 'no' ? 'RSVP no' : 'no RSVP reply' }), false;
      }
      return true;
    });
    const cap = Number(input.away_cap);
    if (away && Number.isInteger(cap) && cap > 0 && avail.length > cap) {
      for (const r of avail.slice(cap)) left.push({ player: r.player_name, why: `over the away cap of ${cap}` });
      avail = avail.slice(0, cap);
    }
    return { avail, basis, left };
  };
  const home = side(m.home_club_id, false);
  const away = side(m.away_club_id, true);
  if (!home.avail.length || !away.avail.length) {
    return { error: `${!home.avail.length ? clubShort(s, m.home_club_id) : clubShort(s, m.away_club_id)} has nobody available, so there's no lineup to build.` };
  }

  const homeClub = s.clubs.find((c) => c.id === m.home_club_id);
  const courts = Number.isInteger(Number(input.courts)) && Number(input.courts) > 0
    ? Number(input.courts)
    : m.courts_override ?? homeClub?.courts_available ?? 0;
  if (courts < 1) return { error: 'No match courts set for this matchup. Say how many courts.' };
  const existingRounds = d.lines.reduce((n, l) => Math.max(n, l.round_number ?? 1), 0);
  const rounds = Math.min(6, Math.max(1, Number.isInteger(Number(input.rounds)) ? Number(input.rounds) : existingRounds || 1));
  const opt = optimizeLines(courts, home.avail.length, away.avail.length);
  let singles = opt.singles;
  let doubles = opt.doubles;
  if (input.singles != null || input.doubles != null) {
    singles = Math.max(0, Number(input.singles ?? 0) | 0);
    doubles = Math.max(0, Number(input.doubles ?? 0) | 0);
    if (singles + doubles > courts) return { error: `${singles} singles + ${doubles} doubles needs ${singles + doubles} courts; there are ${courts}.` };
  }
  if (singles + doubles === 0) return { error: 'That leaves no scored lines.' };
  const exhibition = input.exhibition !== false;

  const rows: NewLine[] = [];
  let lineNo = 1;
  const roundSummaries: unknown[] = [];
  const nameById = (id: string | null) => nameOf(d.rosters, id);
  for (let r = 1; r <= rounds; r++) {
    const roundLines: (NewLine & { id: string })[] = [];
    for (let i = 0; i < singles + doubles; i++) {
      const tmp = `tmp-${r}-${lineNo}`;
      roundLines.push({
        tmp,
        id: tmp,
        round_number: r,
        line_number: lineNo++,
        line_type: i < singles ? 'singles' : 'doubles',
        counts_for_team: true,
        court_label: null,
        home_player1_id: null,
        home_player2_id: null,
        away_player1_id: null,
        away_player2_id: null,
      });
    }
    const prior = rows.map((x) => ({ ...x, id: x.tmp }));
    const patches = autoAssignRoundBalanced(roundLines, prior, home.avail, away.avail);
    for (const p of patches) Object.assign(roundLines.find((l) => l.id === p.id)!, p, { id: p.id });

    const used = new Set(roundLines.flatMap((l) => SLOTS.map((k) => l[k]).filter(Boolean)));
    const restHome = home.avail.filter((x) => !used.has(x.id)).map((x) => x.id);
    const restAway = away.avail.filter((x) => !used.has(x.id)).map((x) => x.id);
    const sitting: string[] = [];
    const exLines: (NewLine & { id: string })[] = [];
    if (exhibition && restHome.length + restAway.length >= 2) {
      const push = (h: (string | null)[], a: (string | null)[]) => {
        const tmp = `tmp-${r}-${lineNo}`;
        exLines.push({
          tmp,
          id: tmp,
          round_number: r,
          line_number: lineNo++,
          line_type: h.length + a.length > 2 ? 'doubles' : 'singles',
          counts_for_team: false,
          court_label: 'Exhibition',
          home_player1_id: h[0] ?? null,
          home_player2_id: h[1] ?? null,
          away_player1_id: a[0] ?? null,
          away_player2_id: a[1] ?? null,
        });
      };
      // Club against club while both have kids left, then whoever remains plays each other.
      while (restHome.length && restAway.length) {
        if (restHome.length >= 2 && restAway.length >= 2) push(restHome.splice(0, 2), restAway.splice(0, 2));
        else push(restHome.splice(0, 1), restAway.splice(0, 1));
      }
      const rest = [...restHome, ...restAway];
      while (rest.length >= 2) {
        const take = rest.length >= 4 ? 4 : 2;
        const g = rest.splice(0, take);
        push(g.slice(0, take / 2), g.slice(take / 2));
      }
      if (rest.length === 1) {
        // A lone kid joins the last exhibition court rather than sitting (2-on-1 is fine for exhibition).
        const last = exLines[exLines.length - 1];
        if (last && (!last.home_player2_id || !last.away_player2_id)) {
          if (!last.home_player2_id) last.home_player2_id = rest[0];
          else last.away_player2_id = rest[0];
          last.line_type = 'doubles';
        } else sitting.push(rest[0]);
      }
      exLines.forEach((l, i) => (l.court_label = exLines.length > 1 ? `Exhibition ${i + 1}` : 'Exhibition'));
    } else {
      sitting.push(...restHome, ...restAway);
    }
    rows.push(...[...roundLines, ...exLines].map(({ id: _id, ...rest }) => rest));
    const show = (l: NewLine) =>
      `${l.court_label ?? `Line ${l.line_number}`} ${l.line_type}: ${[l.home_player1_id, l.home_player2_id].map(nameById).filter(Boolean).join(' & ') || '(empty)'} vs ${[l.away_player1_id, l.away_player2_id].map(nameById).filter(Boolean).join(' & ') || '(empty)'}`;
    roundSummaries.push({
      round: r,
      scored_lines: roundLines.map(show),
      exhibition: exLines.length ? exLines.map(show) : undefined,
      sitting_out: sitting.length ? sitting.map(nameById) : undefined,
    });
  }

  const hs = clubShort(s, m.home_club_id);
  const as = clubShort(s, m.away_club_id);
  return {
    matchup: m,
    rows,
    replaceIds: d.lines.map((l) => l.id),
    summary: {
      ...matchupHeader(s, m, div, us),
      match_courts: courts,
      per_round: `${singles} singles + ${doubles} doubles (scored)`,
      exhibition_court: exhibition ? 'kids not on a scored line play exhibition (not counted for the team) — an extra court' : 'off',
      available: {
        [hs]: { from: home.basis, players: home.avail.map((r) => r.player_name), not_included: home.left.length ? home.left : undefined },
        [as]: { from: away.basis, players: away.avail.map((r) => r.player_name), not_included: away.left.length ? away.left : undefined },
      },
      rounds: roundSummaries,
      replaces: d.lines.length ? `${d.lines.length} existing unscored line(s) on this matchup` : undefined,
      note: opt.warning && !exhibition ? opt.warning : undefined,
      not_done: 'Nobody is emailed and no courts are booked.',
    },
  };
}

async function commitBuild(plan: BuildPlan, ctx: Ctx): Promise<ToolResult> {
  if (plan.replaceIds.length) {
    const { error } = await ctx.db
      .from('league_matchup_lines')
      .delete()
      .in('id', plan.replaceIds)
      .eq('matchup_id', plan.matchup.id)
      .neq('status', 'completed');
    if (error) return { ok: false, error: error.message };
  }
  const { error } = await ctx.db
    .from('league_matchup_lines')
    .insert(plan.rows.map(({ tmp: _t, ...r }) => ({ ...r, matchup_id: plan.matchup.id })));
  if (error) return { ok: false, error: `Old lines were cleared but the new ones didn't save: ${error.message}` };
  return { ok: true, matchup_id: plan.matchup.id, lines_saved: plan.rows.length };
}

// ------------------------------------------------------------------ writes: move players

interface MovePlan {
  matchup: Matchup;
  patches: { id: string; patch: Record<Slot, string | null> }[];
  summary: Record<string, unknown>;
}

function findRosterByName(rosters: Roster[], name: unknown): Roster | { error: string } {
  const key = norm(name);
  if (!key) return { error: 'Which player?' };
  const exact = rosters.filter((r) => norm(r.player_name) === key);
  const hit = exact.length ? exact : rosters.filter((r) => norm(r.player_name).includes(key));
  if (hit.length === 1) return hit[0];
  if (!hit.length) return { error: `"${name}" isn't on either team for this matchup.` };
  return { error: `"${name}" could be ${hit.map((r) => r.player_name).join(' or ')}. Which?` };
}

async function prepareMove(input: Record<string, unknown>, ctx: Ctx): Promise<MovePlan | { error: string; candidates?: unknown }> {
  const s = await loadStructure(ctx, input.league);
  if ('error' in s) return s;
  const f = await findMatchup(ctx, s, input);
  if ('error' in f) return f;
  const { matchup: m, div, us } = f;
  if (isMashup(m)) return { error: 'This is a mish-mash day; move players on the matchup page.' };
  const d = await loadDetail(ctx, m);
  if (!d.lines.length) return { error: 'This matchup has no lineup yet. Build one with league_build_lineup first.' };
  const moves = Array.isArray(input.moves) ? (input.moves as Record<string, unknown>[]) : [];
  if (!moves.length) return { error: 'No moves given.' };

  const work = d.lines.map((l) => ({ ...l }));
  const before = new Map(d.lines.map((l) => [l.id, { ...l }]));
  const benched: string[] = [];

  for (const mv of moves) {
    const p = findRosterByName(d.rosters, mv.player);
    if ('error' in p) return p;
    const sideKeys: Slot[] = p.club_id === m.home_club_id ? ['home_player1_id', 'home_player2_id'] : ['away_player1_id', 'away_player2_id'];
    const lineNo = Number(mv.line);
    const target = lineNo > 0 ? work.find((l) => l.line_number === lineNo) : null;
    if (lineNo > 0 && !target) return { error: `There's no line ${lineNo} on this matchup. Lines: ${work.map((l) => l.line_number).join(', ')}.` };
    const round = target ? target.round_number ?? 1 : Number(mv.round) || null;
    // Where the mover sits now in that round (or anywhere, for an off-court move without a round).
    const cur = work.find(
      (l) => (round == null || (l.round_number ?? 1) === round) && sideKeys.some((k) => l[k] === p.id),
    );
    const curKey = cur ? sideKeys.find((k) => cur[k] === p.id)! : null;
    if (cur && isScored(cur)) return { error: `${p.player_name}'s current line (${cur.line_number}) is already scored and can't change.` };

    if (!target) {
      if (!cur || !curKey) return { error: `${p.player_name} isn't on a line${round ? ` in round ${round}` : ''}.` };
      cur[curKey] = null;
      benched.push(p.player_name);
      continue;
    }
    if (isScored(target)) return { error: `Line ${target.line_number} is already scored and can't change.` };
    const pos = Number(mv.position);
    if (pos === 2 && target.line_type === 'singles') return { error: `Line ${target.line_number} is singles — there's no second slot.` };
    const key: Slot =
      pos === 1 || pos === 2
        ? sideKeys[pos - 1]
        : target.line_type === 'doubles' && target[sideKeys[0]] && !target[sideKeys[1]]
          ? sideKeys[1]
          : sideKeys[0];
    if (target[key] === p.id) continue;
    const displaced = target[key];
    target[key] = p.id;
    if (cur && curKey) {
      cur[curKey] = displaced; // true swap: whoever was here takes the mover's old spot
    } else if (displaced) {
      benched.push(nameOf(d.rosters, displaced)!);
    }
  }

  const patches = work
    .filter((l) => SLOTS.some((k) => l[k] !== before.get(l.id)![k]))
    .map((l) => ({ id: l.id, patch: Object.fromEntries(SLOTS.map((k) => [k, l[k]])) as Record<Slot, string | null> }));
  if (!patches.length) return { error: 'Those moves change nothing — everyone is already there.' };
  const changedIds = new Set(patches.map((x) => x.id));
  const show = (lines: Line[]) => describeLines(s, m, d, us, lines).filter((x) => changedIds.has(lines.find((l) => l.line_number === x.line)!.id));
  return {
    matchup: m,
    patches,
    summary: {
      ...matchupHeader(s, m, div, us),
      before: show(d.lines),
      after: show(work),
      off_court: benched.length ? benched : undefined,
    },
  };
}

async function commitMove(plan: MovePlan, ctx: Ctx): Promise<ToolResult> {
  for (const p of plan.patches) {
    const { error } = await ctx.db
      .from('league_matchup_lines')
      .update(p.patch)
      .eq('id', p.id)
      .eq('matchup_id', plan.matchup.id)
      .neq('status', 'completed');
    if (error) return { ok: false, error: error.message };
  }
  return { ok: true, lines_changed: plan.patches.length };
}

// ------------------------------------------------------------------ writes: scores

interface ScorePlan {
  matchup: Matchup;
  writes: { id: string; patch: Record<string, unknown> }[];
  summary: Record<string, unknown>;
}

const REPORTER = 'Director (Ask ClubMode)';

async function prepareScores(input: Record<string, unknown>, ctx: Ctx): Promise<ScorePlan | { error: string; candidates?: unknown }> {
  const s = await loadStructure(ctx, input.league);
  if ('error' in s) return s;
  const f = await findMatchup(ctx, s, input);
  if ('error' in f) return f;
  const { matchup: m, div, us } = f;
  const given = Array.isArray(input.lines) ? (input.lines as Record<string, unknown>[]) : [];
  if (!given.length) {
    return {
      error:
        'This league keeps the team score as lines won, worked out from each line\'s result — it can\'t be typed in as a total. Give me each line\'s score (or who won each line).',
    };
  }
  const d = await loadDetail(ctx, m);
  if (!d.lines.length) return { error: 'This matchup has no lines yet, so there is nothing to score. Build the lineup first.' };

  const toHomeAway = (v: unknown): 'home' | 'away' | null | 'bad' => {
    const k = norm(v);
    if (!k) return null;
    if (k === 'home' || k === 'away') return k;
    if (k === 'us' || k === 'them') {
      if (!us) return 'bad';
      const usSide = us.id === m.home_club_id ? 'home' : 'away';
      return k === 'us' ? usSide : usSide === 'home' ? 'away' : 'home';
    }
    return 'bad';
  };
  const perspective = toHomeAway(input.score_from ?? (us ? 'us' : 'home'));
  if (perspective === 'bad' || !perspective) return { error: 'I can\'t tell which club is "us" in this matchup — say score_from home or away, or pass our_club.' };

  const writes: ScorePlan['writes'] = [];
  const shown: unknown[] = [];
  const notes: string[] = [];
  const projected = new Map(d.lines.map((l) => [l.id, { ...l }]));

  for (const g of given) {
    let line: Line | undefined;
    if (g.line != null) line = d.lines.find((l) => l.line_number === Number(g.line));
    else if (g.round != null && g.court != null) {
      line = d.lines.filter((l) => (l.round_number ?? 1) === Number(g.round))[Number(g.court) - 1];
    } else if (g.court != null && new Set(d.lines.map((l) => l.round_number ?? 1)).size === 1) {
      line = d.lines[Number(g.court) - 1];
    } else if (clean(g.player)) {
      const p = findRosterByName(d.rosters, g.player);
      if ('error' in p) return p;
      const on = d.lines.filter((l) => SLOTS.some((k) => l[k] === p.id));
      if (on.length !== 1) return { error: `${p.player_name} is on ${on.length} lines here — say which line number.` };
      line = on[0];
    }
    if (!line) return { error: `Couldn't find that line (${JSON.stringify(g)}). Lines: ${d.lines.map((l) => l.line_number).join(', ')}.` };
    if (writes.some((w) => w.id === line!.id)) return { error: `Line ${line.line_number} is given twice.` };

    const explicit = toHomeAway(g.winner);
    if (explicit === 'bad') return { error: `Winner "${g.winner}" — use us/them (or home/away).` };
    let score: string | null = null;
    let winner: 'home' | 'away' | null = explicit;
    if (clean(g.score)) {
      const parsed = parseScore(String(g.score));
      if ('error' in parsed) return { error: `Line ${line.line_number}: ${parsed.error}` };
      let home = perspective === 'home' ? parsed.sets : flipSets(parsed.sets);
      const implied = setsWinner(home);
      const impliedSide = implied === 'a' ? 'home' : implied === 'b' ? 'away' : null;
      if (explicit && impliedSide && impliedSide !== explicit) {
        // "We lost 6-3" — said winner-first. Read it that way and say so.
        home = flipSets(home);
        notes.push(`Line ${line.line_number}: read "${g.score}" as the winner's score.`);
      }
      winner = explicit ?? impliedSide;
      score = formatSets(home);
    }
    if (!winner) return { error: `Line ${line.line_number}: who won? The score doesn't say.` };
    if (line.status === 'completed' && (line.score !== score || line.winner !== winner)) {
      notes.push(`Line ${line.line_number} already had ${line.score ?? 'a result'} (${line.winner}); this replaces it.`);
    }
    const patch = {
      winner,
      score,
      status: 'completed',
      reported_at: '(now)',
      reported_by_name: REPORTER,
    };
    writes.push({ id: line.id, patch });
    Object.assign(projected.get(line.id)!, { winner, score, status: 'completed' });
    shown.push(line.line_number);
  }

  const proj = [...projected.values()];
  const team = proj.filter(countsForTeam);
  const hw = team.filter((l) => l.winner === 'home').length;
  const aw = team.filter((l) => l.winner === 'away').length;
  const unscored = team.filter((l) => l.status !== 'completed').length;
  const hs = clubShort(s, m.home_club_id);
  const as = clubShort(s, m.away_club_id);

  const tt = (input.team_total ?? null) as Record<string, number> | null;
  if (tt && typeof tt === 'object') {
    let wantHome: number | undefined;
    let wantAway: number | undefined;
    if (tt.home != null || tt.away != null) [wantHome, wantAway] = [tt.home, tt.away];
    else if (us && (tt.us != null || tt.them != null)) {
      const usHome = us.id === m.home_club_id;
      [wantHome, wantAway] = usHome ? [tt.us, tt.them] : [tt.them, tt.us];
    }
    if ((wantHome != null && wantHome !== hw) || (wantAway != null && wantAway !== aw)) {
      notes.push(
        `Check: you said ${wantHome ?? '?'}–${wantAway ?? '?'} (${hs}–${as}), but these lines make it ${hw}–${aw} in lines won. ` +
          'This league scores lines, not games — if the total was games, that is expected; otherwise a line is missing or wrong.',
      );
    }
  }

  const afterLines = proj.filter((l) => shown.includes(l.line_number));
  return {
    matchup: m,
    writes,
    summary: {
      ...matchupHeader(s, m, div, us),
      lines: describeLines(s, m, d, us, proj).filter((x) => afterLines.some((l) => l.line_number === x.line)),
      team_score_after: `${hs} ${hw} – ${aw} ${as}${unscored ? ` (${unscored} line(s) still unscored)` : ' — final'}`,
      notes: notes.length ? notes : undefined,
      not_done: 'Nothing is reported to TennisLink or emailed.',
    },
  };
}

async function commitScores(plan: ScorePlan, ctx: Ctx): Promise<ToolResult> {
  const stamp = new Date().toISOString();
  for (const w of plan.writes) {
    // The same patch the coach scoring routes write; the DB trigger recomputes the team result.
    const { error } = await ctx.db
      .from('league_matchup_lines')
      .update({ ...w.patch, reported_at: stamp })
      .eq('id', w.id)
      .eq('matchup_id', plan.matchup.id);
    if (error) return { ok: false, error: error.message };
  }
  await reladder(ctx.db, plan.matchup);
  return { ok: true, lines_scored: plan.writes.length };
}

// ------------------------------------------------------------------ writes: roster

async function rosterTarget(input: Record<string, unknown>, ctx: Ctx) {
  const s = await loadStructure(ctx, input.league);
  if ('error' in s) return s;
  const div = pickDivision(s, input.division);
  if ('error' in div) return div;
  const club = clean(input.club) && norm(input.club) !== 'us'
    ? pickClub(s, div.league_id, input.club)
    : ourClub(ctx, s, div.league_id, input.our_club);
  if (!club) {
    return {
      error: clean(input.club)
        ? `No club "${input.club}" in ${leagueName(s, div.league_id)}. Clubs: ${s.clubs.filter((c) => c.league_id === div.league_id).map((c) => c.short_code).join(', ')}.`
        : 'Which club\'s team? Pass club (short code).',
    };
  }
  const { data } = await ctx.db
    .from('league_team_rosters')
    .select('*')
    .eq('division_id', div.id)
    .eq('club_id', club.id);
  return { s, div, club, roster: (data as Roster[] | null) ?? [] };
}

interface AddPlan {
  existing: Roster | null;
  row: Record<string, unknown>;
  summary: Record<string, unknown>;
}

async function prepareAdd(input: Record<string, unknown>, ctx: Ctx): Promise<AddPlan | { error: string; candidates?: unknown }> {
  const name = clean(input.player, 80);
  if (!name) return { error: 'Player name?' };
  const t = await rosterTarget(input, ctx);
  if ('error' in t) return t;
  const contacts: Record<string, string> = {};
  for (const k of ['parent_name', 'parent_email', 'parent_phone', 'player_email', 'player_phone'] as const) {
    const v = clean(input[k], 120);
    if (!v) continue;
    if (k.endsWith('email') && !looksLikeEmail(v)) return { error: `${k.replace('_', ' ')} "${v}" doesn't look like an email.` };
    contacts[k] = k.endsWith('email') ? v.toLowerCase() : v;
  }
  const team = `${t.club.short_code} ${t.div.short_code}`;
  const existing = t.roster.find((r) => norm(r.player_name) === norm(name)) ?? null;
  if (existing) {
    const changes = Object.entries(contacts).filter(([k, v]) => (existing as Record<string, unknown>)[k] !== v);
    const reactivate = existing.status !== 'active';
    if (!changes.length && !reactivate) return { error: `${existing.player_name} is already on ${team} with those details.` };
    const row: Record<string, unknown> = Object.fromEntries(changes);
    if (reactivate) row.status = 'active';
    return {
      existing,
      row,
      summary: {
        action: `${existing.player_name} is already on ${team} — update their record`,
        changes: changes.map(([k, v]) => `${k}: ${(existing as Record<string, unknown>)[k] ?? '(blank)'} → ${v}`),
        reactivate: reactivate ? `status ${existing.status} → active` : undefined,
      },
    };
  }
  const nextPos = t.roster.reduce((mx, r) => Math.max(mx, r.ladder_position ?? 0), 0) + 1;
  return {
    existing: null,
    row: { division_id: t.div.id, club_id: t.club.id, player_name: name, ladder_position: nextPos, status: 'active', ...contacts },
    summary: {
      action: `Add ${name} to ${team} (${leagueName(t.s, t.div.league_id)})`,
      ladder_position: `${nextPos} (bottom)`,
      contacts: Object.keys(contacts).length ? contacts : 'none given',
      not_done: 'No welcome or RSVP email is sent. USTA/TennisLink registration is separate.',
    },
  };
}

async function commitAdd(plan: AddPlan, ctx: Ctx): Promise<ToolResult> {
  if (plan.existing) {
    const { error } = await ctx.db.from('league_team_rosters').update(plan.row).eq('id', plan.existing.id);
    return error ? { ok: false, error: error.message } : { ok: true, updated: plan.existing.player_name };
  }
  const { data, error } = await ctx.db.from('league_team_rosters').insert(plan.row).select('id').maybeSingle();
  if (error) return { ok: false, error: error.message };
  return { ok: true, added: plan.row.player_name, roster_id: (data as { id: string } | null)?.id };
}

interface RemovePlan {
  player: Roster;
  mode: 'withdraw' | 'delete';
  clearLines: { id: string; patch: Record<string, null> }[];
  futureMatchups: string[];
  summary: Record<string, unknown>;
}

async function prepareRemove(input: Record<string, unknown>, ctx: Ctx): Promise<RemovePlan | { error: string; candidates?: unknown }> {
  const t = await rosterTarget(input, ctx);
  if ('error' in t) return t;
  const p = findRosterByName(t.roster, input.player);
  if ('error' in p) return { error: p.error.replace('either team for this matchup', `${t.club.short_code} ${t.div.short_code}`) };
  const { data: mus } = await ctx.db.from('league_team_matchups').select('id, match_date').eq('division_id', t.div.id);
  const matchups = (mus as { id: string; match_date: string }[] | null) ?? [];
  const today = todayIn(ctx.timeZone);
  const { data: ls } = matchups.length
    ? await ctx.db.from('league_matchup_lines').select('*').in('matchup_id', matchups.map((m) => m.id))
    : { data: [] };
  const mine = ((ls as Line[] | null) ?? []).filter((l) => SLOTS.some((k) => l[k] === p.id));
  const played = mine.filter(isScored);
  const future = new Set(matchups.filter((m) => ymd(m.match_date) >= today).map((m) => m.id));
  const clearLines = mine
    .filter((l) => !isScored(l) && future.has(l.matchup_id))
    .map((l) => ({ id: l.id, patch: Object.fromEntries(SLOTS.filter((k) => l[k] === p.id).map((k) => [k, null])) as Record<string, null> }));
  const mode = played.length ? 'withdraw' : 'delete';
  return {
    player: p,
    mode,
    clearLines,
    futureMatchups: [...future],
    summary: {
      player: p.player_name,
      team: `${t.club.short_code} ${t.div.short_code}`,
      action:
        mode === 'withdraw'
          ? `Mark withdrawn — they have ${played.length} scored line(s), and those results are kept.`
          : 'Delete from the roster (no results to keep).',
      taken_off_upcoming_lines: clearLines.length || undefined,
      not_done: 'Nobody is emailed. USTA/TennisLink is not changed.',
    },
  };
}

async function commitRemove(plan: RemovePlan, ctx: Ctx): Promise<ToolResult> {
  for (const c of plan.clearLines) {
    const { error } = await ctx.db.from('league_matchup_lines').update(c.patch).eq('id', c.id).neq('status', 'completed');
    if (error) return { ok: false, error: error.message };
  }
  if (plan.mode === 'withdraw') {
    if (plan.futureMatchups.length) {
      await ctx.db.from('league_matchup_checkins').delete().eq('roster_id', plan.player.id).in('matchup_id', plan.futureMatchups);
    }
    const { error } = await ctx.db.from('league_team_rosters').update({ status: 'withdrawn' }).eq('id', plan.player.id);
    return error ? { ok: false, error: error.message } : { ok: true, withdrawn: plan.player.player_name };
  }
  const { error } = await ctx.db.from('league_team_rosters').delete().eq('id', plan.player.id);
  return error ? { ok: false, error: error.message } : { ok: true, removed: plan.player.player_name };
}

// ------------------------------------------------------------------ writes: ratings

type VaultRow = { id: string; full_name: string; master_player_id: string | null; wtn: number | null; wtn_doubles: number | null; usta_rating: number | null };
type Person = { key: string; name: string; master: string | null; rosters: Roster[]; vault: VaultRow[] };

interface RatingPlan {
  person: Person;
  wtn: number | null;
  wtnDoubles: number | null;
  ntrp: number | null;
  hubWtn: number | null;
  summary: Record<string, unknown>;
}

async function prepareRating(input: Record<string, unknown>, ctx: Ctx): Promise<RatingPlan | { error: string; candidates?: unknown }> {
  const key = norm(input.name);
  if (!key) return { error: 'Whose rating?' };
  const num = (v: unknown) => (v == null || v === '' ? null : Number(v));
  const wtn = num(input.wtn_singles);
  const wtnDoubles = num(input.wtn_doubles);
  const ntrp = num(input.ntrp);
  if (wtn == null && wtnDoubles == null && ntrp == null) return { error: 'Which rating? Give wtn_singles, wtn_doubles or ntrp.' };
  for (const [label, v] of [['Singles WTN', wtn], ['Doubles WTN', wtnDoubles]] as const) {
    if (v != null && !isValidWtn(v)) return { error: `${label} ${v} is outside ${MIN_WTN}–${MAX_WTN}. WTN runs the other way from NTRP — lower is stronger.` };
  }
  if (ntrp != null && !(Number.isFinite(ntrp) && ntrp >= 1 && ntrp <= 7)) {
    return { error: `NTRP ${ntrp} is outside 1.0–7.0${ntrp > 7 ? ' — was that a WTN?' : ''}.` };
  }

  // Candidates: this director's league rosters, plus their club's PlayerVault.
  const s = await loadStructure(ctx);
  if ('error' in s) return s;
  const { data: rost } = s.divs.length
    ? await ctx.db.from('league_team_rosters').select('*').in('division_id', s.divs.map((d) => d.id))
    : { data: [] };
  const rosters = (rost as Roster[] | null) ?? [];
  const canVault = !!ctx.club && MANAGER_ROLES.has(ctx.club.role);
  const { data: vrows } = canVault
    ? await ctx.db
        .from('cc_vault_players')
        .select('id, full_name, master_player_id, wtn, wtn_doubles, usta_rating')
        .eq('club_id', ctx.club!.id)
    : { data: [] };
  const vault = (vrows as VaultRow[] | null) ?? [];

  const match = (n: string, exact: boolean) => (exact ? norm(n) === key : norm(n).split(' ').some((w) => w === key) || norm(n).includes(key));
  let people: Person[] = [];
  for (const exact of [true, false]) {
    const byKey = new Map<string, Person>();
    const add = (k: string, name: string, master: string | null) => {
      if (!byKey.has(k)) byKey.set(k, { key: k, name, master, rosters: [], vault: [] });
      return byKey.get(k)!;
    };
    for (const r of rosters.filter((r) => match(r.player_name, exact))) {
      add(r.master_player_id ?? `name:${norm(r.player_name)}`, r.player_name, r.master_player_id ?? null).rosters.push(r);
    }
    for (const v of vault.filter((v) => match(v.full_name, exact))) {
      const k = v.master_player_id ?? `name:${norm(v.full_name)}`;
      add(k, v.full_name, v.master_player_id).vault.push(v);
    }
    people = [...byKey.values()];
    if (people.length) break;
  }
  if (!people.length) {
    return { error: `No "${input.name}" in your league rosters${canVault ? ` or ${ctx.club!.name}'s PlayerVault` : ''}. Add them first.` };
  }
  if (people.length > 1) {
    return {
      error: `"${input.name}" matches ${people.length} people. Ask which (full name).`,
      candidates: people.map((p) => ({
        name: p.name,
        where: [...p.rosters.map((r) => `${clubShort(s, r.club_id)} ${s.divs.find((d) => d.id === r.division_id)?.short_code}`), ...(p.vault.length ? ['PlayerVault'] : [])].join(', '),
      })),
    };
  }
  const person = people[0];
  let hubWtn: number | null = null;
  let before: Record<string, unknown> = {};
  if (person.master) {
    const { data: mp } = await ctx.db.from('master_players').select('id, full_name, wtn, wtn_doubles, ntrp').eq('id', person.master).maybeSingle();
    const h = mp as { wtn: number | null; wtn_doubles: number | null; ntrp: number | null } | null;
    hubWtn = h?.wtn ?? null;
    before = { wtn_singles: h?.wtn ?? null, wtn_doubles: h?.wtn_doubles ?? null, ntrp: h?.ntrp ?? null };
  } else {
    const r = person.rosters[0];
    const v = person.vault[0];
    before = { wtn_singles: v?.wtn ?? r?.wtn ?? null, wtn_doubles: v?.wtn_doubles ?? null, ntrp: v?.usta_rating ?? r?.ntrp ?? null };
  }
  const set: Record<string, string> = {};
  if (wtn != null) set.wtn_singles = `${before.wtn_singles ?? '—'} → ${wtn}`;
  if (wtnDoubles != null) set.wtn_doubles = `${before.wtn_doubles ?? '—'} → ${wtnDoubles}`;
  if (ntrp != null) set.ntrp = `${before.ntrp ?? '—'} → ${ntrp.toFixed(1)}`;
  return {
    person,
    wtn,
    wtnDoubles,
    ntrp,
    hubWtn,
    summary: {
      player: person.name,
      set,
      where: person.master
        ? 'Their person record — it follows them to PlayerVault, CaptainMode, mixers and league rosters.'
        : 'Only the copies listed below: they are not linked to a person record yet (the nightly sync links them), so it will not travel until then.',
      league_rosters: person.rosters.map((r) => `${clubShort(s, r.club_id)} ${s.divs.find((d) => d.id === r.division_id)?.short_code}`),
      player_vault: person.vault.length ? ctx.club!.name : undefined,
    },
  };
}

async function commitRating(plan: RatingPlan, ctx: Ctx): Promise<ToolResult> {
  const { person } = plan;
  const stamp = new Date().toISOString();
  const errors: string[] = [];
  const hasWtn = plan.wtn != null || plan.wtnDoubles != null;
  if (person.master) {
    if (hasWtn) {
      // Keep an existing singles number when only doubles was given.
      const out = await setWtnForPerson(person.master, { wtn: plan.wtn ?? plan.hubWtn, wtnDoubles: plan.wtnDoubles }, 'manual');
      errors.push(...out.errors);
    }
    if (plan.ntrp != null) {
      const { error } = await ctx.db
        .from('master_players')
        .update({ ntrp: plan.ntrp, ntrp_source: 'director', ntrp_updated_at: stamp, updated_at: stamp })
        .eq('id', person.master);
      if (error) errors.push(`person record: ${error.message}`);
    }
  }
  // League roster copies (not one of the hub's mirror tables, so refresh them here).
  const rosterPatch: Record<string, unknown> = {};
  if (plan.wtn != null) rosterPatch.wtn = plan.wtn;
  if (plan.ntrp != null) rosterPatch.ntrp = plan.ntrp;
  if (Object.keys(rosterPatch).length) {
    for (const r of person.rosters) {
      const { error } = await ctx.db.from('league_team_rosters').update(rosterPatch).eq('id', r.id);
      if (error) errors.push(`roster: ${error.message}`);
    }
  }
  // PlayerVault: the club's NTRP is usta_rating; WTN only needs writing here when unlinked.
  for (const v of person.vault) {
    const patch: Record<string, unknown> = {};
    if (plan.ntrp != null) Object.assign(patch, { usta_rating: plan.ntrp, rating_source: 'manual' });
    if (!person.master && plan.wtn != null) patch.wtn = plan.wtn;
    if (!person.master && plan.wtnDoubles != null) patch.wtn_doubles = plan.wtnDoubles;
    if (!Object.keys(patch).length) continue;
    const { error } = await ctx.db.from('cc_vault_players').update({ ...patch, updated_at: stamp }).eq('id', v.id).eq('club_id', ctx.club!.id);
    if (error) errors.push(`PlayerVault: ${error.message}`);
  }
  if (errors.length) return { ok: false, error: errors.join('; ') };
  return { ok: true, player: person.name, shared: !!person.master };
}

// ------------------------------------------------------------------ writes: reschedule

interface ReschedulePlan {
  matchup: Matchup;
  patch: Record<string, unknown>;
  summary: Record<string, unknown>;
}

async function prepareReschedule(input: Record<string, unknown>, ctx: Ctx): Promise<ReschedulePlan | { error: string; candidates?: unknown }> {
  const s = await loadStructure(ctx, input.league);
  if ('error' in s) return s;
  const f = await findMatchup(ctx, s, input);
  if ('error' in f) return f;
  const { matchup: m, div, us } = f;
  const newDate = clean(input.new_date);
  const newTimeRaw = clean(input.new_time);
  if (!newDate && !newTimeRaw) return { error: 'New date (YYYY-MM-DD) and/or time (HH:MM)?' };
  if (newDate && !YMD.test(newDate)) return { error: `new_date must be YYYY-MM-DD (got "${newDate}").` };
  let newTime: string | null | undefined;
  if (newTimeRaw) {
    if (norm(newTimeRaw) === 'default') newTime = null;
    else if (HM.test(newTimeRaw)) newTime = `${newTimeRaw.padStart(5, '0')}:00`;
    else return { error: `new_time must be HH:MM 24-hour (got "${newTimeRaw}").` };
  }
  const d = await loadDetail(ctx, m);
  const scored = d.lines.filter(isScored);
  if (scored.length) return { error: `${scored.length} line(s) are already scored — a played match can't be moved.` };

  const oldDate = ymd(m.match_date);
  const patch: Record<string, unknown> = {};
  const changes: string[] = [];
  if (newDate && newDate !== oldDate) {
    patch.match_date = newDate;
    changes.push(`date: ${dateLabel(oldDate)} → ${dateLabel(newDate)}`);
  }
  if (newTime !== undefined && newTime !== m.start_time) {
    patch.start_time = newTime;
    changes.push(`time: ${hhmm(m.start_time) ?? `${hhmm(div.start_time) ?? '—'} (division default)`} → ${hhmm(newTime) ?? `${hhmm(div.start_time) ?? '—'} (division default)`}`);
  }
  if (m.status === 'postponed') {
    patch.status = 'scheduled';
    changes.push('status: postponed → scheduled');
  }
  if (!changes.length) return { error: 'That is already when it is scheduled.' };

  const warnings: string[] = [];
  const target = (patch.match_date as string) ?? oldDate;
  if (newDate && div.day_of_week != null && new Date(`${newDate}T12:00:00Z`).getUTCDay() !== div.day_of_week) {
    warnings.push(`${div.short_code} normally plays ${DOW[div.day_of_week]}s; ${newDate} is a ${weekday(newDate)}.`);
  }
  if (newDate && newDate < todayIn(ctx.timeZone)) warnings.push(`${newDate} is in the past.`);
  if (newDate) {
    const { data: same } = await ctx.db
      .from('league_team_matchups')
      .select('id, division_id, home_club_id, away_club_id')
      .in('division_id', s.divs.filter((x) => x.league_id === div.league_id).map((x) => x.id))
      .eq('match_date', target);
    for (const o of ((same as Matchup[] | null) ?? []).filter((x) => x.id !== m.id)) {
      const shared = [o.home_club_id, o.away_club_id].filter((c) => c === m.home_club_id || c === m.away_club_id);
      if (shared.length) {
        warnings.push(
          `${shared.map((c) => clubShort(s, c)).join(' & ')} already play${shared.length > 1 ? '' : 's'} ${s.divs.find((x) => x.id === o.division_id)?.short_code} that day (${clubShort(s, o.away_club_id)} @ ${clubShort(s, o.home_club_id)}).`,
        );
      }
    }
  }
  const yes = [...d.rsvp.values()].filter((v) => v === 'yes').length;
  const no = [...d.rsvp.values()].filter((v) => v === 'no').length;
  return {
    matchup: m,
    patch,
    summary: {
      ...matchupHeader(s, m, div, us),
      changes,
      stays_attached: {
        rsvps: d.rsvp.size ? `${yes} yes / ${no} no — given for the old date; families may need asking again` : 'none',
        check_ins: d.checkins.size || 'none',
        lineup_lines: d.lines.length || 'none',
      },
      warnings: warnings.length ? warnings : undefined,
      not_done: 'Nobody is emailed or texted, no courts are booked or released, and TennisLink/TopDog are not touched.',
    },
  };
}

async function commitReschedule(plan: ReschedulePlan, ctx: Ctx): Promise<ToolResult> {
  const { error } = await ctx.db.from('league_team_matchups').update(plan.patch).eq('id', plan.matchup.id);
  return error ? { ok: false, error: error.message } : { ok: true, matchup_id: plan.matchup.id };
}

// ------------------------------------------------------------------ tool table

/** Wrap a prepare() into a destructive tool whose preview and run share it. */
function writeTool<P extends { summary: Record<string, unknown> }>(
  schema: Anthropic.Messages.Tool,
  prepare: (input: Record<string, unknown>, ctx: Ctx) => Promise<P | { error: string; candidates?: unknown }>,
  commit: (plan: P, ctx: Ctx) => Promise<ToolResult>,
): ToolDef<Ctx> {
  return {
    schema,
    destructive: true,
    async preview(input, ctx) {
      const plan = await prepare(input ?? {}, ctx);
      if ('error' in plan) return { ok: false, ...plan };
      return { ok: true, will: plan.summary };
    },
    async run(input, ctx) {
      const plan = await prepare(input ?? {}, ctx);
      if ('error' in plan) return { ok: false, ...plan };
      const done = await commit(plan, ctx);
      return done.ok ? { ...done, did: plan.summary } : done;
    },
  };
}

const tools: ToolDef<Ctx>[] = [
  { schema: T_OVERVIEW, run: (i, c) => overview(i ?? {}, c) },
  { schema: T_MATCHUPS, run: (i, c) => listMatchups(i ?? {}, c) },
  { schema: T_LINEUP, run: (i, c) => matchupLineup(i ?? {}, c) },
  { schema: T_STANDINGS, run: (i, c) => standings(i ?? {}, c) },
  { schema: T_PARTICIPATION, run: (i, c) => participation(i ?? {}, c) },
  { schema: T_MISSING_WTN, run: (i, c) => missingWtn(i ?? {}, c) },
  writeTool<BuildPlan>(T_BUILD, prepareBuild, commitBuild),
  writeTool<MovePlan>(T_MOVE, prepareMove, commitMove),
  writeTool<ScorePlan>(T_SCORES, prepareScores, commitScores),
  writeTool<AddPlan>(T_ADD, prepareAdd, commitAdd),
  writeTool<RemovePlan>(T_REMOVE, prepareRemove, commitRemove),
  writeTool<RatingPlan>(T_RATING, prepareRating, commitRating),
  writeTool<ReschedulePlan>(T_RESCHEDULE, prepareReschedule, commitReschedule),
];

// ------------------------------------------------------------------ export

export async function resolveLeaguesCtx(userId: string): Promise<LeaguesCtx | null> {
  const db = getSupabaseAdmin();
  const { data } = await db
    .from('leagues')
    .select('id, name, status, start_date, end_date, club_id')
    .eq('director_id', userId)
    .eq('format', 'team');
  const leagues = ((data as LeagueRow[] | null) ?? []).filter((l) => l.status !== 'archived');
  if (!leagues.length) return null;
  const club = await resolveClubCtx(userId).catch(() => null);
  const clubIds = [...new Set(leagues.map((l) => l.club_id).filter(Boolean))] as string[];
  const { data: cc } = clubIds.length ? await db.from('cc_clubs').select('id, name').in('id', clubIds) : { data: [] };
  const names = new Map(((cc as { id: string; name: string }[] | null) ?? []).map((c) => [c.id, c.name]));
  const leagueClubNames: Record<string, string> = {};
  for (const l of leagues) if (l.club_id && names.has(l.club_id)) leagueClubNames[l.id] = names.get(l.club_id)!;
  return {
    userId,
    db,
    leagues,
    club: club ? { id: club.clubId, name: club.clubName, role: club.role } : null,
    leagueClubNames,
    timeZone: club?.timeZone || CLUB_TZ,
  };
}

export const leaguesPack: DomainPack<Ctx> = {
  domain: 'leagues',

  actionsPrompt: `
LEAGUES — the team leagues this director RUNS in ClubMode (clubs, divisions, matchups, lines), any date, any page.
(Today's check-ins on a matchup page are the JTT match-day tools. CaptainMode teams are not covered here.)

Reads: league_overview (start here if codes/names are unclear), league_matchups, league_matchup_lineup (lines by
round/court, #1 singles etc., us/them, RSVPs), league_standings, league_participation (fairness), league_missing_wtn.
Writes (preview first, then confirm): league_build_lineup, league_move_players, league_enter_scores, league_add_player,
league_remove_player, league_record_rating, league_reschedule_matchup.

Rules:
- Turn "Sunday", "11/4" into YYYY-MM-DD yourself and show it.
- Lineups: at HOME every available kid plays — leftovers go on the exhibition court (exhibition on by default).
  The 6-player cap is for AWAY only: pass away_cap only when the AWAY side must be capped. Never cap the home side.
- Scores: pass each line's score as said and score_from (whose games come first; default us). The team score is lines
  won and is computed — a total like "we won 8–4" goes in team_total as a cross-check, never as the result. If they
  give only a total, ask for the line scores.
- Ratings go on the person: WTN 1–40 (lower is stronger), NTRP 1.0–7.0. "Craig is a 3.0" = NTRP.
- Read the preview's specifics back (who sits/plays, before→after, parsed scores, date change) and wait for a yes.
- If a name matches several people or matches, ask — never pick.

You CANNOT: email/text anyone, write to TennisLink/TopDog or any outside system, book courts, or type a team score.
Say so plainly when asked, and relay any ok:false reason as given.
`.trim(),

  resolve: (userId) => resolveLeaguesCtx(userId),

  tools,
};
