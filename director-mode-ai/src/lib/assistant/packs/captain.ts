import type Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { DomainPack, ToolDef, ToolResult } from '../framework';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { absoluteUrl } from '@/lib/appUrl';
import { gateTeam } from '@/lib/captain/access';
import {
  capForTeam,
  committedCounts,
  pairRecords,
  playedCounts,
  rulesFor,
  singlesCounts,
  soFarCounts,
  styleFor,
  type TeamRow,
} from '@/lib/captain/server';
import {
  eligibilityReport,
  generateLineup,
  requiredMatches,
  type LeagueType,
  type Player,
  type RatingType,
} from '@/lib/captain/lineup';
import { generateJttLineup } from '@/lib/captain/jttLineup';
import {
  DEFAULT_JTT_COURT_FORMAT,
  EXHIBITION_SEATS,
  JTT_COURT_FORMATS,
  COURT_COUNT_ERROR,
  homeRoundCapacity,
  homeSquadMax,
  isValidCourtCount,
  jttRoundPlan,
  leagueSpec,
  lineNames,
  roundClashes,
  roundPlanText,
  roundsByCourt,
  rosterWindow,
} from '@/lib/captain/leagues';
import { resolveAvailability } from '@/lib/captain/availability';
import { answersByPlayer, answerTally, rowsWithAnswers, type SavedCourt } from '@/lib/captain/lineupSave';
import { formatMatchWhen, opponentHostingEmail, sendAll, type MatchInfo } from '@/lib/captain/emails';
import { loadTeamEmailContext, payloadsFor, recipientsFor, MATCH_COLUMNS } from '@/lib/captain/timelineSend';
import { KIND_META } from '@/lib/captain/timeline';
import { ccPayloads, matchCoachOf, withMatchCoach } from '@/lib/captain/teamContacts';
import { pickOpponentRow } from '@/lib/captain/opponentMatch';
import { isNotAName } from '@/lib/captain/rosterPaste';
import { normalizePhone, formatPhone } from '@/lib/captain/phone';
import { CLUB_TZ, normalizeTimeZone } from '@/lib/captain/clubTime';

/*
 * CaptainMode pack — running a team's match week by voice.
 *
 * "Redo Sunday's lineup, it's a 2-court format", "move Daralisa and Leena to
 * line 2", "Maya dropped, who are the subs?", "mark Owen out for Saturday",
 * "send the lineup", "tell the other captain we're short".
 *
 * WHO. CaptainMode teams belong to a captain, not a club. A person may act on a
 * team they captain or co-captain (the same test CaptainMode's own routes run:
 * captain_teams.captain_user_id / captain_team_staff, and the team-owner
 * subscription gate), or on any team playing for a club they own or direct.
 * Every tool is scoped to that list; a team id from anywhere else is "not one
 * of yours".
 *
 * SAME RULES AS THE CAPTAIN'S SCREENS.
 *   - Lineups come from generateLineup / generateJttLineup fed exactly the
 *     inputs the lineup route's generate step builds (availability + blackouts
 *     via resolveAvailability, committed/singles counts, pair history, prefs,
 *     the JTT squad cap and home exhibition). Saves carry every player's
 *     confirmation across with lineupSave, as the route does.
 *   - Marking someone in/out mirrors /api/captain/confirm-for.
 *   - Team emails are built by timelineSend.payloadsFor — the function the
 *     cron, the timeline preview and "send now" share — so the preview here is
 *     the email that goes out. The opposing-captain note uses
 *     opponentHostingEmail with the captain's words, like the host-email route.
 *
 * NOTHING IS SENT OR SAVED WITHOUT CONFIRM. Every write and send is destructive
 * (preview → confirm). Previews show recipients and the exact text.
 *
 * WHAT IT WILL NOT DO. Post scores or lineups to TennisLink / TopDog / USTA,
 * text anyone, charge anyone, or delete a player.
 */

type Db = SupabaseClient<any, 'public', any>;

export type CaptainTeamRef = {
  id: string;
  name: string;
  /** How this user reaches the team. */
  role: 'captain' | 'co-captain' | 'director';
  clubId: string | null;
  /** 'needs_subscription' = CaptainMode would show its paywall for this team. */
  access: 'ok' | 'needs_subscription';
};

export interface CaptainPackCtx {
  userId: string;
  db: Db;
  teams: CaptainTeamRef[];
  /** From a /captain/<teamId> page. */
  defaultTeamId: string | null;
  /** From a /captain/<teamId>/match/<matchId> page. */
  defaultMatchId: string | null;
}
type Ctx = CaptainPackCtx;

type MatchRow = {
  id: string;
  team_id: string;
  match_at: string;
  is_home: boolean;
  opponent: string | null;
  location: string | null;
  arrival_note: string | null;
  opposing_captain_name: string | null;
  opposing_captain_email: string | null;
  opposing_captain_phone: string | null;
  singles_courts: number;
  doubles_courts: number;
  status: string;
  court_format: number | null;
  lineup_email_sent_at: string | null;
  match_coach_id: string | null;
};

type PlayerRow = Record<string, any> & { id: string; name: string };

type CourtRow = {
  id?: string;
  court_number: number;
  court_type: 'singles' | 'doubles';
  player1_id: string | null;
  player2_id: string | null;
  player1_confirmed_at?: string | null;
  player2_confirmed_at?: string | null;
  player1_declined_at?: string | null;
  player2_declined_at?: string | null;
};

type Err = { error: string; candidates?: unknown };
const isErr = (v: unknown): v is Err => !!v && typeof v === 'object' && 'error' in (v as object);
const fail = (e: Err): ToolResult => ({ ok: false, ...e });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---------------------------------------------------------------- resolving

/**
 * Every team this user may run, with how they reach it. Captain beats
 * co-captain beats director when someone is more than one.
 */
async function teamsFor(userId: string, db: Db): Promise<CaptainTeamRef[]> {
  const [{ data: own }, { data: staff }, { data: ownedClubs }, { data: dirClubs }] = await Promise.all([
    db.from('captain_teams').select('id, name, club_id').eq('captain_user_id', userId).eq('archived', false),
    db.from('captain_team_staff').select('team_id').eq('user_id', userId),
    db.from('cc_clubs').select('id').eq('owner_id', userId),
    db.from('cc_club_members').select('club_id').eq('user_id', userId).in('role', ['owner', 'director']),
  ]);
  type T = { id: string; name: string; club_id: string | null };
  const out = new Map<string, Omit<CaptainTeamRef, 'access'>>();
  for (const t of (own as T[]) || []) out.set(t.id, { id: t.id, name: t.name, role: 'captain', clubId: t.club_id });

  const staffIds = ((staff as { team_id: string }[]) || []).map((s) => s.team_id).filter((id) => !out.has(id));
  if (staffIds.length) {
    const { data } = await db.from('captain_teams').select('id, name, club_id').in('id', staffIds).eq('archived', false);
    for (const t of (data as T[]) || []) out.set(t.id, { id: t.id, name: t.name, role: 'co-captain', clubId: t.club_id });
  }

  const clubIds = [
    ...((ownedClubs as { id: string }[]) || []).map((c) => c.id),
    ...((dirClubs as { club_id: string }[]) || []).map((c) => c.club_id),
  ].filter(Boolean);
  if (clubIds.length) {
    const { data } = await db.from('captain_teams').select('id, name, club_id').in('club_id', [...new Set(clubIds)]).eq('archived', false);
    for (const t of (data as T[]) || []) {
      if (!out.has(t.id)) out.set(t.id, { id: t.id, name: t.name, role: 'director', clubId: t.club_id });
    }
  }

  const teams: CaptainTeamRef[] = [];
  for (const t of out.values()) {
    // Captains and co-captains go through CaptainMode's own gate, so the
    // assistant is never a way round the paywall. A director runs the club the
    // team plays for; ClubMode, not a captain subscription, is what they pay.
    let access: CaptainTeamRef['access'] = 'ok';
    if (t.role !== 'director') {
      try {
        access = (await gateTeam(userId, t.id)) === 'ok' ? 'ok' : 'needs_subscription';
      } catch {
        access = 'needs_subscription';
      }
    }
    teams.push({ ...t, access });
  }
  return teams.sort((a, b) => a.name.localeCompare(b.name));
}

export function pageIds(page: string | undefined): { teamId: string | null; matchId: string | null } {
  const m = (page || '').match(/\/captain\/([0-9a-f-]{36})(?:\/match\/([0-9a-f-]{36}))?/i);
  return { teamId: m?.[1] ?? null, matchId: m?.[2] ?? null };
}

function pickTeam(ctx: Ctx, ref: unknown): CaptainTeamRef | Err {
  const list = ctx.teams.map((t) => `${t.name} (${t.role})`);
  let team: CaptainTeamRef | undefined;
  const s = typeof ref === 'string' ? ref.trim() : '';
  if (s) {
    const lc = s.toLowerCase();
    team =
      ctx.teams.find((t) => t.id === s) ??
      ctx.teams.find((t) => t.name.toLowerCase() === lc);
    if (!team) {
      const hits = ctx.teams.filter((t) => t.name.toLowerCase().includes(lc));
      if (hits.length === 1) team = hits[0];
      else if (hits.length > 1) return { error: `"${s}" matches more than one team.`, candidates: hits.map((t) => t.name) };
    }
    if (!team) return { error: `No team "${s}" among the teams you run.`, candidates: list };
  } else if (ctx.defaultTeamId) {
    team = ctx.teams.find((t) => t.id === ctx.defaultTeamId);
  }
  if (!team && ctx.teams.length === 1) team = ctx.teams[0];
  if (!team) return { error: 'Which team?', candidates: list };
  if (team.access !== 'ok') {
    return { error: `${team.name} needs an active CaptainMode subscription (the team owner's) — see /captain/subscribe.` };
  }
  return team;
}

async function loadTeam(ctx: Ctx, ref: unknown): Promise<{ ref: CaptainTeamRef; team: TeamRow & Record<string, any> } | Err> {
  const t = pickTeam(ctx, ref);
  if (isErr(t)) return t;
  const { data } = await ctx.db.from('captain_teams').select('*').eq('id', t.id).maybeSingle();
  if (!data) return { error: 'Team not found.' };
  return { ref: t, team: data as TeamRow & Record<string, any> };
}

async function teamTz(ctx: Ctx, team: { club_id: string | null }): Promise<string> {
  if (!team.club_id) return CLUB_TZ;
  const { data } = await ctx.db.from('cc_clubs').select('timezone').eq('id', team.club_id).maybeSingle();
  return normalizeTimeZone((data as { timezone?: string | null } | null)?.timezone);
}

const localYmd = (iso: string, tz: string) =>
  new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: tz }).format(new Date(iso));

function matchLabel(m: MatchRow, tz: string): string {
  return `${formatMatchWhen(m.match_at, tz)} ${m.is_home ? 'vs' : 'at'} ${m.opponent || 'TBD'}${m.status !== 'scheduled' ? ` (${m.status})` : ''}`;
}

/**
 * The match a request is about: an id, a club-local date, an opponent, or
 * "next". With nothing given, the match whose page they are on, else the next
 * one on the schedule.
 */
