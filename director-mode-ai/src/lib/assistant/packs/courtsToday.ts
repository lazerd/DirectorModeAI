import type Anthropic from '@anthropic-ai/sdk';
import { randomUUID } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { DomainPack, ToolDef, ToolResult } from '../framework';
import { resolveClubCtx, MANAGER_ROLES, type ClubCtx } from '../clubContext';
import { CourtSheetEngine } from '@/lib/courtsheet/engine';
import { PlanTooLargeError, signPlanId } from '@/lib/courtsheet/planner';
import { ConflictsBlockApplyError, PlanIdInvalidError } from '@/lib/courtsheet/apply';
import { detectConflicts } from '@/lib/courtsheet/conflicts';
import {
  enumerateDates,
  localDayOfWeek,
  localToUtc,
  normalizeTime,
  timeToMinutes,
  utcToLocalDate,
  utcToLocalTime,
} from '@/lib/courtsheet/timezones';
import { programSessions } from '@/lib/programs/sessions';
import type {
  ApplyResult,
  BookingIntent,
  Conflict,
  Court,
  DayOfWeek,
  Plan,
  Reservation,
  ReservationInstance,
  ReservationType,
} from '@/lib/courtsheet/types';

/*
 * Courts & today pack — the court sheet and the club's day, by voice.
 *
 * "Block 3-6 Saturday 3:30 to 6 for the junior tournament", "move Julia's
 * lessons to 10", "open the courts back up at 5", "what's on this week?".
 *
 * WHY IT WRAPS COURTSHEET RATHER THAN WRITING ROWS. CourtSheet already has a
 * planner (recurrence + conflict detection, parent/child courts like 11 ↔
 * 11a/11b) and an applier (re-checks conflicts at write time, writes the audit
 * row and the undo diff). Bookings go through engine.computeBookingPlan; moves,
 * resizes and cancels build a Plan with the SAME detectConflicts and are written
 * by the SAME applyPlan. So a booking the CourtSheet screen would refuse, this
 * refuses, for the same reason, and every change here is undoable from
 * CourtSheet's audit log.
 *
 * CONFLICTS ARE SURFACED, NEVER OVERWRITTEN. A booking that collides is not
 * offered for confirmation; the collisions are listed. The director can ask to
 * book only the free slots (skip_conflicts) — a move or resize cannot, because
 * "skip" there would cancel the original and create nothing.
 *
 * WHAT IT WILL NOT TOUCH. Rows that another part of ClubMode owns — class
 * blocks (rebuilt from the class), lesson slots, mixer/quads/tournament blocks,
 * member court bookings. Moving those on the sheet would be undone by their
 * owner on the next sync, or would strand a paying member. The tool says where
 * that thing is managed instead.
 *
 * HOUSE RULES. There is no per-club setting for things like "at most two home
 * matches at once" or "no match next to a lesson", so nothing is hard-coded.
 * Previews carry generic heads-ups — other matches at the same time, lessons or
 * matches on a neighbouring court — and the director applies their own rule.
 */

type Ctx = ClubCtx;
type Db = SupabaseClient<any, 'public', any>;

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^([01]?\d|2[0-3]):[0-5]\d$/;
const RES_TYPES: ReservationType[] = [
  'event',
  'match',
  'lesson',
  'camp',
  'member',
  'hold',
  'maintenance',
  'blackout',
];
/** Reservation sources this pack may move/resize/cancel. Everything else has an owner. */
const EDITABLE_SOURCES = new Set(['manual', 'ai', 'import']);
const OWNER_HINT: Record<string, string> = {
  programs: 'a class — change its courts or dates on the Classes screen; the sheet is rebuilt from the class',
  lessons: "a coach's lesson slot — change it in Lessons",
  mixer: 'a mixer/event — change it on that event',
  quads: 'a Quads event — change it on that event',
  tournaments: 'a tournament — change it on that tournament',
  courtconnect: "a member's court booking — change it from Court bookings so the member is looked after",
  jtt: 'a JTT match — change it in JTT',
};

const db = (ctx: Ctx) => ctx.db as unknown as Db;
/** Timestamps as instants — PostgREST returns "+00:00", toISOString() gives ".000Z". */
const ms = (iso: string) => Date.parse(iso);

// ------------------------------------------------------------- time helpers

function todayLocal(tz: string): string {
  return utcToLocalDate(new Date(), tz);
}

function addDaysYmd(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function dayLabel(ymd: string, tz: string): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: tz,
  }).format(new Date(`${ymd}T12:00:00Z`));
}

/** "3:30 PM" from HH:MM. */
function clock(hhmm: string): string {
  const [h, m] = normalizeTime(hhmm).split(':').map((s) => parseInt(s, 10));
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}

function spanLocal(startIso: string, endIso: string, tz: string, withDay = true): string {
  const d = utcToLocalDate(startIso, tz);
  const t = `${clock(utcToLocalTime(startIso, tz))}–${clock(utcToLocalTime(endIso, tz))}`;
  return withDay ? `${dayLabel(d, tz)} ${t}` : t;
}

/** UTC bounds of club-local days [start, end] inclusive. */
function dayWindowUtc(start: string, end: string, tz: string) {
  return {
    from: localToUtc(start, '00:00', tz).toISOString(),
    to: localToUtc(addDaysYmd(end, 1), '00:00', tz).toISOString(),
  };
}

function hhmmOk(v: unknown): v is string {
  return typeof v === 'string' && HHMM.test(v.trim());
}

// ----------------------------------------------------------- court helpers

function courtLabel(c: Court | undefined): string {
  if (!c) return '?';
  return c.name ?? `Court ${c.number}`;
}

/**
 * Turn "3-6", "court 4", 10, "11a" into concrete courts. Unknown labels are an
 * error, not a silent skip — the planner itself only warns about them, and a
 * booking quietly missing a court is the worst kind of wrong.
 */
function resolveCourts(
  refs: unknown,
  courts: Court[],
): { courts: Court[] } | { error: string } {
  const raw: Array<string | number> = Array.isArray(refs)
    ? (refs as Array<string | number>)
    : typeof refs === 'string' || typeof refs === 'number'
      ? [refs]
      : [];
  if (raw.length === 0) return { error: 'Say which courts.' };

  const out: Court[] = [];
  const unknown: string[] = [];
  const add = (c: Court) => {
    if (!out.some((o) => o.id === c.id)) out.push(c);
  };
  const byLabel = (label: string): Court | undefined => {
    const s = label.trim().toLowerCase().replace(/^court\s*/, '');
    const named = courts.find((c) => (c.name ?? '').toLowerCase() === s || (c.name ?? '').toLowerCase() === label.trim().toLowerCase());
    if (named) return named;
    if (/^\d+$/.test(s)) return courts.find((c) => c.number === parseInt(s, 10));
    return undefined;
  };

  for (const ref of raw) {
    if (typeof ref === 'number') {
      const c = courts.find((cc) => cc.number === ref);
      if (c) add(c);
      else unknown.push(String(ref));
      continue;
    }
    const range = String(ref).trim().toLowerCase().replace(/^courts?\s*/, '').match(/^(\d+)\s*(?:-|–|to)\s*(\d+)$/);
    if (range) {
      const a = parseInt(range[1], 10);
      const b = parseInt(range[2], 10);
      for (let n = Math.min(a, b); n <= Math.max(a, b); n++) {
        const c = courts.find((cc) => cc.number === n);
        if (c) add(c);
        else unknown.push(String(n));
      }
      continue;
    }
    const c = byLabel(String(ref));
    if (c) add(c);
    else unknown.push(String(ref));
  }
  if (unknown.length > 0) {
    return {
      error: `No court called ${unknown.join(', ')} here. Courts: ${courts.map(courtLabel).join(', ')}.`,
    };
  }
  return { courts: out };
}

/** The ref the planner's own resolver will map back to this exact court. */
function plannerRef(c: Court): string | number {
  return c.number ?? (c.name as string);
}

/** Court + its parent/children — the set that a booking on it blocks. */
function blockSet(courtId: string, courts: Court[]): Set<string> {
  const set = new Set<string>([courtId]);
  const c = courts.find((x) => x.id === courtId);
  if (c?.parent_court_id) set.add(c.parent_court_id);
  for (const x of courts) if (x.parent_court_id === courtId) set.add(x.id);
  return set;
}

