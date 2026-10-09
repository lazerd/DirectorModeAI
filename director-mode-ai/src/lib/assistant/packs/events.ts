import type Anthropic from '@anthropic-ai/sdk';
import type { DomainPack, ToolDef, ToolResult } from '../framework';
import { resolveClubCtx, MANAGER_ROLES, type ClubCtx } from '../clubContext';
import { TOURNAMENT_FORMATS, MIXER_FORMATS, isFlexEvent } from '@/lib/eventCategory';
import { daysUntil, livePhase, type LivePhase } from '@/lib/events/live';
import { parseDivisions, divisionLabel, type QuadDivision } from '@/lib/quadDivisions';
import { computeQuadComposite, isValidQuadScore, resolveCourtList } from '@/lib/quads';
import {
  optimizeTournamentSchedule,
  timeToMinutes,
  minutesToTime,
  type SchedulerMatch,
} from '@/lib/tournamentScheduler';
import { generateTournamentMatches, type TournamentFormat } from '@/lib/tournamentFormats';
import { recordTournamentScore, canonicalScore } from '@/lib/tournamentScoring';
import { syncTournamentEvent } from '@/lib/courtsheet/adapters/tournaments';
import { zonedWallTimeToIso, isoToZonedWallTime } from '@/lib/captain/clubTime';
import { absoluteUrl } from '@/lib/appUrl';

/*
 * Events pack — tournaments, quads, mixers and team battles (the `events` table).
 *
 * What a director asks on a tournament weekend: how are sign-ups going, who
 * still owes, build the schedule, double-check it, add a late entry, move the
 * alternate in, push the payment deadline, enter a score, make the draw, how
 * does this compare to last year, set up a mixer, what is live, give me the link.
 *
 * SAME CODE AS THE HAND PATH.
 *   - Scheduling runs optimizeTournamentSchedule with the same inputs the
 *     Schedule tab's auto-schedule route builds (predecessors from
 *     winner_feeds_to / loser_feeds_to, court windows, rest, buffer) and saves
 *     the same columns, then the same court-sheet write-through.
 *   - Scores go through lib/tournamentScoring — the exact function the
 *     magic-link scoring route calls (canonical score, auto-advance, reflow,
 *     playoff seating).
 *   - Draws use generateTournamentMatches with the generate-bracket route's
 *     seeding, cap and waitlist rules.
 *   - Late entries mirror the add-entry route; position moves mirror the
 *     entries/[id]/position routes.
 *   - A new mixer/team battle mirrors the New Event form's insert, as a DRAFT.
 *
 * SCOPE: the club's events, plus club-less events owned by the club owner or
 * by this user (the live-events rule). Never another club's.
 *
 * WHAT IT DELIBERATELY CANNOT DO: send email (promotion, invite and schedule
 * emails stay on their screens or the comms pack), charge or refund, mark
 * anyone paid, publish, generate Quads flights, schedule Quads, or touch any
 * outside system (TopDog, USTA).
 *
 * Writes need owner/director/platform. Coaches and front desk get the reads.
 */

type Ctx = ClubCtx;

// --------------------------------------------------------------- utilities

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

const todayIn = (tz: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(),
  );

const ymd = (d: string | null | undefined) => (d ? String(d).slice(0, 10) : null);