async function pickMatch(ctx: Ctx, teamId: string, ref: unknown, tz: string): Promise<MatchRow | Err> {
  const { data } = await ctx.db.from('captain_matches').select('*').eq('team_id', teamId).order('match_at');
  const all = ((data as MatchRow[]) || []).slice();
  if (!all.length) return { error: 'This team has no matches on its schedule.' };
  const soon = Date.now() - 12 * 3600_000; // a match earlier today still counts as "this one"
  const upcoming = all.filter((m) => m.status !== 'cancelled' && Date.parse(m.match_at) >= soon);
  const cands = (list: MatchRow[]) => list.slice(0, 8).map((m) => ({ match_id: m.id, match: matchLabel(m, tz) }));
  const s = typeof ref === 'string' ? ref.trim() : '';

  if (!s || s.toLowerCase() === 'next') {
    const fromPage = !s && ctx.defaultMatchId ? all.find((m) => m.id === ctx.defaultMatchId) : undefined;
    if (fromPage) return fromPage;
    return upcoming[0] ?? { error: 'No upcoming match — say which one.', candidates: cands(all.slice(-8)) };
  }
  if (UUID.test(s)) {
    return all.find((m) => m.id === s) ?? { error: 'That match is not on this team’s schedule.', candidates: cands(upcoming) };
  }
  if (YMD.test(s)) {
    const hits = all.filter((m) => localYmd(m.match_at, tz) === s);
    if (hits.length === 1) return hits[0];
    if (hits.length > 1) return { error: `More than one match on ${s}.`, candidates: cands(hits) };
    return { error: `No match on ${s}.`, candidates: cands(upcoming) };
  }
  const lc = s.toLowerCase();
  const hits = all.filter((m) => (m.opponent || '').toLowerCase().includes(lc));
  if (!hits.length) return { error: `No match against "${s}".`, candidates: cands(upcoming) };
  // The nearest one still to come; otherwise the most recent.
  return hits.find((m) => upcoming.includes(m)) ?? hits[hits.length - 1];
}

async function loadRoster(ctx: Ctx, teamId: string): Promise<PlayerRow[]> {
  const { data } = await ctx.db.from('captain_players').select('*').eq('team_id', teamId).eq('active', true);
  return ((data as PlayerRow[]) || []).sort((a, b) => a.name.localeCompare(b.name));
}

/** Names as people say them: full name, first name, last name, or a unique fragment. */
export function findPlayers(roster: PlayerRow[], names: unknown): { players: PlayerRow[] } | Err {
  const list = (Array.isArray(names) ? names : typeof names === 'string' ? [names] : [])
    .map((n) => String(n ?? '').trim())
    .filter(Boolean);
  if (!list.length) return { error: 'Name at least one player.' };
  const out: PlayerRow[] = [];
  for (const raw of list) {
    const lc = raw.toLowerCase();
    const parts = (p: PlayerRow) => p.name.toLowerCase().split(/\s+/);
    const tiers: ((p: PlayerRow) => boolean)[] = [
      (p) => p.name.trim().toLowerCase() === lc,
      (p) => parts(p)[0] === lc,
      (p) => parts(p).slice(-1)[0] === lc,
      (p) => p.name.toLowerCase().includes(lc),
    ];
    let hit: PlayerRow | null = null;
    for (const tier of tiers) {
      const h = roster.filter(tier);
      if (h.length === 1) { hit = h[0]; break; }
      if (h.length > 1) return { error: `"${raw}" could be ${h.map((p) => p.name).join(' or ')} — which?` };
    }
    if (!hit) return { error: `Nobody called "${raw}" on the active roster.`, candidates: roster.map((p) => p.name) };
    if (!out.some((p) => p.id === hit!.id)) out.push(hit);
  }
  return { players: out };
}

async function savedCourts(ctx: Ctx, matchId: string): Promise<CourtRow[]> {
  const { data } = await ctx.db.from('captain_lineups').select('*').eq('match_id', matchId).order('court_number');
  return ((data as CourtRow[]) || []).slice().sort((a, b) => a.court_number - b.court_number);
}

function courtFormatOf(match: { court_format: number | null }, team: { court_format?: number | null }): number {
  return match.court_format ?? team.court_format ?? DEFAULT_JTT_COURT_FORMAT;
}

/** "Doubles 2 (round 1): Daralisa Ray / Leena Ko" — one line per court, in playing order. */
function sheetText(
  courts: SavedCourt[],
  nameOf: (id: string | null) => string,
  rounds: Map<number, number> | null,
): string[] {
  const names = lineNames(courts);
  const typeRank = (t: string) => (t === 'singles' ? 0 : 1);
  return [...courts]
    .sort((a, b) =>
      rounds
        ? (rounds.get(a.courtNumber) ?? 99) - (rounds.get(b.courtNumber) ?? 99) ||
          typeRank(a.courtType) - typeRank(b.courtType) ||
          a.courtNumber - b.courtNumber
        : a.courtNumber - b.courtNumber,
    )
    .map((c) => {
      const who = c.courtType === 'doubles' ? `${nameOf(c.player1Id)} / ${nameOf(c.player2Id)}` : nameOf(c.player1Id);
      const r = rounds?.get(c.courtNumber);
      return `${names.get(c.courtNumber) ?? `Line ${c.courtNumber}`}${r ? ` (round ${r})` : ''}: ${who}`;
    });
}

const toSaved = (rows: CourtRow[]): SavedCourt[] =>
  rows.map((r) => ({ courtNumber: r.court_number, courtType: r.court_type, player1Id: r.player1_id, player2Id: r.player2_id }));

function roundsFor(team: { league_type: string; court_format?: number | null }, match: { court_format: number | null }, courts: SavedCourt[]) {
  return leagueSpec(team.league_type).multiLine ? roundsByCourt(courts, courtFormatOf(match, team)) : null;
}

/** Plain text of an email, for a preview the director can read in chat. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(br|\/p|\/div|\/tr|\/h1|\/li)[^>]*>/gi, '\n')
    .replace(/<td[^>]*>/gi, ' ')
    .replace(/<a [^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '$2 [$1]')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&rarr;/g, '→')
    .replace(/&#39;|&rsquo;/g, '’')
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n');
}

// ---------------------------------------------------------- lineup builder

type LineupOpts = {
  courtFormat?: number;
  singlesCourts?: number;
  doublesCourts?: number;
  /** Availability as it WILL be once the confirmed write lands. */
  markIn?: string[];
  markOut?: string[];
};

type LineupPlan = {
  courts: SavedCourt[];
  lineup: string[];
  sitting: { name: string; reason: string }[];
  benched: { name: string; reason: string }[];
  warnings: string[];
  explanation: string[];
  format: { singles: number; doubles: number; court_format: number | null };
  fairness: { name: string; matches_so_far: number; already_committed: number; singles_so_far: number | null }[];
};

/**
 * The lineup route's generate step, verbatim in its inputs. Kept as one
 * function so who_sits, build_lineup's preview and its run are the same
 * computation; the generator itself is CaptainMode's.
 */
