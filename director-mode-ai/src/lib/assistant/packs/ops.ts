import type Anthropic from '@anthropic-ai/sdk';
import type { DomainPack, ToolDef, ToolResult } from '../framework';
import { resolveClubCtx, MANAGER_ROLES, type ClubCtx } from '../clubContext';
import { buildCourts, getBoardReportData } from '@/lib/boardReport/data';
import { zonedWallTimeToIso } from '@/lib/captain/clubTime';
import { APP_URL } from '@/lib/appUrl';
import { stringingCampaign, stringingRestringCampaign } from '@/lib/campaigns/sources';
import { runCampaign, type CampaignData, type NudgePerson } from '@/lib/campaigns/core';
import { loadBoardData } from '@/lib/maintenance/load';
import { clubNowHHMM, clubToday, hhmm, isISODate } from '@/lib/maintenance/dates';
import { canEditTask, canTransition, statusPatch } from '@/lib/maintenance/tasks';
import { routineFields } from '@/lib/maintenance/validate';
import { describeDays } from '@/lib/maintenance/routine';
import { ITEM_COLS, TASK_COLS } from '@/lib/maintenance/load';
import {
  DEPARTMENTS,
  PRIORITIES,
  isDepartment,
  isPriority,
  type Task,
  type TaskStatus,
} from '@/lib/maintenance/types';

/*
 * Ops pack — the back office: how the club is doing, who owes what, the
 * stringing counter and the maintenance board.
 *
 * REPORTS read ClubMode's own records only (class sign-ups, court bookings,
 * event entries, court reservations) — the same numbers as the Board Report
 * and the Getting paid screen. Nothing from QuickBooks, Captyn or a bank.
 *
 * STRINGING mirrors StringingMode's hand path: jobs are scoped through the
 * club's stringing customers; "ready" emails and re-string nudges go through
 * the campaign engine the Jobs screen's buttons use. "Paid" is a bookkeeping
 * tick (customer_paid_at / stringer_paid_at) — no card is charged.
 *
 * MAINTENANCE writes the same rows, with the same permission rules, as the
 * MaintenanceMode routes: anyone on staff (or the crew) may post a work order
 * or move one along; the daily checklist and projects are the owner's/director's.
 *
 * Every write and send previews first (framework confirm gate). Nothing is
 * charged or refunded, ever.
 */

type Ctx = ClubCtx;

// --------------------------------------------------------------- helpers