const fmtDay = (d: string | null | undefined) => {
  const v = ymd(d);
  if (!v) return null;
  return new Date(`${v}T12:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
};

const fmtTime = (hhmm: string | null | undefined) => {
  if (!hhmm) return null;
  const [h, m] = String(hhmm).slice(0, 5).split(':').map(Number);
  const ap = h >= 12 ? 'pm' : 'am';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m ? `${h12}:${String(m).padStart(2, '0')}${ap}` : `${h12}${ap}`;
};

const money = (cents: number | null | undefined) => (cents == null ? null : `$${(cents / 100).toFixed(2).replace(/\.00$/, '')}`);

const norm = (s: unknown) =>
  String(s ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

function canWrite(ctx: Ctx): ToolResult | null {
  if (MANAGER_ROLES.has(ctx.role)) return null;
  return {
    ok: false,
    error: `Your role here is "${ctx.role}", which can look but not change events. An owner or director can make this change.`,
  };
}

// --------------------------------------------------------------- event rows

export type EventRow = {
  id: string;
  user_id: string | null;
  club_id: string | null;
  name: string;
  slug: string | null;
  event_code: string | null;
  match_format: string | null;
  public_status: string;
  event_date: string | null;
  end_date: string | null;
  start_time: string | null;
  end_time: string | null;
  daily_start_time: string | null;
  daily_end_time: string | null;
  num_courts: number | null;
  court_names: string[] | null;
  court_windows: Record<string, { from?: string; to?: string }> | null;
  default_match_length_minutes: number | null;
  player_rest_minutes: number | null;
  match_buffer_minutes: number | null;
  round_duration_minutes: number | null;
  entry_fee_cents: number | null;
  max_players: number | null;
  divisions: unknown;
  entry_flow: string | null;
  hub_slug: string | null;
  hub_title: string | null;
  series_slug: string | null;
  registration_closes_at: string | null;
  public_registration: boolean | null;
  external_payment_url: string | null;
};

const EVENT_COLS =
  'id, user_id, club_id, name, slug, event_code, match_format, public_status, event_date, end_date, start_time, end_time, ' +
  'daily_start_time, daily_end_time, num_courts, court_names, court_windows, default_match_length_minutes, player_rest_minutes, ' +
  'match_buffer_minutes, round_duration_minutes, entry_fee_cents, max_players, divisions, entry_flow, hub_slug, hub_title, ' +
  'series_slug, registration_closes_at, public_registration, external_payment_url';

const isQuads = (e: EventRow) => e.match_format === 'quads';
const isTournament = (e: EventRow) => !!e.match_format && TOURNAMENT_FORMATS.has(e.match_format) && !isQuads(e);
/** Events whose sign-ups land in tournament_entries: tournaments and public-signup mixers. */
const usesTournamentEntries = (e: EventRow) => !isQuads(e) && (isTournament(e) || !!e.public_registration || !!e.slug);

function kindLabel(e: EventRow): string {
  if (isFlexEvent(e)) return 'Flex league division';
  if (isQuads(e)) return 'Quads';
  if (e.match_format === 'team-battle') return 'Team battle';
  if (e.match_format && TOURNAMENT_FORMATS.has(e.match_format)) return 'Tournament';
  return 'Mixer';
}

function publicHref(e: EventRow): string | null {
  if (isQuads(e) && e.slug) return `/quads/${e.slug}`;
  if (e.match_format && TOURNAMENT_FORMATS.has(e.match_format) && e.slug) return `/tournaments/${e.slug}`;
  return e.event_code ? `/event/${e.event_code}` : null;
}

/** Every event this club may act on: club-linked, plus club-less ones its owner or this user made. */
async function scopedEvents(ctx: Ctx): Promise<EventRow[]> {
  const { data: own } = await ctx.db
    .from('events')
    .select(EVENT_COLS)
    .eq('club_id', ctx.clubId)
    .order('event_date', { ascending: false })
    .limit(600);
  const { data: club } = await ctx.db.from('cc_clubs').select('owner_id').eq('id', ctx.clubId).maybeSingle();
  const owners = [...new Set([(club as { owner_id?: string } | null)?.owner_id, ctx.userId].filter(Boolean) as string[])];
  let legacy: EventRow[] = [];
  if (owners.length) {
    const { data } = await ctx.db
      .from('events')
      .select(EVENT_COLS)
      .is('club_id', null)
      .in('user_id', owners)
      .order('event_date', { ascending: false })
      .limit(300);
    legacy = (data as unknown as EventRow[] | null) ?? [];
  }
  return [...((own as unknown as EventRow[] | null) ?? []), ...legacy];
}

/** Divisions of one competition: a shared hub, or "Name — Division" rows on the same date. */
function groupKey(e: EventRow): string {
  if (e.hub_slug) return `hub:${e.hub_slug}`;
  const i = e.name.indexOf(' — ');
  if (i > 0) return `name:${norm(e.name.slice(0, i))}|${ymd(e.event_date)}`;
  return `id:${e.id}`;
}

function divisionNameOf(e: EventRow): string {
  const i = e.name.indexOf(' — ');
  return i > 0 ? e.name.slice(i + 3).trim() : e.name;
}

function eventBrief(e: EventRow) {
  return {
    id: e.id,
    name: e.name,
    kind: kindLabel(e),
    date: fmtDay(e.event_date),
    status: e.public_status,
  };
}

type Target = { events: EventRow[]; title: string };

/**
 * An event by id or name, in scope only. A name that matches the divisions of
 * one competition resolves to the whole group (reads report per division);
 * anything else ambiguous comes back as candidates — never a guess.
 */
async function findTarget(ctx: Ctx, ref: unknown): Promise<Target | { error: string; candidates?: unknown }> {
  const key = String(ref ?? '').trim();
  if (!key) return { error: 'Which event? Give its name or id (list_events shows what exists).' };
  const all = await scopedEvents(ctx);
  const byId = all.find((e) => e.id === key);
  if (byId) return { events: [byId], title: byId.name };
  if (UUID.test(key)) return { error: `No event with that id at ${ctx.clubName}.` };
  const k = norm(key);
  const byHub = all.filter((e) => e.hub_slug && (norm(e.hub_slug) === k || norm(e.hub_title) === k));
  if (byHub.length) return { events: byHub, title: byHub[0].hub_title || byHub[0].hub_slug || key };

  const exact = all.filter((e) => norm(e.name) === k);
  if (exact.length === 1) return { events: exact, title: exact[0].name };
  const toks = k.split(' ').filter(Boolean);
  let hits = exact.length
    ? exact
    : all.filter((e) => {
        const n = ` ${norm(e.name)} ${norm(e.hub_title)} `;
        return toks.every((t) => n.includes(` ${t}`));
      });
  if (hits.length === 0) return { error: `No event at ${ctx.clubName} matches "${key}". Use list_events to see what exists.` };
  if (hits.length === 1) return { events: hits, title: hits[0].name };

  const groups = new Map<string, EventRow[]>();
  for (const e of hits) groups.set(groupKey(e), [...(groups.get(groupKey(e)) ?? []), e]);
  if (groups.size > 1) {
    // Prefer what is still ahead or underway over past editions of the same name.
    const today = todayIn(ctx.timeZone);
    const current = [...groups.values()].filter((g) =>
      g.some((e) => (daysUntil(ymd(e.end_date) ?? ymd(e.event_date), today) ?? 0) >= -1 && e.public_status !== 'cancelled'),
    );
    if (current.length === 1) hits = current[0];
    else
      return {
        error: `"${key}" matches ${groups.size} different events. Ask the director which one, then pass its id.`,
        candidates: hits.slice(0, 12).map(eventBrief),
      };
  } else {
    hits = [...groups.values()][0];
  }
  const g = hits[0];
  const title = g.hub_title || (hits.length > 1 && g.name.includes(' — ') ? g.name.slice(0, g.name.indexOf(' — ')) : g.name);
  return { events: hits, title };
}

/** Does a free-text division ("G12", "12U", "girls 12s", "gold") fit a label? */
export function divisionMatches(query: string, label: string): boolean {
  const expand = (s: string) =>
    norm(s)
      .replace(/(\d+)\s*(u|s|and under|& under)\b/g, '$1')
      .replace(/\b([a-z])(\d+)\b/g, '$1 $2')
      .replace(/\b(\d+)([a-z])\b/g, '$1 $2')
      .split(' ')
      .filter(Boolean);
  const q = expand(query);
  const l = expand(label);
  if (!q.length) return false;
  return q.every((t) => l.some((w) => w === t || (isNaN(Number(t)) && w.startsWith(t))));
}

/**
 * Narrow a target to ONE event, using a division to pick among a group's
 * events. For a Quads event the division is a field on the entry instead, so
 * the event stays and the division id comes back.
 */
function pickOne(
  t: Target,
  division: unknown,
): { event: EventRow; quadDivision: QuadDivision | null } | { error: string; candidates?: unknown } {
  const div = String(division ?? '').trim();
  let events = t.events;
  if (events.length > 1) {
    if (!div)
      return {
        error: `${t.title} has ${events.length} divisions. Which one?`,
        candidates: events.map((e) => ({ id: e.id, division: divisionNameOf(e) })),
      };
    events = events.filter((e) => divisionMatches(div, divisionNameOf(e)));
    if (events.length !== 1)
      return {
        error: events.length
          ? `"${div}" fits ${events.length} divisions of ${t.title}. Which one?`
          : `No division of ${t.title} matches "${div}".`,
        candidates: (events.length ? events : t.events).map((e) => ({ id: e.id, division: divisionNameOf(e) })),
      };
  }
  const event = events[0];
  const divs = parseDivisions(event.divisions);
  if (isQuads(event) && divs.length) {
    if (!div) return { event, quadDivision: null };
    const d = divs.filter((x) => divisionMatches(div, x.label) || norm(x.id) === norm(div));
    if (d.length !== 1)
      return {
        error: d.length ? `"${div}" fits ${d.length} divisions. Which one?` : `${event.name} has no division "${div}".`,
        candidates: divs.map((x) => ({ id: x.id, label: x.label })),
      };
    return { event, quadDivision: d[0] };
  }
  return { event, quadDivision: null };
}

// --------------------------------------------------------------- entries

type Entry = {
  id: string;
  event_id: string;
  table: 'tournament_entries' | 'quad_entries';
  player_name: string;
  partner_name: string | null;
  division: string | null;
  position: string | null;
  payment_status: string | null;
  amount_paid_cents: number | null;
  discount_percent: number | null;
  registered_at: string | null;
  created_at: string | null;
  payment_due_at: string | null;
  gender: string | null;
  composite_rating: number | null;
  seed: number | null;
};

/** Positions that hold (or are about to hold) a spot. */
const IN_POSITIONS = new Set(['in_draw', 'in_flight', 'pending_payment', 'requested']);

async function loadEntries(ctx: Ctx, events: EventRow[]): Promise<Entry[]> {
  const out: Entry[] = [];
  const quadIds = events.filter(isQuads).map((e) => e.id);
  const tIds = events.filter((e) => !isQuads(e)).map((e) => e.id);
  if (tIds.length) {
    const { data } = await ctx.db
      .from('tournament_entries')
      .select(
        'id, event_id, player_name, partner_name, position, payment_status, amount_paid_cents, registered_at, created_at, gender, composite_rating, seed',
      )
      .in('event_id', tIds);
    for (const r of (data as Record<string, any>[] | null) ?? [])
      out.push({ ...(r as any), table: 'tournament_entries', division: null, discount_percent: null, payment_due_at: null });
  }
  if (quadIds.length) {
    const { data } = await ctx.db
      .from('quad_entries')
      .select(
        'id, event_id, player_name, division, position, payment_status, amount_paid_cents, discount_percent, registered_at, created_at, payment_due_at, gender, composite_rating',
      )
      .in('event_id', quadIds);
    for (const r of (data as Record<string, any>[] | null) ?? [])
      out.push({ ...(r as any), table: 'quad_entries', partner_name: null, seed: null });
  }
  return out.sort((a, b) => String(a.registered_at ?? a.created_at ?? '').localeCompare(String(b.registered_at ?? b.created_at ?? '')));
}

const entryName = (e: Pick<Entry, 'player_name' | 'partner_name'>) =>
  e.partner_name ? `${e.player_name} / ${e.partner_name}` : e.player_name;

function divisionFor(entry: Entry, byId: Map<string, EventRow>, grouped: boolean): string {
  const ev = byId.get(entry.event_id);
  if (!ev) return '—';
  if (isQuads(ev)) {
    const divs = parseDivisions(ev.divisions);
    return divs.length ? divisionLabel(divs, entry.division) : grouped ? divisionNameOf(ev) : 'All';
  }
  return grouped ? divisionNameOf(ev) : 'All';
}

/** Find an entry by name inside one event. Exact first; never guesses between two. */
function findEntry(entries: Entry[], who: unknown): { entry: Entry } | { error: string; candidates?: unknown } {
  const k = norm(who);
  if (!k) return { error: 'Which player?' };
  const exact = entries.filter((e) => norm(e.player_name) === k || norm(e.partner_name) === k || norm(entryName(e)) === k);
  const hits = exact.length ? exact : entries.filter((e) => norm(entryName(e)).includes(k));
  if (hits.length === 1) return { entry: hits[0] };
  if (!hits.length) return { error: `Nobody named "${String(who)}" is entered.` };
  return {
    error: `"${String(who)}" matches ${hits.length} entries. Which one?`,
    candidates: hits.map((e) => ({ id: e.id, name: entryName(e), position: e.position })),
  };
}

// --------------------------------------------------------------- reads

async function listEvents(input: Record<string, unknown>, ctx: Ctx): Promise<ToolResult> {
  const today = todayIn(ctx.timeZone);
  const all = await scopedEvents(ctx);
  const ahead = Number(input.days_ahead) > 0 ? Math.min(Number(input.days_ahead), 365) : 60;
  const includeDrafts = input.include_drafts === true;
  type Row = ReturnType<typeof eventBrief> & {
    phase: LivePhase | 'upcoming' | 'draft';
    daysAway: number | null;
    public_url: string | null;
    hub?: string;
  };
  const rows: Row[] = [];
  const hubs = new Set<string>();
  for (const e of all) {
    if (isFlexEvent(e) && e.public_status !== 'open') continue;
    const daysAway = daysUntil(ymd(e.event_date), today);
    const phase = livePhase({ public_status: e.public_status, daysAway, endsIn: daysUntil(ymd(e.end_date), today) });
    let p: Row['phase'] | null = phase;
    if (!p && daysAway != null && daysAway >= 0 && daysAway <= ahead) {
      if (e.public_status === 'draft') p = includeDrafts ? 'draft' : null;
      else if (!['completed', 'cancelled'].includes(e.public_status)) p = 'upcoming';
    }
    if (!p) continue;
    if (e.hub_slug) {
      if (hubs.has(e.hub_slug)) continue;
      hubs.add(e.hub_slug);
    }
    const href = e.hub_slug ? `/tournaments/hub/${e.hub_slug}` : publicHref(e);
    rows.push({
      ...eventBrief(e),
      ...(e.hub_slug ? { name: e.hub_title || e.name, hub: e.hub_slug } : {}),
      phase: p,
      daysAway,
      public_url: href ? absoluteUrl(href) : null,
    });
  }
  // Underway, then open for sign-ups, then coming up; soonest first within each.
  const rank = (r: Row) => (r.phase === 'live' ? 0 : r.phase === 'signup' ? 1 : r.phase === 'upcoming' ? 2 : 3);
  rows.sort((a, b) => rank(a) - rank(b) || (a.daysAway ?? 9999) - (b.daysAway ?? 9999));
  const staleRunning = all.filter(
    (e) => e.public_status === 'running' && (daysUntil(ymd(e.end_date) ?? ymd(e.event_date), today) ?? 0) < -1,
  ).length;
  return {
    ok: true,
    today,
    happening_now: rows.filter((r) => r.phase === 'live'),
    open_for_signups: rows.filter((r) => r.phase === 'signup'),
    coming_up: rows.filter((r) => r.phase === 'upcoming' || r.phase === 'draft'),
    stale_running_not_shown: staleRunning,
  };
}

async function eventSignups(input: Record<string, unknown>, ctx: Ctx): Promise<ToolResult> {
  const t = await findTarget(ctx, input.event);
  if ('error' in t) return { ok: false, ...t };
  const since = typeof input.since === 'string' && YMD.test(input.since) ? input.since : todayIn(ctx.timeZone);
  const sinceIso = zonedWallTimeToIso(`${since}T00:00`, ctx.timeZone) ?? `${since}T00:00:00Z`;
  const entries = await loadEntries(ctx, t.events);
  const byId = new Map(t.events.map((e) => [e.id, e]));
  const grouped = t.events.length > 1;

  // A mixer with no public sign-up keeps its roster in event_players instead.
  if (!entries.length) {
    const ids = t.events.map((e) => e.id);
    const { data } = await ctx.db.from('event_players').select('id, event_id').in('event_id', ids);
    const n = ((data as unknown[] | null) ?? []).length;
    return {
      ok: true,
      event: t.title,
      online_signups: 0,
      roster_players: n,
      note: n ? 'No online sign-ups; these are players added to the roster on the event screen.' : 'Nobody has signed up yet.',
    };
  }

  const divs = new Map<string, { entered: number; waitlist: number; awaiting_payment_or_invite: number; withdrawn: number; cap: number | null }>();
  for (const e of t.events) {
    const qd = parseDivisions(e.divisions);
    if (isQuads(e) && qd.length) for (const d of qd) divs.set(d.label, { entered: 0, waitlist: 0, awaiting_payment_or_invite: 0, withdrawn: 0, cap: null });
    else divs.set(grouped ? divisionNameOf(e) : 'All', { entered: 0, waitlist: 0, awaiting_payment_or_invite: 0, withdrawn: 0, cap: e.max_players });
  }
  const newSince: { name: string; division: string; position: string | null; at: string }[] = [];
  for (const en of entries) {
    const d = divisionFor(en, byId, grouped);
    const row = divs.get(d) ?? { entered: 0, waitlist: 0, awaiting_payment_or_invite: 0, withdrawn: 0, cap: null };
    if (en.position === 'in_draw' || en.position === 'in_flight') row.entered += 1;
    else if (en.position === 'waitlist') row.waitlist += 1;
    else if (en.position === 'pending_payment' || en.position === 'requested') row.awaiting_payment_or_invite += 1;
    else row.withdrawn += 1;
    divs.set(d, row);
    const at = en.registered_at ?? en.created_at;
    if (at && at >= sinceIso && en.position !== 'withdrawn' && en.position !== 'expired')
      newSince.push({ name: entryName(en), division: d, position: en.position, at: isoToZonedWallTime(at, ctx.timeZone).replace('T', ' ') });
  }
  const active = entries.filter((e) => e.position !== 'withdrawn' && e.position !== 'expired');
  const listAll = input.list_names !== false;
  return {
    ok: true,
    event: t.title,
    events: t.events.map(eventBrief),
    registration_closes: t.events[0].registration_closes_at
      ? isoToZonedWallTime(t.events[0].registration_closes_at, ctx.timeZone).replace('T', ' ')
      : null,
    total_active: active.length,
    by_division: [...divs.entries()].map(([division, v]) => ({ division, ...v })),
    new_since: { since, count: newSince.length, entries: newSince },
    ...(listAll
      ? {
          names: active.slice(0, 250).map((e) => ({
            name: entryName(e),
            division: divisionFor(e, byId, grouped),
            position: e.position,
          })),
        }
      : {}),
  };
}

async function eventPayments(input: Record<string, unknown>, ctx: Ctx): Promise<ToolResult> {
  const t = await findTarget(ctx, input.event);
  if ('error' in t) return { ok: false, ...t };
  const entries = await loadEntries(ctx, t.events);
  const byId = new Map(t.events.map((e) => [e.id, e]));
  const grouped = t.events.length > 1;
  const due = (en: Entry) => {
    const fee = byId.get(en.event_id)?.entry_fee_cents ?? 0;
    return en.discount_percent ? Math.round((fee * (100 - en.discount_percent)) / 100) : fee;
  };
  const line = (en: Entry) => ({
    name: entryName(en),
    division: divisionFor(en, byId, grouped),
    position: en.position,
    ...(en.payment_status === 'paid' ? { paid: money(en.amount_paid_cents) } : { fee: money(due(en)) }),
  });
  const live = entries.filter((e) => e.position !== 'withdrawn' && e.position !== 'expired');
  const paid = live.filter((e) => e.payment_status === 'paid');
  const waived = live.filter((e) => e.payment_status === 'waived');
  const unpaid = live.filter((e) => !['paid', 'waived', 'refunded'].includes(e.payment_status ?? '') && due(e) > 0);
  const owes = unpaid.filter((e) => IN_POSITIONS.has(e.position ?? ''));
  const notYetDue = unpaid.filter((e) => !IN_POSITIONS.has(e.position ?? ''));
  const withdrawnPaid = entries.filter((e) => (e.position === 'withdrawn' || e.position === 'expired') && e.payment_status === 'paid');
  const fees = [...new Set(t.events.map((e) => e.entry_fee_cents ?? 0))];
  return {
    ok: true,
    event: t.title,
    entry_fee: fees.length === 1 ? money(fees[0]) : fees.map(money),
    collected_in_app: money(paid.reduce((s, e) => s + (e.amount_paid_cents ?? 0), 0)),
    paid: paid.map(line),
    still_owe: owes.map(line),
    waitlist_unpaid_not_yet_due: notYetDue.map(line),
    waived_or_comped: waived.map(line),
    withdrawn_but_paid: withdrawnPaid.map(line),
    notes: [
      'Paid = the app recorded the online payment. Cash, check or Venmo collected outside the app is not tracked here.',
      ...(t.events.some((e) => e.external_payment_url) ? ['This event also points players to an outside payment link; those payments are not visible here.'] : []),
      'This is read-only — nothing was charged, refunded or marked paid.',
    ],
  };
}

async function shareLink(input: Record<string, unknown>, ctx: Ctx): Promise<ToolResult> {
  const t = await findTarget(ctx, input.event);
  if ('error' in t) return { ok: false, ...t };
  const hub = t.events[0].hub_slug;
  const links = t.events.map((e) => {
    const href = publicHref(e);
    return {
      ...eventBrief(e),
      public_url: href ? absoluteUrl(href) : null,
      // The Share tab's Download: a poster PDF with the QR code (staff sign-in needed to open).
      qr_poster_pdf: e.event_code ? absoluteUrl(`/api/events/${e.id}/poster`) : null,
      live: !['draft', 'cancelled'].includes(e.public_status),
    };
  });
  return {
    ok: true,
    event: t.title,
    ...(hub ? { hub_url: absoluteUrl(`/tournaments/hub/${hub}`) } : {}),
    links,
    note: links.some((l) => !l.live)
      ? 'A draft or cancelled event is not taking sign-ups; publish it on its event screen before sharing.'
      : undefined,
  };
}

// ----------------------------------------------- schedule: load + conflicts

type MatchRow = {
  id: string;
  event_id: string;
  bracket: string;
  round: number;
  slot: number;
  status: string;
  court: string | null;
  scheduled_date: string | null;
  scheduled_at: string | null;
  score: string | null;
  player1_id: string | null;
  player2_id: string | null;
  player3_id: string | null;
  player4_id: string | null;
  winner_feeds_to: string | null;
  loser_feeds_to: string | null;
};

const MATCH_COLS =
  'id, event_id, bracket, round, slot, status, court, scheduled_date, scheduled_at, score, player1_id, player2_id, player3_id, player4_id, winner_feeds_to, loser_feeds_to';

/** Predecessors from feed refs — the same map the auto-schedule route builds. */
export function schedulerMatchesFromRows(rows: MatchRow[]): SchedulerMatch[] {
  const idByPosition = new Map<string, string>();
  for (const m of rows) idByPosition.set(`${m.bracket}:${m.round}:${m.slot}`, m.id);
  const preds = new Map<string, string[]>(rows.map((m) => [m.id, []]));
  for (const m of rows) {
    for (const ref of [m.winner_feeds_to, m.loser_feeds_to].filter(Boolean)) {
      const [bracket, r, s] = String(ref).split(':');
      const dest = idByPosition.get(`${bracket}:${r}:${s}`);
      if (dest) preds.get(dest)?.push(m.id);
    }
  }
  return rows.map((m) => ({
    id: m.id,
    player_ids: [m.player1_id, m.player2_id, m.player3_id, m.player4_id].filter((x): x is string => !!x),
    predecessor_match_ids: preds.get(m.id) ?? [],
  }));
}

export type SlotItem = {
  id: string;
  label: string;
  date: string | null;
  time: string | null;
  court: string | null;
  players: string[];
  status: string;
  predecessors?: string[];
};

export type ScheduleRules = {
  matchLengthMinutes: number;
  restMinutes: number;
  courts: string[];
  dailyStart: string;
  dailyEnd: string;
  maxPerPlayerPerDay?: number | null;
};

export type Conflict = { type: string; detail: string; matches: string[] };

/**
 * Everything wrong with a schedule, pure: a court or player booked twice, more
 * matches than courts at once, too little rest, outside the day, unknown court,
 * a match before its feeder finishes, a player over the daily cap, unscheduled.
 */
export function findScheduleConflicts(items: SlotItem[], rules: ScheduleRules, nameOf: (id: string) => string = (x) => x): Conflict[] {
  const out: Conflict[] = [];
  const len = rules.matchLengthMinutes;
  const live = items.filter((m) => !['cancelled', 'defaulted'].includes(m.status));
  const placed = live.filter((m) => m.date && m.time);
  const unplaced = live.filter((m) => !(m.date && m.time) && m.status !== 'completed');
  if (unplaced.length)
    out.push({ type: 'unscheduled', detail: `${unplaced.length} match(es) have no date/time yet.`, matches: unplaced.map((m) => m.label) });

  const start = (m: SlotItem) => timeToMinutes(String(m.time).slice(0, 5));
  const byDate = new Map<string, SlotItem[]>();
  for (const m of placed) byDate.set(m.date as string, [...(byDate.get(m.date as string) ?? []), m]);
  const courtSet = new Set(rules.courts);

  for (const [date, ms] of byDate) {
    ms.sort((a, b) => start(a) - start(b));
    const day = fmtDay(date);
    // Court double-booked / unknown court / outside hours.
    const byCourt = new Map<string, SlotItem[]>();
    for (const m of ms) {
      if (m.court) byCourt.set(m.court, [...(byCourt.get(m.court) ?? []), m]);
      if (m.court && courtSet.size && !courtSet.has(m.court))
        out.push({ type: 'unknown_court', detail: `${m.label} is on court "${m.court}", which is not one of this event's courts.`, matches: [m.label] });
      if (start(m) < timeToMinutes(rules.dailyStart) || start(m) + len > timeToMinutes(rules.dailyEnd))
        out.push({
          type: 'outside_hours',
          detail: `${m.label} at ${fmtTime(m.time)} ${day} runs outside ${fmtTime(rules.dailyStart)}–${fmtTime(rules.dailyEnd)}.`,
          matches: [m.label],
        });
    }
    for (const [court, cm] of byCourt)
      for (let i = 1; i < cm.length; i++)
        if (start(cm[i]) < start(cm[i - 1]) + len)
          out.push({
            type: 'court_double_booked',
            detail: `Court ${court} ${day}: ${cm[i - 1].label} (${fmtTime(cm[i - 1].time)}) overlaps ${cm[i].label} (${fmtTime(cm[i].time)}).`,
            matches: [cm[i - 1].label, cm[i].label],
          });
    // More matches at once than courts.
    if (rules.courts.length) {
      const seen = new Set<number>();
      for (const m of ms) {
        const s = start(m);
        if (seen.has(s)) continue;
        seen.add(s);
        const at = ms.filter((x) => start(x) <= s && s < start(x) + len);
        if (at.length > rules.courts.length)
          out.push({
            type: 'over_capacity',
            detail: `${at.length} matches on court at ${fmtTime(m.time)} ${day}, but only ${rules.courts.length} courts.`,
            matches: at.map((x) => x.label),
          });
      }
    }
    // Player double-booked, short rest, daily cap.
    const byPlayer = new Map<string, SlotItem[]>();
    for (const m of ms) for (const p of m.players) byPlayer.set(p, [...(byPlayer.get(p) ?? []), m]);
    for (const [p, pm] of byPlayer) {
      for (let i = 1; i < pm.length; i++) {
        const gap = start(pm[i]) - (start(pm[i - 1]) + len);
        if (gap < 0)
          out.push({
            type: 'player_double_booked',
            detail: `${nameOf(p)} is in ${pm[i - 1].label} (${fmtTime(pm[i - 1].time)}) and ${pm[i].label} (${fmtTime(pm[i].time)}) at once, ${day}.`,
            matches: [pm[i - 1].label, pm[i].label],
          });
        else if (gap < rules.restMinutes)
          out.push({
            type: 'short_rest',
            detail: `${nameOf(p)} gets ${gap} min rest between ${pm[i - 1].label} and ${pm[i].label} ${day} (rule: ${rules.restMinutes}).`,
            matches: [pm[i - 1].label, pm[i].label],
          });
      }
      if (rules.maxPerPlayerPerDay && pm.length > rules.maxPerPlayerPerDay)
        out.push({
          type: 'over_daily_cap',
          detail: `${nameOf(p)} has ${pm.length} matches ${day} (cap ${rules.maxPerPlayerPerDay}).`,
          matches: pm.map((x) => x.label),
        });
    }
  }
  // A match that starts before its feeder match can finish.
  const byIdx = new Map(placed.map((m) => [m.id, m]));
  const abs = (m: SlotItem) => Date.parse(`${m.date}T00:00:00Z`) / 60000 + start(m);
  for (const m of placed)
    for (const pid of m.predecessors ?? []) {
      const p = byIdx.get(pid);
      if (p && abs(m) < abs(p) + len)
        out.push({
          type: 'before_feeder',
          detail: `${m.label} starts before ${p.label} (which feeds it) can finish.`,
          matches: [p.label, m.label],
        });
    }
  return out;
}