async function planLineup(
  ctx: Ctx,
  team: TeamRow & Record<string, any>,
  match: MatchRow,
  tz: string,
  opts: LineupOpts,
): Promise<LineupPlan> {
  const db = ctx.db;
  const teamId = team.id;
  const players = await loadRoster(ctx, teamId);
  const { data: availRows } = await db.from('captain_availability').select('player_id, status').eq('match_id', match.id);
  const answers = new Map(((availRows as { player_id: string; status: string }[]) || []).map((a) => [a.player_id, a.status]));
  for (const id of opts.markIn ?? []) answers.set(id, 'yes');
  for (const id of opts.markOut ?? []) answers.set(id, 'no');
  const avail = [...answers.entries()].map(([player_id, status]) => ({ player_id, status }));

  const resolved = resolveAvailability({
    roster: players.map((p) => ({ id: p.id, name: p.name, unavailable_days: (p.unavailable_days as string[] | null) ?? [], row: p })),
    answers: avail,
    matchAt: match.match_at,
    timeZone: tz,
  });

  const counts = await committedCounts(db, teamId, match.id);
  const singlesSoFar = await singlesCounts(db, teamId, match.id);
  const soFar = await soFarCounts(db, teamId, match.id);
  const rules = rulesFor(team);
  const history = await pairRecords(db, teamId);

  const available: Player[] = resolved.available.map((r) => r.row).map((p) => {
    const booked = counts[p.id] ?? 0;
    const need = requiredMatches(rules, (p.rating_type as RatingType) ?? 'computer');
    return {
      id: p.id,
      name: p.name,
      rating: p.rating == null ? null : Number(p.rating),
      gender: (p.gender as 'M' | 'F' | null) ?? null,
      returnSide: (p.return_side as 'deuce' | 'ad' | null) ?? null,
      courtLimit: (p.court_limit as Player['courtLimit']) ?? null,
      maxLines: p.max_lines == null ? null : Number(p.max_lines),
      singlesPlayed: singlesSoFar[p.id] ?? 0,
      matchesPlayed: booked,
      needsEligibility: need > 0 && booked < need,
      sortOrder: p.sort_order == null ? null : Number(p.sort_order),
      wtn: p.wtn == null ? null : Number(p.wtn),
      wtnDoubles: p.wtn_doubles == null ? null : Number(p.wtn_doubles),
    };
  });

  const [{ data: prefs }, { data: never }] = await Promise.all([
    db.from('captain_partner_prefs').select('player_id, preferred_player_id, rank').eq('team_id', teamId),
    db.from('captain_never_pair').select('player_a_id, player_b_id').eq('team_id', teamId),
  ]);
  const singlesCourts = opts.singlesCourts ?? match.singles_courts;
  const doublesCourts = opts.doublesCourts ?? match.doubles_courts;
  const partnerPrefs = ((prefs as Record<string, unknown>[]) || []).map((r) => ({
    playerId: r.player_id as string,
    preferredPlayerId: r.preferred_player_id as string,
    rank: r.rank as number,
  }));
  const neverPairs = ((never as Record<string, unknown>[]) || []).map((r) => ({
    playerAId: r.player_a_id as string,
    playerBId: r.player_b_id as string,
  }));

  const multiLine = leagueSpec(team.league_type).multiLine;
  const courtFormat = opts.courtFormat ?? courtFormatOf(match, team);
  const isHome = !!match.is_home;
  const squadMax = !multiLine
    ? 0
    : isHome
      ? homeSquadMax(courtFormat, singlesCourts, doublesCourts)
      : (team.max_players as number | null) ??
        rosterWindow({ singles: singlesCourts, doubles: doublesCourts }, multiLine).idealMax;
  let squad: { max: number; otherYes: Record<string, number>; joinedAt: Record<string, string> } | null = null;
  if (multiLine && available.length > squadMax) {
    const { data: others } = await db
      .from('captain_matches')
      .select('id')
      .eq('team_id', teamId)
      .eq('status', 'scheduled')
      .gt('match_at', new Date().toISOString())
      .neq('id', match.id);
    const otherIds = ((others as { id: string }[]) || []).map((o) => o.id);
    const { data: yesRows } = otherIds.length
      ? await db.from('captain_availability').select('player_id').in('match_id', otherIds).eq('status', 'yes')
      : { data: [] as { player_id: string }[] };
    const otherYes: Record<string, number> = {};
    for (const r of (yesRows as { player_id: string }[]) || []) otherYes[r.player_id] = (otherYes[r.player_id] ?? 0) + 1;
    const joinedAt = Object.fromEntries(players.map((p) => [p.id, (p.created_at as string) ?? '']));
    squad = { max: squadMax, otherYes, joinedAt };
  }

  const style = styleFor(team);
  const result = multiLine
    ? generateJttLineup({
        available,
        singlesCourts,
        doublesCourts,
        rules: multiLine,
        courtFormat,
        squad,
        exhibition: isHome,
        partnerPrefs,
        neverPairs,
        pairHistory: history,
        captainingStyle: style,
      })
    : generateLineup({
        available,
        pairHistory: history,
        partnerPrefs,
        neverPairs,
        singlesCourts,
        doublesCourts,
        leagueType: (team.league_type as LeagueType) || 'usta_adult',
        combinedRatingCap: capForTeam(team),
        captainingStyle: style,
      });

  const nameOf = (id: string | null) => (id ? players.find((p) => p.id === id)?.name ?? '—' : '—');
  const courts: SavedCourt[] = result.courts.map((c) => ({
    courtNumber: c.courtNumber,
    courtType: c.courtType,
    player1Id: c.player1Id,
    player2Id: c.player2Id,
  }));
  const rounds = multiLine ? roundsByCourt(courts, courtFormat) : null;

  // The route's "why it chose this", the parts a director asks about.
  const spots = singlesCourts + doublesCourts * 2;
  const explanation: string[] = [
    `${available.length} of ${players.length} said yes. This match needs ${spots}` +
      (singlesCourts ? ` — ${singlesCourts} singles and ${doublesCourts} doubles lines.` : ` — ${doublesCourts} doubles lines.`),
  ];
  if (multiLine) {
    explanation.push(
      `${courtFormat}-court format — ${roundPlanText(jttRoundPlan(courtFormat, singlesCourts, doublesCourts), singlesCourts)}. Nobody is on two lines in the same round.`,
    );
    if (isHome) {
      explanation.push(
        available.length > homeRoundCapacity(courtFormat, singlesCourts, doublesCourts)
          ? `Home match: everyone who said yes comes (up to ${squadMax}); the ${EXHIBITION_SEATS}-player exhibition court rotates and anyone on neither takes that round off.`
          : `Home match: everyone who said yes comes (up to ${squadMax}); whoever is off a scored line plays the exhibition court.`,
      );
    }
  }
  explanation.push(
    style === 'equal_play'
      ? 'Equal play is on: fewest matches already committed get the spots first, then strength.'
      : 'Play to win is on: strongest available side; fairness is only a tiebreaker.',
  );
  const answered = [...answers.values()];
  const maybe = answered.filter((s) => s === 'maybe').length;
  const no = answered.filter((s) => s === 'no').length;
  if (maybe) explanation.push(`${maybe} said maybe and were left out — only a yes is used.`);
  if (no) explanation.push(`${no} said no.`);
  if (resolved.awaiting.length) explanation.push(`${resolved.awaiting.length} have not answered and were not considered: ${resolved.awaiting.map((p) => p.name).join(', ')}.`);

  const seated = new Set(courts.flatMap((c) => [c.player1Id, c.player2Id]).filter(Boolean) as string[]);
  const sittingWhy = new Map((result.sitting ?? []).map((s) => [s.id, s.reason]));
  const benched = available
    .filter((p) => !seated.has(p.id))
    .sort((a, b) => a.matchesPlayed - b.matchesPlayed || a.name.localeCompare(b.name))
    .map((p) => ({
      name: p.name,
      reason:
        sittingWhy.get(p.id) ??
        (p.courtLimit === 'singles_only'
          ? 'plays singles only, and the singles lines were filled'
          : p.courtLimit === 'doubles_only'
            ? 'plays doubles only, and the doubles lines were filled'
            : style === 'equal_play'
              ? `already down for ${p.matchesPlayed} ${p.matchesPlayed === 1 ? 'match' : 'matches'} — sitting so someone behind can play`
              : p.needsEligibility
                ? 'available, and still needs matches for playoff eligibility'
                : 'available, but there were more players than spots'),
    }));

  return {
    courts,
    lineup: sheetText(courts, nameOf, rounds),
    sitting: (result.sitting ?? []).map((s) => ({ name: nameOf(s.id), reason: s.reason })),
    benched,
    warnings: [...resolved.warnings, ...result.warnings],
    explanation,
    format: { singles: singlesCourts, doubles: doublesCourts, court_format: multiLine ? courtFormat : null },
    fairness: available
      .map((p) => ({
        name: p.name,
        matches_so_far: soFar[p.id] ?? 0,
        already_committed: counts[p.id] ?? 0,
        singles_so_far: multiLine ? (singlesSoFar[p.id] ?? 0) : null,
      }))
      .sort((a, b) => a.matches_so_far - b.matches_so_far || a.name.localeCompare(b.name)),
  };
}

/** Delete-and-reinsert with every player's answer carried across — the route's save. */
async function saveLineup(ctx: Ctx, teamId: string, matchId: string, courts: SavedCourt[]) {
  const { data: previous } = await ctx.db
    .from('captain_lineups')
    .select(
      'player1_id, player2_id, player1_confirmed_at, player2_confirmed_at, player1_confirmed_source, player2_confirmed_source, player1_declined_at, player2_declined_at, player1_decline_note, player2_decline_note',
    )
    .eq('match_id', matchId);
  const answers = answersByPlayer((previous as Record<string, unknown>[]) || []);
  const tally = answerTally(courts, answers);
  await ctx.db.from('captain_lineups').delete().eq('match_id', matchId);
  if (courts.length) {
    const { error } = await ctx.db
      .from('captain_lineups')
      .insert(rowsWithAnswers(courts, answers, { team_id: teamId, match_id: matchId }));
    if (error) throw new Error(error.message);
  }
  return tally;
}

/** /api/captain/confirm-for, for one player. */
async function recordAnswer(
  ctx: Ctx,
  teamId: string,
  matchId: string,
  playerId: string,
  state: 'in' | 'maybe' | 'out' | 'clear',
  note: string | null,
) {
  const now = new Date().toISOString();
  const rows = await savedCourts(ctx, matchId);
  const row = rows.find((l) => l.player1_id === playerId || l.player2_id === playerId);
  if (row) {
    const slot = row.player1_id === playerId ? 1 : 2;
    const patch: Record<string, unknown> =
      state === 'in'
        ? { [`player${slot}_confirmed_at`]: now, [`player${slot}_confirmed_source`]: 'captain', [`player${slot}_declined_at`]: null, [`player${slot}_decline_note`]: null }
        : state === 'out'
          ? { [`player${slot}_declined_at`]: now, [`player${slot}_confirmed_at`]: null, [`player${slot}_confirmed_source`]: null, [`player${slot}_decline_note`]: note }
          : { [`player${slot}_confirmed_at`]: null, [`player${slot}_confirmed_source`]: null, [`player${slot}_declined_at`]: null, [`player${slot}_decline_note`]: null };
    // 'maybe' on a court row reads as "no answer yet", exactly as confirm-for does.
    const { error } = await ctx.db.from('captain_lineups').update({ ...patch, updated_at: now }).eq('id', row.id).eq('team_id', teamId);
    if (error) throw new Error(error.message);
  }
  if (state === 'clear') {
    await ctx.db.from('captain_availability').delete().eq('match_id', matchId).eq('player_id', playerId);
  } else {
    const { error } = await ctx.db.from('captain_availability').upsert(
      {
        team_id: teamId,
        match_id: matchId,
        player_id: playerId,
        status: state === 'in' ? 'yes' : state === 'maybe' ? 'maybe' : 'no',
        ...(note ? { note } : {}),
        responded_at: now,
      },
      { onConflict: 'match_id,player_id' },
    );
    if (error) throw new Error(error.message);
  }
}

// ------------------------------------------------------------------- shared

const TEAM = { type: 'string', description: 'Team name or id. Omit to use the team whose page they are on (or their only team).' };
const MATCH = {
  type: 'string',
  description: 'Match: YYYY-MM-DD (club-local date), opponent name, match id, or "next". Omit for the match page they are on, else the next match.',
};

async function teamAndMatch(ctx: Ctx, input: any) {
  const t = await loadTeam(ctx, input?.team);
  if (isErr(t)) return t;
  const tz = await teamTz(ctx, t.team);
  const m = await pickMatch(ctx, t.team.id, input?.match, tz);
  if (isErr(m)) return m;
  return { ...t, tz, match: m };
}

// -------------------------------------------------------------------- reads

async function listTeams(_input: any, ctx: Ctx): Promise<ToolResult> {
  const now = new Date().toISOString();
  const out = [];
  for (const t of ctx.teams) {
    const { data } = await ctx.db
      .from('captain_matches')
      .select('id, match_at, opponent, is_home, status')
      .eq('team_id', t.id)
      .eq('status', 'scheduled')
      .gte('match_at', now)
      .order('match_at')
      .limit(1);
    const next = ((data as MatchRow[]) || [])[0];
    const tz = t.access === 'ok' ? await teamTz(ctx, { club_id: t.clubId }) : CLUB_TZ;
    out.push({
      team_id: t.id,
      name: t.name,
      you_are: t.role,
      ...(t.access !== 'ok' ? { blocked: 'needs a CaptainMode subscription' } : {}),
      next_match: next ? matchLabel(next, tz) : null,
      page: absoluteUrl(`/captain/${t.id}`),
    });
  }
  return { ok: true, teams: out };
}

async function listMatches(input: any, ctx: Ctx): Promise<ToolResult> {
  const t = await loadTeam(ctx, input?.team);
  if (isErr(t)) return fail(t);
  const tz = await teamTz(ctx, t.team);
  const { data } = await ctx.db.from('captain_matches').select('*').eq('team_id', t.team.id).order('match_at');
  let ms = (data as MatchRow[]) || [];
  if (!input?.include_past) ms = ms.filter((m) => Date.parse(m.match_at) >= Date.now() - 12 * 3600_000);
  const ids = ms.map((m) => m.id);
  const [{ data: lu }, { data: av }] = await Promise.all([
    ids.length ? ctx.db.from('captain_lineups').select('match_id').in('match_id', ids) : Promise.resolve({ data: [] }),
    ids.length ? ctx.db.from('captain_availability').select('match_id, status').in('match_id', ids) : Promise.resolve({ data: [] }),
  ]);
  const multi = !!leagueSpec(t.team.league_type).multiLine;
  return {
    ok: true,
    team: t.team.name,
    matches: ms.map((m) => {
      const a = ((av as { match_id: string; status: string }[]) || []).filter((x) => x.match_id === m.id);
      return {
        match_id: m.id,
        match: matchLabel(m, tz),
        lines: `${m.singles_courts} singles, ${m.doubles_courts} doubles${multi ? `, ${courtFormatOf(m, t.team)}-court format` : ''}`,
        availability: { yes: a.filter((x) => x.status === 'yes').length, maybe: a.filter((x) => x.status === 'maybe').length, no: a.filter((x) => x.status === 'no').length },
        lineup_saved: ((lu as { match_id: string }[]) || []).some((x) => x.match_id === m.id),
        lineup_emailed: m.lineup_email_sent_at ? formatMatchWhen(m.lineup_email_sent_at, tz) : null,
      };
    }),
  };
}