const STAFF = new Set(['owner', 'director', 'coach', 'front_desk', 'platform']);
const MAINT_ACCESS = new Set([...STAFF, 'maintenance']);
const MAINT_MANAGERS = new Set(['owner', 'director', 'platform']);
const YM = /^\d{4}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const money = (cents: number) =>
  `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;

const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

const clamp = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
};

function deny(ctx: Ctx, allowed: Set<string>, what: string): ToolResult | null {
  if (allowed.has(ctx.role)) return null;
  return { ok: false, error: `Your role here is "${ctx.role}", which cannot ${what}. An owner or director can.` };
}

const today = (ctx: Ctx) => clubToday(new Date(), ctx.timeZone);
const localDay = (iso: string | null | undefined, ctx: Ctx) => (iso ? clubToday(new Date(iso), ctx.timeZone) : null);

function nextMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}
function prevMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}
const monthLabel = (ym: string) =>
  new Date(`${ym}-15T12:00:00Z`).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** A club-local calendar month as UTC instants. */
function monthBounds(ym: string, tz: string): { start: Date; end: Date } {
  const s = zonedWallTimeToIso(`${ym}-01T00:00`, tz)!;
  const e = zonedWallTimeToIso(`${nextMonth(ym)}-01T00:00`, tz)!;
  return { start: new Date(s), end: new Date(e) };
}

const inRange = (iso: string | null | undefined, start: Date, end: Date) => {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return t >= start.getTime() && t < end.getTime();
};

function pickMonth(input: Record<string, unknown>, ctx: Ctx): { ym: string } | { error: string } {
  const m = input?.month == null || input.month === '' ? today(ctx).slice(0, 7) : String(input.month);
  if (!YM.test(m)) return { error: 'month should look like 2026-09.' };
  return { ym: m };
}

// --------------------------------------------------------------- money reads

type RegRow = {
  id: string;
  program_id: string;
  participant_name: string;
  parent_name: string | null;
  parent_email: string | null;
  status: string;
  payment_status: string;
  amount_cents: number | null;
  paid_at: string | null;
  created_at: string;
};
type BookingRow = {
  id: string;
  reservation_id: string | null;
  booker_name: string | null;
  booker_email: string | null;
  amount_cents: number | null;
  payment_status: string;
  status: string;
  paid_at: string | null;
  created_at: string;
};
type EntryRow = {
  event_id: string;
  player_name: string | null;
  payment_status: string | null;
  amount_paid_cents: number | null;
  registered_at: string | null;
  created_at: string | null;
};

async function clubEvents(ctx: Ctx) {
  const { data } = await ctx.db.from('events').select('id, name, event_date, entry_fee_cents').eq('club_id', ctx.clubId);
  return (data as { id: string; name: string; event_date: string | null; entry_fee_cents: number | null }[] | null) ?? [];
}

async function entriesFor(ctx: Ctx, eventIds: string[]): Promise<EntryRow[]> {
  if (!eventIds.length) return [];
  const cols = 'event_id, player_name, payment_status, amount_paid_cents, registered_at, created_at';
  const [t, q] = await Promise.all([
    ctx.db.from('tournament_entries').select(cols).in('event_id', eventIds),
    ctx.db.from('quad_entries').select(cols).in('event_id', eventIds),
  ]);
  return [...((t.data as EntryRow[] | null) ?? []), ...((q.data as EntryRow[] | null) ?? [])];
}

const paidWhen = (r: { paid_at: string | null; created_at: string }) => r.paid_at || r.created_at;

async function monthNumbers(ctx: Ctx, ym: string) {
  const { start, end } = monthBounds(ym, ctx.timeZone);
  const [{ data: regData }, { data: bookData }, events, { data: progData }] = await Promise.all([
    ctx.db
      .from('club_program_registrations')
      .select('id, program_id, participant_name, status, payment_status, amount_cents, paid_at, created_at')
      .eq('club_id', ctx.clubId),
    ctx.db
      .from('court_bookings')
      .select('id, amount_cents, payment_status, status, paid_at, created_at')
      .eq('club_id', ctx.clubId),
    clubEvents(ctx),
    ctx.db.from('club_programs').select('id, title').eq('club_id', ctx.clubId),
  ]);
  const regs = (regData as RegRow[] | null) ?? [];
  const books = (bookData as BookingRow[] | null) ?? [];
  const titles = new Map(((progData as { id: string; title: string }[] | null) ?? []).map((p) => [p.id, p.title]));
  const entries = await entriesFor(ctx, events.map((e) => e.id));

  const classPaid = regs
    .filter((r) => r.payment_status === 'paid' && inRange(paidWhen(r), start, end))
    .reduce((n, r) => n + (r.amount_cents || 0), 0);
  const courtPaid = books
    .filter((b) => b.payment_status === 'paid' && b.status !== 'cancelled' && inRange(paidWhen(b), start, end))
    .reduce((n, b) => n + (b.amount_cents || 0), 0);
  const eventPaid = entries
    .filter((e) => e.payment_status === 'paid' && inRange(e.registered_at || e.created_at, start, end))
    .reduce((n, e) => n + (e.amount_paid_cents || 0), 0);

  const newRegs = regs.filter((r) => r.status !== 'cancelled' && inRange(r.created_at, start, end));
  const byClass = new Map<string, number>();
  for (const r of newRegs) byClass.set(r.program_id, (byClass.get(r.program_id) ?? 0) + 1);

  const newBookings = books.filter((b) => b.status !== 'cancelled' && inRange(b.created_at, start, end));
  const eventsInMonth = events
    .filter((e) => e.event_date && e.event_date.slice(0, 7) === ym)
    .map((e) => ({
      name: e.name,
      date: e.event_date,
      entrants: entries.filter((x) => x.event_id === e.id && x.payment_status !== 'cancelled').length,
    }));

  return {
    start,
    end,
    revenue: {
      total: money(classPaid + courtPaid + eventPaid),
      total_cents: classPaid + courtPaid + eventPaid,
      classes: money(classPaid),
      court_bookings: money(courtPaid),
      event_entries: money(eventPaid),
    },
    class_registrations: {
      new: newRegs.length,
      top_classes: [...byClass.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([id, n]) => ({ class: titles.get(id) ?? 'Unknown class', signups: n })),
    },
    court_bookings_made: newBookings.length,
    events: eventsInMonth,
  };
}

async function boardNumbers(input: Record<string, unknown>, ctx: Ctx): Promise<ToolResult> {
  const pm = pickMonth(input, ctx);
  if ('error' in pm) return { ok: false, error: pm.error };
  const ym = pm.ym;
  const isCurrent = ym === today(ctx).slice(0, 7);
  const { data: club } = await ctx.db.from('cc_clubs').select('owner_id').eq('id', ctx.clubId).maybeSingle();
  const ownerId = (club as { owner_id?: string } | null)?.owner_id ?? ctx.userId;

  const [cur, prev] = await Promise.all([monthNumbers(ctx, ym), monthNumbers(ctx, prevMonth(ym))]);
  const report = await getBoardReportData(ctx.db as never, {
    clubId: ctx.clubId,
    directorId: ownerId,
    clubName: ctx.clubName,
    logoUrl: null,
    timezone: ctx.timeZone,
    surveyUrl: `${APP_URL}/nps/${ctx.clubSlug}`,
    periodStart: cur.start,
    periodEnd: isCurrent ? new Date() : cur.end,
    periodLabel: monthLabel(ym),
    generatedAtLabel: today(ctx),
  });
  const owed = await outstanding(ctx);

  const strip = ({ start: _s, end: _e, ...rest }: Awaited<ReturnType<typeof monthNumbers>>) => rest;
  return {
    ok: true,
    club: ctx.clubName,
    period: isCurrent ? `${monthLabel(ym)} (month to date, through ${today(ctx)})` : monthLabel(ym),
    this_period: strip(cur),
    previous_month: { label: monthLabel(prevMonth(ym)), ...strip(prev) },
    courts: report.courts.available
      ? {
          utilization_pct: report.courts.utilizationPct,
          court_hours_booked: report.courts.courtHoursBooked,
          court_hours_available: report.courts.courtHoursAvailable,
          busiest: `${report.courts.peakWindow} (${report.courts.peakUtilizationPct}%)`,
          quietest: report.courts.quietWindow,
        }
      : 'No court reservations recorded for this period.',
    membership: report.membership.available
      ? { active: report.membership.active, new: report.membership.newThisPeriod, lapsed: report.membership.lapsedThisPeriod }
      : 'Not tracked in ClubMode yet.',
    nps: report.nps.available ? { score: report.nps.score, responses: report.nps.responses } : 'No survey responses yet.',
    still_owed_now: { total: money(owed.totalCents), classes: money(owed.classCents), courts: money(owed.courtCents) },
    notes: [
      'Revenue = payments recorded in ClubMode (class sign-ups, court bookings, event entries). It does not include anything collected outside ClubMode.',
      'Utilization assumes a 6am–10pm day across all courts, same as the Board Report.',
    ],
  };
}

async function outstanding(ctx: Ctx) {
  const [{ data: regData }, { data: bookData }] = await Promise.all([
    ctx.db
      .from('club_program_registrations')
      .select('id, program_id, participant_name, parent_name, parent_email, status, payment_status, amount_cents, paid_at, created_at')
      .eq('club_id', ctx.clubId)
      .eq('payment_status', 'pending')
      .neq('status', 'cancelled'),
    ctx.db
      .from('court_bookings')
      .select('id, reservation_id, booker_name, booker_email, amount_cents, payment_status, status, paid_at, created_at')
      .eq('club_id', ctx.clubId)
      .eq('payment_status', 'pending')
      .eq('status', 'booked'),
  ]);
  const regs = ((regData as RegRow[] | null) ?? []).filter((r) => (r.amount_cents || 0) > 0);
  const books = ((bookData as BookingRow[] | null) ?? []).filter((b) => (b.amount_cents || 0) > 0);
  const classCents = regs.reduce((n, r) => n + (r.amount_cents || 0), 0);
  const courtCents = books.reduce((n, b) => n + (b.amount_cents || 0), 0);
  return { regs, books, classCents, courtCents, totalCents: classCents + courtCents };
}

async function whoOwes(_input: Record<string, unknown>, ctx: Ctx): Promise<ToolResult> {
  const o = await outstanding(ctx);
  const progIds = [...new Set(o.regs.map((r) => r.program_id))];
  const resIds = o.books.map((b) => b.reservation_id).filter(Boolean) as string[];
  const [{ data: progs }, { data: res }] = await Promise.all([
    progIds.length
      ? ctx.db.from('club_programs').select('id, title').eq('club_id', ctx.clubId).in('id', progIds)
      : Promise.resolve({ data: [] }),
    resIds.length
      ? ctx.db.from('reservations').select('id, starts_at').eq('club_id', ctx.clubId).in('id', resIds)
      : Promise.resolve({ data: [] }),
  ]);
  const title = new Map(((progs as { id: string; title: string }[]) ?? []).map((p) => [p.id, p.title]));
  const when = new Map(((res as { id: string; starts_at: string }[]) ?? []).map((r) => [r.id, r.starts_at]));

  // Group by who pays, so a family with three kids reads as one line.
  const byPayer = new Map<string, { payer: string; email: string | null; cents: number; items: string[] }>();
  const add = (key: string, payer: string, email: string | null, cents: number, item: string) => {
    const k = key.toLowerCase();
    const cur = byPayer.get(k) ?? { payer, email, cents: 0, items: [] };
    cur.cents += cents;
    cur.items.push(item);
    byPayer.set(k, cur);
  };
  for (const r of o.regs) {
    const payer = r.parent_name || r.participant_name;
    add(r.parent_email || payer, payer, r.parent_email, r.amount_cents || 0,
      `${r.participant_name} — ${title.get(r.program_id) ?? 'class'} ${money(r.amount_cents || 0)}${r.status === 'waitlist' ? ' (waitlist)' : ''}`);
  }
  for (const b of o.books) {
    const payer = b.booker_name || b.booker_email || 'Unknown booker';
    const at = b.reservation_id ? when.get(b.reservation_id) : null;
    add(b.booker_email || payer, payer, b.booker_email, b.amount_cents || 0,
      `Court booking ${at ? localDay(at, ctx) : ''} ${money(b.amount_cents || 0)}`.replace(/\s+/g, ' '));
  }
  const people = [...byPayer.values()].sort((a, b) => b.cents - a.cents);

  // Stringing records "paid" but no price, so it is a count, not dollars.
  const custIds = (await clubCustomers(ctx)).map((c) => c.id);
  let stringingUnpaid = 0;
  if (custIds.length) {
    const { data } = await ctx.db.from('stringing_jobs').select('id, status, customer_paid_at').in('customer_id', custIds);
    stringingUnpaid = ((data as { status: string; customer_paid_at: string | null }[]) ?? []).filter(
      (j) => (j.status === 'done' || j.status === 'picked_up') && !j.customer_paid_at,
    ).length;
  }

  return {
    ok: true,
    total_owed: money(o.totalCents),
    classes: money(o.classCents),
    court_bookings: money(o.courtCents),
    people: people.map((p) => ({ who: p.payer, email: p.email, owes: money(p.cents), for: p.items })),
    stringing_jobs_not_marked_paid: stringingUnpaid,
    note: 'Same numbers as the Getting paid screen. Event entry fees and anything settled outside ClubMode are not included. This is a list only — nothing is charged or sent.',
  };
}

async function utilizationByMonth(input: Record<string, unknown>, ctx: Ctx): Promise<ToolResult> {
  const n = Math.min(24, Math.max(1, Math.round(Number(input?.months) || 6)));
  let ym = today(ctx).slice(0, 7);
  const months: string[] = [];
  for (let i = 0; i < n; i++) {
    months.unshift(ym);
    ym = prevMonth(ym);
  }
  const now = new Date();
  const rows = [];
  for (const m of months) {
    const { start, end } = monthBounds(m, ctx.timeZone);
    const c = await buildCourts(ctx.db as never, ctx.clubId, ctx.timeZone, start, end < now ? end : now);
    rows.push({
      month: monthLabel(m) + (end > now ? ' (to date)' : ''),
      utilization_pct: c.available ? c.utilizationPct : null,
      court_hours_booked: c.courtHoursBooked,
      busiest: c.available ? c.peakWindow : null,
    });
  }
  if (rows.every((r) => r.utilization_pct == null)) {
    return { ok: true, months: rows, note: 'No court reservations are recorded in ClubMode for these months, so there is no utilization to report.' };
  }
  return { ok: true, months: rows, note: 'Booked court-hours ÷ (courts × 16 open hours a day, 6am–10pm). Blackouts and maintenance holds do not count as use.' };
}

async function broughtIn(input: Record<string, unknown>, ctx: Ctx): Promise<ToolResult> {
  const key = String(input?.name ?? '').trim();
  if (!key) return { ok: false, error: 'Which class or event?' };
  const k = key.toLowerCase();
  const [{ data: progData }, events] = await Promise.all([
    ctx.db.from('club_programs').select('id, title, range_start, range_end, status').eq('club_id', ctx.clubId),
    clubEvents(ctx),
  ]);
  const progs = ((progData as { id: string; title: string; range_start: string; range_end: string; status: string }[]) ?? [])
    .filter((p) => (UUID.test(key) ? p.id === key : p.title.toLowerCase().includes(k)));
  const evs = events.filter((e) => (UUID.test(key) ? e.id === key : e.name.toLowerCase().includes(k)));
  const hits = progs.length + evs.length;
  if (hits === 0) return { ok: false, error: `Nothing at ${ctx.clubName} is called "${key}".` };
  if (hits > 1) {
    return {
      ok: false,
      error: `"${key}" matches ${hits} things. Ask which one, then pass its id.`,
      candidates: [
        ...progs.map((p) => ({ id: p.id, kind: 'class', name: p.title, dates: `${p.range_start} – ${p.range_end}` })),
        ...evs.map((e) => ({ id: e.id, kind: 'event', name: e.name, date: e.event_date })),
      ],
    };
  }
  if (progs.length) {
    const p = progs[0];
    const { data } = await ctx.db
      .from('club_program_registrations')
      .select('id, status, payment_status, amount_cents')
      .eq('club_id', ctx.clubId)
      .eq('program_id', p.id);
    const regs = ((data as RegRow[]) ?? []).filter((r) => r.status !== 'cancelled');
    const paid = regs.filter((r) => r.payment_status === 'paid');
    const pending = regs.filter((r) => r.payment_status === 'pending' && (r.amount_cents || 0) > 0);
    return {
      ok: true,
      kind: 'class',
      name: p.title,
      collected: money(paid.reduce((n, r) => n + (r.amount_cents || 0), 0)),
      paid_signups: paid.length,
      still_owed: money(pending.reduce((n, r) => n + (r.amount_cents || 0), 0)),
      unpaid_signups: pending.length,
      waived: regs.filter((r) => r.payment_status === 'waived').length,
      note: 'Season sign-ups recorded in ClubMode only. Drop-ins paid at the desk or by Venmo are not in these totals.',
    };
  }
  const e = evs[0];
  const entries = (await entriesFor(ctx, [e.id])).filter((x) => x.payment_status !== 'cancelled');
  const paid = entries.filter((x) => x.payment_status === 'paid');
  return {
    ok: true,
    kind: 'event',
    name: e.name,
    date: e.event_date,
    collected: money(paid.reduce((n, x) => n + (x.amount_paid_cents || 0), 0)),
    paid_entries: paid.length,
    unpaid_entries: entries.filter((x) => x.payment_status === 'pending').length,
    waived_entries: entries.filter((x) => x.payment_status === 'waived').length,
    entry_fee: e.entry_fee_cents ? money(e.entry_fee_cents) : null,
    note: 'Entry payments recorded in ClubMode only.',
  };
}

// --------------------------------------------------------------- stringing data

type Customer = { id: string | number; full_name: string; email: string | null; phone: string | null; user_id: string | null };
type Job = {
  id: string;
  customer_id: string | number;
  racket_id: string | null;
  string_id: string | null;
  custom_string_name: string | null;
  main_tension_lbs: number | null;
  cross_tension_lbs: number | null;
  status: string;
  quoted_ready_at: string | null;
  completed_at: string | null;
  picked_up_at: string | null;
  created_at: string;
  stringer_name: string | null;
  stringer_paid_at: string | null;
  customer_paid_at: string | null;
};
type CatalogRow = { id: string; brand: string; name: string; gauge: string | null; in_stock: boolean | null };

const JOB_COLS =
  'id, customer_id, racket_id, string_id, custom_string_name, main_tension_lbs, cross_tension_lbs, status, quoted_ready_at, ' +
  'completed_at, picked_up_at, created_at, stringer_name, stringer_paid_at, customer_paid_at';

/** This club's stringing customers — the scope for every stringing read and write. */
async function clubCustomers(ctx: Ctx): Promise<Customer[]> {
  const { data } = await ctx.db
    .from('stringing_customers')
    .select('id, full_name, email, phone, user_id')
    .eq('club_id', ctx.clubId);
  return (data as Customer[] | null) ?? [];
}

async function clubJobs(ctx: Ctx, customers: Customer[]): Promise<Job[]> {
  if (!customers.length) return [];
  const { data } = await ctx.db
    .from('stringing_jobs')
    .select(JOB_COLS)
    .in('customer_id', customers.map((c) => c.id))
    .neq('status', 'cancelled')
    .order('created_at', { ascending: false });
  return (data as unknown as Job[] | null) ?? [];
}

async function clubCatalog(ctx: Ctx): Promise<CatalogRow[]> {
  const { data } = await ctx.db.from('stringing_catalog').select('id, brand, name, gauge, in_stock').eq('club_id', ctx.clubId);
  return (data as CatalogRow[] | null) ?? [];
}

function findCustomer(customers: Customer[], ref: unknown): { customer: Customer } | { error: string; candidates?: unknown } {
  const key = String(ref ?? '').trim();
  if (!key) return { error: 'Which customer?' };
  const byId = customers.find((c) => String(c.id) === key);
  if (byId) return { customer: byId };
  const k = key.toLowerCase();
  const exact = customers.filter((c) => c.full_name.trim().toLowerCase() === k || (c.email ?? '').toLowerCase() === k);
  const hits = exact.length ? exact : customers.filter((c) => c.full_name.toLowerCase().includes(k));
  if (hits.length === 1) return { customer: hits[0] };
  if (!hits.length) return { error: `No stringing customer named "${key}" at this club.` };
  return {
    error: `"${key}" matches ${hits.length} customers. Ask which one, then pass their id.`,
    candidates: hits.map((c) => ({ id: c.id, name: c.full_name, email: c.email })),
  };
}

function labelJob(j: Job, catalog: Map<string, CatalogRow>, rackets: Map<string, string>, customers: Map<string, Customer>, ctx: Ctx) {
  const cat = j.string_id ? catalog.get(j.string_id) : null;
  const tension = j.main_tension_lbs
    ? j.cross_tension_lbs && j.cross_tension_lbs !== j.main_tension_lbs
      ? `${j.main_tension_lbs}/${j.cross_tension_lbs} lbs`
      : `${j.main_tension_lbs} lbs`
    : null;
  const c = customers.get(String(j.customer_id));
  return {
    id: j.id,
    customer: c?.full_name ?? 'Unknown',
    email: c?.email ?? null,
    racket: j.racket_id ? rackets.get(j.racket_id) ?? null : null,
    string: cat ? `${cat.brand} ${cat.name}` : j.custom_string_name,
    tension,
    status: j.status,
    dropped_off: localDay(j.created_at, ctx),
    promised: j.quoted_ready_at ? localDay(j.quoted_ready_at, ctx) : null,
    finished: j.completed_at ? localDay(j.completed_at, ctx) : null,
    strung_by: j.stringer_name,
    customer_paid: !!j.customer_paid_at,
    stringer_paid: !!j.stringer_paid_at,
  };
}

async function jobContext(ctx: Ctx) {
  const customers = await clubCustomers(ctx);
  const [jobs, catalog] = await Promise.all([clubJobs(ctx, customers), clubCatalog(ctx)]);
  const racketIds = [...new Set(jobs.map((j) => j.racket_id).filter(Boolean))] as string[];
  const { data: rk } = racketIds.length
    ? await ctx.db.from('stringing_rackets').select('id, brand, model').in('id', racketIds)
    : { data: [] };
  const rackets = new Map(
    ((rk as { id: string; brand: string | null; model: string | null }[]) ?? []).map((r) => [r.id, `${r.brand ?? ''} ${r.model ?? ''}`.trim()]),
  );
  const custMap = new Map(customers.map((c) => [String(c.id), c]));
  const catMap = new Map(catalog.map((c) => [c.id, c]));
  const label = (j: Job) => labelJob(j, catMap, rackets, custMap, ctx);
  return { customers, jobs, catalog, custMap, label };
}

async function stringingQueue(input: Record<string, unknown>, ctx: Ctx): Promise<ToolResult> {
  const { customers, jobs, label } = await jobContext(ctx);
  let scoped = jobs;
  if (input?.customer) {
    const f = findCustomer(customers, input.customer);
    if ('error' in f) return { ok: false, ...f };
    scoped = jobs.filter((j) => String(j.customer_id) === String(f.customer.id));
  }
  const now = Date.now();
  const open = scoped.filter((j) => j.status === 'pending' || j.status === 'in_progress');
  const overdue = open.filter((j) => j.quoted_ready_at && new Date(j.quoted_ready_at).getTime() < now);
  const ready = scoped.filter((j) => j.status === 'done');
  const finished = scoped.filter((j) => j.status === 'done' || j.status === 'picked_up');
  const stringerOwed = new Map<string, number>();
  for (const j of finished) if (j.stringer_name && !j.stringer_paid_at) stringerOwed.set(j.stringer_name, (stringerOwed.get(j.stringer_name) ?? 0) + 1);
  return {
    ok: true,
    ready_for_pickup: ready.map(label),
    ready_with_email: ready.filter((j) => customers.find((c) => String(c.id) === String(j.customer_id))?.email).length,
    overdue: overdue.map(label),
    in_the_shop: open.map(label),
    recent_picked_up: scoped.filter((j) => j.status === 'picked_up').slice(0, input?.customer ? 10 : 5).map(label),
    customer_not_marked_paid: finished.filter((j) => !j.customer_paid_at).length,
    stringer_jobs_unpaid: Object.fromEntries(stringerOwed),
    today: today(ctx),
  };
}

// --------------------------------------------------------------- stringing writes

type LogPlan = {
  customer: Customer | null;
  newCustomer: Record<string, unknown> | null;
  job: Record<string, unknown>;
  summary: Record<string, unknown>;
};

async function prepareLogJob(input: Record<string, unknown>, ctx: Ctx): Promise<LogPlan | { error: string; candidates?: unknown }> {
  const name = clamp(input?.customer, 120);
  if (!name) return { error: "Whose racket is it? Give the customer's name." };
  const customers = await clubCustomers(ctx);
  let customer: Customer | null = null;
  let newCustomer: Record<string, unknown> | null = null;
  const f = findCustomer(customers, name);
  if ('customer' in f) customer = f.customer;
  else if (f.candidates) return f;
  else if (input?.create_customer === true) {
    const email = clamp(input?.customer_email, 200)?.toLowerCase() ?? null;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'That email does not look valid.' };
    newCustomer = {
      full_name: name,
      email,
      phone: clamp(input?.customer_phone, 40),
      user_id: ctx.userId,
      club_id: ctx.clubId,
    };
  } else {
    return { error: `No stringing customer named "${name}" here. If they are new, confirm with the director and pass create_customer:true (with their email if known).` };
  }

  // Last job for this customer — the "same as last time" prefill the New Job screen does.
  let last: Job | null = null;
  if (customer) {
    const { data } = await ctx.db
      .from('stringing_jobs')
      .select(JOB_COLS)
      .eq('customer_id', customer.id)
      .neq('status', 'cancelled')
      .order('created_at', { ascending: false })
      .limit(1);
    last = ((data as unknown as Job[]) ?? [])[0] ?? null;
  }

  const catalog = await clubCatalog(ctx);
  let stringId: string | null = null;
  let customString: string | null = null;
  let stringSource = 'given';
  const wanted = clamp(input?.string, 120);
  if (wanted) {
    const w = norm(wanted);
    const hits = catalog.filter((c) => {
      const full = norm(`${c.brand} ${c.name}`);
      const nm = norm(c.name);
      return full === w || nm === w || full.includes(w) || (nm.length >= 3 && w.includes(nm));
    });
    if (hits.length === 1) stringId = hits[0].id;
    else if (hits.length > 1) {
      const exact = hits.filter((c) => norm(c.name) === w || norm(`${c.brand} ${c.name}`) === w);
      if (exact.length === 1) stringId = exact[0].id;
      else return { error: `"${wanted}" matches ${hits.length} strings in the catalog — which one?`, candidates: hits.map((c) => `${c.brand} ${c.name}${c.gauge ? ` ${c.gauge}` : ''}`) };
    } else {
      customString = wanted;
      stringSource = 'not in the catalog — saved as a typed-in string name';
    }
  } else if (last) {
    stringId = last.string_id;
    customString = last.string_id ? null : last.custom_string_name;
    stringSource = `same as their last job (${localDay(last.created_at, ctx)})`;
  } else {
    return { error: `What string? ${name} has no earlier job to copy.` };
  }

  const tensionOf = (v: unknown) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) && n >= 30 && n <= 80 ? n : null;
  };
  let main = input?.main_tension != null ? tensionOf(input.main_tension) : null;
  let cross = input?.cross_tension != null ? tensionOf(input.cross_tension) : null;
  if (input?.main_tension != null && main == null) return { error: 'Tension should be pounds between 30 and 80.' };
  let tensionSource = 'given';
  if (main == null) {
    if (!last?.main_tension_lbs) return { error: 'What tension?' };
    main = last.main_tension_lbs;
    cross = last.cross_tension_lbs;
    tensionSource = 'same as their last job';
  }

  // Racket: a named one of theirs, else the one from last time.
  let racketId: string | null = null;
  let racketLabel: string | null = null;
  if (customer) {
    const { data: rk } = await ctx.db.from('stringing_rackets').select('id, brand, model').eq('customer_id', customer.id);
    const rackets = (rk as { id: string; brand: string | null; model: string | null }[]) ?? [];
    const lbl = (r: { brand: string | null; model: string | null }) => `${r.brand ?? ''} ${r.model ?? ''}`.trim();
    const want = clamp(input?.racket, 120);
    if (want) {
      const hits = rackets.filter((r) => norm(lbl(r)).includes(norm(want)) || (norm(r.model).length >= 3 && norm(want).includes(norm(r.model))));
      if (hits.length === 1) {
        racketId = hits[0].id;
        racketLabel = lbl(hits[0]);
      } else if (hits.length > 1) return { error: `Which racket?`, candidates: hits.map(lbl) };
      else racketLabel = `${want} (not on file — add it on the customer's page; job saved without a racket)`;
    } else if (last?.racket_id) {
      const r = rackets.find((x) => x.id === last!.racket_id);
      if (r) {
        racketId = r.id;
        racketLabel = `${lbl(r)} (from last time)`;
      }
    }
  }

  let readyIso: string | null = null;
  const rd = input?.ready_date;
  if (rd != null && rd !== '') {
    if (!isISODate(rd)) return { error: 'ready_date should be YYYY-MM-DD.' };
    const t = hhmm(clamp(input?.ready_time, 8)) ?? '17:00';
    readyIso = zonedWallTimeToIso(`${rd}T${t}`, ctx.timeZone);
  }

  const cat = stringId ? catalog.find((c) => c.id === stringId) : null;
  const job = {
    racket_id: racketId,
    string_id: stringId,
    custom_string_name: stringId ? null : customString,
    main_tension_lbs: main,
    cross_tension_lbs: cross ?? null,
    status: 'pending',
    requested_by_user_id: ctx.userId,
    quoted_ready_at: readyIso,
    internal_notes: clamp(input?.notes, 1000),
    stringer_name: clamp(input?.stringer_name, 80),
    customer_paid_at: input?.paid_at_dropoff === true ? new Date().toISOString() : null,
  };
  return {
    customer,
    newCustomer,
    job,
    summary: {
      customer: customer ? customer.full_name : `${name} (NEW customer${newCustomer?.email ? `, ${newCustomer.email}` : ', no email — no ready email possible'})`,
      racket: racketLabel ?? 'not specified',
      string: `${cat ? `${cat.brand} ${cat.name}` : customString} (${stringSource})`,
      tension: `${cross && cross !== main ? `${main}/${cross}` : main} lbs (${tensionSource})`,
      ready: readyIso ? `${rd} by ${hhmm(clamp(input?.ready_time, 8)) ?? '17:00'}` : 'no promised time',
      paid_at_dropoff: input?.paid_at_dropoff === true,
      not_done: 'No email is sent now. Nothing is charged.',
    },
  };
}