/** A court's number for adjacency; a sub-court takes its parent's. */
function effectiveNumber(c: Court | undefined, courts: Court[]): number | null {
  if (!c) return null;
  if (c.number != null) return c.number;
  const p = courts.find((x) => x.id === c.parent_court_id);
  return p?.number ?? null;
}

// ------------------------------------------------------- reservation reads

async function loadEngine(ctx: Ctx): Promise<CourtSheetEngine | { error: string }> {
  try {
    return await CourtSheetEngine.load({ db: db(ctx), club_id: ctx.clubId });
  } catch {
    return { error: 'The court sheet is not set up for this club yet (no club record).' };
  }
}

/** Same query the planner and applier use to find what a candidate could hit. */
async function fetchOverlapping(ctx: Ctx, fromIso: string, toIso: string): Promise<Reservation[]> {
  const { data } = await db(ctx)
    .from('reservations')
    .select('*')
    .eq('club_id', ctx.clubId)
    .neq('status', 'cancelled')
    .lt('starts_at', toIso)
    .gt('ends_at', fromIso);
  return (data ?? []) as Reservation[];
}

function windowOf(cands: Array<{ starts_at: string; ends_at: string }>) {
  let from = cands[0].starts_at;
  let to = cands[0].ends_at;
  for (const c of cands) {
    if (c.starts_at < from) from = c.starts_at;
    if (c.ends_at > to) to = c.ends_at;
  }
  return { from, to };
}

/** Reservation.source in the DB is wider than the TS union (e.g. 'programs'). */
const src = (r: { source: unknown }) => String(r.source);

function whatIs(r: Pick<Reservation, 'type' | 'source'>): string {
  if (src(r) === 'programs') return 'class';
  if (src(r) === 'courtconnect') return 'member booking';
  if (src(r) === 'lessons') return 'lesson';
  return r.type;
}

function describeConflicts(conflicts: Conflict[], courts: Court[], existing: Reservation[], tz: string) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of conflicts) {
    if (c.warning) continue;
    if (c.against.kind === 'existing') {
      const key = `${c.candidate.court_id}|${c.against.reservation_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const r = existing.find((e) => e.id === (c.against as { reservation_id: string }).reservation_id);
      const otherCourt = r ? courts.find((x) => x.id === r.court_id) : undefined;
      const onCourt =
        r && r.court_id !== c.candidate.court_id ? ` (on ${courtLabel(otherCourt)}, which shares the space)` : '';
      out.push(
        `${c.candidate.court_label} ${spanLocal(c.candidate.starts_at, c.candidate.ends_at, tz)} collides with ` +
          `"${c.against.title}"${r ? ` — ${whatIs(r)}` : ''}, ${spanLocal(c.against.starts_at, c.against.ends_at, tz, false)}${onCourt}`,
      );
    } else {
      const key = `${c.candidate.court_id}|${c.candidate.starts_at}|same`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(
        `${c.candidate.court_label} ${spanLocal(c.candidate.starts_at, c.candidate.ends_at, tz)} would overlap another part of this same request`,
      );
    }
  }
  return out;
}

/**
 * Generic heads-ups — no club has a setting for its own house rules, so these
 * state facts ("2 other matches at the same time", "a lesson on Court 10 right
 * next to this") and leave the rule to the director.
 */
async function headsUp(
  ctx: Ctx,
  cands: ReservationInstance[],
  existing: Reservation[],
  courts: Court[],
  ignoreIds: Set<string>,
): Promise<string[]> {
  const notes = new Set<string>();
  const others = existing.filter((e) => !ignoreIds.has(e.id) && e.status !== 'cancelled');
  const overlaps = (a: { starts_at: string; ends_at: string }, b: { starts_at: string; ends_at: string }) =>
    ms(a.starts_at) < ms(b.ends_at) && ms(b.starts_at) < ms(a.ends_at);

  const matchCands = cands.filter((c) => c.type === 'match');
  if (matchCands.length > 0) {
    const groups = new Map<string, Reservation[]>();
    for (const e of others) {
      if (e.type !== 'match') continue;
      if (!matchCands.some((c) => overlaps(c, e))) continue;
      const k = `${e.title}|${e.starts_at}`;
      groups.set(k, [...(groups.get(k) ?? []), e]);
    }
    if (groups.size > 0) {
      const list = [...groups.values()].map(
        (rows) =>
          `"${rows[0].title}" on ${rows.map((r) => courtLabel(courts.find((c) => c.id === r.court_id))).join(', ')}`,
      );
      notes.add(
        `${groups.size} other match${groups.size === 1 ? '' : 'es'} on the sheet at the same time: ${list.join('; ')}.`,
      );
    }

    // Home team matches that may not be on the sheet yet.
    const { from, to } = windowOf(matchCands);
    const early = new Date(new Date(from).getTime() - 3 * 3600_000).toISOString();
    const teams = await loadCaptainTeams(ctx);
    if (teams.length > 0) {
      const { data } = await db(ctx)
        .from('captain_matches')
        .select('id, team_id, match_at, is_home, opponent, status')
        .in('team_id', teams.map((t) => t.id))
        .eq('is_home', true)
        .gte('match_at', early)
        .lt('match_at', to);
      const home = ((data ?? []) as CaptainMatchRow[]).filter((m) => m.status !== 'cancelled');
      if (home.length > 0) {
        notes.add(
          `Home team matches starting around then: ${home
            .map((m) => `${teams.find((t) => t.id === m.team_id)?.name ?? 'team'} vs ${m.opponent ?? 'TBD'} at ${clock(utcToLocalTime(m.match_at, ctx.timeZone))}`)
            .join('; ')}.`,
        );
      }
    }
  }

  // Lessons next to matches, either way round.
  for (const c of cands) {
    if (c.type !== 'match' && c.type !== 'lesson') continue;
    const want = c.type === 'match' ? 'lesson' : 'match';
    const cn = effectiveNumber(courts.find((x) => x.id === c.court_id), courts);
    if (cn == null) continue;
    for (const e of others) {
      if (e.type !== want || !overlaps(c, e)) continue;
      const en = effectiveNumber(courts.find((x) => x.id === e.court_id), courts);
      if (en == null || Math.abs(en - cn) !== 1) continue;
      notes.add(
        `A ${want} ("${e.title}") is on ${courtLabel(courts.find((x) => x.id === e.court_id))} right next to ` +
          `this ${c.type} on ${courtLabel(courts.find((x) => x.id === c.court_id))}, ${spanLocal(e.starts_at, e.ends_at, ctx.timeZone)}.`,
      );
    }
  }
  return [...notes];
}

async function signupCount(ctx: Ctx, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const { data } = await db(ctx)
    .from('reservation_signups')
    .select('id, reservation_id, status')
    .in('reservation_id', ids)
    .in('status', ['requested', 'confirmed']);
  return ((data ?? []) as unknown[]).length;
}

// ------------------------------------------------------ team/event lookups

type CaptainTeamRow = { id: string; name: string; archived: boolean | null };
type CaptainMatchRow = {
  id: string;
  team_id: string;
  match_at: string;
  is_home: boolean | null;
  opponent: string | null;
  location?: string | null;
  status: string | null;
};

async function loadCaptainTeams(ctx: Ctx): Promise<CaptainTeamRow[]> {
  const { data } = await db(ctx)
    .from('captain_teams')
    .select('id, name, archived')
    .eq('club_id', ctx.clubId);
  return ((data ?? []) as CaptainTeamRow[]).filter((t) => !t.archived);
}

type EventRow = {
  id: string;
  name: string;
  match_format: string | null;
  public_status: string | null;
  event_date: string | null;
  end_date: string | null;
  start_time: string | null;
  end_time: string | null;
  daily_start_time: string | null;
  public_registration: boolean | null;
};

/** Club events, plus the owner's own club-less ones (same rule as live-events). */
async function loadEvents(ctx: Ctx, start: string, end: string): Promise<EventRow[]> {
  const cols =
    'id, name, match_format, public_status, event_date, end_date, start_time, end_time, daily_start_time, public_registration';
  const { data: own } = await db(ctx).from('events').select(cols).eq('club_id', ctx.clubId).lte('event_date', end);
  const { data: club } = await db(ctx).from('cc_clubs').select('owner_id').eq('id', ctx.clubId).maybeSingle();
  const ownerId = (club as { owner_id: string } | null)?.owner_id;
  let legacy: EventRow[] = [];
  if (ownerId) {
    const { data } = await db(ctx)
      .from('events')
      .select(cols)
      .is('club_id', null)
      .eq('user_id', ownerId)
      .lte('event_date', end);
    legacy = (data ?? []) as EventRow[];
  }
  return [...((own ?? []) as EventRow[]), ...legacy].filter((e) => {
    if (!e.event_date || e.public_status === 'draft') return false;
    const last = (e.end_date ?? e.event_date).slice(0, 10);
    return e.event_date.slice(0, 10) <= end && last >= start;
  });
}

function eventKind(format: string | null): string {
  if (!format) return 'event';
  if (format === 'quads') return 'Quads';
  if (format === 'team-battle') return 'team battle';
  if (/tournament|elimination|compass|round.?robin|bracket|draw/i.test(format)) return 'tournament';
  return 'mixer';
}

// ----------------------------------------------------- selecting rows to edit

const SELECT_PROPS = {
  reservation_ids: {
    type: 'array',
    items: { type: 'string' },
    description: 'Exact reservation ids from courts_booked. Preferred.',
  },
  match: {
    type: 'object',
    description:
      'Or describe them: everything on one club-local day matching ALL given fields. ' +
      'e.g. {date:"2026-10-11", title_match:"Julia", type:"lesson"}.',
    properties: {
      date: { type: 'string', description: 'YYYY-MM-DD, required.' },
      title_match: { type: 'string', description: 'Case-insensitive part of the title shown on the sheet.' },
      courts: { type: 'array', items: { type: ['string', 'number'] } },
      type: { type: 'string', enum: RES_TYPES },
      at_time: { type: 'string', description: 'HH:MM — only rows on court at this time.' },
    },
    required: ['date'],
  },
};

async function selectRows(
  input: any,
  ctx: Ctx,
  courts: Court[],
): Promise<{ rows: Reservation[] } | { error: string }> {
  const ids: string[] = Array.isArray(input?.reservation_ids) ? input.reservation_ids.map(String) : [];
  let rows: Reservation[] = [];
  if (ids.length > 0) {
    const { data } = await db(ctx)
      .from('reservations')
      .select('*')
      .eq('club_id', ctx.clubId)
      .neq('status', 'cancelled')
      .in('id', ids);
    rows = (data ?? []) as Reservation[];
    const missing = ids.filter((id) => !rows.some((r) => r.id === id));
    if (missing.length > 0) {
      return { error: `${missing.length} of those reservations are not on this club's sheet (or already cancelled). Call courts_booked again.` };
    }
  } else if (input?.match && typeof input.match === 'object') {
    const m = input.match;
    if (!YMD.test(String(m.date ?? ''))) return { error: 'match.date must be YYYY-MM-DD.' };
    const { from, to } = dayWindowUtc(m.date, m.date, ctx.timeZone);
    const { data } = await db(ctx)
      .from('reservations')
      .select('*')
      .eq('club_id', ctx.clubId)
      .neq('status', 'cancelled')
      .gte('starts_at', from)
      .lt('starts_at', to);
    rows = (data ?? []) as Reservation[];
    if (m.title_match) {
      const needle = String(m.title_match).toLowerCase();
      rows = rows.filter((r) => r.title.toLowerCase().includes(needle));
    }
    if (m.type) rows = rows.filter((r) => r.type === m.type);
    if (m.courts) {
      const rc = resolveCourts(m.courts, courts);
      if ('error' in rc) return rc;
      const want = new Set(rc.courts.map((c) => c.id));
      rows = rows.filter((r) => want.has(r.court_id));
    }
    if (m.at_time) {
      if (!hhmmOk(m.at_time)) return { error: 'match.at_time must be HH:MM.' };
      const at = localToUtc(m.date, normalizeTime(m.at_time), ctx.timeZone).getTime();
      rows = rows.filter((r) => ms(r.starts_at) <= at && ms(r.ends_at) > at);
    }
  } else {
    return { error: 'Say which reservations: reservation_ids from courts_booked, or a match {date, …}.' };
  }
  if (rows.length === 0) return { error: 'Nothing on the sheet matches that. Call courts_booked to see what is there.' };
  if (rows.length > 100) return { error: `That matches ${rows.length} reservations — narrow it down.` };
  rows.sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  return { rows };
}