const matchLabel = (m: Pick<MatchRow, 'bracket' | 'round' | 'slot'>, names: (id: string | null) => string, row?: MatchRow) => {
  const base = `${m.bracket === 'consolation' ? 'Cons ' : ''}R${m.round}-M${m.slot}`;
  if (!row) return base;
  const a = [row.player1_id, row.player2_id].filter(Boolean).map((x) => names(x as string)).join(' / ') || 'TBD';
  const b = [row.player3_id, row.player4_id].filter(Boolean).map((x) => names(x as string)).join(' / ') || 'TBD';
  return `${base} ${a} v ${b}`;
};

type Timing = {
  courts: string[];
  courtWindows: ({ startMin: number; endMin: number } | undefined)[];
  dailyStart: string;
  dailyEnd: string;
  matchLength: number;
  rest: number;
  buffer: number;
  startDate: string | null;
  endDate: string | null;
};

/** The event's saved schedule settings, read exactly as the auto-schedule route reads them. */
function timingOf(e: EventRow): Timing {
  const dailyStart = (e.daily_start_time || e.start_time || '09:00').slice(0, 5);
  const dailyEnd = (e.daily_end_time || '18:00').slice(0, 5);
  const courts = resolveCourtList({ courtNames: e.court_names, numCourts: e.num_courts });
  const saved = e.court_windows ?? {};
  return {
    courts,
    courtWindows: courts.map((label) => {
      const w = saved[label];
      if (!w) return undefined;
      return {
        startMin: w.from ? timeToMinutes(w.from.slice(0, 5)) : timeToMinutes(dailyStart),
        endMin: w.to ? timeToMinutes(w.to.slice(0, 5)) : timeToMinutes(dailyEnd),
      };
    }),
    dailyStart,
    dailyEnd,
    matchLength: e.default_match_length_minutes ?? e.round_duration_minutes ?? 90,
    rest: e.player_rest_minutes ?? 60,
    buffer: e.match_buffer_minutes ?? 30,
    startDate: ymd(e.event_date),
    endDate: ymd(e.end_date) ?? ymd(e.event_date),
  };
}