async function commitLogJob(plan: LogPlan, ctx: Ctx): Promise<ToolResult> {
  let customerId = plan.customer?.id;
  if (customerId == null) {
    const { data, error } = await ctx.db.from('stringing_customers').insert(plan.newCustomer!).select('id').maybeSingle();
    if (error || !data) return { ok: false, error: error?.message ?? 'Could not add the customer.' };
    customerId = (data as { id: string }).id;
  }
  const { data, error } = await ctx.db
    .from('stringing_jobs')
    .insert({ ...plan.job, customer_id: customerId })
    .select('id')
    .maybeSingle();
  if (error || !data) return { ok: false, error: error?.message ?? 'Could not save the job.' };
  return { ok: true, job_id: (data as { id: string }).id, customer_id: customerId };
}

type StatusPlan = { job: Job; patch: Record<string, unknown>; summary: Record<string, unknown> };

async function prepareJobStatus(input: Record<string, unknown>, ctx: Ctx): Promise<StatusPlan | { error: string; candidates?: unknown }> {
  const to = String(input?.status ?? '');
  if (!['in_progress', 'done', 'picked_up'].includes(to)) return { error: 'status must be in_progress, done or picked_up.' };
  const { customers, jobs, label } = await jobContext(ctx);
  let job: Job | undefined;
  if (input?.job_id) {
    job = jobs.find((j) => j.id === String(input.job_id));
    if (!job) return { error: 'No stringing job with that id at this club.' };
  } else {
    const f = findCustomer(customers, input?.customer);
    if ('error' in f) return f;
    const order = to === 'picked_up' ? ['done', 'in_progress', 'pending'] : ['in_progress', 'pending'];
    const mine = jobs.filter((j) => String(j.customer_id) === String(f.customer.id) && order.includes(j.status));
    if (!mine.length) return { error: `${f.customer.full_name} has no racket in the shop that can be marked ${to.replace('_', ' ')}.` };
    if (mine.length > 1) return { error: `${f.customer.full_name} has ${mine.length} rackets in the shop — which one?`, candidates: mine.map(label) };
    job = mine[0];
  }
  if (job.status === to) return { error: `That job is already ${to.replace('_', ' ')}.` };
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { status: to };
  if (to === 'done') patch.completed_at = now;
  if (to === 'picked_up') patch.picked_up_at = now;
  return {
    job,
    patch,
    summary: {
      job: label(job),
      change: `${job.status.replace('_', ' ')} → ${to.replace('_', ' ')}`,
      not_done:
        to === 'done'
          ? 'No email is sent by this. Use email_ready_rackets to tell them it is ready.'
          : 'No email is sent.',
    },
  };
}