/** Owned-by-something-else and permission checks shared by every edit. */
function checkEditable(
  rows: Reservation[],
  ctx: Ctx,
  action: 'move' | 'cancel',
): { error: string; blocked?: string[] } | null {
  const owned = rows.filter((r) => !EDITABLE_SOURCES.has(src(r)));
  if (owned.length > 0) {
    return {
      error: "Some of these belong to another part of ClubMode, so changing them on the sheet would be undone or strand someone. Nothing was changed.",
      blocked: [...new Set(owned.map((r) => `"${r.title}" is ${OWNER_HINT[src(r)] ?? `managed by ${src(r)}`}.`))],
    };
  }
  if (MANAGER_ROLES.has(ctx.role)) return null;
  if (ctx.role === 'coach' && action === 'move') {
    const notMine = rows.filter((r) => r.type !== 'lesson' || r.created_by !== ctx.userId);
    if (notMine.length === 0) return null;
    return { error: 'A coach can move only lessons they put on the sheet themselves. Ask a director for the rest.' };
  }
  return { error: 'Only an owner or director can change the court sheet. You can still read it.' };
}

function rowsSummary(rows: Reservation[], courts: Court[], tz: string): string[] {
  return rows.map(
    (r) => `${courtLabel(courts.find((c) => c.id === r.court_id))} ${spanLocal(r.starts_at, r.ends_at, tz)} — "${r.title}" (${whatIs(r)})`,
  );
}

// ----------------------------------------------------------------- schemas

const COURTS_BOOKED: Anthropic.Messages.Tool = {
  name: 'courts_booked',
  description:
    "What is on the court sheet for one day (optionally a time window): every reservation per court, who/what it is, " +
    'whether it can be edited here, and which courts are free. Give courts + title_match to CONFIRM a reservation, ' +
    'e.g. "are 1-4 reserved for the B2 match?" → courts:["1-4"], title_match:"B2". Also use it to get reservation ids.',
  input_schema: {
    type: 'object',
    properties: {
      date: { type: 'string', description: 'YYYY-MM-DD club-local. Default today.' },
      time_start: { type: 'string', description: 'HH:MM, optional window start.' },
      time_end: { type: 'string', description: 'HH:MM, optional window end.' },
      courts: { type: 'array', items: { type: ['string', 'number'] }, description: 'Limit to these, e.g. ["1-4"] or [10,"11a"].' },
      title_match: { type: 'string', description: 'With courts: check those courts are held by a reservation whose title contains this.' },
    },
  },
};

const WHATS_ON: Anthropic.Messages.Tool = {
  name: 'whats_on',
  description:
    "Briefing for a day or a range (max 31 days): classes meeting, events (mixers/tournaments/quads), team and " +
    'league/JTT matches (home/away), court blocks on the sheet, booked lessons, things open for sign-up, and pickup ' +
    'games. Use for "what\'s happening today / this week / Saturday". Filter with only/home_only.',
  input_schema: {
    type: 'object',
    properties: {
      start: { type: 'string', description: 'YYYY-MM-DD club-local. Default today.' },
      end: { type: 'string', description: 'YYYY-MM-DD inclusive. Default = start. "This week" = start + 6.' },
      only: {
        type: 'array',
        items: { type: 'string', enum: ['classes', 'events', 'matches', 'court_blocks', 'lessons', 'open_signups', 'pickup_games'] },
        description: 'Only these sections.',
      },
      home_only: { type: 'boolean', description: 'Matches: only ones at this club.' },
    },
  },
};

