import type Anthropic from '@anthropic-ai/sdk';
import type { DomainPack, ToolDef, ToolResult } from '../framework';
import { resolveClubCtx, MANAGER_ROLES, type ClubCtx } from '../clubContext';
import {
  daysLabel,
  formatPrice,
  formatSessionDate,
  formatTimeRange,
  programSessions,
} from '@/lib/programs/sessions';
import { programPatchSchema, programWriteSchema, slugifyTitle } from '@/lib/programs/schema';
import {
  blockProgramCourts,
  clearProgramBlocks,
  describeBlockResult,
  resyncProgramBlocks,
  type BlockableProgram,
} from '@/lib/programs/courtBlocks';

/*
 * Programs pack — setting up and running the club's classes and clinics.
 *
 * Complements the club-site pack, which already lists classes, shows a roster,
 * sets skip dates and changes prices. This pack does the rest of a season's
 * admin: new clinics, the next session of an existing one, extending a run,
 * cancelling a meeting, fixing the copy, moving a student in or out, and the
 * read questions directors ask between those ("is it on Tuesday, who prepaid",
 * "what do we offer", "what should a 3.0 do on weekends").
 *
 * SAME RULES AS THE HAND PATH. Creates go through programWriteSchema, edits
 * through programPatchSchema plus the PATCH route's cross-field checks, courts
 * through courtBlocks — the code the Classes screen's routes use. A copy
 * mirrors the duplicate route field-for-field.
 *
 * WHAT IT DELIBERATELY CANNOT DO:
 *   - Publish. Every class it creates or copies is a DRAFT; going live is a
 *     click on the Classes screen.
 *   - Send anything. No confirmation, cancellation or waitlist email.
 *   - Touch money. No credits, refunds or "mark paid". A withdrawal leaves the
 *     payment record exactly as it was and says so.
 *   - Delete. Cancelling a whole class archives it; registrations are kept.
 *
 * Writes need an owner/director/platform role. Coaches get the reads.
 */

type Ctx = ClubCtx;

