import type Anthropic from '@anthropic-ai/sdk';
import type { DomainPack, ToolDef, ToolResult } from '../framework';
import { resolveClubCtx, MANAGER_ROLES, type ClubCtx } from '../clubContext';
import { programSessions, formatPrice, formatSessionDate } from '@/lib/programs/sessions';
import { cardConnected, DEFAULT_PAYMENTS, type ClubPayments } from '@/lib/courts/payments';

/*
 * Attendance pack: who came to a class meeting, and who owes a drop-in.
 *
 * Darrin's two most frequent asks: "attendance for tonight's B team clinic:
 * Chitra, Kersti, Leena, Yvette" and "who needs the drop-in charge?".
 *
 * WHERE IT IS STORED. ClubMode computes a class's meeting dates
 * (lib/programs/sessions.ts) and keeps season sign-ups
 * (club_program_registrations), but had no place for who actually turned up.
 * supabase/migrations/club_program_attendance.sql adds one. Until that is run,
 * every tool that needs it says so plainly instead of pretending.
 *
 * NAMES. A typed name is matched to the class roster first, then to the club's
 * known people (cc_vault_players). Anything that does not match one person is
 * handed back, never guessed. A person who is not enrolled in the class is a
 * drop-in candidate.
 *
 * DROP-INS. Someone not enrolled owes the drop-in price. Someone enrolled owes
 * it only when they are AHEAD: more meetings attended to date than meetings
 * held to date (plus any extra session that made up a rainout). A meeting
 * marked as a makeup, or marked paid outside ClubMode, owes nothing.
 *
 * MONEY. ClubMode cannot charge a saved card: it keeps no cards on file, and
 * the club's Square connection is scoped to payments and orders only (no
 * customers or cards). charge_drop_ins therefore always refuses, with the
 * reason and the list, rather than charging some other way. There is also no
 * drop-in payment link: openCheckout() (lib/squareConnect) only knows class
 * registrations and court bookings.
 *
 * Every write is destructive (preview -> confirm), and preview and run call
 * the same plan function, so what was shown is what is done.
 */

type Ctx = ClubCtx;

// ------------------------------------------------------------------ schemas

const CLASS_PROP = {
  type: 'string',
  description: 'The class: its id, or its name as the director said it ("B team clinic").',
};
const DATE_PROP = {
  type: 'string',
  description: 'YYYY-MM-DD in club time, or "today". "Tonight" is today.',
};

const ATTENDANCE_STATUS: Anthropic.Messages.Tool = {
  name: 'attendance_status',
  description:
    'Is attendance in? For each class meeting in a date range (default: this week, up to today) ' +
    'shows how many are marked present against how many are enrolled. Omit class for every class.',
  input_schema: {
    type: 'object',
    properties: {
      class: CLASS_PROP,
      from: { type: 'string', description: 'YYYY-MM-DD. Default Monday of this week.' },
      to: { type: 'string', description: 'YYYY-MM-DD. Default today.' },
    },
  },
};

const WHO_CAME: Anthropic.Messages.Tool = {
  name: 'who_came',
  description: 'Who was marked present on a date, per class, with makeup / paid-outside flags.',
  input_schema: {
    type: 'object',
    properties: { class: CLASS_PROP, date: DATE_PROP },
  },
};

const DROP_INS_OWED: Anthropic.Messages.Tool = {
  name: 'drop_ins_owed',
  description:
    'Who owes the drop-in charge for one class meeting, with a reason per person, the drop-in price ' +
    'and the total. Not enrolled = drop-in; enrolled but ahead of meetings held = drop-in; makeups ' +
    'and people already marked paid are excluded.',
  input_schema: {
    type: 'object',
    properties: { class: CLASS_PROP, date: DATE_PROP },
    required: ['class'],
  },
};

const MARK_ATTENDANCE: Anthropic.Messages.Tool = {
  name: 'mark_attendance',
  description:
    'Mark people present at one class meeting. Names are matched to the roster, then to known ' +
    'people; unmatched or ambiguous names are returned, NOT recorded. Pass guest_names only for ' +
    'people the director confirmed are not in ClubMode.',
  input_schema: {
    type: 'object',
    properties: {
      class: CLASS_PROP,
      date: DATE_PROP,
      names: { type: 'array', items: { type: 'string' }, description: 'As the director typed them.' },
      guest_names: {
        type: 'array',
        items: { type: 'string' },
        description: 'Confirmed guests not in ClubMode; recorded by name only.',
      },
    },
    required: ['class', 'names'],
  },
};

const ADD_EXTRA_MEETING: Anthropic.Messages.Tool = {
  name: 'add_extra_meeting',
  description:
    'Record an unscheduled session of a class (an extra column on the sheet). Set makes_up_for to ' +
    'the rained-out date it replaces, so it counts toward what season sign-ups are owed.',
  input_schema: {
    type: 'object',
    properties: {
      class: CLASS_PROP,
      date: DATE_PROP,
      makes_up_for: { type: 'string', description: 'YYYY-MM-DD of the cancelled meeting, if any.' },
      note: { type: 'string' },
    },
    required: ['class'],
  },
};