async function loadMatches(ctx: Ctx, eventId: string): Promise<MatchRow[]> {
  const { data } = await ctx.db.from('tournament_matches').select(MATCH_COLS).eq('event_id', eventId).order('round').order('slot');
  return (data as unknown as MatchRow[] | null) ?? [];
}

async function nameMap(ctx: Ctx, event: EventRow) {
  const entries = await loadEntries(ctx, [event]);
  const m = new Map(entries.map((e) => [e.id, entryName(e)]));
  return { entries, names: (id: string | null) => (id ? m.get(id) ?? 'Unknown' : 'TBD') };
}

async function checkSchedule(input: Record<string, unknown>, ctx: Ctx): Promise<ToolResult> {
  const t = await findTarget(ctx, input.event);
  if ('error' in t) return { ok: false, ...t };
  const cap = Number(input.max_matches_per_player_per_day) > 0 ? Number(input.max_matches_per_player_per_day) : null;
  const results = [];
  for (const ev of t.events) {
    if (isQuads(ev)) {
      const { data: flights } = await ctx.db.from('quad_flights').select('id, name').eq('event_id', ev.id);
      const fl = (flights as { id: string; name: string }[] | null) ?? [];
      const { data } = fl.length
        ? await ctx.db
            .from('quad_matches')
            .select('id, flight_id, round, status, court, scheduled_date, scheduled_at, player1_id, player2_id, player3_id, player4_id')
            .in('flight_id', fl.map((f) => f.id))
        : { data: [] };
      const fname = new Map(fl.map((f) => [f.id, f.name]));
      const { names } = await nameMap(ctx, ev);
      const tm = timingOf({ ...ev, default_match_length_minutes: ev.round_duration_minutes ?? ev.default_match_length_minutes });
      const items: SlotItem[] = ((data as any[] | null) ?? []).map((m) => ({
        id: m.id,
        label: `${fname.get(m.flight_id) ?? 'Flight'} R${m.round}`,
        date: m.scheduled_date ?? ymd(ev.event_date),
        time: m.scheduled_at,
        court: m.court,
        players: [m.player1_id, m.player2_id, m.player3_id, m.player4_id].filter(Boolean),
        status: m.status ?? 'pending',
      }));
      const conflicts = findScheduleConflicts(items, { matchLengthMinutes: tm.matchLength, restMinutes: 0, courts: tm.courts, dailyStart: tm.dailyStart, dailyEnd: ev.end_time?.slice(0, 5) || tm.dailyEnd, maxPerPlayerPerDay: cap }, names);
      results.push({ event: ev.name, matches: items.length, conflicts: conflicts.slice(0, 40), conflict_count: conflicts.length });
      continue;
    }
    if (!isTournament(ev)) {
      results.push({ event: ev.name, note: 'Mixers are scheduled round by round on the event screen; there is no saved match schedule to check.' });
      continue;
    }
    const rows = await loadMatches(ctx, ev.id);
    const { names } = await nameMap(ctx, ev);
    const tm = timingOf(ev);
    const preds = new Map(schedulerMatchesFromRows(rows).map((s) => [s.id, s.predecessor_match_ids]));
    const items: SlotItem[] = rows.map((m) => ({
      id: m.id,
      label: matchLabel(m, names, m),
      date: ymd(m.scheduled_date),
      time: m.scheduled_at,
      court: m.court,
      players: [m.player1_id, m.player2_id, m.player3_id, m.player4_id].filter(Boolean) as string[],
      status: m.status,
      predecessors: preds.get(m.id),
    }));
    const conflicts = findScheduleConflicts(
      items,
      { matchLengthMinutes: tm.matchLength, restMinutes: tm.rest, courts: tm.courts, dailyStart: tm.dailyStart, dailyEnd: tm.dailyEnd, maxPerPlayerPerDay: cap },
      (id) => names(id),
    );
    results.push({
      event: ev.name,
      matches: rows.length,
      rules: { courts: tm.courts.length, hours: `${fmtTime(tm.dailyStart)}–${fmtTime(tm.dailyEnd)}`, match_minutes: tm.matchLength, rest_minutes: tm.rest },
      conflict_count: conflicts.length,
      conflicts: conflicts.slice(0, 40),
    });
  }
  return {
    ok: true,
    event: t.title,
    results,
    hint: 'To fix conflicts in a tournament, run schedule_matches (it re-times every unplayed match).',
  };
}

// --------------------------------------------------------------- compare

async function compareLastYear(input: Record<string, unknown>, ctx: Ctx): Promise<ToolResult> {
  const t = await findTarget(ctx, input.event);
  if ('error' in t) return { ok: false, ...t };
  const all = await scopedEvents(ctx);
  const cur = t.events;
  const curDate = ymd(cur[0].event_date);
  if (!curDate) return { ok: false, error: `${t.title} has no date, so there is no "last year" to compare to.` };
  const stripYear = (s: string) => norm(s).replace(/\b(19|20)\d{2}\b/g, '').replace(/\s+/g, ' ').trim();
  const key = stripYear(t.title);
  const series = cur[0].series_slug;
  const window = (e: EventRow) => {
    const then = ymd(e.event_date);
    const d = then ? daysUntil(curDate, then) : null; // days before this year's date
    return d != null && d >= 240 && d <= 500; // 8–16 months earlier
  };
  const prior = all.filter(
    (e) =>
      !cur.some((c) => c.id === e.id) &&
      window(e) &&
      ((series && e.series_slug === series) ||
        stripYear(e.hub_title || '') === key ||
        stripYear(e.name) === key ||
        (cur.length > 1 && cur.some((c) => stripYear(c.name) === stripYear(e.name)))),
  );
  if (!prior.length)
    return {
      ok: false,
      error: `I can't find last year's edition of ${t.title} (no event with the same name or series 8–16 months earlier). Tell me which event it was and I'll compare.`,
    };
  const count = async (evs: EventRow[]) => {
    const en = await loadEntries(ctx, evs);
    const active = en.filter((e) => !['withdrawn', 'expired'].includes(e.position ?? ''));
    if (active.length) return active.length;
    const { data } = await ctx.db.from('event_players').select('id').in('event_id', evs.map((e) => e.id));
    return ((data as unknown[] | null) ?? []).length;
  };
  const now = await count(cur);
  const then = await count(prior);
  return {
    ok: true,
    this_year: { event: t.title, date: fmtDay(curDate), entries: now },
    last_year: { events: prior.map(eventBrief), entries: then },
    change: now - then,
    change_pct: then ? Math.round(((now - then) / then) * 100) : null,
    note:
      daysUntil(curDate, todayIn(ctx.timeZone))! > 0
        ? 'This year is still taking sign-ups, so the count may grow; last year is the final count.'
        : undefined,
  };
}

// --------------------------------------------------------------- writes

type Plan = { summary: Record<string, unknown> };

/** Wrap a prepare() into a destructive tool whose preview and run share it. */
function writeTool<P extends Plan>(
  schema: Anthropic.Messages.Tool,
  prepare: (input: Record<string, unknown>, ctx: Ctx) => Promise<P | { error: string; candidates?: unknown }>,
  commit: (plan: P, ctx: Ctx) => Promise<ToolResult>,
): ToolDef<Ctx> {
  return {
    schema,
    destructive: true,
    async preview(input, ctx) {
      const denied = canWrite(ctx);
      if (denied) return denied;
      const plan = await prepare(input ?? {}, ctx);
      if ('error' in plan) return { ok: false, ...plan };
      return { ok: true, will: plan.summary };
    },
    async run(input, ctx) {
      const denied = canWrite(ctx);
      if (denied) return denied;
      const plan = await prepare(input ?? {}, ctx);
      if ('error' in plan) return { ok: false, ...plan };
      const done = await commit(plan, ctx);
      return done.ok ? { ...done, did: plan.summary } : done;
    },
  };
}