// --------------------------------------------------------------- utilities

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const addDays = (ymd: string, days: number): string => {
  // Midday UTC so a DST shift cannot roll the date backwards.
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

const dayDiff = (a: string, b: string): number =>
  Math.round((new Date(`${b}T12:00:00Z`).getTime() - new Date(`${a}T12:00:00Z`).getTime()) / 86_400_000);

const toCents = (dollars: unknown): number | undefined =>
  typeof dollars === 'number' && Number.isFinite(dollars) && dollars >= 0 ? Math.round(dollars * 100) : undefined;

const fmtDate = (d: string, ctx: Ctx) => formatSessionDate(d, ctx.timeZone, { weekday: true });

const todayIn = (tz: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(),
  );

function cleanDates(v: unknown): { ok: string[]; bad: string[] } {
  const arr = Array.isArray(v) ? v.map(String) : [];
  return { ok: [...new Set(arr.filter((d) => YMD.test(d)))].sort(), bad: arr.filter((d) => !YMD.test(d)) };
}

function cleanDays(v: unknown): number[] | null {
  if (!Array.isArray(v)) return null;
  return [...new Set(v.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b);
}

function canWrite(ctx: Ctx): ToolResult | null {
  if (MANAGER_ROLES.has(ctx.role)) return null;
  return {
    ok: false,
    error: `Your role here is "${ctx.role}", which can look but not change classes. An owner or director can make this change.`,
  };
}

const firstIssue = (e: { issues: { path: (string | number)[]; message: string }[] }) => {
  const i = e.issues[0];
  return `${i?.path?.join('.') || 'That'}: ${i?.message || 'not valid'}`;
};

// --------------------------------------------------------------- data access

type ProgramRow = Record<string, unknown> & {
  id: string;
  club_id: string;
  title: string;
  slug: string;
  status: string;
  range_start: string;
  range_end: string;
  days_of_week: number[] | null;
  exclusions: string[] | null;
  time_start: string;
  time_end: string;
  price_cents: number | null;
  member_price_cents: number | null;
  drop_in_price_cents: number | null;
  capacity: number | null;
  waitlist_enabled: boolean;
  blocks_courts: boolean;
  court_count: number | null;
  audience: string;
  level_note: string | null;
  coach_name: string | null;
  description: string | null;
};

type RegRow = {
  id: string;
  participant_name: string;
  parent_name: string | null;
  parent_email: string;
  status: string;
  payment_status: string;
  amount_cents: number | null;
  created_at?: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A class by id or by name, in THIS club only. Never guesses between two
 * matches — it returns them so the model can ask.
 */
async function findProgram(ctx: Ctx, ref: unknown): Promise<{ program: ProgramRow } | { error: string; candidates?: unknown }> {
  const key = String(ref ?? '').trim();
  if (!key) return { error: 'Which class? Give its name or id.' };

  if (UUID.test(key)) {
    const { data } = await ctx.db
      .from('club_programs')
      .select('*')
      .eq('id', key)
      .eq('club_id', ctx.clubId)
      .maybeSingle();
    if (data) return { program: data as ProgramRow };
  }

  const { data } = await ctx.db
    .from('club_programs')
    .select('*')
    .eq('club_id', ctx.clubId)
    .neq('status', 'archived')
    .order('range_start');
  const rows = (data as ProgramRow[] | null) ?? [];
  const k = key.toLowerCase();
  const exact = rows.filter((r) => r.title.toLowerCase() === k);
  const partial = exact.length ? exact : rows.filter((r) => r.title.toLowerCase().includes(k));
  if (partial.length === 1) return { program: partial[0] };
  if (partial.length === 0) return { error: `No class at ${ctx.clubName} matches "${key}". Use find_classes to see what exists.` };
  return {
    error: `"${key}" matches ${partial.length} classes. Ask the director which one, then pass its id.`,
    candidates: partial.map((p) => ({
      id: p.id,
      title: p.title,
      status: p.status,
      dates: `${formatSessionDate(p.range_start, ctx.timeZone)} – ${formatSessionDate(p.range_end, ctx.timeZone, { year: true })}`,
      when: `${daysLabel(p.days_of_week)} ${formatTimeRange(p.time_start, p.time_end)}`,
    })),
  };
}

async function liveRegistrations(ctx: Ctx, programId: string): Promise<RegRow[]> {
  const { data } = await ctx.db
    .from('club_program_registrations')
    .select('id, participant_name, parent_name, parent_email, status, payment_status, amount_cents, created_at')
    .eq('program_id', programId)
    .eq('club_id', ctx.clubId)
    .neq('status', 'cancelled')
    .order('created_at');
  return (data as RegRow[] | null) ?? [];
}

function rosterLines(regs: RegRow[]) {
  return regs.map((r) => ({
    name: r.participant_name,
    status: r.status,
    payment: r.payment_status,
    amount: r.amount_cents == null ? null : formatPrice(r.amount_cents),
  }));
}

/** Unique slug in this club, the same "-2, -3" rule the create route uses. */
async function freeSlug(ctx: Ctx, title: string): Promise<string> {
  const wanted = slugifyTitle(title);
  let slug = wanted;
  for (let n = 2; n < 50; n += 1) {
    const { data: clash } = await ctx.db
      .from('club_programs')
      .select('id')
      .eq('club_id', ctx.clubId)
      .eq('slug', slug)
      .maybeSingle();
    if (!clash) break;
    slug = `${wanted}-${n}`;
  }
  return slug;
}

/**
 * Where a run ends. Exactly one of range_end / weeks / meetings.
 *   weeks    — calendar weeks from the start, skips included in the span.
 *   meetings — the date of the Nth actual meeting after skips.
 */
function resolveEnd(
  input: Record<string, unknown>,
  start: string,
  days: number[],
  exclusions: string[],
  tz: string,
): { end: string } | { error: string } | null {
  if (typeof input.range_end === 'string' && input.range_end) {
    if (!YMD.test(input.range_end)) return { error: 'range_end must be YYYY-MM-DD.' };
    return { end: input.range_end };
  }
  const weeks = Number(input.weeks);
  if (input.weeks != null && Number.isFinite(weeks) && weeks > 0) {
    // Trimmed to the last actual meeting, so the stored run ends on a class day.
    const span = addDays(start, Math.round(weeks) * 7 - 1);
    const s = programSessions({ range_start: start, range_end: span, days_of_week: days, exclusions }, tz);
    return { end: s.dates[s.dates.length - 1] ?? span };
  }
  const meetings = Number(input.meetings);
  if (input.meetings != null && Number.isFinite(meetings) && meetings > 0) {
    const n = Math.round(meetings);
    const s = programSessions(
      { range_start: start, range_end: addDays(start, 3 * 365), days_of_week: days, exclusions },
      tz,
    );
    if (s.dates.length < n) return { error: `Could not fit ${n} meetings in three years.` };
    return { end: s.dates[n - 1] };
  }
  return null;
}

function scheduleSummary(p: Pick<ProgramRow, 'range_start' | 'range_end' | 'days_of_week' | 'exclusions' | 'time_start' | 'time_end'>, ctx: Ctx) {
  const s = programSessions(p, ctx.timeZone);
  return {
    when: `${daysLabel(p.days_of_week)}, ${formatTimeRange(p.time_start, p.time_end)}`,
    meetings: s.count,
    first_date: s.dates[0] ? fmtDate(s.dates[0], ctx) : null,
    last_date: s.dates.length ? fmtDate(s.dates[s.dates.length - 1], ctx) : null,
    dates: s.dates.map((d) => formatSessionDate(d, ctx.timeZone)),
    skipping: s.skipped.map((d) => fmtDate(d, ctx)),
  };
}

function priceSummary(p: Pick<ProgramRow, 'price_cents' | 'member_price_cents' | 'drop_in_price_cents'>) {
  return {
    season_price: formatPrice(p.price_cents),
    member_price: p.member_price_cents == null ? null : formatPrice(p.member_price_cents),
    drop_in_price: p.drop_in_price_cents == null ? null : formatPrice(p.drop_in_price_cents),
  };
}

// ---------------------------------------------------------------- schemas

const CLASS_REF = { type: 'string', description: 'The class id, or its name (an exact or unambiguous part of the title).' };

const T_ON_DATE: Anthropic.Messages.Tool = {
  name: 'class_on_date',
  description:
    'Is a class meeting on a given date, and who is signed up (with who has prepaid)? Without a class, lists every ' +
    'class meeting that day. "Prepaid" means a registration whose payment_status is paid — the app does not track ' +
    'individual drop-in visits.',
  input_schema: {
    type: 'object',
    properties: {
      date: { type: 'string', description: 'YYYY-MM-DD, club local.' },
      class: CLASS_REF,
    },
    required: ['date'],
  },
};

const T_OFFERINGS: Anthropic.Messages.Tool = {
  name: 'offerings_summary',
  description:
    "What the club offers and at what price: every current class (days, time, dates, season / member / drop-in price, " +
    'level, coach, spots left) plus private-lesson rate notes coaches have written. Returns a ready-to-paste text block ' +
    'for staff as well as the structured list.',
  input_schema: {
    type: 'object',
    properties: {
      include_drafts: { type: 'boolean', description: 'Include unpublished classes. Default false (what the public sees).' },
      include_past: { type: 'boolean', description: 'Include classes whose last date has passed. Default false.' },
    },
  },
};

const T_FIND: Anthropic.Messages.Tool = {
  name: 'find_classes',
  description:
    'Find classes that fit a player: by audience (adult / junior), NTRP-style level (e.g. 3.0), days (weekend, ' +
    'weekday, or specific days), and time of day. Use it for "what should I recommend for a 3.0 adult on weekends". ' +
    'Also the way to look up a class id by name. Only current and upcoming classes.',
  input_schema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Part of the class title.' },
      audience: { type: 'string', enum: ['adult', 'junior', 'family', 'all'] },
      level: { type: 'number', description: 'e.g. 3.0. Matched against the class level note.' },
      days: {
        type: 'string',
        enum: ['weekend', 'weekday', 'any'],
        description: 'Shortcut for days_of_week.',
      },
      days_of_week: { type: 'array', items: { type: 'number' }, description: '0=Sun..6=Sat.' },
      time_of_day: { type: 'string', enum: ['morning', 'afternoon', 'evening', 'any'] },
      include_drafts: { type: 'boolean', description: 'Default false.' },
    },
  },
};

const PRICE_PROPS = {
  price_dollars: { type: 'number', description: 'Season / full-session price.' },
  member_price_dollars: { type: 'number' },
  drop_in_price_dollars: { type: 'number', description: 'Per-visit drop-in price.' },
};

const END_PROPS = {
  range_end: { type: 'string', description: 'Last date, YYYY-MM-DD. Give this OR weeks OR meetings.' },
  weeks: { type: 'number', description: 'Calendar weeks from the start ("10 weeks").' },
  meetings: { type: 'number', description: 'Number of actual meetings after skips ("10 sessions").' },
};

const T_CREATE: Anthropic.Messages.Tool = {
  name: 'create_class',
  description:
    'Set up a NEW class or clinic as an unpublished DRAFT, and optionally hold courts for every meeting. ' +
    'The director publishes it on the Classes screen. Prices in dollars.',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      days_of_week: { type: 'array', items: { type: 'number' }, description: '0=Sun..6=Sat.' },
      time_start: { type: 'string', description: 'HH:MM 24-hour.' },
      time_end: { type: 'string', description: 'HH:MM 24-hour.' },
      range_start: { type: 'string', description: 'First date, YYYY-MM-DD.' },
      ...END_PROPS,
      skip_dates: { type: 'array', items: { type: 'string' }, description: 'YYYY-MM-DD dates it does not meet.' },
      ...PRICE_PROPS,
      price_note: { type: 'string', description: 'e.g. "Season price covers 10 weeks".' },
      capacity: { type: 'number' },
      court_count: { type: 'number', description: 'How many courts to hold on the court sheet. Omit to hold none.' },
      coach_name: { type: 'string' },
      description: { type: 'string' },
      subtitle: { type: 'string' },
      level_note: { type: 'string', description: 'e.g. "NTRP 3.0–3.5".' },
      audience: { type: 'string', enum: ['junior', 'adult', 'family', 'all'] },
      sport: { type: 'string', enum: ['tennis', 'pickleball', 'padel', 'swim', 'fitness', 'other'] },
      age_min: { type: 'number' },
      age_max: { type: 'number' },
      location_note: { type: 'string' },
    },
    required: ['title', 'days_of_week', 'time_start', 'time_end', 'range_start'],
  },
};

const T_COPY: Anthropic.Messages.Tool = {
  name: 'copy_class_to_new_session',
  description:
    "Create the next session of an existing class: same details, new dates, new skip dates, optionally new prices. " +
    'The copy is a DRAFT with nobody enrolled; last session\'s skip dates are NOT carried over.',
  input_schema: {
    type: 'object',
    properties: {
      class: CLASS_REF,
      range_start: { type: 'string', description: 'First date of the new session, YYYY-MM-DD.' },
      ...END_PROPS,
      skip_dates: { type: 'array', items: { type: 'string' }, description: 'YYYY-MM-DD.' },
      title: { type: 'string', description: 'New title. Defaults to the same title.' },
      ...PRICE_PROPS,
      hold_courts: {
        type: 'boolean',
        description: 'Hold courts for the new session, using the old class\'s court count. Default: only if the old class held courts.',
      },
    },
    required: ['class', 'range_start'],
  },
};