const FIND_FREE_DATES: Anthropic.Messages.Tool = {
  name: 'find_free_dates',
  description:
    'Dates in a range when none of the named teams has a match, and (by default) the club has no event. ' +
    'For "find a date in November with nothing on for the 12U and 14U teams". Read only.',
  input_schema: {
    type: 'object',
    properties: {
      start: { type: 'string', description: 'YYYY-MM-DD' },
      end: { type: 'string', description: 'YYYY-MM-DD inclusive, max 92 days after start.' },
      teams: { type: 'array', items: { type: 'string' }, description: 'Team names or parts of them, e.g. ["12U","14U"].' },
      days_of_week: { type: 'array', items: { type: 'integer', minimum: 0, maximum: 6 }, description: '0=Sun..6=Sat. Omit = any day.' },
      avoid_club_events: { type: 'boolean', description: 'Also rule out days with a club event. Default true.' },
    },
    required: ['start', 'end'],
  },
};

const BOOK_COURTS: Anthropic.Messages.Tool = {
  name: 'book_courts',
  description:
    'Put a block on the court sheet: a tournament, a class, a match, maintenance. One day, or a date range with ' +
    'days_of_week for a recurring hold. Collisions with existing bookings are listed and NOTHING is overwritten; ' +
    'set skip_conflicts only if the director then says to book just the free ones.',
  input_schema: {
    type: 'object',
    properties: {
      courts: { type: 'array', items: { type: ['string', 'number'] }, description: 'e.g. ["3-6"] or [10,"11a","11b"].' },
      date: { type: 'string', description: 'YYYY-MM-DD for one day.' },
      date_range: {
        type: 'object',
        properties: { start: { type: 'string' }, end: { type: 'string' } },
        description: 'Instead of date, for a recurring block.',
      },
      days_of_week: { type: 'array', items: { type: 'integer', minimum: 0, maximum: 6 } },
      time_start: { type: 'string', description: 'HH:MM 24-hour club-local.' },
      time_end: { type: 'string', description: 'HH:MM 24-hour club-local.' },
      title: { type: 'string', description: 'Shown on the sheet, e.g. "Junior tournament", "Alex — class".' },
      type: { type: 'string', enum: RES_TYPES, description: 'Default event. Class/clinic = lesson; team match = match; closed = maintenance.' },
      skip_conflicts: { type: 'boolean', description: 'Book only the free slots. Only after the director saw the conflicts and said so.' },
    },
    required: ['courts', 'time_start', 'time_end', 'title'],
  },
};

const MOVE: Anthropic.Messages.Tool = {
  name: 'move_reservations',
  description:
    'Move reservations to another court, day or start time (length is kept). "Move Julia\'s lessons on 10/11 to ' +
    'court 10" → match {date, title_match:"Julia", type:"lesson"}, to_courts:[10]. With several source courts, give ' +
    'to_courts in the same order (or one court for all). Refused if the new spot is taken.',
  input_schema: {
    type: 'object',
    properties: {
      ...SELECT_PROPS,
      to_courts: { type: 'array', items: { type: ['string', 'number'] } },
      to_date: { type: 'string', description: 'YYYY-MM-DD' },
      to_start: { type: 'string', description: 'HH:MM new start; the length is kept.' },
    },
  },
};

const RESIZE: Anthropic.Messages.Tool = {
  name: 'change_reservation_times',
  description:
    'Shorten or extend reservations in place (same court, same day). "Open the courts back up for member play at 5" ' +
    '→ new_end:"17:00" on that block. Refused if an extension runs into another booking.',
  input_schema: {
    type: 'object',
    properties: {
      ...SELECT_PROPS,
      new_start: { type: 'string', description: 'HH:MM' },
      new_end: { type: 'string', description: 'HH:MM' },
    },
  },
};

const CANCEL: Anthropic.Messages.Tool = {
  name: 'cancel_reservations',
  description:
    'Remove blocks from the court sheet (marks them cancelled — undoable from CourtSheet). Only blocks made on the ' +
    'sheet itself; class, lesson, event and member bookings are managed where they were made. Sends no messages.',
  input_schema: { type: 'object', properties: { ...SELECT_PROPS } },
};

// ------------------------------------------------------------ write prep

type Prepared = {
  engine: CourtSheetEngine;
  plan: Plan;
  courts: Court[];
  existing: Reservation[];
  hard: Conflict[];
  outsideHours: string[];
  notes: string[];
  rows: Reservation[];
  signups: number;
};

async function prepareBooking(input: any, ctx: Ctx): Promise<Prepared | ToolResult> {
  if (!MANAGER_ROLES.has(ctx.role)) {
    return { ok: false, error: 'Only an owner or director can put blocks on the court sheet. You can still read it.' };
  }
  const title = String(input?.title ?? '').trim();
  if (!title) return { ok: false, error: 'Give the block a title — it is what the sheet shows.' };
  const type = (input?.type ?? 'event') as ReservationType;
  if (!RES_TYPES.includes(type)) return { ok: false, error: `type must be one of ${RES_TYPES.join(', ')}.` };
  if (!hhmmOk(input?.time_start) || !hhmmOk(input?.time_end)) return { ok: false, error: 'time_start and time_end must be HH:MM, 24-hour.' };
  const ts = normalizeTime(input.time_start);
  const te = normalizeTime(input.time_end);
  if (te <= ts) return { ok: false, error: `${te} is not after ${ts}.` };

  let start: string;
  let end: string;
  if (YMD.test(String(input?.date ?? ''))) {
    start = end = input.date;
  } else if (YMD.test(String(input?.date_range?.start ?? '')) && YMD.test(String(input?.date_range?.end ?? ''))) {
    start = input.date_range.start;
    end = input.date_range.end;
    if (end < start) return { ok: false, error: 'date_range ends before it starts.' };
  } else {
    return { ok: false, error: 'Give a date (YYYY-MM-DD) or a date_range.' };
  }

  const engine = await loadEngine(ctx);
  if ('error' in engine) return { ok: false, error: engine.error };
  const courts = engine.getCourts();
  const rc = resolveCourts(input?.courts, courts);
  if ('error' in rc) return { ok: false, error: rc.error };

  const days = Array.isArray(input?.days_of_week)
    ? (input.days_of_week as number[]).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
    : undefined;
  const intent: BookingIntent = {
    club_id: ctx.clubId,
    courts: rc.courts.map(plannerRef),
    date_range: { start, end },
    days_of_week: days as DayOfWeek[] | undefined,
    time_range: { start: ts, end: te },
    type,
    title: title.slice(0, 120),
    meta: { via: 'assistant' },
  };

  let plan: Plan;
  try {
    plan = await engine.computeBookingPlan(intent, { allowLarge: false });
  } catch (e) {
    if (e instanceof PlanTooLargeError) {
      return { ok: false, error: `That is ${e.instanceCount} court-slots — too many for one request. Split the range.` };
    }
    throw e;
  }
  if (plan.toCreate.length === 0) return { ok: false, error: 'No dates in that range match the days given.' };

  const { from, to } = windowOf(plan.toCreate);
  const existing = await fetchOverlapping(ctx, from, to);
  const hard = plan.conflicts.filter((c) => !c.warning);
  const outsideHours = plan.conflicts.filter((c) => c.warning === 'outside_operating_hours').map((c) => c.candidate.starts_at);
  const notes = await headsUp(ctx, plan.toCreate, existing, courts, new Set());
  const maint = rc.courts.filter((c) => c.status === 'maintenance');
  if (maint.length > 0) notes.push(`${maint.map(courtLabel).join(', ')} is marked under maintenance.`);

  return { engine, plan, courts, existing, hard, outsideHours, notes, rows: [], signups: 0 };
}