async function oneEvent(ctx: Ctx, input: Record<string, unknown>) {
  const t = await findTarget(ctx, input.event);
  if ('error' in t) return t;
  return pickOne(t, input.division);
}

// ---- schedule_matches

type SchedulePlan = Plan & {
  event: EventRow;
  patch: Record<string, unknown>;
  assignments: [string, { scheduled_date: string; scheduled_at: string; court: string }][];
};

async function prepareSchedule(input: Record<string, unknown>, ctx: Ctx): Promise<SchedulePlan | { error: string; candidates?: unknown }> {
  const p = await oneEvent(ctx, input);
  if ('error' in p) return p;
  const ev = p.event;
  if (!isTournament(ev))
    return { error: `${ev.name} is a ${kindLabel(ev)}; only tournament draws are scheduled here (Quads and mixers schedule on their own screens).` };
  const tm = timingOf(ev);
  const patch: Record<string, unknown> = {};

  // Overrides — the same columns the Schedule tab saves.
  if (Array.isArray(input.court_names) && input.court_names.length) {
    const names = (input.court_names as unknown[]).map((c) => String(c).trim()).filter(Boolean);
    patch.court_names = names;
    patch.num_courts = names.length;
    patch.court_windows = null;
    tm.courts = names;
    tm.courtWindows = names.map(() => undefined);
  } else if (input.courts != null) {
    const n = Number(input.courts);
    if (!Number.isInteger(n) || n < 1 || n > 40) return { error: 'courts must be a whole number 1–40.' };
    patch.num_courts = n;
    patch.court_names = null;
    patch.court_windows = null;
    tm.courts = resolveCourtList({ numCourts: n });
    tm.courtWindows = tm.courts.map(() => undefined);
  }
  for (const [k, col, key] of [
    ['start_time', 'daily_start_time', 'dailyStart'],
    ['end_time', 'daily_end_time', 'dailyEnd'],
  ] as const) {
    if (input[k] == null) continue;
    const v = String(input[k]).slice(0, 5);
    if (!HHMM.test(v)) return { error: `${k} must be HH:MM (24-hour). For "sunset", give the actual sunset time.` };
    patch[col] = v;
    tm[key] = v;
  }
  if (timeToMinutes(tm.dailyEnd) <= timeToMinutes(tm.dailyStart)) return { error: 'The day must end after it starts.' };
  if (input.match_length_minutes != null) {
    const m = Number(input.match_length_minutes);
    if (!Number.isInteger(m) || m < 5 || m > 240) return { error: 'match_length_minutes must be 5–240.' };
    patch.default_match_length_minutes = m;
    tm.matchLength = m;
  }
  if (input.rest_minutes != null) {
    const r = Number(input.rest_minutes);
    if (!Number.isInteger(r) || r < 0 || r > 480) return { error: 'rest_minutes must be 0–480.' };
    patch.player_rest_minutes = r;
    tm.rest = r;
  }
  if (input.end_date != null) {
    const d = String(input.end_date);
    if (!YMD.test(d)) return { error: 'end_date must be YYYY-MM-DD.' };
    patch.end_date = d;
    tm.endDate = d;
  }
  if (!tm.startDate) return { error: `${ev.name} has no start date.` };
  if (!tm.courts.length) return { error: 'No courts configured — say how many courts to use.' };

  const rows = await loadMatches(ctx, ev.id);
  if (!rows.length) return { error: `${ev.name} has no draw yet. Generate the draw first (generate_draw).` };
  const fixed = rows.filter((m) => ['completed', 'in_progress', 'defaulted', 'cancelled'].includes(m.status));
  const todo = rows.filter((m) => !fixed.includes(m));
  if (!todo.length) return { error: 'Every match is already played or on court; there is nothing left to schedule.' };

  const startDate = typeof input.from_date === 'string' && YMD.test(input.from_date) ? input.from_date : tm.startDate;
  const out = optimizeTournamentSchedule({
    matches: schedulerMatchesFromRows(rows).filter((s) => todo.some((t) => t.id === s.id)),
    courts: tm.courts,
    startDate,
    endDate: tm.endDate ?? startDate,
    dailyStartTime: tm.dailyStart,
    dailyEndTime: tm.dailyEnd,
    matchLengthMinutes: tm.matchLength,
    playerRestMinutes: tm.rest,
    matchBufferMinutes: tm.buffer,
    courtWindows: tm.courtWindows,
  });

  const { names } = await nameMap(ctx, ev);
  const preds = new Map(schedulerMatchesFromRows(rows).map((s) => [s.id, s.predecessor_match_ids]));
  const after: SlotItem[] = rows.map((m) => {
    const a = out.assignments.get(m.id);
    return {
      id: m.id,
      label: matchLabel(m, names, m),
      date: a ? a.scheduled_date : fixed.includes(m) ? ymd(m.scheduled_date) : null,
      time: a ? a.scheduled_at : fixed.includes(m) ? m.scheduled_at : null,
      court: a ? a.court : fixed.includes(m) ? m.court : null,
      players: [m.player1_id, m.player2_id, m.player3_id, m.player4_id].filter(Boolean) as string[],
      status: m.status,
      predecessors: preds.get(m.id),
    };
  });
  const cap = Number(input.max_matches_per_player_per_day) > 0 ? Number(input.max_matches_per_player_per_day) : null;
  const conflicts = findScheduleConflicts(
    after.filter((x) => x.status !== 'completed'),
    { matchLengthMinutes: tm.matchLength, restMinutes: tm.rest, courts: tm.courts, dailyStart: tm.dailyStart, dailyEnd: tm.dailyEnd, maxPerPlayerPerDay: cap },
    (id) => names(id),
  ).filter((c) => c.type !== 'unscheduled');

  const perDay = new Map<string, { matches: number; first: number; last: number }>();
  for (const [, a] of out.assignments) {
    const s = timeToMinutes(a.scheduled_at);
    const d = perDay.get(a.scheduled_date) ?? { matches: 0, first: s, last: 0 };
    d.matches += 1;
    d.first = Math.min(d.first, s);
    d.last = Math.max(d.last, s + tm.matchLength);
    perDay.set(a.scheduled_date, d);
  }
  const consolation = rows.filter((m) => m.bracket === 'consolation').length;
  return {
    event: ev,
    patch,
    assignments: [...out.assignments.entries()],
    summary: {
      event: ev.name,
      settings: {
        courts: tm.courts,
        hours: `${fmtTime(tm.dailyStart)}–${fmtTime(tm.dailyEnd)}`,
        match_minutes: tm.matchLength,
        rest_minutes: tm.rest,
        days: `${fmtDay(startDate)}${tm.endDate && tm.endDate !== startDate ? ` – ${fmtDay(tm.endDate)}` : ''}`,
        saved_as_event_defaults: Object.keys(patch),
      },
      matches_to_time: todo.length,
      ...(consolation ? { includes_backdraw_matches: consolation } : {}),
      kept_as_is_played_or_on_court: fixed.length,
      will_schedule: out.assignments.size,
      could_not_fit: out.unscheduled.map((id) => after.find((x) => x.id === id)?.label ?? id),
      by_day: [...perDay.entries()]
        .sort()
        .map(([d, v]) => ({ day: fmtDay(d), matches: v.matches, first_start: fmtTime(minutesToTime(v.first)), last_finish: fmtTime(minutesToTime(v.last)) })),
      conflicts_after: conflicts.slice(0, 25),
      ...(cap && conflicts.some((c) => c.type === 'over_daily_cap')
        ? { cap_note: `The scheduler cannot enforce ${cap} matches per player per day; the players over it are listed above.` }
        : {}),
      court_sheet: 'Court-sheet holds are synced the same way the Schedule tab does.',
    },
  };
}

// ---- generate_draw

const DRAW_FORMATS = new Set<string>([
  'rr-singles', 'rr-doubles', 'single-elim-singles', 'single-elim-doubles', 'fmlc-singles', 'fmlc-doubles',
  'ffic-singles', 'ffic-doubles', 'compass-singles', 'compass-doubles',
]);

type DrawPlan = Plan & { event: EventRow; inDraw: Entry[]; overflow: Entry[]; existing: number; generated: ReturnType<typeof generateTournamentMatches> };

async function prepareDraw(input: Record<string, unknown>, ctx: Ctx): Promise<DrawPlan | { error: string; candidates?: unknown }> {
  const p = await oneEvent(ctx, input);
  if ('error' in p) return p;
  const ev = p.event;
  if (isQuads(ev)) return { error: 'Quads flights are generated on the Quads screen (Entries → Generate flights); I cannot do that here.' };
  if (!ev.match_format || !DRAW_FORMATS.has(ev.match_format))
    return { error: `${ev.name} is a ${kindLabel(ev)} (${ev.match_format}); it has no draw to generate.` };
  const rows = await loadMatches(ctx, ev.id);
  const scored = rows.filter((m) => m.status === 'completed' || m.score);
  if (scored.length)
    return {
      error: `${ev.name} already has ${scored.length} scored match(es). Regenerating would erase those results, so I won't — do it on the event screen if you really mean to start over.`,
    };
  const entries = (await loadEntries(ctx, [ev])).filter((e) => e.position === 'in_draw');
  if (entries.length < 2) return { error: 'Need at least 2 confirmed (in-draw) entries to generate a draw.' };
  entries.sort((a, b) => {
    const sa = a.seed ?? Infinity;
    const sb = b.seed ?? Infinity;
    if (sa !== sb) return sa - sb;
    return (b.composite_rating ?? 0) - (a.composite_rating ?? 0);
  });
  const max = ev.max_players && ev.max_players > 0 ? ev.max_players : null;
  const inDraw = max ? entries.slice(0, max) : entries;
  const overflow = max ? entries.slice(max) : [];
  const generated = generateTournamentMatches(ev.match_format as TournamentFormat, inDraw.map((e) => e.id));
  return {
    event: ev,
    inDraw,
    overflow,
    existing: rows.length,
    generated,
    summary: {
      event: ev.name,
      format: ev.match_format,
      seeds_in_order: inDraw.map((e, i) => `${i + 1}. ${entryName(e)}`),
      matches_to_create: generated.length,
      ...(generated.some((m) => m.bracket === 'consolation') ? { backdraw_matches: generated.filter((m) => m.bracket === 'consolation').length } : {}),
      moved_to_waitlist_over_cap: overflow.map(entryName),
      replaces_unplayed_matches: rows.length,
      event_status_becomes: 'running',
      next: 'Matches have no times yet — run schedule_matches after.',
    },
  };
}