const T_EXTEND: Anthropic.Messages.Tool = {
  name: 'extend_class',
  description:
    'Move the last date of a class later (or earlier) — "extend it through Dec 15". Rebuilds court holds if the class holds courts.',
  input_schema: {
    type: 'object',
    properties: {
      class: CLASS_REF,
      new_end: { type: 'string', description: 'New last date, YYYY-MM-DD.' },
      add_meetings: { type: 'number', description: 'Alternatively, add this many meetings after the current end.' },
      skip_dates: { type: 'array', items: { type: 'string' }, description: 'Extra YYYY-MM-DD dates to skip within the new stretch.' },
    },
    required: ['class'],
  },
};

const T_CANCEL_MEETING: Anthropic.Messages.Tool = {
  name: 'cancel_class_meeting',
  description:
    'Cancel ONE meeting of a class (rain, holiday, coach out): the date becomes a skip date, its court hold is ' +
    'released, and you get the list of who is registered so the director knows who is affected. Issues no ' +
    'credits or refunds and emails nobody.',
  input_schema: {
    type: 'object',
    properties: { class: CLASS_REF, date: { type: 'string', description: 'YYYY-MM-DD.' } },
    required: ['class', 'date'],
  },
};

const T_CANCEL_CLASS: Anthropic.Messages.Tool = {
  name: 'cancel_whole_class',
  description:
    'Cancel an ENTIRE class — only when the director explicitly asks to cancel the whole thing, not one date. ' +
    'Archives it (registrations are kept as the record), takes it off the site and releases all its courts. ' +
    'Issues no credits or refunds and emails nobody.',
  input_schema: { type: 'object', properties: { class: CLASS_REF }, required: ['class'] },
};

const T_EDIT: Anthropic.Messages.Tool = {
  name: 'edit_class_details',
  description:
    "Fix a class's details: title, description, subtitle, level, coach, location, length (start/end time), days, " +
    'capacity, audience, ages, price note. Set only what the director asked about. Not dates, skip dates, prices or ' +
    'publishing — other tools/screens do those.',
  input_schema: {
    type: 'object',
    properties: {
      class: CLASS_REF,
      title: { type: 'string' },
      subtitle: { type: 'string' },
      description: { type: 'string' },
      level_note: { type: 'string' },
      coach_name: { type: 'string' },
      location_note: { type: 'string' },
      price_note: { type: 'string' },
      time_start: { type: 'string', description: 'HH:MM 24-hour.' },
      time_end: { type: 'string', description: 'HH:MM 24-hour.' },
      days_of_week: { type: 'array', items: { type: 'number' } },
      capacity: { type: 'number' },
      waitlist_enabled: { type: 'boolean' },
      audience: { type: 'string', enum: ['junior', 'adult', 'family', 'all'] },
      age_min: { type: 'number' },
      age_max: { type: 'number' },
    },
    required: ['class'],
  },
};

const T_WITHDRAW: Anthropic.Messages.Tool = {
  name: 'withdraw_student',
  description:
    'Take a student out of a class (their registration is cancelled, the record kept). Does NOT refund or credit ' +
    'and leaves their payment record as it is; does not auto-promote or email the waitlist.',
  input_schema: {
    type: 'object',
    properties: { class: CLASS_REF, student: { type: 'string', description: "The player's name as registered." } },
    required: ['class', 'student'],
  },
};

const T_ADD: Anthropic.Messages.Tool = {
  name: 'add_student',
  description:
    'Register a student in a class by hand. Goes on the waitlist if the class is full. Records what they owe at the ' +
    'class price — never marks them paid. Sends no confirmation email.',
  input_schema: {
    type: 'object',
    properties: {
      class: CLASS_REF,
      student: { type: 'string', description: "Player's full name." },
      email: { type: 'string', description: 'Contact (parent) email. Optional if they have registered at this club before.' },
      parent_name: { type: 'string' },
      phone: { type: 'string' },
      notes: { type: 'string' },
    },
    required: ['class', 'student'],
  },
};

// ------------------------------------------------------------ read handlers

async function classOnDate(input: Record<string, unknown>, ctx: Ctx): Promise<ToolResult> {
  const date = String(input?.date ?? '');
  if (!YMD.test(date)) return { ok: false, error: 'date must be YYYY-MM-DD.' };

  let programs: ProgramRow[];
  if (input?.class) {
    const f = await findProgram(ctx, input.class);
    if ('error' in f) return { ok: false, ...f };
    programs = [f.program];
  } else {
    const { data } = await ctx.db
      .from('club_programs')
      .select('*')
      .eq('club_id', ctx.clubId)
      .neq('status', 'archived')
      .lte('range_start', date)
      .gte('range_end', date);
    programs = ((data as ProgramRow[] | null) ?? []).filter((p) => programSessions(p, ctx.timeZone).dates.includes(date));
    if (programs.length === 0) return { ok: true, date: fmtDate(date, ctx), classes: [], note: 'No classes meet that day.' };
  }

  const out = [];
  for (const p of programs) {
    const s = programSessions(p, ctx.timeZone);
    let meets = s.dates.includes(date);
    let why: string | undefined;
    if (!meets) {
      if (s.skipped.includes(date)) why = 'It is a skip date — the class is off that day.';
      else if (date < String(p.range_start).slice(0, 10) || date > String(p.range_end).slice(0, 10))
        why = `Outside the class's run (${formatSessionDate(p.range_start, ctx.timeZone)} – ${formatSessionDate(p.range_end, ctx.timeZone, { year: true })}).`;
      else why = `The class meets ${daysLabel(p.days_of_week)}, not ${fmtDate(date, ctx).split(',')[0]}.`;
    }
    meets = meets && p.status !== 'archived';
    const regs = await liveRegistrations(ctx, p.id);
    const enrolled = regs.filter((r) => r.status === 'enrolled');
    out.push({
      id: p.id,
      title: p.title,
      status: p.status,
      meets,
      why_not: why,
      time: formatTimeRange(p.time_start, p.time_end),
      coach: p.coach_name,
      enrolled: enrolled.length,
      prepaid: enrolled.filter((r) => r.payment_status === 'paid').map((r) => r.participant_name),
      not_paid: enrolled.filter((r) => r.payment_status === 'pending').map((r) => r.participant_name),
      waived: enrolled.filter((r) => r.payment_status === 'waived').map((r) => r.participant_name),
      waitlist: regs.filter((r) => r.status === 'waitlist').map((r) => r.participant_name),
    });
  }
  return {
    ok: true,
    date: fmtDate(date, ctx),
    classes: out,
    note: 'Drop-in visits are not recorded per date in ClubMode, so only season registrations are listed.',
  };
}

async function currentPrograms(ctx: Ctx, opts: { drafts: boolean; past: boolean }): Promise<ProgramRow[]> {
  let q = ctx.db
    .from('club_programs')
    .select('*')
    .eq('club_id', ctx.clubId)
    .neq('status', 'archived');
  if (!opts.drafts) q = q.eq('status', 'published');
  if (!opts.past) q = q.gte('range_end', todayIn(ctx.timeZone));
  const { data } = await q.order('display_order').order('range_start');
  return (data as ProgramRow[] | null) ?? [];
}