/** Moves and resizes: a Plan built like planMutation's, checked by the same detectConflicts. */
async function prepareShift(
  input: any,
  ctx: Ctx,
  mode: 'move' | 'resize',
): Promise<Prepared | ToolResult> {
  const engine = await loadEngine(ctx);
  if ('error' in engine) return { ok: false, error: engine.error };
  const courts = engine.getCourts();

  const sel = await selectRows(input, ctx, courts);
  if ('error' in sel) return { ok: false, error: sel.error };
  const rows = sel.rows;
  const denied = checkEditable(rows, ctx, 'move');
  if (denied) return { ok: false, ...denied, reservations: rowsSummary(rows, courts, ctx.timeZone) };

  const tz = ctx.timeZone;
  const cands: ReservationInstance[] = [];

  if (mode === 'move') {
    const toDate = input?.to_date;
    const toStart = input?.to_start;
    if (toDate != null && !YMD.test(String(toDate))) return { ok: false, error: 'to_date must be YYYY-MM-DD.' };
    if (toStart != null && !hhmmOk(toStart)) return { ok: false, error: 'to_start must be HH:MM.' };
    let courtMap: Map<string, string> | null = null;
    if (input?.to_courts != null) {
      const rc = resolveCourts(input.to_courts, courts);
      if ('error' in rc) return { ok: false, error: rc.error };
      const sourceCourts = [...new Set(rows.map((r) => r.court_id))].sort((a, b) => {
        const ca = courts.find((c) => c.id === a);
        const cb = courts.find((c) => c.id === b);
        return (ca?.display_order ?? 0) - (cb?.display_order ?? 0);
      });
      if (rc.courts.length === 1) {
        courtMap = new Map(sourceCourts.map((id) => [id, rc.courts[0].id]));
      } else if (rc.courts.length === sourceCourts.length) {
        courtMap = new Map(sourceCourts.map((id, i) => [id, rc.courts[i].id]));
      } else {
        return {
          ok: false,
          error: `These are on ${sourceCourts.length} courts (${sourceCourts.map((id) => courtLabel(courts.find((c) => c.id === id))).join(', ')}); give one target court or ${sourceCourts.length} in order.`,
        };
      }
    }
    if (!courtMap && toDate == null && toStart == null) return { ok: false, error: 'Say where to: to_courts, to_date and/or to_start.' };

    for (const r of rows) {
      const date = toDate ?? utcToLocalDate(r.starts_at, tz);
      const len = Math.round((Date.parse(r.ends_at) - Date.parse(r.starts_at)) / 60000);
      const startsAt = toStart != null ? localToUtc(date, normalizeTime(toStart), tz) : localToUtc(date, utcToLocalTime(r.starts_at, tz), tz);
      cands.push(instanceFrom(r, courtMap?.get(r.court_id) ?? r.court_id, startsAt.toISOString(), new Date(startsAt.getTime() + len * 60000).toISOString()));
    }
  } else {
    const ns = input?.new_start;
    const ne = input?.new_end;
    if (ns == null && ne == null) return { ok: false, error: 'Give new_start and/or new_end.' };
    if ((ns != null && !hhmmOk(ns)) || (ne != null && !hhmmOk(ne))) return { ok: false, error: 'Times must be HH:MM, 24-hour.' };
    for (const r of rows) {
      const date = utcToLocalDate(r.starts_at, tz);
      const s = ns != null ? normalizeTime(ns) : utcToLocalTime(r.starts_at, tz);
      const e = ne != null ? normalizeTime(ne) : utcToLocalTime(r.ends_at, tz);
      if (timeToMinutes(e) <= timeToMinutes(s)) {
        return {
          ok: false,
          error: `"${r.title}" would end (${clock(e)}) at or before it starts (${clock(s)}). To free the court entirely, cancel it instead.`,
        };
      }
      cands.push(instanceFrom(r, r.court_id, localToUtc(date, s, tz).toISOString(), localToUtc(date, e, tz).toISOString()));
    }
  }

  const movingIds = new Set(rows.map((r) => r.id));
  const { from, to } = windowOf(cands);
  const existing = await fetchOverlapping(ctx, from, to);
  const conflicts = detectConflicts({
    candidates: cands,
    existing: existing.filter((e) => !movingIds.has(e.id)),
    courts,
  });

  const plan: Plan = {
    plan_id: signPlanId(randomUUID(), ctx.clubId),
    club_id: ctx.clubId,
    toCreate: cands,
    toModify: [],
    toCancel: rows.map((r) => ({ reservation_id: r.id })),
    conflicts,
    summary: {
      instance_count: cands.length,
      court_count: new Set(cands.map((c) => c.court_id)).size,
      day_count: new Set(cands.map((c) => utcToLocalDate(c.starts_at, tz))).size,
      spans: `${mode === 'move' ? 'Moved' : 'Retimed'} ${cands.length} reservation${cands.length === 1 ? '' : 's'}`,
    },
  };
  const notes = await headsUp(ctx, cands, existing, courts, movingIds);
  const signups = await signupCount(ctx, rows.filter((r) => r.signups_open).map((r) => r.id));
  return { engine, plan, courts, existing, hard: conflicts, outsideHours: [], notes, rows, signups };
}

function instanceFrom(r: Reservation, courtId: string, startsAt: string, endsAt: string): ReservationInstance {
  return {
    court_id: courtId,
    starts_at: startsAt,
    ends_at: endsAt,
    type: r.type,
    title: r.title,
    meta: (r.meta ?? {}) as Record<string, unknown>,
    color: r.color,
    signups_open: r.signups_open,
    signups_capacity: r.signups_capacity,
    signups_pitch: r.signups_pitch,
  };
}

async function prepareCancel(input: any, ctx: Ctx): Promise<Prepared | ToolResult> {
  const engine = await loadEngine(ctx);
  if ('error' in engine) return { ok: false, error: engine.error };
  const courts = engine.getCourts();
  const sel = await selectRows(input, ctx, courts);
  if ('error' in sel) return { ok: false, error: sel.error };
  const denied = checkEditable(sel.rows, ctx, 'cancel');
  if (denied) return { ok: false, ...denied, reservations: rowsSummary(sel.rows, courts, ctx.timeZone) };
  const plan: Plan = {
    plan_id: signPlanId(randomUUID(), ctx.clubId),
    club_id: ctx.clubId,
    toCreate: [],
    toModify: [],
    toCancel: sel.rows.map((r) => ({ reservation_id: r.id })),
    conflicts: [],
    summary: {
      instance_count: sel.rows.length,
      court_count: new Set(sel.rows.map((r) => r.court_id)).size,
      day_count: new Set(sel.rows.map((r) => utcToLocalDate(r.starts_at, ctx.timeZone))).size,
      spans: `Cancel ${sel.rows.length} reservation${sel.rows.length === 1 ? '' : 's'}`,
    },
  };
  const signups = await signupCount(ctx, sel.rows.filter((r) => r.signups_open).map((r) => r.id));
  return { engine, plan, courts, existing: [], hard: [], outsideHours: [], notes: [], rows: sel.rows, signups };
}

const isPrepared = (p: Prepared | ToolResult): p is Prepared => 'plan' in p && 'engine' in p;

/** Collisions block the write; the director sees them and decides. */
function conflictRefusal(p: Prepared, ctx: Ctx, canSkip: boolean): ToolResult {
  const total = p.plan.toCreate.length;
  const clashing = new Set(p.hard.map((c) => `${c.candidate.court_id}|${c.candidate.starts_at}`)).size;
  return {
    ok: false,
    error:
      `${clashing} of ${total} slot${total === 1 ? '' : 's'} collide with what is already on the sheet. ` +
      'Nothing has been changed or overwritten.',
    conflicts: describeConflicts(p.hard, p.courts, p.existing, ctx.timeZone),
    options: canSkip
      ? 'Pick other courts or times, move the existing booking first, or re-run with skip_conflicts:true to book only the free slots.'
      : 'Pick another court or time, or move/cancel the booking in the way first.',
    heads_up: p.notes.length ? p.notes : undefined,
  };
}

function createdSummary(p: Prepared, ctx: Ctx, cands = p.plan.toCreate) {
  const byWhen = new Map<string, string[]>();
  for (const c of cands) {
    const k = `${c.starts_at}|${c.ends_at}`;
    byWhen.set(k, [...(byWhen.get(k) ?? []), courtLabel(p.courts.find((x) => x.id === c.court_id))]);
  }
  return [...byWhen.entries()].map(([k, labels]) => {
    const [s, e] = k.split('|');
    return `${spanLocal(s, e, ctx.timeZone)} on ${labels.join(', ')}`;
  });
}

function skippedSet(p: Prepared) {
  return new Set(p.hard.map((c) => `${c.candidate.court_id}|${c.candidate.starts_at}|${c.candidate.ends_at}`));
}

type Applied = { ok: true; result: ApplyResult } | { ok: false; error: string };