async function matchOverview(input: any, ctx: Ctx): Promise<ToolResult> {
  const r = await teamAndMatch(ctx, input);
  if (isErr(r)) return fail(r);
  const { team, match, tz } = r;
  const roster = await loadRoster(ctx, team.id);
  const nameOf = (id: string | null) => (id ? roster.find((p) => p.id === id)?.name ?? '(not on roster)' : '—');
  const courts = await savedCourts(ctx, match.id);
  const saved = toSaved(courts);
  const { data: availRows } = await ctx.db.from('captain_availability').select('player_id, status, note').eq('match_id', match.id);
  const answers = (availRows as { player_id: string; status: string; note: string | null }[]) || [];
  const resolved = resolveAvailability({
    roster: roster.map((p) => ({ id: p.id, name: p.name, unavailable_days: (p.unavailable_days as string[] | null) ?? [] })),
    answers,
    matchAt: match.match_at,
    timeZone: tz,
  });
  const noteOf = (id: string) => answers.find((a) => a.player_id === id)?.note;
  const by = (s: string) =>
    answers.filter((a) => a.status === s).map((a) => `${nameOf(a.player_id)}${noteOf(a.player_id) ? ` (${noteOf(a.player_id)})` : ''}`);
  const confirmations = courts.flatMap((c) =>
    ([1, 2] as const)
      .filter((s) => (s === 1 ? c.player1_id : c.player2_id))
      .map((s) => {
        const pid = (s === 1 ? c.player1_id : c.player2_id) as string;
        const conf = s === 1 ? c.player1_confirmed_at : c.player2_confirmed_at;
        const dec = s === 1 ? c.player1_declined_at : c.player2_declined_at;
        return `${nameOf(pid)}: ${dec ? 'pulled out' : conf ? 'confirmed' : 'no answer yet'}`;
      }),
  );
  const multi = !!leagueSpec(team.league_type).multiLine;
  return {
    ok: true,
    team: team.name,
    match_id: match.id,
    match: matchLabel(match, tz),
    location: match.location,
    format: { singles: match.singles_courts, doubles: match.doubles_courts, court_format: multi ? courtFormatOf(match, team) : null },
    lineup: saved.length ? sheetText(saved, nameOf, roundsFor(team, match, saved)) : null,
    confirmations: [...new Set(confirmations)],
    availability: {
      yes: by('yes'),
      maybe: by('maybe'),
      no: by('no'),
      not_answered: resolved.awaiting.map((p) => p.name),
      standing_blackout: resolved.blockedByDay.map((p) => p.name),
    },
    warnings: resolved.warnings,
    lineup_emailed: match.lineup_email_sent_at ? formatMatchWhen(match.lineup_email_sent_at, tz) : null,
    page: absoluteUrl(`/captain/${team.id}/match/${match.id}`),
  };
}

async function seasonCounts(input: any, ctx: Ctx): Promise<ToolResult> {
  const t = await loadTeam(ctx, input?.team);
  if (isErr(t)) return fail(t);
  const team = t.team;
  const tz = await teamTz(ctx, team);
  const roster = await loadRoster(ctx, team.id);
  const [soFar, marked, committed] = await Promise.all([
    soFarCounts(ctx.db, team.id),
    playedCounts(ctx.db, team.id),
    committedCounts(ctx.db, team.id),
  ]);
  const { data: ms } = await ctx.db.from('captain_matches').select('*').eq('team_id', team.id).order('match_at');
  const matches = ((ms as MatchRow[]) || []).filter((m) => m.status !== 'cancelled');
  const future = matches.filter((m) => Date.parse(m.match_at) >= Date.now());
  const multi = !!leagueSpec(team.league_type).multiLine;
  // Singles before the next match = singles so far (singlesCounts counts earlier matches only).
  const singles = multi && future[0] ? await singlesCounts(ctx.db, team.id, future[0].id) : null;
  const { data: lu } = future.length
    ? await ctx.db.from('captain_lineups').select('match_id, player1_id, player2_id').in('match_id', future.map((m) => m.id))
    : { data: [] };
  const upcomingFor = (pid: string) =>
    future
      .filter((m) => ((lu as CourtRow[] & { match_id: string }[]) || []).some((l: any) => l.match_id === m.id && (l.player1_id === pid || l.player2_id === pid)))
      .map((m) => localYmd(m.match_at, tz));
  const rules = rulesFor(team);
  const elig = eligibilityReport({
    players: roster.filter((p) => !p.is_sub).map((p) => ({ id: p.id, name: p.name, ratingType: p.rating_type as RatingType })),
    playedByPlayer: marked,
    rules,
    matchesRemaining: future.length,
  });
  return {
    ok: true,
    team: team.name,
    note:
      'matches_so_far counts every match whose start time has passed (cancelled matches and defaulted lines excluded), marked played or not. ' +
      'in_upcoming_lineups = saved lineups for matches still to come.',
    players: roster
      .map((p) => ({
        name: p.name,
        ...(p.is_sub ? { sub: true } : {}),
        matches_so_far: soFar[p.id] ?? 0,
        ...(marked[p.id] !== soFar[p.id] ? { marked_played: marked[p.id] ?? 0 } : {}),
        ...(singles ? { singles_so_far: singles[p.id] ?? 0 } : {}),
        in_upcoming_lineups: upcomingFor(p.id),
        committed_total: committed[p.id] ?? 0,
      }))
      .sort((a, b) => b.matches_so_far - a.matches_so_far || a.name.localeCompare(b.name)),
    ...(elig.length ? { playoff_eligibility: elig.filter((e) => !e.eligible).map((e) => `${e.name}: ${e.played}/${e.required}${e.atRisk ? ' (at risk)' : ''}`) } : {}),
  };
}

async function whoSits(input: any, ctx: Ctx): Promise<ToolResult> {
  const r = await teamAndMatch(ctx, input);
  if (isErr(r)) return fail(r);
  const opts = formatOpts(input, r.team);
  if (isErr(opts)) return fail(opts);
  const plan = await planLineup(ctx, r.team, r.match, r.tz, opts);
  return {
    ok: true,
    team: r.team.name,
    match: matchLabel(r.match, r.tz),
    sit_out: plan.sitting.length ? plan.sitting : plan.benched,
    playing_if_built_now: plan.lineup,
    fairness: plan.fairness,
    explanation: plan.explanation,
    warnings: plan.warnings,
    note: 'Nothing saved. build_lineup saves exactly this.',
  };
}

async function findSubs(input: any, ctx: Ctx): Promise<ToolResult> {
  const r = await teamAndMatch(ctx, input);
  if (isErr(r)) return fail(r);
  const { team, match, tz } = r;
  const roster = await loadRoster(ctx, team.id);
  const courts = await savedCourts(ctx, match.id);
  const busy = new Set(courts.flatMap((c) => [c.player1_id, c.player2_id]).filter(Boolean) as string[]);
  // Optional: the player who dropped, so the sub fits THEIR line (the subs route's rules).
  let line: CourtRow | null = null;
  let partner: PlayerRow | null = null;
  if (input?.replacing) {
    const f = findPlayers(roster, [input.replacing]);
    if (isErr(f)) return fail(f);
    const gone = f.players[0];
    busy.add(gone.id);
    line = courts.find((c) => c.player1_id === gone.id || c.player2_id === gone.id) ?? null;
    const pid = line ? (line.player1_id === gone.id ? line.player2_id : line.player1_id) : null;
    partner = pid ? roster.find((p) => p.id === pid) ?? null : null;
  }
  const cap = capForTeam(team);
  const isDoubles = line?.court_type === 'doubles';
  const fits = (p: PlayerRow) => {
    if (!line) return true;
    if (isDoubles && p.court_limit === 'singles_only') return false;
    if (!isDoubles && p.court_limit === 'doubles_only') return false;
    if (isDoubles && partner) {
      if (team.league_type === 'usta_mixed' && p.gender && partner.gender && p.gender === partner.gender) return false;
      if (cap != null && Number(p.rating ?? 0) + Number(partner.rating ?? 0) > cap + 1e-9) return false;
    }
    return true;
  };
  const { data: av } = await ctx.db.from('captain_availability').select('player_id, status, note').eq('match_id', match.id);
  const ans = new Map(((av as { player_id: string; status: string; note: string | null }[]) || []).map((a) => [a.player_id, a]));
  const soFar = await soFarCounts(ctx.db, team.id, match.id);
  const rank = (s: string | undefined) => (s === 'yes' ? 0 : s === undefined ? 1 : 2);
  const subs = roster
    .filter((p) => !busy.has(p.id) && ans.get(p.id)?.status !== 'no' && fits(p))
    .map((p) => ({ p, a: ans.get(p.id) }))
    .sort((x, y) => rank(x.a?.status) - rank(y.a?.status) || (soFar[x.p.id] ?? 0) - (soFar[y.p.id] ?? 0) || x.p.name.localeCompare(y.p.name))
    .map(({ p, a }) => ({
      name: p.name,
      answer: a?.status ?? 'no answer',
      ...(a?.note ? { note: a.note } : {}),
      matches_so_far: soFar[p.id] ?? 0,
      ...(p.is_sub ? { listed_as_sub: true } : {}),
      has_email: !!p.email,
    }));
  return {
    ok: true,
    team: team.name,
    match: matchLabel(match, tz),
    ...(line ? { line: lineNames(toSaved(courts)).get(line.court_number), partner: partner?.name ?? null } : {}),
    subs,
    note: 'Said yes first, then not answered, then maybe; fewest matches so far first within each. Players who said no are left out.',
  };
}

type OppContact = {
  name: string | null;
  email: string | null;
  phone: string | null;
  source: 'this match' | 'opponent directory' | 'another match vs this opponent' | null;
  directory?: Record<string, string | null> | null;
};

/** Same lookup order as the host-email route: the match, the opponent directory, a sibling fixture. */
async function opponentContact(ctx: Ctx, teamId: string, match: MatchRow): Promise<OppContact> {
  const out: OppContact = {
    name: match.opposing_captain_name,
    email: match.opposing_captain_email,
    phone: match.opposing_captain_phone,
    source: match.opposing_captain_email || match.opposing_captain_phone ? 'this match' : null,
    directory: null,
  };
  if (match.opponent) {
    const { data: opps } = await ctx.db
      .from('captain_opponents')
      .select('opponent, captain_name, captain_email, captain_phone, cocaptain_name, cocaptain_email, cocaptain_phone, home_club, club_phone, notes')
      .eq('team_id', teamId);
    const row = pickOpponentRow(match.opponent, (opps as ({ opponent: string | null } & Record<string, string | null>)[]) || []);
    if (row) {
      out.directory = row;
      if (!out.email && row.captain_email) {
        out.email = row.captain_email;
        out.name = row.captain_name ?? out.name;
        out.phone = out.phone ?? row.captain_phone ?? null;
        out.source = 'opponent directory';
      }
    }
    if (!out.email) {
      const { data: sib } = await ctx.db
        .from('captain_matches')
        .select('opposing_captain_email, opposing_captain_name')
        .eq('team_id', teamId)
        .eq('opponent', match.opponent)
        .not('opposing_captain_email', 'is', null)
        .limit(1)
        .maybeSingle();
      const s = sib as { opposing_captain_email: string; opposing_captain_name: string | null } | null;
      if (s?.opposing_captain_email) {
        out.email = s.opposing_captain_email;
        out.name = s.opposing_captain_name ?? out.name;
        out.source = 'another match vs this opponent';
      }
    }
  }
  return out;
}