const MARK_MAKEUP: Anthropic.Messages.Tool = {
  name: 'mark_makeup',
  description:
    'Count one person\'s attendance at a meeting as a makeup, so it never owes a drop-in. They must ' +
    'already be marked present.',
  input_schema: {
    type: 'object',
    properties: {
      class: CLASS_PROP,
      date: DATE_PROP,
      name: { type: 'string' },
      note: { type: 'string', description: 'e.g. "for the 9/17 rainout".' },
    },
    required: ['class', 'name'],
  },
};

const MARK_PAID_OUTSIDE: Anthropic.Messages.Tool = {
  name: 'mark_drop_in_paid',
  description:
    'Record that a person paid for a meeting outside ClubMode (Venmo, cash, check). No money moves. ' +
    'They must already be marked present.',
  input_schema: {
    type: 'object',
    properties: {
      class: CLASS_PROP,
      date: DATE_PROP,
      name: { type: 'string' },
      method: { type: 'string', description: 'How they paid, e.g. "Venmo".' },
    },
    required: ['class', 'name'],
  },
};

const CHARGE_DROP_INS: Anthropic.Messages.Tool = {
  name: 'charge_drop_ins',
  description:
    'Charge the drop-ins for one meeting to their saved card through the club\'s Square. Only ' +
    'possible with Square connected AND a card on file in ClubMode; otherwise it refuses and says why.',
  input_schema: {
    type: 'object',
    properties: { class: CLASS_PROP, date: DATE_PROP },
    required: ['class'],
  },
};

// ------------------------------------------------------------------ types

type Program = {
  id: string;
  title: string;
  status: string;
  range_start: string;
  range_end: string;
  days_of_week: number[] | null;
  exclusions: string[] | null;
  drop_in_price_cents: number | null;
};

type Registration = {
  id: string;
  participant_name: string;
  status: string;
  payment_status: string;
  master_player_id: string | null;
};

type VaultPerson = { id: string; full_name: string; master_player_id: string | null };

type AttendanceRow = {
  id: string;
  program_id: string;
  meeting_date: string;
  name: string;
  person_key: string;
  registration_id: string | null;
  vault_player_id: string | null;
  is_makeup: boolean;
  makeup_note: string | null;
  paid_outside_at: string | null;
  paid_outside_note: string | null;
};

type ExtraMeeting = { id: string; program_id: string; meeting_date: string; makes_up_for: string | null };

type Fail = { ok: false; error: string } & Record<string, unknown>;
const fail = (error: string, extra: Record<string, unknown> = {}): Fail => ({ ok: false, error, ...extra });
const isFail = (v: unknown): v is Fail => !!v && typeof v === 'object' && (v as Fail).ok === false;

const PROGRAM_COLS =
  'id, title, status, range_start, range_end, days_of_week, exclusions, drop_in_price_cents';

// ------------------------------------------------------------------ helpers

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export function todayIn(tz: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function mondayOf(ymd: string): string {
  const dow = new Date(`${ymd}T12:00:00Z`).getUTCDay(); // 0=Sun
  return addDays(ymd, dow === 0 ? -6 : 1 - dow);
}

function readDate(raw: unknown, ctx: Ctx): string | Fail {
  const s = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (!s || s === 'today' || s === 'tonight') return todayIn(ctx.timeZone);
  if (s === 'yesterday') return addDays(todayIn(ctx.timeZone), -1);
  if (!YMD.test(s)) return fail('date must be YYYY-MM-DD (or "today").');
  return s;
}

const label = (ymd: string, ctx: Ctx) => formatSessionDate(ymd, ctx.timeZone, { weekday: true });

/** The attendance tables are added by a migration that may not have been run yet. */
function tableMissing(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | null;
  if (!e) return false;
  return e.code === '42P01' || e.code === 'PGRST205' || /does not exist|could not find the table/i.test(e.message ?? '');
}
const NOT_INSTALLED = fail(
  "Class attendance isn't switched on yet: ClubMode has no attendance table until the " +
    'club_program_attendance migration is run. Nothing was recorded.',
);

function canMark(ctx: Ctx) {
  return MANAGER_ROLES.has(ctx.role) || ctx.role === 'coach';
}
function canManage(ctx: Ctx) {
  return MANAGER_ROLES.has(ctx.role);
}

// --------------------------------------------------------------- name match

export function nameTokens(s: string): string[] {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’.-]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter(Boolean);
}