async function enrolledCounts(ctx: Ctx, ids: string[]): Promise<Map<string, number>> {
  const m = new Map<string, number>();
  if (!ids.length) return m;
  const { data } = await ctx.db
    .from('club_program_registrations')
    .select('program_id, status')
    .eq('club_id', ctx.clubId)
    .in('program_id', ids)
    .eq('status', 'enrolled');
  for (const r of (data as { program_id: string }[] | null) ?? []) m.set(r.program_id, (m.get(r.program_id) ?? 0) + 1);
  return m;
}

async function offeringsSummary(input: Record<string, unknown>, ctx: Ctx): Promise<ToolResult> {
  const rows = await currentPrograms(ctx, { drafts: input?.include_drafts === true, past: input?.include_past === true });
  const counts = await enrolledCounts(ctx, rows.map((r) => r.id));

  const { data: coachRows } = await ctx.db
    .from('lesson_coaches')
    .select('display_name, open_rate_note')
    .eq('club_id', ctx.clubId);
  const lessons = ((coachRows as { display_name: string; open_rate_note: string | null }[] | null) ?? [])
    .filter((c) => c.open_rate_note && c.open_rate_note.trim())
    .map((c) => ({ coach: c.display_name, rates: c.open_rate_note!.trim() }));

  const classes = rows.map((p) => {
    const s = programSessions(p, ctx.timeZone);
    const enrolled = counts.get(p.id) ?? 0;
    return {
      id: p.id,
      title: p.title,
      status: p.status,
      when: `${daysLabel(p.days_of_week)} ${formatTimeRange(p.time_start, p.time_end)}`,
      dates: s.dates.length
        ? `${formatSessionDate(s.dates[0], ctx.timeZone)} – ${formatSessionDate(s.dates[s.dates.length - 1], ctx.timeZone)} (${s.count} meetings)`
        : 'no meetings scheduled',
      ...priceSummary(p),
      price_note: (p.price_note as string | null) ?? null,
      level: p.level_note,
      audience: p.audience,
      coach: p.coach_name,
      spots_left: p.capacity == null ? null : Math.max(0, p.capacity - enrolled),
    };
  });

  const lines = [`${ctx.clubName} — classes & lessons`, ''];
  for (const c of classes) {
    const prices = [
      `${c.season_price} season`,
      c.member_price ? `${c.member_price} members` : null,
      c.drop_in_price ? `${c.drop_in_price} drop-in` : null,
    ]
      .filter(Boolean)
      .join(' · ');
    lines.push(
      `• ${c.title}${c.status !== 'published' ? ' [draft]' : ''} — ${c.when}, ${c.dates}. ${prices}.` +
        `${c.level ? ` Level: ${c.level}.` : ''}${c.coach ? ` Coach: ${c.coach}.` : ''}` +
        `${c.spots_left != null ? ` ${c.spots_left} spots left.` : ''}`,
    );
  }
  if (classes.length === 0) lines.push('(No current classes.)');
  if (lessons.length) {
    lines.push('', 'Private lessons:');
    for (const l of lessons) lines.push(`• ${l.coach}: ${l.rates}`);
  }

  return {
    ok: true,
    classes,
    lessons,
    lessons_note: lessons.length ? undefined : 'No coach has written a lesson rate in ClubMode, so lesson prices are not known here.',
    paste_text: lines.join('\n'),
  };
}

/** NTRP-ish level fit from a free-text note. null = the note says nothing usable. */
export function levelFits(note: string | null | undefined, level: number): boolean | null {
  if (!note) return null;
  const nums = [...note.matchAll(/(\d\.\d)/g)].map((m) => Number(m[1]));
  if (nums.length === 0) return null;
  if (nums.length >= 2) {
    const lo = Math.min(nums[0], nums[1]);
    const hi = Math.max(nums[0], nums[1]);
    return level >= lo - 0.001 && level <= hi + 0.001;
  }
  const n = nums[0];
  if (/\+|and up|or above|above/i.test(note)) return level >= n - 0.001;
  if (/below|under|or less/i.test(note)) return level <= n + 0.001;
  return Math.abs(level - n) <= 0.25;
}

async function findClasses(input: Record<string, unknown>, ctx: Ctx): Promise<ToolResult> {
  const rows = await currentPrograms(ctx, { drafts: input?.include_drafts === true, past: false });
  let days = cleanDays(input?.days_of_week);
  if (!days || days.length === 0) {
    if (input?.days === 'weekend') days = [0, 6];
    else if (input?.days === 'weekday') days = [1, 2, 3, 4, 5];
    else days = null;
  }
  const name = typeof input?.name === 'string' ? input.name.toLowerCase().trim() : '';
  const audience = typeof input?.audience === 'string' ? input.audience : null;
  const level = typeof input?.level === 'number' ? input.level : null;
  const tod = input?.time_of_day;

  const matches: Record<string, unknown>[] = [];
  const levelUnknown: string[] = [];
  for (const p of rows) {
    if (name && !p.title.toLowerCase().includes(name)) continue;
    if (audience && audience !== 'all' && p.audience !== audience && p.audience !== 'all') continue;
    const pd = p.days_of_week && p.days_of_week.length ? p.days_of_week : [0, 1, 2, 3, 4, 5, 6];
    if (days && !pd.some((d) => days!.includes(d))) continue;
    const startH = Number(String(p.time_start).slice(0, 2));
    if (tod === 'morning' && startH >= 12) continue;
    if (tod === 'afternoon' && (startH < 12 || startH >= 17)) continue;
    if (tod === 'evening' && startH < 17) continue;
    let fit: boolean | null = null;
    if (level != null) {
      fit = levelFits(p.level_note, level);
      if (fit === false) continue;
      if (fit === null) levelUnknown.push(p.title);
    }
    const s = programSessions(p, ctx.timeZone);
    matches.push({
      id: p.id,
      title: p.title,
      status: p.status,
      audience: p.audience,
      level: p.level_note,
      level_match: level == null ? undefined : fit === true ? 'fits' : 'level not stated',
      when: `${daysLabel(p.days_of_week)} ${formatTimeRange(p.time_start, p.time_end)}`,
      next_meeting: (() => {
        const t = todayIn(ctx.timeZone);
        const n = s.dates.find((d) => d >= t);
        return n ? fmtDate(n, ctx) : null;
      })(),
      meetings_left: s.dates.filter((d) => d >= todayIn(ctx.timeZone)).length,
      ...priceSummary(p),
      coach: p.coach_name,
    });
  }
  // Classes that state a fitting level first.
  matches.sort((a, b) => (a.level_match === 'fits' ? 0 : 1) - (b.level_match === 'fits' ? 0 : 1));
  return {
    ok: true,
    count: matches.length,
    classes: matches,
    note:
      levelUnknown.length > 0
        ? `${levelUnknown.length} of these do not state a level, so they may or may not suit a ${level}.`
        : undefined,
  };
}

// ---------------------------------------------------------- write preparation
// Each write is prepared ONCE and the same plan feeds preview and run, so what
// the director approves is what happens.

type CreatePlan = { row: Record<string, unknown>; courtCount: number | null; summary: Record<string, unknown> };