type PaidPlan = { jobs: Job[]; field: 'customer_paid_at' | 'stringer_paid_at'; summary: Record<string, unknown> };

async function preparePaid(input: Record<string, unknown>, ctx: Ctx): Promise<PaidPlan | { error: string; candidates?: unknown }> {
  const who = input?.who === 'stringer' ? 'stringer' : input?.who === 'customer' ? 'customer' : null;
  if (!who) return { error: "who must be 'customer' (the customer paid for the job) or 'stringer' (we paid the stringer)." };
  const field = who === 'customer' ? 'customer_paid_at' : 'stringer_paid_at';
  const { customers, jobs, label } = await jobContext(ctx);
  let pick = jobs.filter((j) => !j[field]);

  const ids = Array.isArray(input?.job_ids) ? (input.job_ids as unknown[]).map(String) : null;
  const month = input?.month ? String(input.month) : null;
  if (month && !YM.test(month)) return { error: 'month should look like 2026-07.' };
  if (!ids && !month && !input?.customer && !input?.stringer_name) {
    return { error: 'Say which jobs: a month (dropped off that month), a customer, a stringer, or job ids.' };
  }
  if (ids) {
    const unknown = ids.filter((id) => !jobs.some((j) => j.id === id));
    if (unknown.length) return { error: `Not stringing jobs at this club: ${unknown.join(', ')}` };
    pick = pick.filter((j) => ids.includes(j.id));
  }
  if (month) pick = pick.filter((j) => localDay(j.created_at, ctx)?.slice(0, 7) === month);
  if (input?.customer) {
    const f = findCustomer(customers, input.customer);
    if ('error' in f) return f;
    pick = pick.filter((j) => String(j.customer_id) === String(f.customer.id));
  }
  if (input?.stringer_name) {
    const s = String(input.stringer_name).trim().toLowerCase();
    pick = pick.filter((j) => (j.stringer_name ?? '').trim().toLowerCase() === s);
  }
  // Stringers are paid for finished work only — the Jobs screen's "still to pay the stringer" count.
  if (who === 'stringer') pick = pick.filter((j) => (j.status === 'done' || j.status === 'picked_up') && j.stringer_name);
  if (!pick.length) return { error: `No matching jobs are still unpaid${who === 'stringer' ? ' to the stringer' : ''}.` };

  const byStringer = new Map<string, number>();
  if (who === 'stringer') for (const j of pick) byStringer.set(j.stringer_name!, (byStringer.get(j.stringer_name!) ?? 0) + 1);
  return {
    jobs: pick,
    field,
    summary: {
      marking: who === 'customer' ? 'customer paid' : 'stringer paid',
      count: pick.length,
      jobs: pick.map(label),
      ...(who === 'stringer' ? { by_stringer: Object.fromEntries(byStringer) } : {}),
      not_done: 'A bookkeeping tick only — no card is charged and no money moves.',
    },
  };
}