// ---- add_late_entry

type AddPlan = Plan & { event: EventRow; table: 'tournament_entries' | 'quad_entries'; row: Record<string, unknown> };

async function prepareAdd(input: Record<string, unknown>, ctx: Ctx): Promise<AddPlan | { error: string; candidates?: unknown }> {
  const p = await oneEvent(ctx, input);
  if ('error' in p) return p;
  const ev = p.event;
  const name = String(input.player_name ?? '').trim().slice(0, 80);
  if (!name) return { error: 'player_name is required.' };
  if (['completed', 'cancelled'].includes(ev.public_status)) return { error: `${ev.name} is ${ev.public_status}.` };
  if (!isQuads(ev) && !usesTournamentEntries(ev))
    return { error: `${ev.name} is a mixer without online sign-up; add players on its Players screen.` };
  const existing = await loadEntries(ctx, [ev]);
  const dup = existing.find(
    (e) => norm(e.player_name) === norm(name) && !['withdrawn', 'expired'].includes(e.position ?? '') && (!p.quadDivision || e.division === p.quadDivision.id),
  );
  if (dup) return { error: `${name} is already entered (${dup.position}).` };

  const gRaw = String(input.gender ?? '').toLowerCase();
  const gender = gRaw === 'male' || gRaw === 'female' || gRaw === 'nonbinary' ? gRaw : null;
  const ntrp = typeof input.ntrp === 'number' && input.ntrp >= 1 && input.ntrp <= 7 ? input.ntrp : null;
  const utr = typeof input.utr === 'number' && input.utr > 0 && input.utr <= 16 ? input.utr : null;
  const email = typeof input.email === 'string' ? input.email.trim().slice(0, 120) || null : null;
  const fee = ev.entry_fee_cents ?? 0;
  const waive = input.waive_fee === true || fee === 0;
  const payment_status = waive ? 'waived' : 'pending';

  if (isQuads(ev)) {
    const divs = parseDivisions(ev.divisions);
    if (divs.length && !p.quadDivision)
      return { error: `Which division? ${ev.name} has ${divs.map((d) => d.label).join(', ')}.`, candidates: divs.map((d) => ({ id: d.id, label: d.label })) };
    const inFlight = existing.filter((e) => e.position === 'in_flight').length;
    const position =
      ev.entry_flow === 'request_then_invite' ? 'requested' : ev.max_players && inFlight >= ev.max_players ? 'waitlist' : 'in_flight';
    const row = {
      event_id: ev.id,
      player_name: name,
      player_email: email,
      gender,
      ntrp,
      utr,
      composite_rating: computeQuadComposite({ utr, ntrp }) || null,
      division: p.quadDivision?.id ?? null,
      position,
      payment_status,
    };
    return {
      event: ev,
      table: 'quad_entries',
      row,
      summary: {
        event: ev.name,
        player: name,
        division: p.quadDivision?.label ?? null,
        position,
        payment: waive ? 'waived' : `owes ${money(fee)} (not charged)`,
        ...(position === 'requested' ? { next: 'Invite them from the Entries tab when ready (that sends the payment link).' } : {}),
      },
    };
  }

  // Tournament / public mixer — the add-entry route's rules.
  const inDraw = existing.filter((e) => e.position === 'in_draw').length;
  const position = ev.max_players && inDraw >= ev.max_players ? 'waitlist' : 'in_draw';
  const partner = typeof input.partner_name === 'string' ? input.partner_name.trim().slice(0, 80) || null : null;
  const drawn = isTournament(ev) ? (await loadMatches(ctx, ev.id)).length : 0;
  const row = {
    event_id: ev.id,
    player_name: name,
    player_email: email,
    gender,
    ntrp,
    utr,
    composite_rating: computeQuadComposite({ utr, ntrp }) || null,
    partner_name: partner,
    position,
    payment_status,
  };
  return {
    event: ev,
    table: 'tournament_entries',
    row,
    summary: {
      event: ev.name,
      player: partner ? `${name} / ${partner}` : name,
      position,
      payment: waive ? 'waived' : `owes ${money(fee)} (not charged)`,
      ...(drawn ? { warning: `The draw already exists (${drawn} matches). A late entry is not placed into it — regenerate the draw or use them as an alternate.` } : {}),
    },
  };
}

// ---- move_entry (withdraw / promote alternate / back to waitlist)

type MovePlan = Plan & {
  event: EventRow;
  table: 'tournament_entries' | 'quad_entries';
  moves: { id: string; position: string }[];
};

async function prepareMove(input: Record<string, unknown>, ctx: Ctx): Promise<MovePlan | { error: string; candidates?: unknown }> {
  const p = await oneEvent(ctx, input);
  if ('error' in p) return p;
  const ev = p.event;
  const entries = await loadEntries(ctx, [ev]);
  if (!entries.length) return { error: `${ev.name} has no online entries to move.` };
  const table = isQuads(ev) ? 'quad_entries' : 'tournament_entries';
  const IN = isQuads(ev) ? 'in_flight' : 'in_draw';
  const to = String(input.to ?? '');
  const moves: { id: string; position: string }[] = [];
  const lines: string[] = [];

  let target: Entry | null = null;
  if (input.player) {
    const f = findEntry(entries, input.player);
    if ('error' in f) return f;
    target = f.entry;
  }
  if (to === 'withdrawn' || to === 'waitlist' || to === 'in') {
    if (!target) return { error: 'Which player?' };
    const pos = to === 'in' ? IN : to;
    if (target.position === pos) return { error: `${entryName(target)} is already ${pos}.` };
    moves.push({ id: target.id, position: pos });
    lines.push(`${entryName(target)}: ${target.position} → ${pos}`);
  } else if (to !== 'promote_alternate') {
    return { error: "to must be 'withdrawn', 'waitlist', 'in', or 'promote_alternate'." };
  }

  if (to === 'promote_alternate' && !target && isQuads(ev) && parseDivisions(ev.divisions).length && !p.quadDivision)
    return { error: 'Which division should the alternate come into?' };
  const promote = to === 'promote_alternate' || (to === 'withdrawn' && input.promote_next_alternate !== false && target && IN_POSITIONS.has(target.position ?? ''));
  if (promote) {
    const division = target?.division ?? p.quadDivision?.id ?? null;
    const waiting = entries
      .filter((e) => e.position === 'waitlist' && (!isQuads(ev) || !division || e.division === division))
      .filter((e) => e.id !== target?.id);
    // Same gender first when the freed spot was a gendered one (mixed doubles caps).
    const sameGender = target?.gender ? waiting.filter((e) => e.gender === target!.gender) : [];
    const next = (sameGender.length ? sameGender : waiting)[0];
    if (next) {
      moves.push({ id: next.id, position: IN });
      lines.push(`${entryName(next)} (first on the waitlist, signed up ${fmtDay(next.registered_at ?? next.created_at)}): waitlist → ${IN}`);
    } else if (to === 'promote_alternate') return { error: 'Nobody is on the waitlist.' };
    else lines.push('Nobody is on the waitlist to move in.');
  }
  const drawn = isTournament(ev) ? (await loadMatches(ctx, ev.id)).length : 0;
  const moved = moves.map((m) => entries.find((e) => e.id === m.id)!);
  return {
    event: ev,
    table,
    moves,
    summary: {
      event: ev.name,
      changes: lines,
      payments: moved.some((e) => e.payment_status === 'paid')
        ? 'Payment records are left exactly as they are — no refund or charge. Handle money separately.'
        : 'No money moves.',
      emails: 'No email is sent (the screen would email a promoted Quads player; tell them yourself or ask the comms pack).',
      ...(drawn ? { warning: `The draw already exists (${drawn} matches); this changes the entry list, not the bracket. Swap the player on the desk or regenerate the draw.` } : {}),
    },
  };
}

// ---- extend_deadline

type DeadlinePlan = Plan & { event: EventRow; kind: 'payment_hold' | 'registration_close'; iso: string; entryIds: string[] };

async function prepareDeadline(input: Record<string, unknown>, ctx: Ctx): Promise<DeadlinePlan | { error: string; candidates?: unknown }> {
  const p = await oneEvent(ctx, input);
  if ('error' in p) return p;
  const ev = p.event;
  const iso = zonedWallTimeToIso(String(input.new_deadline ?? ''), ctx.timeZone);
  if (!iso) return { error: 'new_deadline must be a club-local YYYY-MM-DDTHH:MM.' };
  if (Date.parse(iso) < Date.now()) return { error: 'That deadline is already in the past.' };
  const local = isoToZonedWallTime(iso, ctx.timeZone);
  const when = `${fmtDay(local.slice(0, 10))} ${fmtTime(local.slice(11, 16))}`;
  const kind = input.which === 'registration_close' ? 'registration_close' : 'payment_hold';
  if (kind === 'registration_close') {
    return {
      event: ev,
      kind,
      iso,
      entryIds: [],
      summary: {
        event: ev.name,
        registration_closes: { from: ev.registration_closes_at ? isoToZonedWallTime(ev.registration_closes_at, ctx.timeZone).replace('T', ' ') : 'not set', to: when },
      },
    };
  }
  if (!isQuads(ev))
    return { error: `${ev.name} has no payment-hold release (that is a Quads invite window). Did you mean the registration close (which: 'registration_close')?` };
  let held = (await loadEntries(ctx, [ev])).filter(
    (e) => e.position === 'pending_payment' && !['paid', 'waived'].includes(e.payment_status ?? ''),
  );
  if (p.quadDivision) held = held.filter((e) => e.division === p.quadDivision!.id);
  if (input.player) {
    const f = findEntry(held, input.player);
    if ('error' in f) return f;
    held = [f.entry];
  }
  if (!held.length) return { error: 'Nobody is holding an unpaid spot right now, so there is no release to push back.' };
  return {
    event: ev,
    kind,
    iso,
    entryIds: held.map((e) => e.id),
    summary: {
      event: ev.name,
      spots_held_until: when,
      players: held.map((e) => ({
        name: e.player_name,
        was: e.payment_due_at ? isoToZonedWallTime(e.payment_due_at, ctx.timeZone).replace('T', ' ') : 'no deadline',
      })),
      note: 'Their payment links stay the same; nobody is emailed.',
    },
  };
}

// ---- enter_result

type ResultPlan = Plan & { event: EventRow; match: MatchRow; winnerSide: 'a' | 'b'; score: string };