async function opposingCaptain(input: any, ctx: Ctx): Promise<ToolResult> {
  const r = await teamAndMatch(ctx, input);
  if (isErr(r)) return fail(r);
  const c = await opponentContact(ctx, r.team.id, r.match);
  const d = c.directory;
  if (!c.email && !c.phone && !c.name && !d) {
    return { ok: true, match: matchLabel(r.match, r.tz), found: false, note: 'No opposing-captain contact is stored for this opponent. Add it on the match page or the Opponents list.' };
  }
  return {
    ok: true,
    match: matchLabel(r.match, r.tz),
    found: true,
    captain: { name: c.name, email: c.email, phone: c.phone ? formatPhone(c.phone) || c.phone : null, from: c.source },
    ...(d
      ? {
          co_captain: d.cocaptain_name || d.cocaptain_email || d.cocaptain_phone ? { name: d.cocaptain_name, email: d.cocaptain_email, phone: d.cocaptain_phone } : null,
          home_club: d.home_club,
          club_phone: d.club_phone,
          notes: d.notes,
        }
      : {}),
  };
}

async function printLineup(input: any, ctx: Ctx): Promise<ToolResult> {
  const r = await teamAndMatch(ctx, input);
  if (isErr(r)) return fail(r);
  const courts = await savedCourts(ctx, r.match.id);
  const url = absoluteUrl(`/captain/${r.team.id}/match/${r.match.id}`);
  if (!courts.length) return { ok: false, error: 'There is no saved lineup for this match yet — build one first.', page: url };
  return {
    ok: true,
    match: matchLabel(r.match, r.tz),
    url,
    how: 'Open the match page and press "Print" next to the lineup — it opens the printable sheet (or Save as PDF). There is no separate print URL; the sheet is generated on that page.',
  };
}

// ------------------------------------------------------------------- writes

function formatOpts(input: any, team: TeamRow): LineupOpts | Err {
  const opts: LineupOpts = {};
  const multi = !!leagueSpec(team.league_type).multiLine;
  if (input?.court_format != null) {
    if (!multi) return { error: 'Court format (2- or 3-court rounds) only applies to Junior Team Tennis. For adults, change singles_courts / doubles_courts.' };
    const n = Number(input.court_format);
    if (!(JTT_COURT_FORMATS as readonly number[]).includes(n)) return { error: `Court format must be ${JTT_COURT_FORMATS.join(' or ')}.` };
    opts.courtFormat = n;
  }
  for (const [k, key] of [['singles_courts', 'singlesCourts'], ['doubles_courts', 'doublesCourts']] as const) {
    if (input?.[k] != null) {
      if (!isValidCourtCount(input[k])) return { error: COURT_COUNT_ERROR };
      opts[key] = Number(input[k]);
    }
  }
  return opts;
}

type BuildPlan = {
  team: TeamRow & Record<string, any>;
  match: MatchRow;
  tz: string;
  plan: LineupPlan;
  matchPatch: Record<string, number>;
  marks: { id: string; name: string; state: 'in' | 'out' }[];
  replaces: string[] | null;
  summary: Record<string, unknown>;
};

async function prepareBuild(input: any, ctx: Ctx): Promise<BuildPlan | Err> {
  const r = await teamAndMatch(ctx, input);
  if (isErr(r)) return r;
  const { team, match, tz } = r;
  if (match.status === 'cancelled') return { error: 'That match is cancelled.' };
  const opts = formatOpts(input, team);
  if (isErr(opts)) return opts;
  const roster = await loadRoster(ctx, team.id);
  const marks: BuildPlan['marks'] = [];
  for (const [key, state] of [['mark_in', 'in'], ['mark_out', 'out']] as const) {
    const names = input?.[key];
    if (names == null || (Array.isArray(names) && !names.length)) continue;
    const f = findPlayers(roster, names);
    if (isErr(f)) return f;
    for (const p of f.players) {
      if (marks.some((m) => m.id === p.id)) return { error: `${p.name} is in both mark_in and mark_out.` };
      marks.push({ id: p.id, name: p.name, state });
    }
  }
  opts.markIn = marks.filter((m) => m.state === 'in').map((m) => m.id);
  opts.markOut = marks.filter((m) => m.state === 'out').map((m) => m.id);
  const plan = await planLineup(ctx, team, match, tz, opts);
  if (!plan.courts.length) return { error: 'Nothing to build — nobody is available for this match yet.', ...{ candidates: plan.explanation } };

  const matchPatch: Record<string, number> = {};
  if (opts.courtFormat != null && opts.courtFormat !== match.court_format) matchPatch.court_format = opts.courtFormat;
  if (opts.singlesCourts != null && opts.singlesCourts !== match.singles_courts) matchPatch.singles_courts = opts.singlesCourts;
  if (opts.doublesCourts != null && opts.doublesCourts !== match.doubles_courts) matchPatch.doubles_courts = opts.doublesCourts;

  const existing = await savedCourts(ctx, match.id);
  const nameOf = (id: string | null) => (id ? roster.find((p) => p.id === id)?.name ?? '—' : '—');
  const replaces = existing.length ? sheetText(toSaved(existing), nameOf, roundsFor(team, match, toSaved(existing))) : null;

  const changes: string[] = [];
  if (matchPatch.court_format) changes.push(`This match becomes a ${matchPatch.court_format}-court format.`);
  if (matchPatch.singles_courts != null || matchPatch.doubles_courts != null) {
    changes.push(`This match's lines become ${plan.format.singles} singles and ${plan.format.doubles} doubles.`);
  }
  for (const m of marks) changes.push(`${m.name} recorded as ${m.state === 'in' ? 'available (yes)' : 'out (no)'}, noted as from the captain.`);

  return {
    team,
    match,
    tz,
    plan,
    matchPatch,
    marks,
    replaces,
    summary: {
      team: team.name,
      match: matchLabel(match, tz),
      format: plan.format,
      ...(changes.length ? { also_changes: changes } : {}),
      lineup: plan.lineup,
      sitting_out: plan.sitting.length ? plan.sitting : plan.benched,
      warnings: plan.warnings,
      explanation: plan.explanation,
      replaces_saved_lineup: replaces,
      ...(match.lineup_email_sent_at
        ? { heads_up: `The lineup email already went out (${formatMatchWhen(match.lineup_email_sent_at, tz)}). Saving does not re-send it — use send_lineup after.` }
        : {}),
      emails: 'None. Saving sends nothing.',
    },
  };
}

async function runBuild(input: any, ctx: Ctx): Promise<ToolResult> {
  const p = await prepareBuild(input, ctx);
  if (isErr(p)) return fail(p);
  if (Object.keys(p.matchPatch).length) {
    const { error } = await ctx.db
      .from('captain_matches')
      .update({ ...p.matchPatch, updated_at: new Date().toISOString() })
      .eq('id', p.match.id)
      .eq('team_id', p.team.id);
    if (error) return { ok: false, error: error.message };
  }
  for (const m of p.marks) await recordAnswer(ctx, p.team.id, p.match.id, m.id, m.state, null);
  const tally = await saveLineup(ctx, p.team.id, p.match.id, p.plan.courts);
  return {
    ok: true,
    saved: true,
    ...p.summary,
    confirmations_kept: tally.kept,
    confirmations_dropped_with_player: tally.dropped,
  };
}

/** Which line a director means: "Doubles 2", "D2", "S1", "line 2", 2. */
function resolveLine(courts: SavedCourt[], ref: unknown, playerCount: number): SavedCourt | Err {
  const names = lineNames(courts);
  const s = String(ref ?? '').trim().toLowerCase();
  const byLabel = (type: 'singles' | 'doubles', n: number) =>
    courts.find((c) => c.courtType === type && names.get(c.courtNumber) === `${type === 'singles' ? 'Singles' : 'Doubles'} ${n}`);
  const typed = s.match(/^(singles|doubles|s|d)\s*(\d+)$/);
  if (typed) {
    const type = typed[1].startsWith('s') ? 'singles' : 'doubles';
    return byLabel(type, Number(typed[2])) ?? { error: `There is no ${type} ${typed[2]} on this sheet.`, candidates: [...names.values()] };
  }
  const bare = s.match(/^(?:line|court|ct)?\s*(\d+)$/);
  if (bare) {
    const n = Number(bare[1]);
    const types = new Set(courts.map((c) => c.courtType));
    if (types.size === 1) return byLabel([...types][0], n) ?? { error: `There is no line ${n}.`, candidates: [...names.values()] };
    if (playerCount === 2) return byLabel('doubles', n) ?? { error: `There is no Doubles ${n}.`, candidates: [...names.values()] };
    return { error: `Line ${n} is ambiguous on this sheet — Singles ${n} or Doubles ${n}?`, candidates: [...names.values()] };
  }
  return { error: `Not sure which line "${ref}" is.`, candidates: [...names.values()] };
}

type EditPlan = {
  team: TeamRow & Record<string, any>;
  match: MatchRow;
  courts: SavedCourt[];
  summary: Record<string, unknown>;
};