// --------------------------------------------------------------- stringing sends

async function directorEmail(ctx: Ctx): Promise<string | null> {
  try {
    const { data } = await (ctx.db as any).auth.admin.getUserById(ctx.userId);
    return data?.user?.email ?? null;
  } catch {
    return null;
  }
}

type ReadyPlan = { data: CampaignData; summary: Record<string, unknown> };

/**
 * Who gets "your racket's ready" — the Jobs screen's "Tell them it's ready"
 * campaign, but with the recipient list built from THIS club's customers
 * (that source is keyed to whoever is signed in, not the club).
 */
async function prepareReady(input: Record<string, unknown>, ctx: Ctx): Promise<ReadyPlan | { error: string; candidates?: unknown }> {
  const { customers, jobs, catalog } = await jobContext(ctx);
  let ready = jobs.filter((j) => j.status === 'done' && !j.picked_up_at);
  if (input?.customer) {
    const f = findCustomer(customers, input.customer);
    if ('error' in f) return f;
    ready = ready.filter((j) => String(j.customer_id) === String(f.customer.id));
  }
  const byId = new Map(customers.map((c) => [String(c.id), c]));
  const noEmail: string[] = [];
  const nudge: NudgePerson[] = [];
  for (const j of ready) {
    const c = byId.get(String(j.customer_id))!;
    if (!c.email) {
      noEmail.push(c.full_name);
      continue;
    }
    const cat = j.string_id ? catalog.find((s) => s.id === j.string_id) : null;
    const stringName = cat ? `${cat.brand} ${cat.name}` : j.custom_string_name || '';
    nudge.push({
      email: c.email,
      firstName: (c.full_name || '').trim().split(/\s+/)[0] || 'there',
      played: null,
      target: null,
      outstanding: [{ label: 'Your racket is strung and ready for pickup 🎾', sub: stringName ? `Strung with ${stringName}` : undefined, contact: '' }],
    });
  }
  if (!nudge.length) {
    return { error: noEmail.length ? `Rackets are ready for ${noEmail.join(', ')}, but none of them has an email on file.` : 'No rackets are waiting for pickup.' };
  }
  const email = await directorEmail(ctx);
  const src = await stringingCampaign({ id: ctx.userId, email });
  if (!src.ok) return { error: src.error };
  const data: CampaignData = { ...src.data, ownerId: ctx.userId, clubName: ctx.clubName, nudge, stats: [{ label: 'Ready for pickup', value: `${nudge.length}` }] };
  const pv = await runCampaign(data, 'nudge', 'preview');
  const names = new Map(customers.filter((c) => c.email).map((c) => [c.email!.toLowerCase(), c.full_name]));
  return {
    data,
    summary: {
      email: 'Your racket is ready for pickup (the StringingMode pickup email)',
      subject: pv.mode === 'preview' ? pv.subject : undefined,
      recipients: nudge.map((n) => `${names.get(n.email.toLowerCase()) ?? n.firstName} <${n.email}>`),
      count: nudge.length,
      skipped_no_email: noEmail,
      from: ctx.clubName,
    },
  };
}