async function prepareCreate(input: Record<string, unknown>, ctx: Ctx): Promise<CreatePlan | { error: string }> {
  const days = cleanDays(input?.days_of_week) ?? [];
  if (days.length === 0) return { error: 'Which days does it meet? days_of_week, 0=Sun..6=Sat.' };
  const start = String(input?.range_start ?? '');
  if (!YMD.test(start)) return { error: 'range_start must be YYYY-MM-DD.' };
  const skips = cleanDates(input?.skip_dates);
  if (skips.bad.length) return { error: `Skip dates must be YYYY-MM-DD (got ${skips.bad.join(', ')}).` };
  const end = resolveEnd(input, start, days, skips.ok, ctx.timeZone);
  if (!end) return { error: 'How long does it run? Give range_end, weeks or meetings.' };
  if ('error' in end) return end;

  const courtCountRaw = Number(input?.court_count);
  const courtCount = input?.court_count != null && Number.isFinite(courtCountRaw) && courtCountRaw > 0 ? Math.round(courtCountRaw) : null;
  if (courtCount != null && courtCount > 40) return { error: 'A class can hold at most 40 courts.' };

  const draft = {
    title: input?.title,
    subtitle: input?.subtitle,
    sport: input?.sport,
    audience: input?.audience,
    age_min: input?.age_min,
    age_max: input?.age_max,
    level_note: input?.level_note,
    range_start: start,
    range_end: end.end,
    days_of_week: days,
    exclusions: skips.ok,
    time_start: input?.time_start,
    time_end: input?.time_end,
    price_cents: toCents(input?.price_dollars),
    member_price_cents: toCents(input?.member_price_dollars),
    drop_in_price_cents: toCents(input?.drop_in_price_dollars),
    price_note: input?.price_note,
    capacity: typeof input?.capacity === 'number' ? Math.round(input.capacity) : undefined,
    description: input?.description,
    coach_name: input?.coach_name,
    location_note: input?.location_note,
    // Publishing is a human click on the Classes screen.
    status: 'draft',
  };
  for (const k of Object.keys(draft) as (keyof typeof draft)[]) if (draft[k] === undefined) delete draft[k];
  for (const k of ['price_dollars', 'member_price_dollars', 'drop_in_price_dollars'] as const) {
    if (input?.[k] != null && toCents(input[k]) === undefined) return { error: `${k} must be a number of dollars, 0 or more.` };
  }

  const parsed = programWriteSchema.safeParse(draft);
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  const row: Record<string, unknown> = {
    ...parsed.data,
    club_id: ctx.clubId,
    created_by: ctx.userId,
    ...(courtCount ? { court_count: courtCount, blocks_courts: true } : {}),
  };
  const s = programSessions(parsed.data, ctx.timeZone);
  if (s.count === 0) return { error: 'That schedule has no meetings at all — check the days and dates.' };

  const summary = {
    title: parsed.data.title,
    status: 'draft (not visible to the public until published on the Classes screen)',
    ...scheduleSummary(parsed.data as never, ctx),
    ...priceSummary(parsed.data as never),
    capacity: parsed.data.capacity ?? 'no limit',
    coach: parsed.data.coach_name ?? null,
    courts: courtCount
      ? `Will hold ${courtCount} court${courtCount === 1 ? '' : 's'} for every meeting — the first free courts in court order; specific court numbers cannot be pinned.`
      : 'No courts held.',
    start_not_a_meeting:
      s.dates[0] !== start ? `${fmtDate(start, ctx)} is not a meeting day; the first meeting is ${fmtDate(s.dates[0], ctx)}.` : undefined,
  };
  return { row, courtCount, summary };
}

async function insertProgram(ctx: Ctx, row: Record<string, unknown>, courtCount: number | null) {
  const slug = await freeSlug(ctx, String(row.title));
  const { data, error } = await ctx.db
    .from('club_programs')
    .insert({ ...row, slug })
    .select('*')
    .maybeSingle();
  if (error || !data) return { ok: false as const, error: error?.message ?? 'Could not save the class.' };
  const program = data as ProgramRow;
  let courts: string | null = null;
  if (courtCount) {
    const result = await blockProgramCourts(
      ctx.db as never,
      { ...(program as unknown as BlockableProgram), court_count: courtCount, blocks_courts: true },
      { timeZone: ctx.timeZone, createdBy: ctx.userId },
    );
    courts = describeBlockResult(result);
  }
  return { ok: true as const, program, courts };
}

type CopyPlan = { source: ProgramRow; row: Record<string, unknown>; courtCount: number | null; summary: Record<string, unknown> };

async function prepareCopy(input: Record<string, unknown>, ctx: Ctx): Promise<CopyPlan | { error: string; candidates?: unknown }> {
  const f = await findProgram(ctx, input?.class);
  if ('error' in f) return f;
  const src = f.program;

  const start = String(input?.range_start ?? '');
  if (!YMD.test(start)) return { error: 'range_start must be YYYY-MM-DD.' };
  const skips = cleanDates(input?.skip_dates);
  if (skips.bad.length) return { error: `Skip dates must be YYYY-MM-DD (got ${skips.bad.join(', ')}).` };
  const days = src.days_of_week ?? [];
  let end = resolveEnd(input, start, days, skips.ok, ctx.timeZone);
  if (end && 'error' in end) return end;
  // Default as the duplicate route: same length as the old session.
  if (!end) end = { end: addDays(start, Math.max(0, dayDiff(String(src.range_start).slice(0, 10), String(src.range_end).slice(0, 10)))) };

  const title = (typeof input?.title === 'string' && input.title.trim() ? input.title.trim() : src.title).slice(0, 160);
  const price = (k: string, srcVal: number | null) => {
    const c = toCents(input?.[k]);
    return c === undefined ? srcVal : c;
  };
  for (const k of ['price_dollars', 'member_price_dollars', 'drop_in_price_dollars'] as const) {
    if (input?.[k] != null && toCents(input[k]) === undefined) return { error: `${k} must be a number of dollars, 0 or more.` };
  }

  // Field-for-field the duplicate route's copy.
  const draft = {
    title,
    subtitle: src.subtitle,
    sport: src.sport,
    audience: src.audience,
    age_min: src.age_min,
    age_max: src.age_max,
    level_note: src.level_note,
    range_start: start,
    range_end: end.end,
    days_of_week: days,
    exclusions: skips.ok,
    time_start: src.time_start,
    time_end: src.time_end,
    price_cents: price('price_dollars', src.price_cents),
    member_price_cents: price('member_price_dollars', src.member_price_cents),
    drop_in_price_cents: price('drop_in_price_dollars', src.drop_in_price_cents),
    price_note: src.price_note,
    capacity: src.capacity,
    waitlist_enabled: src.waitlist_enabled,
    registration_mode: src.registration_mode,
    external_payment_url: src.external_payment_url,
    description: src.description,
    coach_name: src.coach_name,
    location_note: src.location_note,
    image_url: src.image_url,
    display_order: src.display_order,
    status: 'draft',
    registration_opens_at: null,
    registration_closes_at: null,
  };
  const parsed = programWriteSchema.safeParse(draft);
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  const wantCourts = input?.hold_courts === true || (input?.hold_courts !== false && src.blocks_courts);
  const courtCount = wantCourts ? src.court_count : null;
  if (input?.hold_courts === true && !src.court_count) {
    return { error: `${src.title} has no court count set, so there is nothing to copy. Say how many courts, or create the class with court_count.` };
  }

  const row: Record<string, unknown> = {
    ...parsed.data,
    club_id: ctx.clubId,
    created_by: ctx.userId,
    series_id: null,
    ...(courtCount ? { court_count: courtCount, blocks_courts: true } : { court_count: src.court_count }),
  };
  const s = programSessions(parsed.data, ctx.timeZone);
  if (s.count === 0) return { error: 'The new dates contain no meetings.' };

  const priceChanges = (
    [
      ['season price', src.price_cents, parsed.data.price_cents],
      ['member price', src.member_price_cents, parsed.data.member_price_cents],
      ['drop-in price', src.drop_in_price_cents, parsed.data.drop_in_price_cents],
    ] as const
  )
    .filter(([, a, b]) => (a ?? null) !== (b ?? null))
    .map(([field, a, b]) => ({ field, from: formatPrice(a), to: formatPrice(b) }));

  return {
    source: src,
    row,
    courtCount,
    summary: {
      copying_from: `${src.title} (${formatSessionDate(src.range_start, ctx.timeZone)} – ${formatSessionDate(src.range_end, ctx.timeZone, { year: true })})`,
      new_title: title,
      status: 'draft — nobody enrolled; publish on the Classes screen',
      ...scheduleSummary(parsed.data as never, ctx),
      ...priceSummary(parsed.data as never),
      price_changes: priceChanges.length ? priceChanges : 'same prices as the old session',
      courts: courtCount ? `Will hold ${courtCount} courts per meeting.` : 'No courts held.',
      start_not_a_meeting:
        s.dates[0] !== start ? `${fmtDate(start, ctx)} is not a meeting day; the first meeting is ${fmtDate(s.dates[0], ctx)}.` : undefined,
    },
  };
}