async function prepareEdit(input: any, ctx: Ctx): Promise<EditPlan | Err> {
  const r = await teamAndMatch(ctx, input);
  if (isErr(r)) return r;
  const { team, match, tz } = r;
  const moves = Array.isArray(input?.moves) ? input.moves : [];
  if (!moves.length) return { error: 'Say which line gets which players.' };
  const before = toSaved(await savedCourts(ctx, match.id));
  if (!before.length) return { error: 'There is no saved lineup to change yet — build_lineup first.' };
  const roster = await loadRoster(ctx, team.id);
  const nameOf = (id: string | null) => (id ? roster.find((p) => p.id === id)?.name ?? '(not on roster)' : '—');
  const multi = !!leagueSpec(team.league_type).multiLine;

  const after = before.map((c) => ({ ...c }));
  const targets = new Map<number, string[]>();
  for (const mv of moves) {
    const f = findPlayers(roster, mv?.players);
    if (isErr(f)) return f;
    const ids = f.players.map((p) => p.id);
    const line = resolveLine(before, mv?.line, ids.length);
    if (isErr(line)) return line;
    const want = line.courtType === 'doubles' ? 2 : 1;
    if (ids.length !== want) {
      return { error: `${lineNames(before).get(line.courtNumber)} takes ${want} player${want === 1 ? '' : 's'} — name ${want === 2 ? 'both partners' : 'one player'}.` };
    }
    if (targets.has(line.courtNumber)) return { error: `${lineNames(before).get(line.courtNumber)} is named twice.` };
    targets.set(line.courtNumber, ids);
  }
  if (!multi) {
    const all = [...targets.values()].flat();
    const dup = all.find((id, i) => all.indexOf(id) !== i);
    if (dup) return { error: `${nameOf(dup)} is put on two lines — an adult plays one line.` };
  }

  // Adults: a player moved off a line leaves a hole; whoever they displaced
  // fills it (a swap). JTT: players can hold several lines, so only the named
  // lines change and the round-clash check below keeps the sheet playable.
  const vacated: { court: number; slot: 1 | 2 }[] = [];
  const displaced: string[] = [];
  const placed = new Set([...targets.values()].flat());
  for (const [num, ids] of targets) {
    const c = after.find((x) => x.courtNumber === num)!;
    for (const old of [c.player1Id, c.player2Id]) if (old && !ids.includes(old)) displaced.push(old);
    c.player1Id = ids[0];
    c.player2Id = c.courtType === 'doubles' ? ids[1] : null;
  }
  if (!multi) {
    for (const c of after) {
      if (targets.has(c.courtNumber)) continue;
      for (const slot of [1, 2] as const) {
        const k = slot === 1 ? 'player1Id' : 'player2Id';
        if (c[k] && placed.has(c[k] as string)) {
          c[k] = null;
          vacated.push({ court: c.courtNumber, slot });
        }
      }
    }
  }
  const toSeat = multi ? [] : displaced.filter((id) => !placed.has(id));
  const unseated: string[] = [];
  for (const id of toSeat) {
    const hole = vacated.shift();
    if (!hole) { unseated.push(id); continue; }
    const c = after.find((x) => x.courtNumber === hole.court)!;
    if (hole.slot === 1) c.player1Id = id; else c.player2Id = id;
  }

  if (multi) {
    const clashes = roundClashes(after, courtFormatOf(match, team));
    if (clashes.length) {
      return {
        error: `That puts ${clashes.map((c) => nameOf(c.playerId)).join(', ')} on two lines in the same round — unplayable. Move them off the other line too.`,
      };
    }
  }

  const rounds = roundsFor(team, match, after);
  const beforeText = sheetText(before, nameOf, rounds);
  const afterText = sheetText(after, nameOf, rounds);
  const changed = afterText.filter((l) => !beforeText.includes(l));
  if (!changed.length) return { error: 'That is already the lineup — nothing to change.' };
  const open = vacated.map((h) => `${lineNames(after).get(h.court)} has an empty seat`);
  return {
    team,
    match,
    courts: after,
    summary: {
      team: team.name,
      match: matchLabel(match, tz),
      changed_lines: changed,
      lineup: afterText,
      ...(unseated.length ? { now_not_playing: unseated.map(nameOf) } : {}),
      ...(open.length ? { open_seats: open } : {}),
      ...(match.lineup_email_sent_at
        ? { heads_up: `The lineup email already went out (${formatMatchWhen(match.lineup_email_sent_at, tz)}). Saving does not re-send it — use send_lineup (only_players for just the people who moved).` }
        : {}),
      emails: 'None. Saving sends nothing.',
    },
  };
}

async function runEdit(input: any, ctx: Ctx): Promise<ToolResult> {
  const p = await prepareEdit(input, ctx);
  if (isErr(p)) return fail(p);
  const tally = await saveLineup(ctx, p.team.id, p.match.id, p.courts);
  return { ok: true, saved: true, ...p.summary, confirmations_kept: tally.kept, confirmations_dropped_with_player: tally.dropped };
}

type AvailPlan = {
  teamId: string;
  matchId: string;
  players: PlayerRow[];
  state: 'in' | 'maybe' | 'out' | 'clear';
  note: string | null;
  summary: Record<string, unknown>;
};

async function prepareAvailability(input: any, ctx: Ctx): Promise<AvailPlan | Err> {
  const state = input?.state;
  if (!['in', 'maybe', 'out', 'clear'].includes(state)) return { error: "state must be 'in', 'maybe', 'out' or 'clear'." };
  const r = await teamAndMatch(ctx, input);
  if (isErr(r)) return r;
  const roster = await loadRoster(ctx, r.team.id);
  const f = findPlayers(roster, input?.players);
  if (isErr(f)) return f;
  const note = String(input?.note ?? '').trim().slice(0, 500) || null;
  const courts = await savedCourts(ctx, r.match.id);
  const names = lineNames(toSaved(courts));
  const { data: av } = await ctx.db.from('captain_availability').select('player_id, status').eq('match_id', r.match.id);
  const now = new Map(((av as { player_id: string; status: string }[]) || []).map((a) => [a.player_id, a.status]));
  const word = { in: 'available (yes)', maybe: 'maybe', out: 'out (no)', clear: 'no answer (cleared)' }[state as 'in'];
  const lines = f.players.map((p) => {
    const row = courts.find((c) => c.player1_id === p.id || c.player2_id === p.id);
    return `${p.name}: ${now.get(p.id) ?? 'no answer'} → ${word}${row ? ` (on ${names.get(row.court_number)}${state === 'in' ? ' — marked confirmed' : state === 'out' ? ' — marked pulled out; still on the sheet until you change the lineup' : ''})` : ''}`;
  });
  return {
    teamId: r.team.id,
    matchId: r.match.id,
    players: f.players,
    state,
    note,
    summary: {
      team: r.team.name,
      match: matchLabel(r.match, r.tz),
      changes: lines,
      ...(note ? { note } : {}),
      recorded_as: 'from the captain (not the player’s own tap)',
      emails: 'None.',
    },
  };
}

async function runAvailability(input: any, ctx: Ctx): Promise<ToolResult> {
  const p = await prepareAvailability(input, ctx);
  if (isErr(p)) return fail(p);
  for (const pl of p.players) await recordAnswer(ctx, p.teamId, p.matchId, pl.id, p.state, p.note);
  return { ok: true, saved: true, ...p.summary };
}

type AddPlan = { teamId: string; insert: Record<string, unknown> | null; topUp: { id: string; patch: Record<string, unknown> } | null; summary: Record<string, unknown> };

async function prepareAdd(input: any, ctx: Ctx): Promise<AddPlan | Err> {
  const t = await loadTeam(ctx, input?.team);
  if (isErr(t)) return t;
  const name = String(input?.name ?? '').trim();
  const bad = isNotAName(name);
  if (bad) return { error: `"${name}" ${bad === 'empty' ? 'is empty' : bad} — give the player's name.` };
  const fields: Record<string, unknown> = {};
  const str = (v: unknown) => String(v ?? '').trim();
  for (const [k, col] of [['email', 'email'], ['parent_email', 'contact2_email']] as const) {
    const v = str(input?.[k]);
    if (v) {
      if (!EMAIL.test(v)) return { error: `"${v}" is not an email address.` };
      fields[col] = v;
    }
  }
  for (const [k, col] of [['phone', 'phone'], ['parent_phone', 'contact2_phone']] as const) {
    const v = str(input?.[k]);
    if (v) {
      const e164 = normalizePhone(v);
      if (!e164) return { error: `"${v}" doesn't read as a phone number.` };
      fields[col] = e164;
    }
  }
  if (str(input?.parent_name)) fields.contact2_name = str(input.parent_name);
  if (input?.rating != null && input.rating !== '') {
    const n = Number(input.rating);
    if (!Number.isFinite(n) || n < 0 || n > 16) return { error: 'Rating must be a number like 3.5.' };
    fields.rating = n;
  }
  if (input?.gender === 'M' || input?.gender === 'F') fields.gender = input.gender;

  const { data: existing } = await ctx.db.from('captain_players').select('*').eq('team_id', t.team.id);
  const same = ((existing as PlayerRow[]) || []).find((p) => p.name.trim().toLowerCase() === name.toLowerCase());
  const shown = (o: Record<string, unknown>) =>
    Object.entries(o).map(([k, v]) => `${k.replace('contact2_', 'parent ')}: ${k.endsWith('phone') ? formatPhone(String(v)) || v : v}`);

  if (same) {
    // Same rule as the roster import: fill blanks, never overwrite.
    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fields)) if (same[k] == null || same[k] === '') patch[k] = v;
    const kept = Object.keys(fields).filter((k) => !(k in patch));
    const reactivate = same.active === false;
    if (reactivate) patch.active = true;
    if (!Object.keys(patch).length) {
      return { error: `${same.name} is already on the roster${kept.length ? ` and already has ${kept.join(', ')} — change those on the team page` : ''}.` };
    }
    return {
      teamId: t.team.id,
      insert: null,
      topUp: { id: same.id, patch },
      summary: {
        team: t.team.name,
        action: `${same.name} is already on the roster${reactivate ? ' (inactive — will be put back on)' : ''}; filling in what is blank`,
        adds: shown(Object.fromEntries(Object.entries(patch).filter(([k]) => k !== 'active'))),
        ...(kept.length ? { not_overwritten: kept } : {}),
      },
    };
  }
  const insert = { team_id: t.team.id, name, is_sub: !!input?.is_sub, ...fields };
  return {
    teamId: t.team.id,
    insert,
    topUp: null,
    summary: {
      team: t.team.name,
      action: `Add ${name} to the roster${input?.is_sub ? ' as a sub' : ''}`,
      details: shown(fields),
      emails: 'None — they get team emails from the next send.',
    },
  };
}

async function runAdd(input: any, ctx: Ctx): Promise<ToolResult> {
  const p = await prepareAdd(input, ctx);
  if (isErr(p)) return fail(p);
  if (p.insert) {
    const { error } = await ctx.db.from('captain_players').insert(p.insert).select('id, name');
    if (error) return { ok: false, error: error.message };
  } else if (p.topUp) {
    const { error } = await ctx.db
      .from('captain_players')
      .update({ ...p.topUp.patch, updated_at: new Date().toISOString() })
      .eq('id', p.topUp.id)
      .eq('team_id', p.teamId);
    if (error) return { ok: false, error: error.message };
  }
  return { ok: true, saved: true, ...p.summary };
}

// -------------------------------------------------------------------- sends

type Payload = { to: string; subject: string; html: string };

type SendPlan = {
  team: TeamRow & Record<string, any>;
  match: MatchRow & Record<string, unknown>;
  payloads: Payload[];
  billTo: string;
  /** Team-wide lineup send: stamp lineup_email_sent_at like timeline/send. */
  stamp: boolean;
  recipients: { name: string; email: string | null }[];
  summary: Record<string, unknown>;
};

async function emailCtxFor(ctx: Ctx, team: TeamRow, matchId: string) {
  const { data: row } = await ctx.db.from('captain_matches').select(MATCH_COLUMNS).eq('id', matchId).eq('team_id', team.id).maybeSingle();
  if (!row) return null;
  const ectx = await loadTeamEmailContext(
    ctx.db,
    { id: team.id, name: team.name, captain_user_id: team.captain_user_id },
    [row as unknown as Record<string, unknown>],
  );
  return { row: row as unknown as MatchRow & Record<string, unknown>, ectx };
}

function sample(payloads: Payload[], recipients: { name: string; email: string | null }[]) {
  return {
    subject: payloads[0].subject,
    sample_for: recipients[0]?.name,
    text: htmlToText(payloads[0].html),
  };
}