type RestringPlan = { data: CampaignData; summary: Record<string, unknown> };

async function prepareRestring(input: Record<string, unknown>, ctx: Ctx): Promise<RestringPlan | { error: string; candidates?: unknown }> {
  const customers = await clubCustomers(ctx);
  const f = findCustomer(customers, input?.customer);
  if ('error' in f) return f;
  const c = f.customer;
  if (!c.email) return { error: `${c.full_name} has no email on file.` };
  if (!c.user_id) return { error: `${c.full_name}'s record has no StringingMode owner, so the nudge cannot be built. Send it from their customer page.` };
  const email = await directorEmail(ctx);
  // The same source the customer page's Nudge button uses; it reads their last job.
  const src = await stringingRestringCampaign(String(c.id), { id: c.user_id, email });
  if (!src.ok) return { error: src.error };
  if (!src.data.nudge.length) {
    return { error: `${c.full_name} has a racket in the shop right now, or has never had one strung here — no re-string nudge to send.` };
  }
  const data: CampaignData = { ...src.data, ownerId: ctx.userId, clubName: ctx.clubName };
  const pv = await runCampaign(data, 'nudge', 'preview');
  return {
    data,
    summary: {
      email: 'Re-string reminder',
      to: `${c.full_name} <${c.email}>`,
      subject: pv.mode === 'preview' ? pv.subject : undefined,
      says: src.data.nudge[0].outstanding.map((o) => [o.label, o.sub].filter(Boolean).join(' — ')),
      from: ctx.clubName,
    },
  };
}

async function sendCampaign(plan: { data: CampaignData }): Promise<ToolResult> {
  const r = await runCampaign(plan.data, 'nudge', 'live');
  if (r.mode !== 'live') return { ok: false, error: 'Unexpected send result.' };
  if (r.creditLimited) return { ok: false, error: `Email credit limit reached after ${r.sent} of ${r.attempted}.`, sent: r.sent, failures: r.failures };
  return { ok: r.sent > 0, sent: r.sent, attempted: r.attempted, failures: r.failures };
}

// --------------------------------------------------------------- maintenance

async function maintenanceBoard(_input: Record<string, unknown>, ctx: Ctx): Promise<ToolResult> {
  const now = new Date();
  const day = clubToday(now, ctx.timeZone);
  const b = await loadBoardData(ctx.db as never, ctx.clubId, day, clubNowHHMM(now, ctx.timeZone));
  return {
    ok: true,
    today: day,
    open_work_orders: b.tasks.map((t) => ({
      id: t.id,
      title: t.title,
      priority: t.priority,
      status: t.status,
      location: t.location,
      department: t.department,
      due: t.due_date,
      overdue: !!t.due_date && t.due_date < day,
      posted: localDay(t.created_at, ctx),
    })),
    done_last_24h: b.recentDone.map((t) => t.title),
    projects: b.projects.map((p) => ({ id: p.id, title: p.title, status: p.status, pct: p.pct, next: p.next, target: p.target_date, stalled: p.stalled })),
    todays_checklist: b.checklist.map((r) => ({ id: r.item.id, item: r.item.title, by: r.item.target_time ? hhmm(r.item.target_time) : 'anytime', state: r.state })),
    missed_yesterday: b.missedYesterday.map((i) => i.title),
  };
}

type TaskPlan = { row: Record<string, unknown>; summary: Record<string, unknown> };

async function prepareWorkOrder(input: Record<string, unknown>, ctx: Ctx): Promise<TaskPlan | { error: string }> {
  const title = clamp(input?.title, 200);
  if (!title) return { error: 'What needs doing? Give it a title.' };
  const department = input?.department ?? 'tennis';
  if (!isDepartment(department)) return { error: `department must be one of ${DEPARTMENTS.join(', ')}.` };
  const priority = input?.priority ?? 'normal';
  if (!isPriority(priority)) return { error: `priority must be one of ${PRIORITIES.join(', ')}.` };
  const due = input?.due_date ? String(input.due_date) : null;
  if (due && !isISODate(due)) return { error: 'due_date should be YYYY-MM-DD.' };
  const row = {
    club_id: ctx.clubId,
    title,
    description: clamp(input?.description, 2000),
    department,
    location: clamp(input?.location, 120),
    priority,
    due_date: due,
    created_by: ctx.userId,
  };
  return { row, summary: { work_order: title, priority, department, location: row.location, due: due ?? 'no due date', description: row.description } };
}

type UpdatePlan =
  | { kind: 'task'; task: Task; patch: Record<string, unknown>; summary: Record<string, unknown> }
  | { kind: 'project'; project: { id: string; title: string; status: string }; patch: Record<string, unknown>; summary: Record<string, unknown> };

async function prepareUpdateWork(input: Record<string, unknown>, ctx: Ctx): Promise<UpdatePlan | { error: string; candidates?: unknown }> {
  const to = String(input?.status ?? 'done') as TaskStatus;
  if (!['open', 'in_progress', 'done', 'cancelled'].includes(to)) return { error: 'status must be done, in_progress, open or cancelled.' };
  const key = String(input?.item ?? '').trim();
  if (!key) return { error: 'Which work order?' };
  const k = key.toLowerCase();

  const { data } = await ctx.db.from('maint_tasks').select(TASK_COLS).eq('club_id', ctx.clubId);
  const tasks = (data as unknown as Task[]) ?? [];
  let hits = tasks.filter((t) => t.id === key);
  if (!hits.length) {
    const pool = to === 'open' ? tasks.filter((t) => t.status === 'done' || t.status === 'cancelled') : tasks.filter((t) => t.status === 'open' || t.status === 'in_progress');
    const exact = pool.filter((t) => t.title.toLowerCase() === k);
    hits = exact.length ? exact : pool.filter((t) => t.title.toLowerCase().includes(k) || (t.location ?? '').toLowerCase().includes(k));
  }
  if (hits.length > 1) return { error: `"${key}" matches ${hits.length} work orders — which one?`, candidates: hits.map((t) => ({ id: t.id, title: t.title, status: t.status, location: t.location })) };
  if (hits.length === 1) {
    const task = hits[0];
    if (task.status === to) return { error: `"${task.title}" is already ${to.replace('_', ' ')}.` };
    if (!canTransition(task.status, to)) return { error: `Can't go from ${task.status} to ${to}.` };
    if (to === 'cancelled' && !canEditTask({ userId: ctx.userId, canManage: MAINT_MANAGERS.has(ctx.role) }, task)) {
      return { error: 'Only whoever posted it, or an owner/director, can cancel a work order.' };
    }
    const patch = statusPatch(to, ctx.userId, new Date().toISOString());
    if (to === 'done') patch.completion_note = clamp(input?.note, 1000);
    return { kind: 'task', task, patch, summary: { work_order: task.title, change: `${task.status.replace('_', ' ')} → ${to.replace('_', ' ')}`, note: patch.completion_note ?? null } };
  }

  // Not a work order — maybe a project ("mark the windscreen job done").
  const { data: pd } = await ctx.db.from('maint_projects').select('id, title, status').eq('club_id', ctx.clubId);
  const projects = ((pd as { id: string; title: string; status: string }[]) ?? []).filter(
    (p) => p.id === key || p.title.toLowerCase().includes(k),
  );
  if (!projects.length) return { error: `No work order or project at ${ctx.clubName} matches "${key}". Use maintenance_board to see what is open.` };
  if (projects.length > 1) return { error: `"${key}" matches ${projects.length} projects — which one?`, candidates: projects };
  if (!MAINT_MANAGERS.has(ctx.role)) return { error: 'Projects are changed by an owner or director.' };
  const p = projects[0];
  const pStatus = to === 'done' ? 'done' : to === 'in_progress' || to === 'open' ? 'active' : null;
  if (!pStatus) return { error: 'A project can be marked done or active, not cancelled. Put it on hold on the Maintenance screen.' };
  if (p.status === pStatus) return { error: `"${p.title}" is already ${pStatus}.` };
  return {
    kind: 'project',
    project: p,
    patch: { status: pStatus, completed_at: pStatus === 'done' ? new Date().toISOString() : null },
    summary: { project: p.title, change: `${p.status} → ${pStatus}` },
  };
}