/** Apply a schedule patch with the PATCH route's rules, and rebuild courts if held. */
async function applyPatch(ctx: Ctx, before: ProgramRow, patch: Record<string, unknown>) {
  const { data: after, error } = await ctx.db
    .from('club_programs')
    .update(patch)
    .eq('id', before.id)
    .eq('club_id', ctx.clubId)
    .select('*')
    .maybeSingle();
  if (error || !after) return { ok: false as const, error: error?.message ?? 'Could not save.' };
  const scheduleMoved = ['exclusions', 'range_start', 'range_end', 'days_of_week', 'time_start', 'time_end'].some((k) => k in patch);
  const blocks = scheduleMoved
    ? await resyncProgramBlocks(ctx.db as never, after as unknown as BlockableProgram, {
        timeZone: ctx.timeZone,
        createdBy: ctx.userId,
      })
    : null;
  return { ok: true as const, after: after as ProgramRow, courts: blocks ? describeBlockResult(blocks) : null };
}

type ExtendPlan = { program: ProgramRow; patch: Record<string, unknown>; summary: Record<string, unknown> };

async function prepareExtend(input: Record<string, unknown>, ctx: Ctx): Promise<ExtendPlan | { error: string; candidates?: unknown }> {
  const f = await findProgram(ctx, input?.class);
  if ('error' in f) return f;
  const p = f.program;
  const oldEnd = String(p.range_end).slice(0, 10);
  const skips = cleanDates(input?.skip_dates);
  if (skips.bad.length) return { error: `Skip dates must be YYYY-MM-DD (got ${skips.bad.join(', ')}).` };
  const exclusions = [...new Set([...(p.exclusions ?? []).map((d) => String(d).slice(0, 10)), ...skips.ok])].sort();

  let newEnd: string | null = null;
  if (typeof input?.new_end === 'string') {
    if (!YMD.test(input.new_end)) return { error: 'new_end must be YYYY-MM-DD.' };
    newEnd = input.new_end;
  } else if (typeof input?.add_meetings === 'number' && input.add_meetings > 0) {
    const r = resolveEnd({ meetings: input.add_meetings }, addDays(oldEnd, 1), p.days_of_week ?? [], exclusions, ctx.timeZone);
    if (!r || 'error' in r) return { error: r && 'error' in r ? r.error : 'Could not work out the new end.' };
    newEnd = r.end;
  }
  if (!newEnd) return { error: 'Give new_end (YYYY-MM-DD) or add_meetings.' };
  if (newEnd < String(p.range_start).slice(0, 10)) return { error: 'The last date cannot be before the first.' };
  if (newEnd === oldEnd && skips.ok.length === 0) return { error: `${p.title} already ends ${fmtDate(oldEnd, ctx)}.` };

  const patch: Record<string, unknown> = { range_end: newEnd };
  if (skips.ok.length) patch.exclusions = exclusions;
  const parsed = programPatchSchema.safeParse(patch);
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  const before = programSessions(p, ctx.timeZone);
  const after = programSessions({ ...p, range_end: newEnd, exclusions }, ctx.timeZone);
  const regs = await liveRegistrations(ctx, p.id);
  return {
    program: p,
    patch: parsed.data as Record<string, unknown>,
    summary: {
      class: p.title,
      end_was: fmtDate(oldEnd, ctx),
      end_now: fmtDate(newEnd, ctx),
      meetings_before: before.count,
      meetings_after: after.count,
      added_dates: after.dates.filter((d) => !before.dates.includes(d)).map((d) => fmtDate(d, ctx)),
      removed_dates: before.dates.filter((d) => !after.dates.includes(d)).map((d) => fmtDate(d, ctx)),
      new_skip_dates: skips.ok.map((d) => fmtDate(d, ctx)),
      families_signed_up: regs.length,
      also: p.blocks_courts ? 'Court holds will be rebuilt to match.' : undefined,
      money_note:
        regs.length > 0
          ? 'Registered families keep what they were charged; any top-up for the extra weeks is a separate billing step.'
          : undefined,
    },
  };
}

type CancelMeetingPlan = { program: ProgramRow; exclusions: string[]; date: string; regs: RegRow[]; summary: Record<string, unknown> };

async function prepareCancelMeeting(input: Record<string, unknown>, ctx: Ctx): Promise<CancelMeetingPlan | { error: string; candidates?: unknown }> {
  const f = await findProgram(ctx, input?.class);
  if ('error' in f) return f;
  const p = f.program;
  const date = String(input?.date ?? '');
  if (!YMD.test(date)) return { error: 'date must be YYYY-MM-DD.' };
  const s = programSessions(p, ctx.timeZone);
  if (!s.dates.includes(date)) {
    if (s.skipped.includes(date)) return { error: `${p.title} is already off on ${fmtDate(date, ctx)}.` };
    return { error: `${p.title} does not meet on ${fmtDate(date, ctx)} (it meets ${daysLabel(p.days_of_week)}, ${formatSessionDate(p.range_start, ctx.timeZone)} – ${formatSessionDate(p.range_end, ctx.timeZone)}).` };
  }
  const exclusions = [...new Set([...(p.exclusions ?? []).map((d) => String(d).slice(0, 10)), date])].sort();
  const regs = await liveRegistrations(ctx, p.id);
  return {
    program: p,
    exclusions,
    date,
    regs,
    summary: {
      class: p.title,
      cancelling: `${fmtDate(date, ctx)}, ${formatTimeRange(p.time_start, p.time_end)}`,
      meetings_before: s.count,
      meetings_after: s.count - 1,
      affected: rosterLines(regs),
      affected_count: regs.length,
      courts: p.blocks_courts ? 'The court hold for that date is released.' : undefined,
      not_done: 'No credits or refunds are issued, and nobody is emailed. The Notify button on the Classes screen tells families.',
    },
  };
}

type EditPlan = { program: ProgramRow; patch: Record<string, unknown>; summary: Record<string, unknown> };

const EDITABLE = [
  'title', 'subtitle', 'description', 'level_note', 'coach_name', 'location_note', 'price_note',
  'time_start', 'time_end', 'days_of_week', 'capacity', 'waitlist_enabled', 'audience', 'age_min', 'age_max',
] as const;