function lev(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

/** 0 = exact, 1 = every typed word is a word of theirs (or an initial), 2 = close spelling. */
function tierOf(typed: string[], cand: string[]): number | null {
  if (typed.length === 0 || cand.length === 0) return null;
  if (typed.join(' ') === cand.join(' ')) return 0;
  const every = (ok: (t: string, c: string) => boolean) => typed.every((t) => cand.some((c) => ok(t, c)));
  if (every((t, c) => t === c || (t.length === 1 && c.startsWith(t)))) return 1;
  if (
    every(
      (t, c) =>
        t === c ||
        (t.length === 1 && c.startsWith(t)) ||
        (t.length >= 3 && c.startsWith(t)) ||
        (t.length >= 4 && lev(t, c) <= 1) ||
        (t.length >= 7 && lev(t, c) <= 2),
    )
  )
    return 2;
  return null;
}

export type Candidate = { key: string; name: string; source: 'roster' | 'known' } & Record<string, unknown>;
export type MatchResult =
  | { kind: 'match'; typed: string; person: Candidate }
  | { kind: 'ambiguous'; typed: string; could_be: string[]; keys: string[] }
  | { kind: 'none'; typed: string };

/**
 * One typed name against the roster, then known people. Exact beats a first
 * name beats a near-spelling, and at each level the roster is asked first.
 * More than one hit at the deciding level is ambiguous: we ask, never pick.
 */
export function matchName(typed: string, roster: Candidate[], known: Candidate[]): MatchResult {
  const t = nameTokens(typed);
  for (const tier of [0, 1, 2]) {
    for (const pool of [roster, known]) {
      const hits = pool.filter((c) => tierOf(t, nameTokens(c.name)) === tier);
      const unique = [...new Map(hits.map((h) => [h.key, h])).values()];
      if (unique.length === 1) return { kind: 'match', typed, person: unique[0] };
      if (unique.length > 1)
        return { kind: 'ambiguous', typed, could_be: unique.map((h) => h.name), keys: unique.map((h) => h.key) };
    }
  }
  return { kind: 'none', typed };
}

// ------------------------------------------------------------------ loaders

async function resolveProgram(ctx: Ctx, ref: unknown): Promise<Program | Fail> {
  const raw = typeof ref === 'string' ? ref.trim() : '';
  if (!raw) return fail('Which class? Give its name or id.');
  const { data } = await ctx.db
    .from('club_programs')
    .select(PROGRAM_COLS)
    .eq('club_id', ctx.clubId)
    .neq('status', 'archived');
  const rows = (data as Program[] | null) ?? [];
  const byId = rows.find((p) => p.id === raw);
  if (byId) return byId;
  // Titles carry filler a director may or may not say ("tonight's ... clinic").
  const FILLER = ['the', 'tonights', 'todays', 'class', 'clinic'];
  const strip = (t: string) => nameTokens(t).filter((w) => !FILLER.includes(w)).join(' ');
  const cands: Candidate[] = rows.map((p) => ({ key: p.id, name: strip(p.title) || p.title, source: 'roster' }));
  const m = matchName(strip(raw) || raw, cands, []);
  if (m.kind === 'match') return rows.find((p) => p.id === m.person.key)!;
  if (m.kind === 'ambiguous') {
    return fail(`More than one class could be "${raw}". Which one?`, {
      classes: rows.filter((p) => m.keys.includes(p.id)).map((p) => p.title),
    });
  }
  return fail(`No class called "${raw}".`, { classes: rows.map((p) => p.title) });
}

async function loadExtras(ctx: Ctx, programIds: string[]): Promise<ExtraMeeting[] | Fail> {
  if (programIds.length === 0) return [];
  const { data, error } = await ctx.db
    .from('club_program_extra_meetings')
    .select('id, program_id, meeting_date, makes_up_for')
    .eq('club_id', ctx.clubId)
    .in('program_id', programIds);
  if (error) return tableMissing(error) ? NOT_INSTALLED : fail(String((error as { message?: string }).message));
  return (data as ExtraMeeting[] | null) ?? [];
}

async function loadAttendance(
  ctx: Ctx,
  programIds: string[],
  range: { from?: string; to: string },
): Promise<AttendanceRow[] | Fail> {
  if (programIds.length === 0) return [];
  let q = ctx.db
    .from('club_program_attendance')
    .select(
      'id, program_id, meeting_date, name, person_key, registration_id, vault_player_id, is_makeup, makeup_note, paid_outside_at, paid_outside_note',
    )
    .eq('club_id', ctx.clubId)
    .in('program_id', programIds)
    .lte('meeting_date', range.to);
  if (range.from) q = q.gte('meeting_date', range.from);
  const { data, error } = await q;
  if (error) return tableMissing(error) ? NOT_INSTALLED : fail(String((error as { message?: string }).message));
  return (data as AttendanceRow[] | null) ?? [];
}

async function loadRoster(ctx: Ctx, programId: string): Promise<Registration[]> {
  const { data } = await ctx.db
    .from('club_program_registrations')
    .select('id, participant_name, status, payment_status, master_player_id')
    .eq('club_id', ctx.clubId)
    .eq('program_id', programId)
    .in('status', ['enrolled', 'waitlist']);
  return (data as Registration[] | null) ?? [];
}

async function loadKnown(ctx: Ctx): Promise<VaultPerson[]> {
  const { data } = await ctx.db
    .from('cc_vault_players')
    .select('id, full_name, master_player_id')
    .eq('club_id', ctx.clubId)
    .limit(5000);
  return (data as VaultPerson[] | null) ?? [];
}

/** Season sign-up that covers meetings: enrolled and not refunded. */
const isSeason = (r: Registration | undefined) => !!r && r.status === 'enrolled' && r.payment_status !== 'refunded';

/** Scheduled meeting dates plus extra sessions, for one class. */
function meetingDates(ctx: Ctx, p: Program, extras: ExtraMeeting[]): { scheduled: string[]; extra: string[] } {
  return {
    scheduled: programSessions(p, ctx.timeZone).dates,
    extra: extras.filter((e) => e.program_id === p.id).map((e) => e.meeting_date.slice(0, 10)),
  };
}

/** The class + date + extras, validated as a real meeting. */
async function loadMeeting(ctx: Ctx, input: any) {
  const program = await resolveProgram(ctx, input?.class);
  if (isFail(program)) return program;
  const date = readDate(input?.date, ctx);
  if (isFail(date)) return date;
  const extras = await loadExtras(ctx, [program.id]);
  if (isFail(extras)) return extras;
  const { scheduled, extra } = meetingDates(ctx, program, extras);
  const isScheduled = scheduled.includes(date);
  const isExtra = extra.includes(date);
  return { program, date, extras, scheduled, isScheduled, isExtra };
}

function notAMeeting(program: Program, date: string, ctx: Ctx): Fail {
  return fail(
    `${program.title} doesn't meet on ${label(date, ctx)}. If you ran an extra session, add it first ` +
      'with add_extra_meeting.',
  );
}

// ------------------------------------------------------------ drop-in rules

export type DropInLine = { name: string; reason: string; amount_cents: number | null; attendance_id: string; person_key: string };

/**
 * Who owes a drop-in for one meeting. Pure: the rule, separate from the I/O.
 *
 * Someone not enrolled owes for every meeting they attend, unless it is a
 * makeup or already paid outside ClubMode.
 *
 * Someone enrolled is walked through their own attendance in date order. Each
 * meeting uses one of the slots the season has given them so far (scheduled
 * meetings held to that date, plus extra sessions that made up a rainout).
 * A meeting with no slot left is a drop-in: they are AHEAD. A makeup takes a
 * slot if one is free and never owes. A meeting paid outside ClubMode never
 * takes a slot. Walking in order means a meeting that was already a drop-in
 * last week is not counted against them again this week.
 */
export function assessDropIns(opts: {
  program: Program;
  date: string;
  scheduled: string[];
  extras: ExtraMeeting[];
  rows: AttendanceRow[];
  roster: Registration[];
}) {
  const { program, date } = opts;
  const price = program.drop_in_price_cents;
  const day = (r: { meeting_date: string }) => r.meeting_date.slice(0, 10);
  const makeups = opts.extras
    .filter((e) => e.program_id === program.id && e.makes_up_for)
    .map((e) => e.meeting_date.slice(0, 10));
  const entitledBy = (d: string) =>
    opts.scheduled.filter((x) => x <= d).length + makeups.filter((x) => x <= d).length;
  const regs = new Map(opts.roster.map((r) => [r.id, r]));

  /** Every row's verdict, keyed by row id, walking each person in date order. */
  const verdict = new Map<string, { owes: boolean; reason: string }>();
  const people = new Map<string, AttendanceRow[]>();
  for (const r of opts.rows.filter((r) => day(r) <= date)) {
    people.set(r.person_key, [...(people.get(r.person_key) ?? []), r]);
  }
  for (const rows of people.values()) {
    rows.sort((x, y) => day(x).localeCompare(day(y)));
    let used = 0;
    for (const r of rows) {
      const reg = r.registration_id ? regs.get(r.registration_id) : undefined;
      const season = isSeason(reg);
      if (r.paid_outside_at) {
        verdict.set(r.id, { owes: false, reason: `paid outside ClubMode${r.paid_outside_note ? ` (${r.paid_outside_note})` : ''}` });
      } else if (r.is_makeup) {
        if (season && used < entitledBy(day(r))) used += 1;
        verdict.set(r.id, { owes: false, reason: `makeup${r.makeup_note ? ` (${r.makeup_note})` : ''}` });
      } else if (!season) {
        verdict.set(r.id, {
          owes: true,
          reason: reg?.status === 'waitlist' ? 'on the waitlist, not enrolled' : 'not enrolled in this class',
        });
      } else if (used < entitledBy(day(r))) {
        used += 1;
        verdict.set(r.id, { owes: false, reason: 'season' });
      } else {
        verdict.set(r.id, {
          owes: true,
          reason: `ahead: more meetings attended than the ${entitledBy(day(r))} held so far`,
        });
      }
    }
  }

  const owes: DropInLine[] = [];
  const settled: { name: string; how: string }[] = [];
  let covered = 0;
  for (const r of opts.rows.filter((r) => day(r) === date)) {
    const v = verdict.get(r.id)!;
    if (v.owes) owes.push({ name: r.name, reason: v.reason, amount_cents: price, attendance_id: r.id, person_key: r.person_key });
    else if (v.reason === 'season') covered += 1;
    else settled.push({ name: r.name, how: v.reason });
  }

  const total = price == null ? null : owes.length * price;
  return { owes, settled, covered_by_season: covered, price_cents: price, total_cents: total, entitled: entitledBy(date) };
}

async function dropInPlan(ctx: Ctx, input: any) {
  const m = await loadMeeting(ctx, input);
  if (isFail(m)) return m;
  if (!m.isScheduled && !m.isExtra) return notAMeeting(m.program, m.date, ctx);
  const rows = await loadAttendance(ctx, [m.program.id], { to: m.date });
  if (isFail(rows)) return rows;
  const roster = await loadRoster(ctx, m.program.id);
  const a = assessDropIns({ program: m.program, date: m.date, scheduled: m.scheduled, extras: m.extras, rows, roster });
  return { ...m, rows, ...a };
}

// --------------------------------------------------------------- write plans

async function attendancePlan(ctx: Ctx, input: any) {
  if (!canMark(ctx)) return fail('Only a director, owner or coach can mark attendance.');
  const m = await loadMeeting(ctx, input);
  if (isFail(m)) return m;
  if (!m.isScheduled && !m.isExtra) return notAMeeting(m.program, m.date, ctx);

  const existing = await loadAttendance(ctx, [m.program.id], { from: m.date, to: m.date });
  if (isFail(existing)) return existing;
  const [roster, known] = await Promise.all([loadRoster(ctx, m.program.id), loadKnown(ctx)]);

  const rosterC: Candidate[] = roster.map((r) => ({ key: `reg:${r.id}`, name: r.participant_name, source: 'roster', reg: r }));
  const onRoster = new Set(roster.map((r) => r.master_player_id).filter(Boolean));
  // A known person who IS the roster entry is the roster entry, not a second person.
  const knownC: Candidate[] = known
    .filter((v) => !(v.master_player_id && onRoster.has(v.master_player_id)))
    .map((v) => ({ key: `vault:${v.id}`, name: v.full_name, source: 'known', vault: v }));

  const typed: string[] = (Array.isArray(input?.names) ? input.names : []).map(String).filter((s: string) => s.trim());
  const guests: string[] = (Array.isArray(input?.guest_names) ? input.guest_names : []).map(String).filter((s: string) => s.trim());
  if (typed.length + guests.length === 0) return fail('No names given.');

  const already = new Set(existing.map((r) => r.person_key));
  const toInsert = new Map<string, Record<string, unknown>>();
  const willMark: { name: string; typed: string; on_roster: boolean; note?: string }[] = [];
  const alreadyMarked: string[] = [];
  const unmatched: string[] = [];
  const ambiguous: { typed: string; could_be: string[] }[] = [];

  const add = (typedName: string, key: string, name: string, extra: Record<string, unknown>, onR: boolean, note?: string) => {
    if (already.has(key)) return void alreadyMarked.push(name);
    if (toInsert.has(key)) return;
    toInsert.set(key, {
      club_id: ctx.clubId,
      program_id: m.program.id,
      meeting_date: m.date,
      name,
      person_key: key,
      registration_id: null,
      vault_player_id: null,
      marked_by: ctx.userId,
      ...extra,
    });
    willMark.push({ name, typed: typedName, on_roster: onR, ...(note ? { note } : {}) });
  };

  for (const t of typed) {
    const r = matchName(t, rosterC, knownC);
    if (r.kind === 'none') unmatched.push(t);
    else if (r.kind === 'ambiguous') ambiguous.push({ typed: t, could_be: r.could_be });
    else if (r.person.source === 'roster') {
      const reg = r.person.reg as Registration;
      add(t, r.person.key, reg.participant_name, { registration_id: reg.id }, true,
        isSeason(reg) ? undefined : 'on the roster but not enrolled: drop-in candidate');
    } else {
      const v = r.person.vault as VaultPerson;
      add(t, r.person.key, v.full_name, { vault_player_id: v.id }, false, 'not on this class roster: drop-in candidate');
    }
  }
  for (const g of guests) {
    const clean = g.trim().replace(/\s+/g, ' ');
    add(g, `name:${nameTokens(clean).join(' ')}`, clean, {}, false, 'guest not in ClubMode: drop-in candidate');
  }

  const summary = {
    class: m.program.title,
    date: m.date,
    meeting: label(m.date, ctx),
    ...(m.isExtra && !m.isScheduled ? { extra_session: true } : {}),
    will_mark: willMark,
    already_marked: alreadyMarked,
    unmatched,
    ambiguous,
  };
  if (toInsert.size === 0) {
    return fail(
      alreadyMarked.length && !unmatched.length && !ambiguous.length
        ? 'Everyone named is already marked present.'
        : 'Nobody to mark. Check the unmatched/ambiguous names with the director.',
      summary,
    );
  }
  return { ok: true as const, ...summary, rows: [...toInsert.values()] };
}

async function extraMeetingPlan(ctx: Ctx, input: any) {
  if (!canManage(ctx)) return fail('Only a director or owner can add a session.');
  const m = await loadMeeting(ctx, input);
  if (isFail(m)) return m;
  if (m.isScheduled) return fail(`${m.program.title} already meets on ${label(m.date, ctx)}. No extra session needed.`);
  if (m.isExtra) return fail(`An extra session on ${label(m.date, ctx)} is already recorded.`);
  let makesUpFor: string | null = null;
  if (input?.makes_up_for) {
    const d = String(input.makes_up_for).trim();
    if (!YMD.test(d)) return fail('makes_up_for must be YYYY-MM-DD.');
    const s = programSessions(m.program, ctx.timeZone);
    if (!s.dates.includes(d) && !s.skipped.includes(d))
      return fail(`${m.program.title} was never due to meet on ${label(d, ctx)}, so there is nothing to make up.`);
    if (m.extras.some((e) => e.makes_up_for === d))
      return fail(`Another extra session already makes up ${label(d, ctx)}.`);
    makesUpFor = d;
  }
  const row = {
    club_id: ctx.clubId,
    program_id: m.program.id,
    meeting_date: m.date,
    makes_up_for: makesUpFor,
    note: typeof input?.note === 'string' ? input.note.slice(0, 500) : null,
    created_by: ctx.userId,
  };
  return {
    ok: true as const,
    class: m.program.title,
    adding: label(m.date, ctx),
    makes_up_for: makesUpFor ? label(makesUpFor, ctx) : null,
    counts_toward_season: Boolean(makesUpFor),
    row,
  };
}

/** Find the one attendance row for a named person at a meeting. */
async function attendeePlan(ctx: Ctx, input: any, verb: string) {
  if (!canManage(ctx)) return fail(`Only a director or owner can ${verb}.`);
  const m = await loadMeeting(ctx, input);
  if (isFail(m)) return m;
  const rows = await loadAttendance(ctx, [m.program.id], { from: m.date, to: m.date });
  if (isFail(rows)) return rows;
  const name = String(input?.name ?? '').trim();
  if (!name) return fail('Whose attendance?');
  const cands: Candidate[] = rows.map((r) => ({ key: r.id, name: r.name, source: 'roster' }));
  const hit = matchName(name, cands, []);
  if (hit.kind === 'ambiguous') return fail(`More than one person present could be "${name}".`, { could_be: hit.could_be });
  if (hit.kind === 'none')
    return fail(`${name} isn't marked present at ${m.program.title} on ${label(m.date, ctx)}. Mark attendance first.`, {
      present: rows.map((r) => r.name),
    });
  const row = rows.find((r) => r.id === hit.person.key)!;
  return { ok: true as const, m, row };
}

async function makeupPlan(ctx: Ctx, input: any) {
  const a = await attendeePlan(ctx, input, 'mark a makeup');
  if (isFail(a)) return a;
  if (a.row.is_makeup) return fail(`${a.row.name} is already counted as a makeup that day.`);
  if (a.row.paid_outside_at) return fail(`${a.row.name} already paid for that day; a makeup would not change anything.`);
  const note = typeof input?.note === 'string' ? input.note.slice(0, 300) : null;
  return {
    ok: true as const,
    class: a.m.program.title,
    meeting: label(a.m.date, ctx),
    person: a.row.name,
    note,
    id: a.row.id,
    patch: { is_makeup: true, makeup_note: note, updated_at: new Date().toISOString() },
  };
}

async function paidPlan(ctx: Ctx, input: any) {
  const a = await attendeePlan(ctx, input, 'mark someone paid');
  if (isFail(a)) return a;
  if (a.row.paid_outside_at) return fail(`${a.row.name} is already marked paid for that day.`);
  const method = typeof input?.method === 'string' && input.method.trim() ? input.method.trim().slice(0, 100) : 'outside ClubMode';
  return {
    ok: true as const,
    class: a.m.program.title,
    meeting: label(a.m.date, ctx),
    person: a.row.name,
    method,
    amount: formatPrice(a.m.program.drop_in_price_cents),
    note: 'Records the payment only. No money moves through ClubMode.',
    id: a.row.id,
    patch: { paid_outside_at: new Date().toISOString(), paid_outside_note: method, updated_at: new Date().toISOString() },
  };
}

/**
 * The charge plan. Shared by preview and run, and it ALWAYS refuses before
 * anything could be charged: ClubMode keeps no saved cards, so there is no
 * card to charge, and no second path is invented to get around that.
 */
async function chargePlan(ctx: Ctx, input: any): Promise<ToolResult> {
  if (!canManage(ctx)) return fail('Only a director or owner can charge anyone.');
  const plan = await dropInPlan(ctx, input);
  if (isFail(plan)) return plan;
  const list = plan.owes.map((o) => ({ name: o.name, amount: formatPrice(o.amount_cents), reason: o.reason }));
  if (plan.owes.length === 0) return fail('Nobody owes a drop-in for that meeting.', { settled: plan.settled });

  const { data } = await ctx.db
    .from('club_payments')
    .select('provider, provider_status')
    .eq('club_id', ctx.clubId)
    .maybeSingle();
  const payments: ClubPayments = { ...DEFAULT_PAYMENTS, ...((data as Partial<ClubPayments> | null) ?? {}) };
  const base = {
    class: plan.program.title,
    meeting: label(plan.date, ctx),
    would_charge: list,
    total: plan.total_cents == null ? 'drop-in price not set' : formatPrice(plan.total_cents),
    instead:
      'Collect it however the club normally does, then say "mark <name> paid for <date>" to record it. ' +
      'ClubMode has no drop-in payment link yet (Square checkout links exist only for class sign-ups ' +
      'and court bookings).',
  };
  if (!cardConnected(payments)) {
    return fail("Nothing charged: this club hasn't connected Square to ClubMode (Club site > Payments).", base);
  }
  return fail(
    'Nothing charged: ClubMode does not keep cards on file, so there is no saved card to charge for anyone. ' +
      "The club's Square connection takes checkout payments only.",
    base,
  );
}

// --------------------------------------------------------------------- tools

const strip = <T extends Record<string, unknown>>(o: T, ...keys: string[]) => {
  const c: Record<string, unknown> = { ...o };
  for (const k of keys) delete c[k];
  return c;
};

const tools: ToolDef<Ctx>[] = [
  {
    schema: ATTENDANCE_STATUS,
    async run(input, ctx) {
      const today = todayIn(ctx.timeZone);
      const to = input?.to && YMD.test(String(input.to)) ? String(input.to) : today;
      const from = input?.from && YMD.test(String(input.from)) ? String(input.from) : mondayOf(today);
      let programs: Program[];
      if (input?.class) {
        const p = await resolveProgram(ctx, input.class);
        if (isFail(p)) return p;
        programs = [p];
      } else {
        const { data } = await ctx.db.from('club_programs').select(PROGRAM_COLS).eq('club_id', ctx.clubId).neq('status', 'archived');
        programs = (data as Program[] | null) ?? [];
      }
      const ids = programs.map((p) => p.id);
      const extras = await loadExtras(ctx, ids);
      if (isFail(extras)) return extras;
      const rows = await loadAttendance(ctx, ids, { from, to });
      if (isFail(rows)) return rows;
      const { data: regs } = ids.length
        ? await ctx.db.from('club_program_registrations').select('program_id, status').eq('club_id', ctx.clubId).in('program_id', ids).eq('status', 'enrolled')
        : { data: [] };
      const enrolled = new Map<string, number>();
      for (const r of (regs as { program_id: string }[] | null) ?? []) enrolled.set(r.program_id, (enrolled.get(r.program_id) ?? 0) + 1);

      const meetings: Record<string, unknown>[] = [];
      for (const p of programs) {
        const { scheduled, extra } = meetingDates(ctx, p, extras);
        const dates = [...new Set([...scheduled, ...extra])].filter((d) => d >= from && d <= to).sort();
        for (const d of dates) {
          const n = rows.filter((r) => r.program_id === p.id && r.meeting_date.slice(0, 10) === d).length;
          meetings.push({
            class: p.title,
            date: d,
            meeting: label(d, ctx),
            ...(extra.includes(d) && !scheduled.includes(d) ? { extra_session: true } : {}),
            marked_present: n,
            enrolled: enrolled.get(p.id) ?? 0,
            attendance: n > 0 ? 'in' : 'NOT in',
          });
        }
      }
      return {
        ok: true,
        today,
        range: { from, to },
        meetings,
        missing: meetings.filter((m) => m.attendance === 'NOT in').length,
      };
    },
  },

  {
    schema: WHO_CAME,
    async run(input, ctx) {
      const date = readDate(input?.date, ctx);
      if (isFail(date)) return date;
      let programs: Program[];
      if (input?.class) {
        const p = await resolveProgram(ctx, input.class);
        if (isFail(p)) return p;
        programs = [p];
      } else {
        const { data } = await ctx.db.from('club_programs').select(PROGRAM_COLS).eq('club_id', ctx.clubId).neq('status', 'archived');
        programs = (data as Program[] | null) ?? [];
      }
      const rows = await loadAttendance(ctx, programs.map((p) => p.id), { from: date, to: date });
      if (isFail(rows)) return rows;
      const classes = programs
        .map((p) => {
          const here = rows.filter((r) => r.program_id === p.id);
          return {
            class: p.title,
            present: here.map((r) => ({
              name: r.name,
              ...(r.is_makeup ? { makeup: r.makeup_note || true } : {}),
              ...(r.paid_outside_at ? { paid: r.paid_outside_note || 'outside ClubMode' } : {}),
              ...(r.registration_id ? {} : { not_on_roster: true }),
            })),
          };
        })
        .filter((c) => c.present.length > 0);
      return { ok: true, date, meeting: label(date, ctx), classes, note: classes.length ? undefined : 'Nobody marked present that day.' };
    },
  },

  {
    schema: DROP_INS_OWED,
    async run(input, ctx) {
      const plan = await dropInPlan(ctx, input);
      if (isFail(plan)) return plan;
      return {
        ok: true,
        class: plan.program.title,
        meeting: label(plan.date, ctx),
        drop_in_price: plan.price_cents == null ? 'not set on this class' : formatPrice(plan.price_cents),
        meetings_held_so_far: plan.entitled,
        owes: plan.owes.map((o) => ({ name: o.name, reason: o.reason, amount: formatPrice(o.amount_cents) })),
        total: plan.total_cents == null ? null : formatPrice(plan.total_cents),
        already_settled: plan.settled,
        covered_by_season: plan.covered_by_season,
      };
    },
  },

  {
    schema: MARK_ATTENDANCE,
    destructive: true,
    async preview(input, ctx) {
      const p = await attendancePlan(ctx, input);
      return isFail(p) ? p : strip(p, 'rows') as ToolResult;
    },
    async run(input, ctx) {
      const p = await attendancePlan(ctx, input);
      if (isFail(p)) return p;
      const { error } = await ctx.db.from('club_program_attendance').insert(p.rows);
      if (error) {
        if (tableMissing(error)) return NOT_INSTALLED;
        if ((error as { code?: string }).code === '23505')
          return fail('Someone marked this meeting at the same moment. Nothing doubled; ask again to see who is in.');
        return fail(String((error as { message?: string }).message));
      }
      return { ...(strip(p, 'rows') as ToolResult), ok: true, marked: p.will_mark.length };
    },
  },

  {
    schema: ADD_EXTRA_MEETING,
    destructive: true,
    async preview(input, ctx) {
      const p = await extraMeetingPlan(ctx, input);
      return isFail(p) ? p : strip(p, 'row') as ToolResult;
    },
    async run(input, ctx) {
      const p = await extraMeetingPlan(ctx, input);
      if (isFail(p)) return p;
      const { error } = await ctx.db.from('club_program_extra_meetings').insert(p.row);
      if (error) return tableMissing(error) ? NOT_INSTALLED : fail(String((error as { message?: string }).message));
      return { ...(strip(p, 'row') as ToolResult), ok: true, added: true };
    },
  },

  {
    schema: MARK_MAKEUP,
    destructive: true,
    async preview(input, ctx) {
      const p = await makeupPlan(ctx, input);
      return isFail(p) ? p : strip(p, 'id', 'patch') as ToolResult;
    },
    async run(input, ctx) {
      const p = await makeupPlan(ctx, input);
      if (isFail(p)) return p;
      const { error } = await ctx.db
        .from('club_program_attendance')
        .update(p.patch)
        .eq('id', p.id)
        .eq('club_id', ctx.clubId);
      if (error) return fail(String((error as { message?: string }).message));
      return { ...(strip(p, 'id', 'patch') as ToolResult), ok: true, marked_makeup: true };
    },
  },

  {
    schema: MARK_PAID_OUTSIDE,
    destructive: true,
    async preview(input, ctx) {
      const p = await paidPlan(ctx, input);
      return isFail(p) ? p : strip(p, 'id', 'patch') as ToolResult;
    },
    async run(input, ctx) {
      const p = await paidPlan(ctx, input);
      if (isFail(p)) return p;
      // .is(null) so two confirms can never both record it.
      const { error } = await ctx.db
        .from('club_program_attendance')
        .update(p.patch)
        .eq('id', p.id)
        .eq('club_id', ctx.clubId)
        .is('paid_outside_at', null);
      if (error) return fail(String((error as { message?: string }).message));
      return { ...(strip(p, 'id', 'patch') as ToolResult), ok: true, recorded: true };
    },
  },

  {
    schema: CHARGE_DROP_INS,
    destructive: true,
    // The same plan both ways, and it refuses before any money could move.
    preview: (input, ctx) => chargePlan(ctx, input),
    run: (input, ctx) => chargePlan(ctx, input),
  },
];

export const attendancePack: DomainPack<Ctx> = {
  domain: 'attendance',
  actionsPrompt: `
ATTENDANCE — class attendance and drop-ins.

- Mark who came with mark_attendance, passing the names exactly as typed. Read back will_mark, and say
  which names were unmatched or ambiguous; never guess those. Only pass guest_names for people the
  director confirmed are not in ClubMode.
- "Is attendance in?" → attendance_status. "Who came on <date>?" → who_came.
- Extra session → add_extra_meeting (set makes_up_for when it replaces a rainout), then mark attendance.
- "Who needs the drop-in charge?" → drop_ins_owed. Give each name, the reason and the total.
- "Count it as a makeup" → mark_makeup. "They Venmo'd me" → mark_drop_in_paid (records it; no money moves).
- charge_drop_ins: ClubMode cannot charge saved cards today. Relay its refusal and the list plainly.
- Every change previews first; show the specifics and wait for a clear yes.
- Dates are club-local YYYY-MM-DD; "tonight" is today. If a class name is ambiguous, ask which.
- If a tool says attendance isn't switched on yet, say so; do not record it anywhere else.
`.trim(),
  async resolve(userId, page) {
    void page;
    return resolveClubCtx(userId);
  },
  tools,
};