async function prepareResult(input: Record<string, unknown>, ctx: Ctx): Promise<ResultPlan | { error: string; candidates?: unknown }> {
  const p = await oneEvent(ctx, input);
  if ('error' in p) return p;
  const ev = p.event;
  if (!isTournament(ev))
    return { error: `${ev.name} is a ${kindLabel(ev)}; scores for it are entered on its own screen (or the players' scoring links).` };
  const score = String(input.score ?? '').trim().replace(/\s+(?=\d+-\d+)/g, ', ').replace(/,\s*,/g, ',');
  if (!score || score.length > 100 || !isValidQuadScore(score))
    return { error: 'Score must be tennis format, winner first, like "6-3, 6-4".' };
  const { entries, names } = await nameMap(ctx, ev);
  const w = findEntry(entries, input.winner);
  if ('error' in w) return w;
  const l = input.loser ? findEntry(entries, input.loser) : null;
  if (l && 'error' in l) return l;
  const rows = await loadMatches(ctx, ev.id);
  const side = (m: MatchRow, id: string): 'a' | 'b' | null =>
    m.player1_id === id || m.player2_id === id ? 'a' : m.player3_id === id || m.player4_id === id ? 'b' : null;
  const wid = w.entry.id;
  const lid = l && 'entry' in l ? l.entry.id : null;
  let hits = rows.filter((m) => side(m, wid) && (!lid || (side(m, lid) && side(m, lid) !== side(m, wid))));
  const open = hits.filter((m) => !['completed', 'defaulted', 'cancelled'].includes(m.status));
  if (!open.length) {
    const done = hits.find((m) => m.status === 'completed');
    return {
      error: done
        ? `${matchLabel(done, names, done)} is already scored (${done.score}). Correct it on the tournament desk.`
        : `No unplayed match has ${entryName(w.entry)}${lid ? ` against ${names(lid)}` : ''}.`,
    };
  }
  hits = open.filter((m) => m.player1_id && m.player3_id);
  if (!hits.length) return { error: 'That match is still waiting on an opponent (TBD).' };
  if (hits.length > 1)
    return {
      error: `${entryName(w.entry)} has ${hits.length} unplayed matches. Who was the opponent?`,
      candidates: hits.map((m) => matchLabel(m, names, m)),
    };
  const match = hits[0];
  const winnerSide = side(match, wid) as 'a' | 'b';
  return {
    event: ev,
    match,
    winnerSide,
    score,
    summary: {
      event: ev.name,
      match: matchLabel(match, names, match),
      winner: entryName(w.entry),
      score_as_stored: canonicalScore(score, winnerSide),
      then: 'Winner (and loser, in a backdraw) advance automatically; unplayed matches re-time; playoffs update — same as a scoring link.',
    },
  };
}

// ---- create_event

type CreatePlan = Plan & { row: Record<string, unknown>; teams: string[] | null };

async function prepareCreate(input: Record<string, unknown>, ctx: Ctx): Promise<CreatePlan | { error: string }> {
  const name = String(input.name ?? '').trim().slice(0, 200);
  if (!name) return { error: 'name is required.' };
  const format = String(input.format ?? '');
  if (!MIXER_FORMATS.has(format))
    return {
      error: `format must be one of ${[...MIXER_FORMATS].join(', ')}. Tournaments and Quads are set up on their own New screens (entry fees, divisions, draws).`,
    };
  const date = String(input.date ?? '');
  if (!YMD.test(date)) return { error: 'date must be YYYY-MM-DD.' };
  if (date < todayIn(ctx.timeZone)) return { error: 'That date is in the past.' };
  const start = String(input.start_time ?? '').slice(0, 5);
  if (!HHMM.test(start)) return { error: 'start_time must be HH:MM (24-hour).' };
  const end = input.end_time == null ? null : String(input.end_time).slice(0, 5);
  if (end && (!HHMM.test(end) || timeToMinutes(end) <= timeToMinutes(start))) return { error: 'end_time must be HH:MM, after the start.' };

  let courts: number;
  let courtNote: string | undefined;
  if (input.courts === 'max' || input.courts == null) {
    const { data } = await ctx.db.from('courts').select('id, parent_court_id').eq('club_id', ctx.clubId).eq('status', 'active');
    const top = ((data as { parent_court_id: string | null }[] | null) ?? []).filter((c) => !c.parent_court_id);
    if (!top.length) return { error: 'I could not count the club’s courts; say how many to use.' };
    courts = top.length;
    courtNote = `All ${courts} active courts.`;
  } else {
    courts = Number(input.courts);
    if (!Number.isInteger(courts) || courts < 1 || courts > 40) return { error: 'courts must be 1–40 or "max".' };
  }
  const teams =
    format === 'team-battle'
      ? [String(input.team1_name ?? '').trim() || 'Team A', String(input.team2_name ?? '').trim() || 'Team B']
      : null;

  // Unique join code, same alphabet as the New Event form.
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let tries = 0; tries < 6; tries++) {
    code = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    const { data: clash } = await ctx.db.from('events').select('id').eq('event_code', code).maybeSingle();
    if (!clash) break;
  }
  const row: Record<string, unknown> = {
    name,
    event_date: date,
    start_time: start,
    ...(end ? { end_time: end, duration_minutes: timeToMinutes(end) - timeToMinutes(start) } : {}),
    num_courts: courts,
    match_format: format,
    scoring_format: 'fixed_games',
    round_length_minutes: 20,
    target_games: 6,
    format_notes: typeof input.notes === 'string' ? input.notes.slice(0, 1000) : '',
    user_id: ctx.userId,
    club_id: ctx.clubId,
    event_code: code,
    public_status: 'draft',
  };
  return {
    row,
    teams,
    summary: {
      name,
      kind: format === 'team-battle' ? 'Team battle' : `Mixer (${format})`,
      when: `${fmtDay(date)} ${fmtTime(start)}${end ? `–${fmtTime(end)}` : ''}`,
      courts,
      ...(courtNote ? { courts_note: courtNote } : {}),
      ...(teams ? { teams } : {}),
      status: 'draft — no public sign-up; open it on the event screen',
      court_sheet: 'Courts are NOT held on the court sheet by this; ask to block them if you want that.',
    },
  };
}

// ---------------------------------------------------------------- schemas

const EVENT_REF = {
  type: 'string',
  description: 'Event id, or its name (part of the name works; a competition name covers all its divisions).',
};
const DIVISION = {
  type: 'string',
  description: 'Division when the event has several (e.g. "G12", "12U", "Gold", "Women\'s Doubles").',
};

const T_LIST: Anthropic.Messages.Tool = {
  name: 'list_events',
  description:
    "What events (tournaments, quads, mixers, team battles) are happening now, open for sign-ups, or coming up, with each public link. Judges 'live' by date, not by stale flags.",
  input_schema: {
    type: 'object',
    properties: {
      days_ahead: { type: 'number', description: 'How far ahead "coming up" looks. Default 60.' },
      include_drafts: { type: 'boolean', description: 'Include unpublished drafts. Default false.' },
    },
  },
};

const T_SIGNUPS: Anthropic.Messages.Tool = {
  name: 'event_signups',
  description:
    'How sign-ups are going for an event: counts by division (entered / waitlist / awaiting payment or invite / withdrawn, with caps), who signed up since a date (default today), and the name list.',
  input_schema: {
    type: 'object',
    properties: {
      event: EVENT_REF,
      since: { type: 'string', description: 'YYYY-MM-DD; "new since" cut-off. Default today.' },
      list_names: { type: 'boolean', description: 'Include every name. Default true.' },
    },
    required: ['event'],
  },
};

const T_PAYMENTS: Anthropic.Messages.Tool = {
  name: 'event_payments',
  description:
    'Who has paid and who still owes the entry fee for an event (read-only; never charges). Also waitlist-unpaid (not due yet), comped, and withdrawn-but-paid.',
  input_schema: { type: 'object', properties: { event: EVENT_REF }, required: ['event'] },
};

const T_LINK: Anthropic.Messages.Tool = {
  name: 'event_share_link',
  description: 'The public sign-up/results link to share for an event, plus the QR-code poster PDF link.',
  input_schema: { type: 'object', properties: { event: EVENT_REF }, required: ['event'] },
};

const T_CHECK: Anthropic.Messages.Tool = {
  name: 'check_schedule',
  description:
    'Double-check an event schedule: court double-booked, more matches than courts at once, player double-booked, too little rest, outside hours, a match before its feeder finishes, players over a daily cap, unscheduled matches.',
  input_schema: {
    type: 'object',
    properties: {
      event: EVENT_REF,
      max_matches_per_player_per_day: { type: 'number', description: 'Optional cap to check.' },
    },
    required: ['event'],
  },
};

const T_COMPARE: Anthropic.Messages.Tool = {
  name: 'compare_to_last_year',
  description: "Entries this year vs last year's edition of the same event (matched by series or name, 8–16 months earlier).",
  input_schema: { type: 'object', properties: { event: EVENT_REF }, required: ['event'] },
};

const T_SCHEDULE: Anthropic.Messages.Tool = {
  name: 'schedule_matches',
  description:
    "Build or rebuild a tournament's match schedule with the app's scheduler (earliest-finish packing, bracket order, player rest, court windows; backdraw/consolation matches included). Re-times every unplayed match; played and on-court matches stay. Also the fix for an over-booked or conflicting schedule. Settings given are saved as the event's defaults. Preview shows per-day spans, what didn't fit, and remaining conflicts.",
  input_schema: {
    type: 'object',
    properties: {
      event: EVENT_REF,
      division: DIVISION,
      courts: { type: 'number', description: 'Number of courts (named 1..N).' },
      court_names: { type: 'array', items: { type: 'string' }, description: 'Exact court labels instead of a count.' },
      start_time: { type: 'string', description: 'Daily first start, HH:MM.' },
      end_time: { type: 'string', description: 'Daily last finish, HH:MM (for "sunset", the actual sunset time).' },
      match_length_minutes: { type: 'number' },
      rest_minutes: { type: 'number', description: 'Minimum rest between a player\'s matches.' },
      end_date: { type: 'string', description: 'Last day, YYYY-MM-DD, for a multi-day event.' },
      from_date: { type: 'string', description: 'Only use days from this date on (not saved).' },
      max_matches_per_player_per_day: { type: 'number', description: 'Checked and reported; the scheduler cannot enforce it.' },
    },
    required: ['event'],
  },
};

const T_DRAW: Anthropic.Messages.Tool = {
  name: 'generate_draw',
  description:
    "Generate a tournament's draw/bracket (round robin, single elim, FMLC/FFIC/compass backdraws) from in-draw entries: manual seeds first, then by rating; over the cap goes to the waitlist. Replaces unplayed matches; refuses if any result exists. Not for Quads flights.",
  input_schema: { type: 'object', properties: { event: EVENT_REF, division: DIVISION }, required: ['event'] },
};