async function applyIt(p: Prepared, ctx: Ctx, opts: { skipConflicting?: boolean }): Promise<Applied> {
  try {
    const result = await p.engine.applyPlan(p.plan, { actor_user_id: ctx.userId, channel: 'ai' }, opts);
    if (result.failed.length > 0) {
      return { ok: false, error: `The sheet refused the write: ${result.failed.map((f) => f.reason).join('; ')}. Nothing was kept.` };
    }
    return { ok: true, result };
  } catch (e) {
    if (e instanceof ConflictsBlockApplyError) {
      return { ok: false, error: 'Someone booked into that spot in the meantime. Nothing was changed — check courts_booked again.' };
    }
    if (e instanceof PlanIdInvalidError) return { ok: false, error: 'The plan could not be verified. Nothing was changed.' };
    throw e;
  }
}

// ------------------------------------------------------------------ tools

const tools: ToolDef<Ctx>[] = [
  {
    schema: COURTS_BOOKED,
    async run(input, ctx) {
      const tz = ctx.timeZone;
      const date = input?.date ?? todayLocal(tz);
      if (!YMD.test(String(date))) return { ok: false, error: 'date must be YYYY-MM-DD.' };
      const ws = input?.time_start;
      const we = input?.time_end;
      if ((ws != null && !hhmmOk(ws)) || (we != null && !hhmmOk(we))) return { ok: false, error: 'Times must be HH:MM.' };
      const day = dayWindowUtc(date, date, tz);
      const from = ws ? localToUtc(date, normalizeTime(ws), tz).toISOString() : day.from;
      const to = we ? localToUtc(date, normalizeTime(we), tz).toISOString() : day.to;
      if (to <= from) return { ok: false, error: 'The window ends before it starts.' };

      const engine = await loadEngine(ctx);
      if ('error' in engine) return { ok: false, error: engine.error };
      const allCourts = engine.getCourts();
      let courts = allCourts;
      if (input?.courts != null) {
        const rc = resolveCourts(input.courts, allCourts);
        if ('error' in rc) return { ok: false, error: rc.error };
        courts = rc.courts;
      }
      if (allCourts.length === 0) return { ok: false, error: 'This club has no courts set up on the court sheet.' };

      const rows = await fetchOverlapping(ctx, from, to);
      rows.sort((a, b) => a.starts_at.localeCompare(b.starts_at));

      const perCourt = courts.map((c) => {
        const mine = rows.filter((r) => r.court_id === c.id);
        return {
          court: courtLabel(c),
          ...(c.status === 'maintenance' ? { status: 'maintenance' } : {}),
          bookings: mine.map((r) => ({
            id: r.id,
            when: spanLocal(r.starts_at, r.ends_at, tz, false),
            title: r.title,
            what: whatIs(r),
            editable_here: EDITABLE_SOURCES.has(src(r)),
            ...(r.signups_open ? { open_for_signups: true } : {}),
          })),
        };
      });
      const free = courts
        .filter((c) => {
          const set = blockSet(c.id, allCourts);
          return !rows.some((r) => set.has(r.court_id));
        })
        .map(courtLabel);

      let confirmation: Record<string, unknown> | undefined;
      if (input?.title_match && input?.courts != null) {
        const needle = String(input.title_match).toLowerCase();
        const per = courts.map((c) => {
          const held = rows
            .filter((r) => r.court_id === c.id && r.title.toLowerCase().includes(needle))
            .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
          // Covered = the matching rows leave no gap in the window (or exist, if no window).
          let covered = held.length > 0;
          if (covered && (ws || we)) {
            let cursor = ms(from);
            for (const r of held) {
              if (ms(r.starts_at) > cursor) break;
              if (ms(r.ends_at) > cursor) cursor = ms(r.ends_at);
            }
            covered = cursor >= ms(to);
          }
          return {
            court: courtLabel(c),
            reserved: covered,
            by: held.map((r) => `"${r.title}" ${spanLocal(r.starts_at, r.ends_at, tz, false)}`),
          };
        });
        confirmation = {
          looking_for: input.title_match,
          all_reserved: per.every((p) => p.reserved),
          courts: per,
        };
      }

      return {
        ok: true,
        day: dayLabel(date, tz),
        window: ws || we ? `${clock(utcToLocalTime(from, tz))}–${clock(utcToLocalTime(to, tz))}` : 'all day',
        ...(confirmation ? { confirmation } : {}),
        free_courts: free,
        courts: perCourt.filter((p) => p.bookings.length > 0 || input?.courts != null),
      };
    },
  },

  {
    schema: WHATS_ON,
    async run(input, ctx) {
      return briefing(input, ctx);
    },
  },

  {
    schema: FIND_FREE_DATES,
    async run(input, ctx) {
      return freeDates(input, ctx);
    },
  },

  {
    schema: BOOK_COURTS,
    destructive: true,
    async preview(input, ctx) {
      const p = await prepareBooking(input, ctx);
      if (!isPrepared(p)) return p;
      const skip = input?.skip_conflicts === true;
      if (p.hard.length > 0 && !skip) return conflictRefusal(p, ctx, true);
      const skipped = skippedSet(p);
      const keep = p.plan.toCreate.filter((c) => !skipped.has(`${c.court_id}|${c.starts_at}|${c.ends_at}`));
      if (keep.length === 0) return { ok: false, error: 'Every slot asked for is already taken. Nothing to book.', conflicts: describeConflicts(p.hard, p.courts, p.existing, ctx.timeZone) };
      return {
        ok: true,
        will_book: {
          title: p.plan.intent?.title,
          type: p.plan.intent?.type,
          slots: keep.length,
          when: createdSummary(p, ctx, keep),
        },
        ...(p.hard.length > 0 ? { skipping_taken_slots: describeConflicts(p.hard, p.courts, p.existing, ctx.timeZone) } : {}),
        ...(p.outsideHours.length ? { outside_operating_hours: [...new Set(p.outsideHours)].map((d) => dayLabel(d, ctx.timeZone)) } : {}),
        heads_up: p.notes.length ? p.notes : undefined,
        note: 'Nothing on the sheet is overwritten. No one is emailed.',
      };
    },
    async run(input, ctx) {
      const p = await prepareBooking(input, ctx);
      if (!isPrepared(p)) return p;
      const skip = input?.skip_conflicts === true;
      if (p.hard.length > 0 && !skip) return conflictRefusal(p, ctx, true);
      const skipped = skippedSet(p);
      const keep = p.plan.toCreate.filter((c) => !skipped.has(`${c.court_id}|${c.starts_at}|${c.ends_at}`));
      if (keep.length === 0) return { ok: false, error: 'Every slot asked for is already taken. Nothing booked.' };
      const applied = await applyIt(p, ctx, { skipConflicting: skip });
      if (!applied.ok) return applied;
      return {
        ok: true,
        booked: applied.result.created_ids.length,
        title: p.plan.intent?.title,
        when: createdSummary(p, ctx, keep),
        reservation_ids: applied.result.created_ids,
        undo: 'Undo is available from CourtSheet’s history.',
      };
    },
  },

  ...(['move', 'resize'] as const).map(
    (mode): ToolDef<Ctx> => ({
      schema: mode === 'move' ? MOVE : RESIZE,
      destructive: true,
      async preview(input, ctx) {
        const p = await prepareShift(input, ctx, mode);
        if (!isPrepared(p)) return p;
        if (p.hard.length > 0) return conflictRefusal(p, ctx, false);
        return {
          ok: true,
          will_change: p.rows.map((r, i) => ({
            title: r.title,
            from: `${courtLabel(p.courts.find((c) => c.id === r.court_id))} ${spanLocal(r.starts_at, r.ends_at, ctx.timeZone)}`,
            to: `${courtLabel(p.courts.find((c) => c.id === p.plan.toCreate[i].court_id))} ${spanLocal(p.plan.toCreate[i].starts_at, p.plan.toCreate[i].ends_at, ctx.timeZone)}`,
          })),
          heads_up: p.notes.length ? p.notes : undefined,
          signups_not_notified:
            p.signups > 0 ? `${p.signups} player(s) signed up to these will NOT be told — tell them yourself.` : undefined,
        };
      },
      async run(input, ctx) {
        const p = await prepareShift(input, ctx, mode);
        if (!isPrepared(p)) return p;
        if (p.hard.length > 0) return conflictRefusal(p, ctx, false);
        // No skipConflicting: a skipped move would cancel the original and create nothing.
        const applied = await applyIt(p, ctx, {});
        if (!applied.ok) return applied;
        return {
          ok: true,
          changed: applied.result.created_ids.length,
          now: createdSummary(p, ctx),
          reservation_ids: applied.result.created_ids,
        };
      },
    }),
  ),

  {
    schema: CANCEL,
    destructive: true,
    async preview(input, ctx) {
      const p = await prepareCancel(input, ctx);
      if (!isPrepared(p)) return p;
      return {
        ok: true,
        will_cancel: rowsSummary(p.rows, p.courts, ctx.timeZone),
        frees_up: 'Those courts become open on the sheet.',
        signups_not_notified:
          p.signups > 0
            ? `${p.signups} player(s) are signed up to these and will NOT be emailed from here. Cancelling from the CourtSheet screen emails them.`
            : undefined,
      };
    },
    async run(input, ctx) {
      const p = await prepareCancel(input, ctx);
      if (!isPrepared(p)) return p;
      const applied = await applyIt(p, ctx, {});
      if (!applied.ok) return applied;
      return {
        ok: true,
        cancelled: applied.result.cancelled_ids.length,
        what: rowsSummary(p.rows, p.courts, ctx.timeZone),
      };
    },
  },
];