type ChecklistPlan = { row: Record<string, unknown>; summary: Record<string, unknown> };

async function prepareChecklist(input: Record<string, unknown>, ctx: Ctx): Promise<ChecklistPlan | { error: string }> {
  const body: Record<string, unknown> = {
    title: input?.title,
    department: input?.department ?? 'tennis',
    days_of_week: input?.days_of_week,
  };
  if (input?.notes != null) body.notes = input.notes;
  if (input?.location != null) body.location = input.location;
  if (input?.target_time != null) body.target_time = input.target_time;
  const v = routineFields(body, false);
  if ('error' in v) return { error: v.error };
  const { data: existing } = await ctx.db
    .from('maint_routine_items')
    .select(ITEM_COLS)
    .eq('club_id', ctx.clubId)
    .is('archived_on', null)
    .order('sort_order');
  const items = (existing as { title: string; sort_order: number }[]) ?? [];
  const title = String(v.patch.title);
  if (items.some((i) => i.title.trim().toLowerCase() === title.toLowerCase())) return { error: `"${title}" is already on the daily checklist.` };
  const maxOrder = items.reduce((m, i) => Math.max(m, Number(i.sort_order) || 0), -1);
  const row = { ...v.patch, sort_order: maxOrder + 1, club_id: ctx.clubId, active_from: today(ctx), created_by: ctx.userId };
  return {
    row,
    summary: {
      checklist_item: title,
      days: describeDays(v.patch.days_of_week as number[]),
      by: v.patch.target_time ?? 'anytime',
      starts: today(ctx),
      location: v.patch.location ?? null,
    },
  };
}

// --------------------------------------------------------------- schemas

const T_BOARD: Anthropic.Messages.Tool = {
  name: 'board_report_numbers',
  description:
    'How the club is doing for a month: revenue recorded in ClubMode (classes, court bookings, event entries), new class sign-ups, court bookings, utilization, events, membership, NPS, what is still owed — plus the previous month to compare. Use for "how are we doing", "bullets for the board meeting". Write the bullets yourself from these numbers.',
  input_schema: { type: 'object', properties: { month: { type: 'string', description: 'YYYY-MM; default this month (to date).' } } },
};
const T_OWES: Anthropic.Messages.Tool = {
  name: 'who_still_owes',
  description: 'Unpaid class sign-ups and court bookings with amounts, grouped by who pays (the Getting paid list). Read only.',
  input_schema: { type: 'object', properties: {} },
};
const T_UTIL: Anthropic.Messages.Tool = {
  name: 'court_utilization_by_month',
  description: 'Court utilization % per month from court reservations.',
  input_schema: { type: 'object', properties: { months: { type: 'number', description: 'How many months back, including this one (default 6, max 24).' } } },
};
const T_BROUGHT: Anthropic.Messages.Tool = {
  name: 'revenue_for_class_or_event',
  description: 'How much one class or event brought in (payments recorded in ClubMode), plus what is still owed on it.',
  input_schema: { type: 'object', properties: { name: { type: 'string', description: 'Class or event name (or id).' } }, required: ['name'] },
};
const T_QUEUE: Anthropic.Messages.Tool = {
  name: 'stringing_queue',
  description: 'StringingMode: rackets ready for pickup, overdue vs promised time, in the shop, unpaid counts. Optional customer filter.',
  input_schema: { type: 'object', properties: { customer: { type: 'string' } } },
};
const T_LOG: Anthropic.Messages.Tool = {
  name: 'log_stringing_job',
  description:
    'Log a new stringing job. String and tension default to the customer\'s last job ("same as last time"). Turn "Thursday" into ready_date YYYY-MM-DD yourself.',
  input_schema: {
    type: 'object',
    properties: {
      customer: { type: 'string', description: 'Customer name or id.' },
      string: { type: 'string', description: 'String name, e.g. "NRG2". Omit to reuse last job\'s.' },
      main_tension: { type: 'number', description: 'lbs' },
      cross_tension: { type: 'number', description: 'lbs, only if different from mains' },
      racket: { type: 'string', description: 'Which of their rackets, if they have several.' },
      ready_date: { type: 'string', description: 'YYYY-MM-DD promised ready date' },
      ready_time: { type: 'string', description: 'HH:MM, default 17:00' },
      stringer_name: { type: 'string' },
      notes: { type: 'string' },
      paid_at_dropoff: { type: 'boolean' },
      create_customer: { type: 'boolean', description: 'true only when the director confirms this is a new customer.' },
      customer_email: { type: 'string' },
      customer_phone: { type: 'string' },
    },
    required: ['customer'],
  },
};
const T_STATUS: Anthropic.Messages.Tool = {
  name: 'set_stringing_job_status',
  description: 'Move a stringing job to in_progress, done (strung) or picked_up. Sends nothing.',
  input_schema: {
    type: 'object',
    properties: {
      customer: { type: 'string' },
      job_id: { type: 'string' },
      status: { type: 'string', enum: ['in_progress', 'done', 'picked_up'] },
    },
    required: ['status'],
  },
};
const T_PAID: Anthropic.Messages.Tool = {
  name: 'mark_stringing_jobs_paid',
  description:
    'Tick stringing jobs as paid: who="customer" (customer paid us) or who="stringer" (we paid the stringer, finished jobs only). Filter by month (dropped off that month), customer, stringer_name or job_ids. Bookkeeping only.',
  input_schema: {
    type: 'object',
    properties: {
      who: { type: 'string', enum: ['customer', 'stringer'] },
      month: { type: 'string', description: 'YYYY-MM' },
      customer: { type: 'string' },
      stringer_name: { type: 'string' },
      job_ids: { type: 'array', items: { type: 'string' } },
    },
    required: ['who'],
  },
};
const T_READY: Anthropic.Messages.Tool = {
  name: 'email_ready_rackets',
  description: 'SEND the "your racket is ready for pickup" email to every customer whose racket is done and not picked up (or one customer). Preview lists recipients.',
  input_schema: { type: 'object', properties: { customer: { type: 'string', description: 'Only this customer.' } } },
};
const T_RESTRING: Anthropic.Messages.Tool = {
  name: 'nudge_restring',
  description: 'SEND one customer the re-string reminder email (days since their last job, their usual string). Preview first.',
  input_schema: { type: 'object', properties: { customer: { type: 'string' } }, required: ['customer'] },
};
const T_MBOARD: Anthropic.Messages.Tool = {
  name: 'maintenance_board',
  description: 'MaintenanceMode: open work orders (urgent first, overdue flagged), projects, today\'s checklist, what was missed yesterday.',
  input_schema: { type: 'object', properties: {} },
};
const T_WO: Anthropic.Messages.Tool = {
  name: 'add_work_order',
  description: 'Post a maintenance work order.',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'e.g. "Court 6 net crank broken"' },
      description: { type: 'string' },
      location: { type: 'string', description: 'e.g. "Court 6"' },
      priority: { type: 'string', enum: [...PRIORITIES] },
      department: { type: 'string', enum: [...DEPARTMENTS], description: 'default tennis' },
      due_date: { type: 'string', description: 'YYYY-MM-DD' },
    },
    required: ['title'],
  },
};
const T_UPD: Anthropic.Messages.Tool = {
  name: 'update_work_order',
  description: 'Mark a work order (or project) done, in progress, reopened or cancelled. Finds it by title words or id.',
  input_schema: {
    type: 'object',
    properties: {
      item: { type: 'string', description: 'Work order/project title words or id, e.g. "windscreen".' },
      status: { type: 'string', enum: ['done', 'in_progress', 'open', 'cancelled'], description: 'default done' },
      note: { type: 'string', description: 'Completion note.' },
    },
    required: ['item'],
  },
};
const T_CHECK: Anthropic.Messages.Tool = {
  name: 'add_checklist_item',
  description: 'Add a recurring item to the daily maintenance checklist (owner/director).',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      days_of_week: { type: 'array', items: { type: 'number' }, description: '0=Sun..6=Sat; omit for every day' },
      target_time: { type: 'string', description: 'HH:MM to be done by; omit for anytime' },
      location: { type: 'string' },
      department: { type: 'string', enum: [...DEPARTMENTS] },
      notes: { type: 'string' },
    },
    required: ['title'],
  },
};