const T_ADD: Anthropic.Messages.Tool = {
  name: 'add_late_entry',
  description:
    'Add a late entry to a tournament, quads or public-signup event (in the draw if there is room, else waitlist; Quads by its entry flow). Records the fee as owed unless waive_fee. Charges nothing, emails nobody.',
  input_schema: {
    type: 'object',
    properties: {
      event: EVENT_REF,
      division: DIVISION,
      player_name: { type: 'string' },
      partner_name: { type: 'string', description: 'Doubles partner.' },
      email: { type: 'string' },
      gender: { type: 'string', enum: ['male', 'female', 'nonbinary'] },
      ntrp: { type: 'number' },
      utr: { type: 'number' },
      waive_fee: { type: 'boolean', description: 'Comp the entry fee. Default false.' },
    },
    required: ['event', 'player_name'],
  },
};

const T_MOVE: Anthropic.Messages.Tool = {
  name: 'move_entry',
  description:
    "Change an entry's spot: withdraw a player (and by default move the first alternate on the waitlist in), put someone in or back on the waitlist, or just promote the next alternate. Payments untouched; no emails.",
  input_schema: {
    type: 'object',
    properties: {
      event: EVENT_REF,
      division: DIVISION,
      player: { type: 'string', description: 'Player name (not needed for promote_alternate).' },
      to: { type: 'string', enum: ['withdrawn', 'in', 'waitlist', 'promote_alternate'] },
      promote_next_alternate: { type: 'boolean', description: 'With withdrawn: move the first alternate in. Default true.' },
    },
    required: ['event', 'to'],
  },
};

const T_DEADLINE: Anthropic.Messages.Tool = {
  name: 'extend_deadline',
  description:
    "Move a deadline: 'payment_hold' = when unpaid Quads invites release their spots (the waitlist release), for everyone held or one player; 'registration_close' = when online sign-up closes.",
  input_schema: {
    type: 'object',
    properties: {
      event: EVENT_REF,
      division: DIVISION,
      which: { type: 'string', enum: ['payment_hold', 'registration_close'] },
      new_deadline: { type: 'string', description: 'Club-local YYYY-MM-DDTHH:MM. "Tomorrow midnight" = the day after tomorrow T00:00 — state which you used.' },
      player: { type: 'string', description: 'Only this player\'s hold.' },
    },
    required: ['event', 'which', 'new_deadline'],
  },
};

const T_RESULT: Anthropic.Messages.Tool = {
  name: 'enter_result',
  description:
    "Enter a tournament match result, through the same code as the players' scoring links (auto-advance, re-timing, playoffs). Score winner-first, e.g. \"6-3, 6-4\".",
  input_schema: {
    type: 'object',
    properties: {
      event: EVENT_REF,
      division: DIVISION,
      winner: { type: 'string', description: 'Winning player (or team) name.' },
      loser: { type: 'string', description: 'Opponent — needed when the winner has several unplayed matches.' },
      score: { type: 'string', description: 'Winner first: "6-3, 6-4" or "6-3 4-6 10-7".' },
    },
    required: ['event', 'winner', 'score'],
  },
};

const T_CREATE: Anthropic.Messages.Tool = {
  name: 'create_event',
  description:
    'Set up a mixer or team battle as an unpublished DRAFT (same as the New Event form). Not tournaments or Quads. Does not hold courts on the court sheet.',
  input_schema: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      format: { type: 'string', enum: [...MIXER_FORMATS] },
      date: { type: 'string', description: 'YYYY-MM-DD.' },
      start_time: { type: 'string', description: 'HH:MM 24-hour.' },
      end_time: { type: 'string', description: 'HH:MM 24-hour.' },
      courts: { type: ['number', 'string'], description: 'Number of courts, or "max" for all the club\'s courts.' },
      team1_name: { type: 'string' },
      team2_name: { type: 'string' },
      notes: { type: 'string' },
    },
    required: ['name', 'format', 'date', 'start_time'],
  },
};

// --------------------------------------------------------------- tool table

const tools: ToolDef<Ctx>[] = [
  { schema: T_LIST, run: (i, c) => listEvents(i ?? {}, c) },
  { schema: T_SIGNUPS, run: (i, c) => eventSignups(i ?? {}, c) },
  { schema: T_PAYMENTS, run: (i, c) => eventPayments(i ?? {}, c) },
  { schema: T_LINK, run: (i, c) => shareLink(i ?? {}, c) },
  { schema: T_CHECK, run: (i, c) => checkSchedule(i ?? {}, c) },
  { schema: T_COMPARE, run: (i, c) => compareLastYear(i ?? {}, c) },

  writeTool<SchedulePlan>(T_SCHEDULE, prepareSchedule, async (plan, ctx) => {
    if (Object.keys(plan.patch).length) {
      const { error } = await ctx.db.from('events').update(plan.patch).eq('id', plan.event.id);
      if (error) return { ok: false, error: error.message };
    }
    for (const [id, slot] of plan.assignments) {
      const { error } = await ctx.db
        .from('tournament_matches')
        .update({ scheduled_date: slot.scheduled_date, scheduled_at: slot.scheduled_at, court: slot.court })
        .eq('id', id)
        .eq('event_id', plan.event.id);
      if (error) return { ok: false, error: error.message };
    }
    const sheet = await syncTournamentEvent(plan.event.id).catch(() => null);
    return { ok: true, event: plan.event.name, matches_scheduled: plan.assignments.length, court_sheet: sheet ?? 'not synced' };
  }),

  writeTool<DrawPlan>(T_DRAW, prepareDraw, async (plan, ctx) => {
    const ev = plan.event;
    await ctx.db.from('tournament_matches').delete().eq('event_id', ev.id);
    for (let i = 0; i < plan.inDraw.length; i++)
      await ctx.db.from('tournament_entries').update({ seed: i + 1 }).eq('id', plan.inDraw[i].id).eq('event_id', ev.id);
    for (const e of plan.overflow)
      await ctx.db.from('tournament_entries').update({ position: 'waitlist', seed: null }).eq('id', e.id).eq('event_id', ev.id);
    if (plan.generated.length) {
      const { error } = await ctx.db.from('tournament_matches').insert(
        plan.generated.map((m) => ({
          event_id: ev.id,
          bracket: m.bracket,
          round: m.round,
          slot: m.slot,
          match_type: m.match_type,
          player1_id: m.player1_id,
          player2_id: m.player2_id,
          player3_id: m.player3_id,
          player4_id: m.player4_id,
          winner_feeds_to: m.winner_feeds_to,
          loser_feeds_to: m.loser_feeds_to,
        })),
      );
      if (error) return { ok: false, error: error.message };
    }
    await ctx.db.from('events').update({ public_status: 'running' }).eq('id', ev.id);
    return { ok: true, event: ev.name, matches_created: plan.generated.length, in_draw: plan.inDraw.length, waitlisted: plan.overflow.length };
  }),

  writeTool<AddPlan>(T_ADD, prepareAdd, async (plan, ctx) => {
    const { data, error } = await ctx.db.from(plan.table).insert(plan.row).select('id, position').maybeSingle();
    if (error || !data) return { ok: false, error: error?.message ?? 'Could not save the entry.' };
    return { ok: true, event: plan.event.name, entry_id: (data as { id: string }).id, position: plan.row.position };
  }),

  writeTool<MovePlan>(T_MOVE, prepareMove, async (plan, ctx) => {
    for (const m of plan.moves) {
      const { error } = await ctx.db.from(plan.table).update({ position: m.position }).eq('id', m.id).eq('event_id', plan.event.id);
      if (error) return { ok: false, error: error.message };
    }
    return { ok: true, event: plan.event.name, moved: plan.moves.length };
  }),

  writeTool<DeadlinePlan>(T_DEADLINE, prepareDeadline, async (plan, ctx) => {
    if (plan.kind === 'registration_close') {
      const { error } = await ctx.db.from('events').update({ registration_closes_at: plan.iso }).eq('id', plan.event.id);
      if (error) return { ok: false, error: error.message };
      return { ok: true, event: plan.event.name };
    }
    const { error } = await ctx.db
      .from('quad_entries')
      .update({ payment_due_at: plan.iso })
      .eq('event_id', plan.event.id)
      .in('id', plan.entryIds);
    if (error) return { ok: false, error: error.message };
    return { ok: true, event: plan.event.name, extended: plan.entryIds.length };
  }),

  writeTool<ResultPlan>(T_RESULT, prepareResult, async (plan, ctx) => {
    await recordTournamentScore(ctx.db, plan.match, {
      winnerSide: plan.winnerSide,
      score: plan.score,
      reportedByToken: null,
      reportedByName: 'Director (Ask ClubMode)',
    });
    return { ok: true, event: plan.event.name };
  }),

  writeTool<CreatePlan>(T_CREATE, prepareCreate, async (plan, ctx) => {
    const { data, error } = await ctx.db.from('events').insert(plan.row).select('id, event_code').maybeSingle();
    if (error || !data) return { ok: false, error: error?.message ?? 'Could not create the event.' };
    const ev = data as { id: string; event_code: string };
    if (plan.teams) {
      await ctx.db.from('event_teams').insert([
        { event_id: ev.id, name: plan.teams[0], color: '#3B82F6' },
        { event_id: ev.id, name: plan.teams[1], color: '#EF4444' },
      ]);
    }
    return { ok: true, event_id: ev.id, manage_url: absoluteUrl(`/mixer/events/${ev.id}`), join_code: ev.event_code };
  }),
];

// -------------------------------------------------------------------- export

export const eventsPack: DomainPack<Ctx> = {
  domain: 'events',

  actionsPrompt: `
EVENTS — tournaments, Quads, mixers and team battles.

Reads (any staff): list_events (live / open for sign-ups / coming up, with links), event_signups (by division, new today,
names), event_payments (paid vs owes — read-only), event_share_link (public link + QR poster), check_schedule
(conflicts), compare_to_last_year.
Writes (owner/director): schedule_matches, generate_draw, add_late_entry, move_entry, extend_deadline, enter_result,
create_event. Every write previews first; relay the specifics and wait for a clear yes.

Rules:
- A name that covers several divisions reads as the whole competition; writes need the division ("G12", "Gold").
- If an event or player name is ambiguous, ask — never pick.
- "Sunset": give the real sunset time for that date as end_time and say what you used. "Finish fast" is the scheduler's
  default. "Backdraw" is part of the draw format; the schedule includes it. A per-player daily cap is checked and
  reported, not enforced — say so.
- "Fix the schedule" = check_schedule, then schedule_matches to re-time unplayed matches.
- Convert "tomorrow midnight" etc. to a concrete club-local time and say it back.
- New mixers/team battles are DRAFTS; they don't hold courts (the courts pack does that).

You CANNOT: email or text anyone, charge, refund or mark paid, publish, generate or schedule Quads flights, score Quads or
mixers, or use outside systems (TopDog, USTA). Say so plainly and relay any ok:false reason.
`.trim(),

  async resolve(userId) {
    return resolveClubCtx(userId);
  },

  tools,
};