async function prepareSendLineup(input: any, ctx: Ctx): Promise<SendPlan | Err> {
  const r = await teamAndMatch(ctx, input);
  if (isErr(r)) return r;
  const { team, match, tz } = r;
  if (match.status === 'cancelled') return { error: 'That match is cancelled.' };
  const courts = toSaved(await savedCourts(ctx, match.id));
  if (!courts.length) return { error: 'Build the lineup first — this email lists the court assignments.' };
  if (leagueSpec(team.league_type).multiLine) {
    // The match page's rule: a kid on two courts at once is an unplayable sheet — never send one.
    const clashes = roundClashes(courts, courtFormatOf(match, team));
    if (clashes.length) return { error: 'The saved sheet has a player on two lines in the same round — fix it before sending.' };
  }
  let only: string[] | null = null;
  if (input?.only_players != null && !(Array.isArray(input.only_players) && !input.only_players.length)) {
    const f = findPlayers(await loadRoster(ctx, team.id), input.only_players);
    if (isErr(f)) return f;
    only = f.players.map((p) => p.id);
  }
  const e = await emailCtxFor(ctx, team, match.id);
  if (!e) return { error: 'Match not found.' };
  const payloads = payloadsFor('lineup', e.ectx, match.id, only);
  if (!payloads.length) {
    return { error: only ? 'Nobody to send to — those players have no email address on the roster.' : 'There is nobody with an email address on the roster.' };
  }
  const recipients = recipientsFor('lineup', e.ectx, match.id, only);
  const noEmail = (await loadRoster(ctx, team.id)).filter((p) => !p.email && (!only || only.includes(p.id))).map((p) => p.name);
  return {
    team,
    match: e.row,
    payloads,
    billTo: team.captain_user_id,
    stamp: !only,
    recipients,
    summary: {
      team: team.name,
      match: matchLabel(match, tz),
      kind: only ? 'lineup email to just these players (the team-wide send is unaffected)' : 'lineup email to the whole team',
      emails: payloads.length,
      recipients: recipients.map((x) => `${x.name} <${x.email}>`),
      ...(noEmail.length ? { no_email_on_file: noEmail } : {}),
      ...sample(payloads, recipients),
      note: 'Each player’s copy has their own Yes/No confirm buttons; players not in the lineup get it without buttons.',
      ...(e.row.lineup_email_sent_at && !only ? { already_sent: formatMatchWhen(e.row.lineup_email_sent_at as string, tz) } : {}),
    },
  };
}

/** timeline/send's claim-then-send, so a double confirm can't mail the team twice. */
async function deliver(ctx: Ctx, p: SendPlan, sentColumn?: string): Promise<ToolResult> {
  let previous: string | null = null;
  if (p.stamp && sentColumn) {
    previous = (p.match[sentColumn] as string | null) ?? null;
    const cutoff = new Date(Date.now() - 2 * 60_000).toISOString();
    if (previous && previous > cutoff) return { ok: false, error: 'That email just went out. Give it a minute before sending it again.' };
    const { data: claimed } = await ctx.db
      .from('captain_matches')
      .update({ [sentColumn]: new Date().toISOString() })
      .eq('id', p.match.id)
      .or(`${sentColumn}.is.null,${sentColumn}.lt.${cutoff}`)
      .select('id')
      .maybeSingle();
    if (!claimed) return { ok: false, error: 'That email just went out. Give it a minute before sending it again.' };
  }
  try {
    const results = await sendAll(p.billTo, p.payloads);
    const sent = results.filter((r) => r.sent).length;
    return {
      ok: true,
      sent,
      failed: results.length - sent,
      failedNames: results.map((r, i) => (r.sent ? null : p.recipients[i]?.name)).filter(Boolean),
      ...p.summary,
    };
  } catch (err) {
    if (p.stamp && sentColumn) await ctx.db.from('captain_matches').update({ [sentColumn]: previous }).eq('id', p.match.id);
    return { ok: false, error: `Could not send: ${err instanceof Error ? err.message : 'send failed'}` };
  }
}

async function prepareAskConfirm(input: any, ctx: Ctx): Promise<SendPlan | Err> {
  const r = await teamAndMatch(ctx, input);
  if (isErr(r)) return r;
  const { team, match, tz } = r;
  if (match.status === 'cancelled') return { error: 'That match is cancelled.' };
  const roster = await loadRoster(ctx, team.id);
  const f = findPlayers(roster, input?.players);
  if (isErr(f)) return f;
  const courts = await savedCourts(ctx, match.id);
  const seated = new Set(courts.flatMap((c) => [c.player1_id, c.player2_id]).filter(Boolean) as string[]);
  const inLineup = f.players.filter((p) => seated.has(p.id) && p.email).map((p) => p.id);
  const notIn = f.players.filter((p) => !seated.has(p.id) && p.email).map((p) => p.id);
  const noEmail = f.players.filter((p) => !p.email).map((p) => p.name);
  const e = await emailCtxFor(ctx, team, match.id);
  if (!e) return { error: 'Match not found.' };
  // In the lineup: their lineup email, which carries the Yes/No confirm buttons.
  // Not in it yet: the availability ask (Yes / No / Maybe). Both targeted, so
  // nobody else is emailed and the team-wide send stamps are left alone.
  const a = inLineup.length ? payloadsFor('lineup', e.ectx, match.id, inLineup) : [];
  const b = notIn.length ? payloadsFor('poll', e.ectx, match.id, notIn) : [];
  const ra = inLineup.length ? recipientsFor('lineup', e.ectx, match.id, inLineup) : [];
  const rb = notIn.length ? recipientsFor('poll', e.ectx, match.id, notIn) : [];
  if (!a.length && !b.length) return { error: noEmail.length ? `No email address on file for ${noEmail.join(', ')}.` : 'Nobody to email.' };
  return {
    team,
    match: e.row,
    payloads: [...a, ...b],
    billTo: team.captain_user_id,
    stamp: false,
    recipients: [...ra, ...rb],
    summary: {
      team: team.name,
      match: matchLabel(match, tz),
      ...(a.length ? { confirm_your_line: { recipients: ra.map((x) => `${x.name} <${x.email}>`), ...sample(a, ra) } } : {}),
      ...(b.length ? { can_you_play: { recipients: rb.map((x) => `${x.name} <${x.email}>`), ...sample(b, rb) } } : {}),
      ...(noEmail.length ? { no_email_on_file: noEmail } : {}),
      emails: a.length + b.length,
    },
  };
}

async function prepareOpponentEmail(input: any, ctx: Ctx): Promise<(SendPlan & { coachCopy: Payload[] }) | Err> {
  const r = await teamAndMatch(ctx, input);
  if (isErr(r)) return r;
  const { team, match, tz } = r;
  const message = String(input?.message ?? '').trim();
  if (!message) return { error: 'Write the message — it is sent in your words.' };
  const contact = await opponentContact(ctx, team.id, match);
  const to = String(input?.to ?? '').trim() || contact.email || '';
  if (!to) return { error: "No opposing-captain email is stored for this opponent. Give me the address (to) and I'll use it." };
  if (!EMAIL.test(to)) return { error: `"${to}" is not an email address.` };

  let clubName = match.location || 'our club';
  if (team.club_id) {
    const { data: club } = await ctx.db.from('cc_clubs').select('name').eq('id', team.club_id).maybeSingle();
    if ((club as { name?: string } | null)?.name) clubName = (club as { name: string }).name;
  }
  const m: MatchInfo = {
    id: match.id,
    matchAt: match.match_at,
    isHome: match.is_home,
    opponent: match.opponent,
    location: match.location,
    arrivalNote: match.arrival_note,
    opposingCaptainName: contact.name,
    opposingCaptainPhone: match.opposing_captain_phone,
  };
  const email = opponentHostingEmail(team.name, m, { to, clubName, bodyText: message, subject: input?.subject ?? null }, tz);
  const coach = await matchCoachOf(ctx.db, match.id);
  const coachCopy = ccPayloads({ subject: email.subject, html: email.html }, withMatchCoach([], coach, [email.to]), team.name);
  const recipients = [{ name: contact.name || 'Opposing captain', email: to }];
  return {
    team,
    match: match as MatchRow & Record<string, unknown>,
    payloads: [email],
    billTo: ctx.userId,
    stamp: false,
    recipients,
    coachCopy,
    summary: {
      team: team.name,
      match: matchLabel(match, tz),
      to: `${contact.name ? `${contact.name} ` : ''}<${to}>`,
      ...(input?.to ? {} : { address_from: contact.source }),
      subject: email.subject,
      text: htmlToText(email.html),
      ...(coachCopy.length ? { copy_to: coachCopy.map((c) => c.to) } : {}),
      note: 'Goes to another club — there is no undo.',
    },
  };
}

// ------------------------------------------------------------------- schemas