// --------------------------------------------------------------- tool table

/** A destructive tool whose preview and run share one prepare(). */
function writeTool<P extends { summary: Record<string, unknown> }>(
  schema: Anthropic.Messages.Tool,
  roles: Set<string>,
  what: string,
  prepare: (input: Record<string, unknown>, ctx: Ctx) => Promise<P | { error: string; candidates?: unknown }>,
  commit: (plan: P, ctx: Ctx) => Promise<ToolResult>,
): ToolDef<Ctx> {
  return {
    schema,
    destructive: true,
    async preview(input, ctx) {
      const d = deny(ctx, roles, what);
      if (d) return d;
      const plan = await prepare(input ?? {}, ctx);
      if ('error' in plan) return { ok: false, ...plan };
      return { ok: true, will: plan.summary };
    },
    async run(input, ctx) {
      const d = deny(ctx, roles, what);
      if (d) return d;
      const plan = await prepare(input ?? {}, ctx);
      if ('error' in plan) return { ok: false, ...plan };
      const done = await commit(plan, ctx);
      return done.ok ? { ...done, did: plan.summary } : { ...done, plan: plan.summary };
    },
  };
}

function readTool(schema: Anthropic.Messages.Tool, roles: Set<string>, what: string, fn: (i: Record<string, unknown>, c: Ctx) => Promise<ToolResult>): ToolDef<Ctx> {
  return {
    schema,
    run: async (i, c) => deny(c, roles, what) ?? fn(i ?? {}, c),
  };
}

const tools: ToolDef<Ctx>[] = [
  readTool(T_BOARD, MANAGER_ROLES, 'see club finances', boardNumbers),
  readTool(T_OWES, MANAGER_ROLES, 'see who owes money', whoOwes),
  readTool(T_UTIL, STAFF, 'see court utilization', utilizationByMonth),
  readTool(T_BROUGHT, MANAGER_ROLES, 'see revenue', broughtIn),
  readTool(T_QUEUE, STAFF, 'see the stringing queue', stringingQueue),
  readTool(T_MBOARD, MAINT_ACCESS, 'see the maintenance board', maintenanceBoard),

  writeTool<LogPlan>(T_LOG, STAFF, 'log stringing jobs', prepareLogJob, commitLogJob),

  writeTool<StatusPlan>(T_STATUS, STAFF, 'update stringing jobs', prepareJobStatus, async (plan, ctx) => {
    const { error } = await ctx.db.from('stringing_jobs').update(plan.patch).eq('id', plan.job.id).eq('customer_id', plan.job.customer_id);
    return error ? { ok: false, error: error.message } : { ok: true, job_id: plan.job.id, status: plan.patch.status };
  }),

  writeTool<PaidPlan>(T_PAID, MANAGER_ROLES, 'mark stringing jobs paid', preparePaid, async (plan, ctx) => {
    const now = new Date().toISOString();
    let n = 0;
    for (const j of plan.jobs) {
      const { error } = await ctx.db.from('stringing_jobs').update({ [plan.field]: now }).eq('id', j.id).eq('customer_id', j.customer_id);
      if (error) return { ok: false, error: error.message, marked_before_error: n };
      n++;
    }
    return { ok: true, marked: n };
  }),

  writeTool<ReadyPlan>(T_READY, MANAGER_ROLES, 'email customers', prepareReady, (plan) => sendCampaign(plan)),
  writeTool<RestringPlan>(T_RESTRING, MANAGER_ROLES, 'email customers', prepareRestring, (plan) => sendCampaign(plan)),

  writeTool<TaskPlan>(T_WO, MAINT_ACCESS, 'post work orders', prepareWorkOrder, async (plan, ctx) => {
    const { data, error } = await ctx.db.from('maint_tasks').insert(plan.row).select('id').maybeSingle();
    if (error || !data) return { ok: false, error: error?.message ?? 'Could not save.' };
    return { ok: true, id: (data as { id: string }).id };
  }),

  writeTool<UpdatePlan>(T_UPD, MAINT_ACCESS, 'update work orders', prepareUpdateWork, async (plan, ctx) => {
    const now = new Date().toISOString();
    const q =
      plan.kind === 'task'
        ? ctx.db.from('maint_tasks').update({ ...plan.patch, updated_at: now }).eq('id', plan.task.id).eq('club_id', ctx.clubId)
        : ctx.db.from('maint_projects').update({ ...plan.patch, updated_at: now }).eq('id', plan.project.id).eq('club_id', ctx.clubId);
    const { error } = await q;
    return error ? { ok: false, error: error.message } : { ok: true };
  }),

  writeTool<ChecklistPlan>(T_CHECK, MANAGER_ROLES, 'change the daily checklist', prepareChecklist, async (plan, ctx) => {
    const { data, error } = await ctx.db.from('maint_routine_items').insert(plan.row).select('id').maybeSingle();
    if (error || !data) return { ok: false, error: error?.message ?? 'Could not save.' };
    return { ok: true, id: (data as { id: string }).id };
  }),
];

// -------------------------------------------------------------------- export

export const opsPack: DomainPack<Ctx> = {
  domain: 'ops',

  actionsPrompt: `
OPS — reports, stringing, maintenance.

Reports (owner/director): board_report_numbers (month numbers + previous month; YOU write the 4–5 bullets, plain and
specific, comparing to last month), who_still_owes, revenue_for_class_or_event; court_utilization_by_month (staff).
Revenue is only what was recorded in ClubMode — say so if asked about totals; never invent numbers for missing sections.

Stringing: stringing_queue (ready / overdue / in shop), log_stringing_job (string + tension default to their last job;
resolve "Thursday" to YYYY-MM-DD), set_stringing_job_status, mark_stringing_jobs_paid (bookkeeping tick, no charge),
email_ready_rackets and nudge_restring (these SEND email).
Maintenance: maintenance_board (what's open), add_work_order, update_work_order (done/in progress/cancel; also
finishes a project), add_checklist_item (owner/director).

Every write and send previews first: relay the specifics (who, how many, recipients) and wait for a clear yes before
calling again with confirm:true. If a name matches several, ask. Relay ok:false reasons plainly.
You CANNOT charge cards, refund, issue credits, or read QuickBooks/Captyn/bank data.
`.trim(),

  async resolve(userId) {
    return resolveClubCtx(userId);
  },

  tools,
};

// exported for tests
export { monthBounds, prevMonth };