// -------------------------------------------------------------- briefing

const SECTIONS = ['classes', 'events', 'matches', 'court_blocks', 'lessons', 'open_signups', 'pickup_games'] as const;

async function briefing(input: any, ctx: Ctx): Promise<ToolResult> {
  const tz = ctx.timeZone;
  const start = input?.start ?? todayLocal(tz);
  const end = input?.end ?? start;
  if (!YMD.test(String(start)) || !YMD.test(String(end))) return { ok: false, error: 'start/end must be YYYY-MM-DD.' };
  if (end < start) return { ok: false, error: 'end is before start.' };
  if (enumerateDates(start, end).length > 31) return { ok: false, error: 'At most 31 days at a time.' };
  const want = new Set<string>(
    Array.isArray(input?.only) && input.only.length > 0 ? input.only.filter((s: string) => (SECTIONS as readonly string[]).includes(s)) : SECTIONS,
  );
  const homeOnly = input?.home_only === true;
  const { from, to } = dayWindowUtc(start, end, tz);
  const out: Record<string, unknown> = {};
  const opens: string[] = [];
  const at = (iso: string) => `${dayLabel(utcToLocalDate(iso, tz), tz)} ${clock(utcToLocalTime(iso, tz))}`;

  // Classes meeting — from the class schedule itself, not the sheet.
  if (want.has('classes') || want.has('open_signups')) {
    const { data } = await db(ctx)
      .from('club_programs')
      .select('id, title, status, range_start, range_end, days_of_week, exclusions, time_start, time_end, registration_mode, registration_opens_at, registration_closes_at')
      .eq('club_id', ctx.clubId)
      .eq('status', 'published')
      .lte('range_start', end)
      .gte('range_end', start);
    const progs = (data ?? []) as Array<Record<string, any>>;
    const meetings: string[] = [];
    for (const p of progs) {
      const dates = programSessions(p as any, tz).dates.filter((d) => d >= start && d <= end);
      for (const d of dates) {
        meetings.push(`${dayLabel(d, tz)} ${clock(String(p.time_start).slice(0, 5))}–${clock(String(p.time_end).slice(0, 5))} — ${p.title}`);
      }
      const opensAt = p.registration_opens_at as string | null;
      const closesAt = p.registration_closes_at as string | null;
      const nowIso = new Date().toISOString();
      if ((!opensAt || opensAt <= nowIso) && (!closesAt || closesAt > nowIso) && p.registration_mode !== 'closed') {
        opens.push(`Class "${p.title}" is taking sign-ups`);
      }
    }
    if (want.has('classes')) out.classes = meetings.sort((a, b) => a.localeCompare(b));
  }

  if (want.has('events') || want.has('open_signups')) {
    const events = await loadEvents(ctx, start, end);
    if (want.has('events')) {
      out.events = events.map((e) => {
        const st = e.start_time ?? e.daily_start_time;
        const multi = e.end_date && e.end_date.slice(0, 10) !== e.event_date!.slice(0, 10);
        return `${dayLabel(e.event_date!.slice(0, 10), tz)}${multi ? `–${dayLabel(e.end_date!.slice(0, 10), tz)}` : ''}${st ? ` ${clock(st.slice(0, 5))}` : ''} — ${e.name} (${eventKind(e.match_format)}, ${e.public_status})`;
      });
    }
    for (const e of events) if (e.public_status === 'open') opens.push(`${eventKind(e.match_format)} "${e.name}" is open for registration`);
  }

  if (want.has('matches')) {
    const lines: string[] = [];
    const teams = await loadCaptainTeams(ctx);
    if (teams.length > 0) {
      const { data } = await db(ctx)
        .from('captain_matches')
        .select('id, team_id, match_at, is_home, opponent, location, status')
        .in('team_id', teams.map((t) => t.id))
        .gte('match_at', from)
        .lt('match_at', to);
      for (const m of ((data ?? []) as CaptainMatchRow[]).sort((a, b) => a.match_at.localeCompare(b.match_at))) {
        if (m.status === 'cancelled') continue;
        if (homeOnly && !m.is_home) continue;
        lines.push(
          `${at(m.match_at)} — ${teams.find((t) => t.id === m.team_id)?.name ?? 'Team'} vs ${m.opponent ?? 'TBD'} (${m.is_home ? 'HOME' : `away${m.location ? ` @ ${m.location}` : ''}`})`,
        );
      }
    }
    // League (e.g. JTT) matchups in leagues this club runs.
    const { data: leagues } = await db(ctx).from('leagues').select('id, name').eq('club_id', ctx.clubId);
    const leagueRows = (leagues ?? []) as Array<{ id: string; name: string }>;
    if (leagueRows.length > 0) {
      const { data: divs } = await db(ctx).from('league_divisions').select('id, name, league_id').in('league_id', leagueRows.map((l) => l.id));
      const divRows = (divs ?? []) as Array<{ id: string; name: string; league_id: string }>;
      if (divRows.length > 0) {
        const { data: mus } = await db(ctx)
          .from('league_team_matchups')
          .select('id, division_id, match_date, start_time, home_club_id, away_club_id, status')
          .in('division_id', divRows.map((d) => d.id))
          .gte('match_date', start)
          .lte('match_date', end);
        const { data: lcs } = await db(ctx).from('league_clubs').select('id, name, short_code').in('league_id', leagueRows.map((l) => l.id));
        const lc = new Map(((lcs ?? []) as Array<{ id: string; name: string; short_code: string | null }>).map((c) => [c.id, c]));
        const clubName = ctx.clubName.toLowerCase();
        for (const m of (mus ?? []) as Array<Record<string, any>>) {
          const home = lc.get(m.home_club_id);
          const away = lc.get(m.away_club_id);
          const isHome = !!home && (clubName.includes(home.name.toLowerCase()) || home.name.toLowerCase().includes(clubName));
          if (homeOnly && !isHome) continue;
          const div = divRows.find((d) => d.id === m.division_id);
          lines.push(
            `${dayLabel(m.match_date, tz)}${m.start_time ? ` ${clock(String(m.start_time).slice(0, 5))}` : ''} — ${div?.name ?? 'League'}: ${away?.short_code ?? away?.name ?? '?'} @ ${home?.short_code ?? home?.name ?? '?'}${isHome ? ' (HOME)' : ''} [${m.status}]`,
          );
        }
      }
    }
    out.matches = lines;
  }

  if (want.has('court_blocks') || want.has('open_signups')) {
    const engine = await loadEngine(ctx);
    const courts = 'error' in engine ? [] : engine.getCourts();
    const { data } = await db(ctx)
      .from('reservations')
      .select('*')
      .eq('club_id', ctx.clubId)
      .neq('status', 'cancelled')
      .gte('starts_at', from)
      .lt('starts_at', to);
    const rows = ((data ?? []) as Reservation[]).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    const groups = new Map<string, Reservation[]>();
    for (const r of rows) {
      if (src(r) === 'programs') continue; // shown under classes
      const k = `${r.title}|${r.starts_at}|${r.ends_at}`;
      groups.set(k, [...(groups.get(k) ?? []), r]);
    }
    if (want.has('court_blocks')) {
      out.court_blocks = [...groups.values()].map(
        (g) => `${spanLocal(g[0].starts_at, g[0].ends_at, tz)} — ${g[0].title} (${whatIs(g[0])}) on ${g.map((r) => courtLabel(courts.find((c) => c.id === r.court_id))).join(', ')}`,
      );
    }
    for (const g of groups.values()) {
      if (g[0].signups_open) opens.push(`"${g[0].title}" ${spanLocal(g[0].starts_at, g[0].ends_at, tz)} is open for sign-ups${g[0].signups_capacity ? ` (cap ${g[0].signups_capacity})` : ''}`);
    }
  }

  if (want.has('lessons')) {
    const { data: coaches } = await db(ctx).from('lesson_coaches').select('id, display_name').eq('club_id', ctx.clubId);
    const coachRows = (coaches ?? []) as Array<{ id: string; display_name: string | null }>;
    const lines: string[] = [];
    if (coachRows.length > 0) {
      const { data } = await db(ctx)
        .from('lesson_slots')
        .select('id, coach_id, start_time, end_time, status, guest_name, court_id')
        .in('coach_id', coachRows.map((c) => c.id))
        .eq('status', 'booked')
        .gte('start_time', from)
        .lt('start_time', to);
      for (const s of ((data ?? []) as Array<Record<string, any>>).sort((a, b) => a.start_time.localeCompare(b.start_time))) {
        const coach = coachRows.find((c) => c.id === s.coach_id)?.display_name ?? 'Coach';
        lines.push(`${spanLocal(s.start_time, s.end_time, tz)} — ${coach}${s.guest_name ? ` with ${s.guest_name}` : ''}`);
      }
    }
    out.lessons = lines;
  }

  if (want.has('pickup_games') || want.has('open_signups')) {
    const { data } = await db(ctx)
      .from('pf_games')
      .select('id, starts_at, duration_min, format, spots_needed, court, status')
      .eq('club_id', ctx.clubId)
      .gte('starts_at', from)
      .lt('starts_at', to);
    const games = ((data ?? []) as Array<Record<string, any>>).filter((g) => g.status === 'open' || g.status === 'full');
    if (want.has('pickup_games')) {
      out.pickup_games = games.map((g) => `${at(g.starts_at)} — ${g.format ?? 'game'}${g.court ? ` on ${g.court}` : ''} (${g.status === 'open' ? `needs ${g.spots_needed}` : 'full'})`);
    }
    for (const g of games) if (g.status === 'open') opens.push(`Pickup ${g.format ?? 'game'} ${at(g.starts_at)} needs ${g.spots_needed}`);
  }

  if (want.has('open_signups')) out.open_signups = opens;

  return {
    ok: true,
    club: ctx.clubName,
    range: start === end ? dayLabel(start, tz) : `${dayLabel(start, tz)} – ${dayLabel(end, tz)}`,
    ...out,
  };
}