async function prepareEdit(input: Record<string, unknown>, ctx: Ctx): Promise<EditPlan | { error: string; candidates?: unknown }> {
  const f = await findProgram(ctx, input?.class);
  if ('error' in f) return f;
  const p = f.program;
  const raw: Record<string, unknown> = {};
  for (const k of EDITABLE) if (input?.[k] !== undefined) raw[k] = input[k];
  if (typeof raw.capacity === 'number') raw.capacity = Math.round(raw.capacity);
  if (Object.keys(raw).length === 0) return { error: 'Nothing to change.' };

  const parsed = programPatchSchema.safeParse(raw);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const patch: Record<string, unknown> = {};
  for (const k of Object.keys(raw)) {
    const v = (parsed.data as Record<string, unknown>)[k];
    patch[k] = v === undefined ? null : v;
  }

  // The PATCH route's cross-field rules, against the stored row.
  const merged = { ...p, ...patch } as Record<string, unknown>;
  if (String(merged.time_end).slice(0, 5) <= String(merged.time_start).slice(0, 5))
    return { error: 'The end time has to be after the start time.' };
  if (merged.age_min != null && merged.age_max != null && Number(merged.age_max) < Number(merged.age_min))
    return { error: 'The oldest age cannot be below the youngest.' };

  const show = (k: string, v: unknown): string => {
    if (v == null || v === '') return '(blank)';
    if (k === 'days_of_week') return daysLabel(v as number[]);
    if (k === 'time_start' || k === 'time_end') return String(v).slice(0, 5);
    if (k === 'description') return String(v).length > 200 ? `${String(v).slice(0, 200)}…` : String(v);
    return String(v);
  };
  const changes = Object.keys(patch).map((k) => ({ field: k, from: show(k, p[k]), to: show(k, patch[k]) }));

  const regs = await liveRegistrations(ctx, p.id);
  const enrolled = regs.filter((r) => r.status === 'enrolled').length;
  const scheduleMoved = ['time_start', 'time_end', 'days_of_week'].some((k) => k in patch);
  const before = programSessions(p, ctx.timeZone);
  const after = programSessions({ ...p, ...(patch as object) } as ProgramRow, ctx.timeZone);

  return {
    program: p,
    patch,
    summary: {
      class: p.title,
      changes,
      when_now: scheduleMoved ? `${daysLabel(merged.days_of_week as number[])}, ${formatTimeRange(String(merged.time_start), String(merged.time_end))}` : undefined,
      meetings: scheduleMoved && before.count !== after.count ? { before: before.count, after: after.count } : undefined,
      warning:
        typeof patch.capacity === 'number' && patch.capacity < enrolled
          ? `${enrolled} are already enrolled — above the new capacity of ${patch.capacity}. Nobody is removed.`
          : undefined,
      families_signed_up: regs.length,
      also: scheduleMoved && p.blocks_courts ? 'Court holds will be rebuilt for the new times.' : undefined,
      reminder: scheduleMoved && regs.length ? 'This emails nobody; the Notify button on the Classes screen does.' : undefined,
    },
  };
}

async function findRegistration(ctx: Ctx, programId: string, student: string) {
  const regs = await liveRegistrations(ctx, programId);
  const k = student.trim().toLowerCase();
  const exact = regs.filter((r) => r.participant_name.trim().toLowerCase() === k);
  const hits = exact.length ? exact : regs.filter((r) => r.participant_name.toLowerCase().includes(k));
  return { regs, hits };
}

type WithdrawPlan = { program: ProgramRow; reg: RegRow; summary: Record<string, unknown> };

async function prepareWithdraw(input: Record<string, unknown>, ctx: Ctx): Promise<WithdrawPlan | { error: string; candidates?: unknown }> {
  const f = await findProgram(ctx, input?.class);
  if ('error' in f) return f;
  const p = f.program;
  const student = String(input?.student ?? '').trim();
  if (!student) return { error: 'Which student?' };
  const { regs, hits } = await findRegistration(ctx, p.id, student);
  if (hits.length === 0) return { error: `Nobody called "${student}" is registered in ${p.title}.`, candidates: regs.map((r) => r.participant_name) };
  if (hits.length > 1) return { error: `"${student}" matches ${hits.length} registrations — which one?`, candidates: hits.map((r) => `${r.participant_name} (${r.parent_email})`) };
  const reg = hits[0];
  const waitHead = regs.find((r) => r.status === 'waitlist');
  const paidNote =
    reg.payment_status === 'paid'
      ? `They had PAID${reg.amount_cents ? ` ${formatPrice(reg.amount_cents)}` : ''}. No refund or credit is made here and the payment record stays "paid" — handle any refund/credit separately.`
      : reg.payment_status === 'pending' && (reg.amount_cents ?? 0) > 0
        ? `They still owed ${formatPrice(reg.amount_cents)}; that pending amount stays on the record — clear it on the roster screen if it should be dropped.`
        : undefined;
  return {
    program: p,
    reg,
    summary: {
      class: p.title,
      withdrawing: reg.participant_name,
      contact: reg.parent_email,
      was: reg.status,
      payment: reg.payment_status,
      money: paidNote,
      waitlist:
        reg.status === 'enrolled' && waitHead
          ? `${waitHead.participant_name} is first on the waitlist. They are NOT moved up automatically here (that sends an email) — promote them from the roster screen if wanted.`
          : undefined,
      not_done: 'Nobody is emailed.',
    },
  };
}

type AddPlan = { program: ProgramRow; row: Record<string, unknown>; summary: Record<string, unknown> };

const looksLikeEmail = (s: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);
const clamp = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

async function prepareAdd(input: Record<string, unknown>, ctx: Ctx): Promise<AddPlan | { error: string; candidates?: unknown }> {
  const f = await findProgram(ctx, input?.class);
  if ('error' in f) return f;
  const p = f.program;
  const student = clamp(input?.student, 120);
  if (!student) return { error: "We need the player's name." };

  let email = clamp(input?.email, 200)?.toLowerCase() ?? null;
  let emailSource = 'given';
  if (!email) {
    // Someone who has registered here before: reuse that contact, but only if it is unambiguous.
    const { data } = await ctx.db
      .from('club_program_registrations')
      .select('parent_email, parent_name')
      .eq('club_id', ctx.clubId)
      .ilike('participant_name', student);
    const emails = [...new Set(((data as { parent_email: string }[] | null) ?? []).map((r) => r.parent_email.toLowerCase()))];
    if (emails.length === 1) {
      email = emails[0];
      emailSource = 'from their earlier registration at this club';
    } else if (emails.length > 1) {
      return { error: `${student} has registered before under ${emails.length} emails — which one?`, candidates: emails };
    } else {
      return { error: `A contact email is required for a registration, and ${student} has not registered here before. Ask the director for one.` };
    }
  }
  if (!looksLikeEmail(email)) return { error: 'That email does not look valid.' };

  const { regs } = await findRegistration(ctx, p.id, student);
  const dupe = regs.find((r) => r.participant_name.trim().toLowerCase() === student.toLowerCase() && r.parent_email.toLowerCase() === email);
  if (dupe) return { error: `${student} is already ${dupe.status === 'waitlist' ? 'on the waitlist for' : 'in'} ${p.title}.` };

  const enrolled = regs.filter((r) => r.status === 'enrolled').length;
  const full = p.capacity != null && enrolled >= p.capacity;
  if (full && !p.waitlist_enabled) {
    return { error: `${p.title} is full (${enrolled}/${p.capacity}) and has no waitlist. Raise the capacity first if they should be squeezed in.` };
  }
  const status = full ? 'waitlist' : 'enrolled';
  const priceCents = Number(p.price_cents) || 0;
  // Same money fields the public sign-up writes. Never 'paid'.
  const row = {
    program_id: p.id,
    club_id: ctx.clubId,
    participant_name: student,
    parent_name: clamp(input?.parent_name, 120),
    parent_email: email,
    parent_phone: clamp(input?.phone, 40),
    notes: clamp(input?.notes, 1000),
    status,
    payment_status: status === 'waitlist' ? 'pending' : priceCents > 0 ? 'pending' : 'waived',
    amount_cents: status === 'waitlist' ? null : priceCents,
  };
  return {
    program: p,
    row,
    summary: {
      class: p.title,
      adding: student,
      contact: `${email} (${emailSource})`,
      as: status === 'waitlist' ? `WAITLIST — the class is full (${enrolled}/${p.capacity})` : `enrolled (${enrolled + 1}${p.capacity != null ? `/${p.capacity}` : ''})`,
      payment:
        status === 'waitlist'
          ? 'Nothing owed while waitlisted.'
          : priceCents > 0
            ? `Recorded as OWING ${formatPrice(priceCents)} (the season price). Not marked paid — if they already paid, mark it on the roster screen.`
            : 'No charge (class has no season price set or is free).',
      not_done: 'No confirmation email is sent.',
    },
  };
}