const T_TEAMS: Anthropic.Messages.Tool = {
  name: 'captain_teams',
  description: 'The CaptainMode teams this person runs (as captain, co-captain, or director of the team’s club), each with its next match.',
  input_schema: { type: 'object', properties: {} },
};
const T_MATCHES: Anthropic.Messages.Tool = {
  name: 'captain_matches',
  description: "A team's schedule: each match with its lines/format, availability counts, and whether a lineup is saved / emailed.",
  input_schema: { type: 'object', properties: { team: TEAM, include_past: { type: 'boolean' } } },
};
const T_OVERVIEW: Anthropic.Messages.Tool = {
  name: 'captain_match',
  description: 'One match: format, saved lineup (line by line, with rounds for JTT), who confirmed, and availability (yes / maybe / no / not answered, with notes).',
  input_schema: { type: 'object', properties: { team: TEAM, match: MATCH } },
};
const T_SEASON: Anthropic.Messages.Tool = {
  name: 'captain_season_counts',
  description: 'Matches played per player this season (and singles so far for JTT), plus which upcoming saved lineups each is in and playoff-eligibility shortfalls.',
  input_schema: { type: 'object', properties: { team: TEAM } },
};
const FORMAT_PROPS = {
  court_format: { type: 'number', description: 'JTT only: courts played at once (2 or 3), e.g. "it\'s a 2-court format today".' },
  singles_courts: { type: 'number', description: 'Override the number of singles lines for this match.' },
  doubles_courts: { type: 'number', description: 'Override the number of doubles lines for this match.' },
};
const T_SITS: Anthropic.Messages.Tool = {
  name: 'captain_who_sits',
  description:
    'Too many available? Runs CaptainMode’s lineup generator without saving: who would sit and why, the lineup it would pick, and the fairness numbers ' +
    '(matches so far, already committed, singles so far) for everyone available.',
  input_schema: { type: 'object', properties: { team: TEAM, match: MATCH, ...FORMAT_PROPS } },
};
const T_SUBS: Anthropic.Messages.Tool = {
  name: 'captain_find_subs',
  description:
    'Possible subs for a match: everyone not already in the lineup and not a "no", said-yes first, fewest matches so far first. ' +
    'Pass replacing (who dropped) to keep only players who can take that line (singles/doubles limits, mixed gender, combined-rating cap).',
  input_schema: { type: 'object', properties: { team: TEAM, match: MATCH, replacing: { type: 'string' } } },
};
const T_OPP: Anthropic.Messages.Tool = {
  name: 'captain_opposing_captain',
  description: "The opposing captain's stored contact for a match (and co-captain / club phone from the opponent directory).",
  input_schema: { type: 'object', properties: { team: TEAM, match: MATCH } },
};
const T_PRINT: Anthropic.Messages.Tool = {
  name: 'captain_print_lineup',
  description: 'Where to print the saved lineup: the match page URL (its Print button opens the printable sheet / PDF).',
  input_schema: { type: 'object', properties: { team: TEAM, match: MATCH } },
};
const T_BUILD: Anthropic.Messages.Tool = {
  name: 'captain_build_lineup',
  description:
    'Build (or redo) and SAVE the lineup for a match with CaptainMode’s generator, respecting the team’s format, availability, fairness setting and pairing rules. ' +
    'Replaces any saved lineup (confirmations carry over for players still in it). Optional: change this match’s format, and record players in/out first ' +
    '("X dropped, put Y in and remake it" = mark_out [X], mark_in [Y]). Sends nothing.',
  input_schema: {
    type: 'object',
    properties: {
      team: TEAM,
      match: MATCH,
      ...FORMAT_PROPS,
      mark_in: { type: 'array', items: { type: 'string' }, description: 'Players to record as available before building.' },
      mark_out: { type: 'array', items: { type: 'string' }, description: 'Players to record as out before building.' },
    },
  },
};
const T_EDIT: Anthropic.Messages.Tool = {
  name: 'captain_edit_lineup',
  description:
    'Change specific lines of the saved lineup: each move names a line and exactly who is on it (both partners for doubles). ' +
    'Adults: players moved off a line swap with the players they displace. JTT: only the named lines change; a same-round clash is refused. Sends nothing.',
  input_schema: {
    type: 'object',
    properties: {
      team: TEAM,
      match: MATCH,
      moves: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            line: { type: 'string', description: '"Doubles 2", "D2", "Singles 1", or "line 2" (doubles when two players are named).' },
            players: { type: 'array', items: { type: 'string' } },
          },
          required: ['line', 'players'],
        },
      },
    },
    required: ['moves'],
  },
};
const T_AVAIL: Anthropic.Messages.Tool = {
  name: 'captain_set_availability',
  description:
    'Record availability the captain heard off-app (text, in person): in / maybe / out / clear for one or more players for a match. ' +
    'If they are on the saved lineup, also marks them confirmed or pulled out. Does not change the lineup and sends nothing.',
  input_schema: {
    type: 'object',
    properties: {
      team: TEAM,
      match: MATCH,
      players: { type: 'array', items: { type: 'string' } },
      state: { type: 'string', enum: ['in', 'maybe', 'out', 'clear'] },
      note: { type: 'string', description: 'e.g. "doubles only", "arriving late".' },
    },
    required: ['players', 'state'],
  },
};
const T_ADD: Anthropic.Messages.Tool = {
  name: 'captain_add_player',
  description: 'Add a player to a team roster, with optional email/phone and a parent (second contact, copied on team emails). An existing player only has blanks filled.',
  input_schema: {
    type: 'object',
    properties: {
      team: TEAM,
      name: { type: 'string' },
      email: { type: 'string' },
      phone: { type: 'string' },
      parent_name: { type: 'string' },
      parent_email: { type: 'string' },
      parent_phone: { type: 'string' },
      rating: { type: 'number' },
      gender: { type: 'string', enum: ['M', 'F'] },
      is_sub: { type: 'boolean' },
    },
    required: ['name'],
  },
};
const T_SEND: Anthropic.Messages.Tool = {
  name: 'captain_send_lineup',
  description:
    'EMAIL the saved lineup — to the whole team (plus team-email contacts and the match coach), or only_players for just those people. ' +
    'Uses CaptainMode’s lineup email. Preview shows every recipient and the text.',
  input_schema: { type: 'object', properties: { team: TEAM, match: MATCH, only_players: { type: 'array', items: { type: 'string' } } } },
};
const T_ASK: Anthropic.Messages.Tool = {
  name: 'captain_ask_to_confirm',
  description:
    'EMAIL specific players (and their parent contact) asking them to confirm for a match: players in the lineup get their lineup email with Yes/No confirm buttons; ' +
    'players not in it get the "can you play?" Yes/No/Maybe email. Nobody else is emailed.',
  input_schema: { type: 'object', properties: { team: TEAM, match: MATCH, players: { type: 'array', items: { type: 'string' } } }, required: ['players'] },
};
const T_OPPMAIL: Anthropic.Messages.Tool = {
  name: 'captain_email_opposing_captain',
  description:
    "EMAIL the opposing captain for a match, in the captain's own words (e.g. we're short / defaulting a line / running late). " +
    'Address comes from the match or opponent directory unless `to` is given. The match coach gets a copy.',
  input_schema: {
    type: 'object',
    properties: {
      team: TEAM,
      match: MATCH,
      message: { type: 'string', description: 'The body, exactly as it should be sent. Sign it with the captain’s name.' },
      subject: { type: 'string' },
      to: { type: 'string' },
    },
    required: ['message'],
  },
};

const tools: ToolDef<Ctx>[] = [
  { schema: T_TEAMS, run: listTeams },
  { schema: T_MATCHES, run: listMatches },
  { schema: T_OVERVIEW, run: matchOverview },
  { schema: T_SEASON, run: seasonCounts },
  { schema: T_SITS, run: whoSits },
  { schema: T_SUBS, run: findSubs },
  { schema: T_OPP, run: opposingCaptain },
  { schema: T_PRINT, run: printLineup },
  {
    schema: T_BUILD,
    destructive: true,
    preview: async (i, c) => {
      const p = await prepareBuild(i, c);
      return isErr(p) ? fail(p) : { ok: true, ...p.summary };
    },
    run: runBuild,
  },
  {
    schema: T_EDIT,
    destructive: true,
    preview: async (i, c) => {
      const p = await prepareEdit(i, c);
      return isErr(p) ? fail(p) : { ok: true, ...p.summary };
    },
    run: runEdit,
  },
  {
    schema: T_AVAIL,
    destructive: true,
    preview: async (i, c) => {
      const p = await prepareAvailability(i, c);
      return isErr(p) ? fail(p) : { ok: true, ...p.summary };
    },
    run: runAvailability,
  },
  {
    schema: T_ADD,
    destructive: true,
    preview: async (i, c) => {
      const p = await prepareAdd(i, c);
      return isErr(p) ? fail(p) : { ok: true, ...p.summary };
    },
    run: runAdd,
  },
  {
    schema: T_SEND,
    destructive: true,
    preview: async (i, c) => {
      const p = await prepareSendLineup(i, c);
      return isErr(p) ? fail(p) : { ok: true, ...p.summary };
    },
    run: async (i, c) => {
      const p = await prepareSendLineup(i, c);
      return isErr(p) ? fail(p) : deliver(c, p, KIND_META.lineup.sentColumn as string);
    },
  },
  {
    schema: T_ASK,
    destructive: true,
    preview: async (i, c) => {
      const p = await prepareAskConfirm(i, c);
      return isErr(p) ? fail(p) : { ok: true, ...p.summary };
    },
    run: async (i, c) => {
      const p = await prepareAskConfirm(i, c);
      return isErr(p) ? fail(p) : deliver(c, p);
    },
  },
  {
    schema: T_OPPMAIL,
    destructive: true,
    preview: async (i, c) => {
      const p = await prepareOpponentEmail(i, c);
      return isErr(p) ? fail(p) : { ok: true, ...p.summary };
    },
    run: async (i, c) => {
      const p = await prepareOpponentEmail(i, c);
      if (isErr(p)) return fail(p);
      let results;
      try {
        results = await sendAll(p.billTo, p.payloads);
      } catch (err) {
        return { ok: false, error: `Could not send: ${err instanceof Error ? err.message : 'send failed'}` };
      }
      const r0 = results[0];
      if (!r0 || r0.sent !== true) {
        const reason = r0 && r0.sent === false && (r0 as { reason?: string }).reason === 'unsubscribed'
          ? 'That address has unsubscribed from ClubMode email.'
          : 'Send failed.';
        return { ok: false, error: reason };
      }
      // Best-effort, as in the host-email route: the email that matters has gone.
      if (p.coachCopy.length) {
        try { await sendAll(p.billTo, p.coachCopy); } catch { /* copy only */ }
      }
      return { ok: true, sent: 1, ...p.summary };
    },
  },
];

/**
 * A director of the team's club can READ a captain's team but not change it or
 * email its players: CaptainMode's own screens don't let them, and a captain
 * paying for CaptainMode runs their own team. Captains and co-captains write.
 */
const captainOnly = (t: (typeof tools)[number]): (typeof tools)[number] => {
  if (!t.destructive) return t;
  const guard = (input: any, ctx: Ctx) => {
    const team = pickTeam(ctx, input?.team);
    if (!isErr(team) && team.role === 'director') {
      return { ok: false as const, error: `${team.name} is run by its captain. As club director you can see it, but changes and emails go through the captain.` };
    }
    return null;
  };
  return {
    ...t,
    preview: async (input, ctx) => guard(input, ctx) ?? (t.preview ? t.preview(input, ctx) : { ok: true }),
    run: async (input, ctx) => guard(input, ctx) ?? t.run(input, ctx),
  };
};

export const captainPack: DomainPack<Ctx> = {
  domain: 'captain',

  actionsPrompt: `
CAPTAINMODE — the user's CaptainMode teams (captain, co-captain, or director of the team's club — directors can read but not change or email a captain's team).

Read: captain_teams, captain_matches, captain_match (lineup + availability), captain_season_counts,
captain_who_sits, captain_find_subs, captain_opposing_captain, captain_print_lineup.
Write (preview → confirm): captain_build_lineup, captain_edit_lineup, captain_set_availability, captain_add_player.
Send (preview → confirm): captain_send_lineup, captain_ask_to_confirm, captain_email_opposing_captain.

Rules:
- Pass "Sunday" etc. as the club-local YYYY-MM-DD in match. Omit team/match on a team/match page.
- "X dropped, put Y in and remake it" = captain_build_lineup with mark_out [X], mark_in [Y]. Use captain_find_subs to suggest Y.
- Before any send, show the recipients and the text from the preview; send only after the user says yes to that exact preview.
- Saving a lineup never emails anyone; say so, and offer captain_send_lineup (only_players for just the people affected).
- captain_email_opposing_captain sends the user's words: draft it, show it, then send.
- Nothing here posts to TennisLink, TopDog or USTA, or texts anyone.
`.trim(),

  async resolve(userId, page) {
    const db = getSupabaseAdmin();
    const teams = await teamsFor(userId, db);
    if (!teams.length) return null;
    const { teamId, matchId } = pageIds(page);
    const onPage = teamId && teams.some((t) => t.id === teamId) ? teamId : null;
    return { userId, db, teams, defaultTeamId: onPage, defaultMatchId: onPage ? matchId : null };
  },

  tools: tools.map(captainOnly),
};