// ------------------------------------------------------------ free dates

async function freeDates(input: any, ctx: Ctx): Promise<ToolResult> {
  const tz = ctx.timeZone;
  const start = String(input?.start ?? '');
  const end = String(input?.end ?? '');
  if (!YMD.test(start) || !YMD.test(end)) return { ok: false, error: 'start and end must be YYYY-MM-DD.' };
  const all = enumerateDates(start, end);
  if (all.length === 0) return { ok: false, error: 'end is before start.' };
  if (all.length > 92) return { ok: false, error: 'At most about three months at a time.' };

  const teams = await loadCaptainTeams(ctx);
  const asked: string[] = Array.isArray(input?.teams) ? input.teams.map(String).filter(Boolean) : [];
  const chosen: CaptainTeamRow[] = [];
  const unknown: string[] = [];
  for (const name of asked) {
    const n = name.toLowerCase();
    const hits = teams.filter((t) => t.name.toLowerCase().includes(n));
    if (hits.length === 0) unknown.push(name);
    for (const h of hits) if (!chosen.some((c) => c.id === h.id)) chosen.push(h);
  }
  if (unknown.length > 0) {
    return {
      ok: false,
      error: `No team here matches ${unknown.join(', ')}.`,
      teams: teams.map((t) => t.name),
    };
  }

  const busy = new Map<string, string[]>();
  const mark = (d: string, why: string) => busy.set(d, [...(busy.get(d) ?? []), why]);
  const { from, to } = dayWindowUtc(start, end, tz);

  if (chosen.length > 0) {
    const { data } = await db(ctx)
      .from('captain_matches')
      .select('id, team_id, match_at, is_home, opponent, status')
      .in('team_id', chosen.map((t) => t.id))
      .gte('match_at', from)
      .lt('match_at', to);
    for (const m of (data ?? []) as CaptainMatchRow[]) {
      if (m.status === 'cancelled') continue;
      mark(
        utcToLocalDate(m.match_at, tz),
        `${chosen.find((t) => t.id === m.team_id)?.name} ${m.is_home ? 'home' : 'away'} vs ${m.opponent ?? 'TBD'}`,
      );
    }
  }
  if (input?.avoid_club_events !== false) {
    for (const e of await loadEvents(ctx, start, end)) {
      for (const d of enumerateDates(e.event_date!.slice(0, 10), (e.end_date ?? e.event_date!).slice(0, 10))) {
        mark(d, `club event: ${e.name}`);
      }
    }
  }

  const dows = Array.isArray(input?.days_of_week) && input.days_of_week.length > 0 ? new Set<number>(input.days_of_week) : null;
  const candidates = all.filter((d) => !dows || dows.has(localDayOfWeek(d, tz)));
  const free = candidates.filter((d) => !busy.has(d));
  return {
    ok: true,
    teams_checked: chosen.map((t) => t.name),
    checked_club_events: input?.avoid_club_events !== false,
    free_dates: free.slice(0, 40).map((d) => `${d} (${dayLabel(d, tz)})`),
    busy_dates: candidates
      .filter((d) => busy.has(d))
      .slice(0, 40)
      .map((d) => `${dayLabel(d, tz)}: ${busy.get(d)!.join('; ')}`),
    note:
      chosen.length === 0
        ? 'No teams named, so only club events were checked.'
        : 'Team matches come from each team\'s schedule in ClubMode; a match not entered there is not seen.',
  };
}

// ---------------------------------------------------------------- export

export const courtsTodayPack: DomainPack<Ctx> = {
  domain: 'courts',

  actionsPrompt: `
COURTS & TODAY — the court sheet and what is happening at the club.

Read: courts_booked (one day; also confirms "are 1-4 held for the B2 match?"), whats_on (briefing for a day or week;
"this week" = today..today+6), find_free_dates (dates with no matches for named teams / no club events).
Write (owner/director; a coach may only move/retime lessons they put on the sheet): book_courts, move_reservations,
change_reservation_times (shorten/extend; "open the courts at 5" = new_end 17:00), cancel_reservations.

Rules:
- Resolve "Saturday", "tomorrow" against today in the club's time zone; pass YYYY-MM-DD and 24-hour HH:MM.
- For moves/retimes/cancels, call courts_booked first and pass reservation_ids, unless the director's description
  is unambiguous (then use match).
- If a write comes back with conflicts, show them and stop. Never re-run with skip_conflicts unless the director says
  to book only the free slots. Never cancel someone else's booking to make room unless asked.
- Relay heads_up lines as-is; they are facts, not rules. The director decides.
- Rows owned by a class, lesson slot, event or member booking cannot be changed here — say where to change them.
- Nothing here emails or texts anyone. Say so if players are signed up to something that changes.
`.trim(),

  async resolve(userId) {
    const ctx = await resolveClubCtx(userId);
    if (!ctx) return null;
    // Anyone who runs or staffs the club; members never reach here (resolveClubCtx is null for them).
    if (!['owner', 'director', 'platform', 'coach', 'front_desk'].includes(ctx.role)) return null;
    return ctx;
  },

  tools,
};