// --------------------------------------------------------------- tool table

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

const tools: ToolDef<Ctx>[] = [
  { schema: T_ON_DATE, run: (i, c) => classOnDate(i ?? {}, c) },
  { schema: T_OFFERINGS, run: (i, c) => offeringsSummary(i ?? {}, c) },
  { schema: T_FIND, run: (i, c) => findClasses(i ?? {}, c) },

  writeTool<CreatePlan>(T_CREATE, prepareCreate, async (plan, ctx) => {
    const r = await insertProgram(ctx, plan.row, plan.courtCount);
    if (!r.ok) return r;
    return { ok: true, id: r.program.id, title: r.program.title, status: r.program.status, courts: r.courts };
  }),

  writeTool<CopyPlan>(T_COPY, prepareCopy, async (plan, ctx) => {
    const r = await insertProgram(ctx, plan.row, plan.courtCount);
    if (!r.ok) return r;
    return { ok: true, id: r.program.id, title: r.program.title, status: r.program.status, courts: r.courts };
  }),

  writeTool<ExtendPlan>(T_EXTEND, prepareExtend, async (plan, ctx) => {
    const r = await applyPatch(ctx, plan.program, plan.patch);
    if (!r.ok) return r;
    return { ok: true, class: r.after.title, meetings: programSessions(r.after, ctx.timeZone).count, courts: r.courts };
  }),

  writeTool<CancelMeetingPlan>(T_CANCEL_MEETING, prepareCancelMeeting, async (plan, ctx) => {
    const r = await applyPatch(ctx, plan.program, { exclusions: plan.exclusions });
    if (!r.ok) return r;
    return { ok: true, class: r.after.title, meetings: programSessions(r.after, ctx.timeZone).count, courts: r.courts };
  }),

  writeTool(
    T_CANCEL_CLASS,
    async (input, ctx) => {
      const f = await findProgram(ctx, input?.class);
      if ('error' in f) return f;
      const p = f.program;
      const regs = await liveRegistrations(ctx, p.id);
      const s = programSessions(p, ctx.timeZone);
      const today = todayIn(ctx.timeZone);
      return {
        program: p,
        summary: {
          class: p.title,
          action: 'Archive the whole class: off the website, no further sign-ups, all court holds released. Registrations are kept.',
          remaining_meetings: s.dates.filter((d) => d >= today).length,
          affected: rosterLines(regs),
          affected_count: regs.length,
          prepaid: regs.filter((r) => r.payment_status === 'paid').map((r) => r.participant_name),
          not_done: 'No credits or refunds are issued, and nobody is emailed.',
        },
      };
    },
    async (plan: { program: ProgramRow; summary: Record<string, unknown> }, ctx) => {
      // Release first: reservations.source_id has no FK, so nothing else would.
      const released = await clearProgramBlocks(ctx.db as never, plan.program.id);
      const { error } = await ctx.db
        .from('club_programs')
        .update({ status: 'archived', blocks_courts: false, courts_blocked_at: null })
        .eq('id', plan.program.id)
        .eq('club_id', ctx.clubId);
      if (error) return { ok: false, error: error.message };
      return { ok: true, class: plan.program.title, archived: true, court_slots_released: released };
    },
  ),

  writeTool<EditPlan>(T_EDIT, prepareEdit, async (plan, ctx) => {
    const r = await applyPatch(ctx, plan.program, plan.patch);
    if (!r.ok) return r;
    return { ok: true, class: r.after.title, courts: r.courts };
  }),

  writeTool<WithdrawPlan>(T_WITHDRAW, prepareWithdraw, async (plan, ctx) => {
    // Status only. The roster screen's cancel also stamps payment 'refunded';
    // that would claim money moved when it did not, so it is left alone here.
    const { error } = await ctx.db
      .from('club_program_registrations')
      .update({ status: 'cancelled' })
      .eq('id', plan.reg.id)
      .eq('program_id', plan.program.id)
      .eq('club_id', ctx.clubId);
    if (error) return { ok: false, error: error.message };
    return { ok: true, class: plan.program.title, withdrawn: plan.reg.participant_name };
  }),

  writeTool<AddPlan>(T_ADD, prepareAdd, async (plan, ctx) => {
    const { data, error } = await ctx.db
      .from('club_program_registrations')
      .insert(plan.row)
      .select('id, status, payment_status, amount_cents')
      .maybeSingle();
    if (error || !data) {
      const dup = (error?.message || '').includes('idx_cpr_no_dupes');
      return { ok: false, error: dup ? `${plan.row.participant_name} is already signed up.` : error?.message ?? 'Could not save.' };
    }
    const r = data as { id: string; status: string; payment_status: string };
    return { ok: true, class: plan.program.title, registration_id: r.id, status: r.status, payment_status: r.payment_status };
  }),
];

// -------------------------------------------------------------------- export

export const programsPack: DomainPack<Ctx> = {
  domain: 'programs',

  actionsPrompt: `
PROGRAMS — you can set up and run the club's classes and clinics.

Reads (anyone on staff): class_on_date (is it on, who prepaid), offerings_summary (classes + prices, paste-ready),
find_classes (recommend by audience / level / days / time; also finds a class id by name).
Writes (owner/director only; coaches are read-only): create_class, copy_class_to_new_session, extend_class,
cancel_class_meeting, cancel_whole_class, edit_class_details, add_student, withdraw_student.

Rules:
- Turn holidays and phrases into concrete YYYY-MM-DD dates yourself ("Thanksgiving" → the Thursday, or the whole
  week if the director says week) and SHOW them in your reply. If which dates is unclear, ask.
- "10 weeks" → weeks; "10 sessions/classes" → meetings. The preview lists every date — read it back.
- Every write previews first. Relay the specifics (dates, counts, prices, who is affected) and wait for a clear yes.
- New and copied classes are DRAFTS. Say the director publishes them on the Classes screen.
- Court holds take the first free courts in court order; you cannot pin "courts 1–2" to specific numbers. Say so.
- "Change the drop-in price starting next session": copy the class with drop_in_price_dollars set, or if the next
  session already exists, change that class's price. Never change the current session when they said next.
- Cancel ONE date with cancel_class_meeting. Use cancel_whole_class only when they explicitly say the whole class.
- If a class name matches several classes, ask which — never pick one.

You CANNOT, and must say so plainly:
- Publish, email/text anyone, or issue credits, refunds or charges (that is a separate step). After cancelling a
  meeting or withdrawing a student, list who is affected and say no money moved.
- Mark anyone paid. add_student records what they owe.
- Delete a class (it archives), or track individual drop-in visits (the app does not record them).
- Pin specific court numbers, or anything else the tools return ok:false for — relay the reason; never fake it.
`.trim(),

  async resolve(userId) {
    // Every page, for anyone who runs a club; members get null.
    return resolveClubCtx(userId);
  },

  tools,
};
