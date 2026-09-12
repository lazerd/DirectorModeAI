import type Anthropic from '@anthropic-ai/sdk';
import type { DomainPack, ToolDef } from '../framework';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import {
  daysLabel,
  formatPrice,
  formatSessionDate,
  formatTimeRange,
  programSessions,
} from '@/lib/programs/sessions';
import { priceBooking, toHHMM, toMinutes, type RateCard } from '@/lib/courts/pricing';
import { resyncProgramBlocks, type BlockableProgram } from '@/lib/programs/courtBlocks';
import { CLUB_TZ } from '@/lib/captain/clubTime';
import { resolveActiveClub } from '@/lib/clubs/activeClub';

/*
 * Club site pack — conversational control of the club's website, its classes
 * and its court prices.
 *
 * The jobs a director does between seasons are the ones that are tedious as
 * clicks and natural as speech: "skip Thanksgiving week on the after-school
 * class", "make Tuesday evenings thirty dollars", "how many families are in
 * Pee-Wee?". Those are three screens and about nine clicks, or one sentence.
 *
 * WHY THIS IS A SMALL FILE. Every verb here already existed as a validated,
 * permission-gated API endpoint before the pack did. The tools call the same
 * helpers those routes call, so the assistant cannot do anything a director
 * could not do by hand, and cannot do it in a way the hand path would refuse.
 * A pack that reimplemented the writes would be a second set of rules to keep
 * in step with the first.
 *
 * WHAT IT DELIBERATELY CANNOT DO:
 *   - Publish or unpublish a site or a class. Going live is a decision, not a
 *     chore, and it is one click on a screen the director is already looking at.
 *   - Send anything. Email to families goes out from the Notify panel where the
 *     recipient count and the diff are on screen together.
 *   - Delete a class. Archiving keeps registrations, and deciding between them
 *     needs the roster in view.
 *   - Change anything about who has paid.
 *
 * Every write is marked destructive, so the framework forces preview → confirm
 * in code rather than trusting the model to remember to ask.
 */

interface Ctx {
  userId: string;
  db: ReturnType<typeof getSupabaseAdmin>;
  clubId: string;
  clubName: string;
  clubSlug: string;
  timeZone: string;
}

// ---------------------------------------------------------------- read tools

const LIST_CLASSES: Anthropic.Messages.Tool = {
  name: 'list_classes',
  description:
    "List the club's classes with their real meeting dates, skip dates, prices, capacity and how many " +
    'families are signed up. Use this before answering anything about a class, and to find a class id.',
  input_schema: {
    type: 'object',
    properties: {
      include_drafts: {
        type: 'boolean',
        description: 'Include unpublished classes. Default true, since a director owns both.',
      },
    },
  },
};

const CLASS_ROSTER: Anthropic.Messages.Tool = {
  name: 'class_roster',
  description:
    'Who is signed up for one class: enrolled, waitlisted, and who still owes money. ' +
    'Returns counts and names. Use it when asked who is in a class or who has not paid.',
  input_schema: {
    type: 'object',
    properties: {
      class_id: { type: 'string', description: 'The class id from list_classes.' },
    },
    required: ['class_id'],
  },
};

const LIST_RATES: Anthropic.Messages.Tool = {
  name: 'list_court_rates',
  description:
    "The club's court rate cards — who each rate is for, which days and hours it covers, the price per " +
    'hour, and how far ahead that audience may book. Online court booking is ON when at least one rate ' +
    'is active.',
  input_schema: { type: 'object', properties: {} },
};

const QUOTE_COURT: Anthropic.Messages.Tool = {
  name: 'quote_court_price',
  description:
    'What a specific court booking would cost, using the same pricing engine the booking page uses. ' +
    'Handles a booking that crosses two rates. Use this rather than doing the arithmetic yourself.',
  input_schema: {
    type: 'object',
    properties: {
      date: { type: 'string', description: 'YYYY-MM-DD, club local.' },
      time: { type: 'string', description: 'HH:MM 24-hour, club local start time.' },
      minutes: { type: 'number', description: 'Length in minutes.' },
      audience: { type: 'string', enum: ['member', 'public'] },
    },
    required: ['date', 'time', 'minutes', 'audience'],
  },
};

const UPCOMING_BOOKINGS: Anthropic.Messages.Tool = {
  name: 'list_court_bookings',
  description:
    'Court bookings made through the website, soonest first, with who booked and what they owe. ' +
    'Use it for "who has a court tomorrow" or "who still owes for court time".',
  input_schema: {
    type: 'object',
    properties: {
      unpaid_only: { type: 'boolean', description: 'Only bookings with money outstanding.' },
    },
  },
};

// --------------------------------------------------------------- write tools

const SET_SKIP_DATES: Anthropic.Messages.Tool = {
  name: 'set_class_skip_dates',
  description:
    'Add or remove skip dates on a class — the weeks it does not meet. This is the single most common ' +
    'seasonal change. It updates the public page, the dated list in confirmation emails, and hands the ' +
    'courts back if the class is holding any. Does NOT email the families; tell the director that the ' +
    'Notify button on the classes screen does that, with the recipient count in view.',
  input_schema: {
    type: 'object',
    properties: {
      class_id: { type: 'string' },
      add: {
        type: 'array',
        items: { type: 'string' },
        description: 'Dates to START skipping, YYYY-MM-DD.',
      },
      remove: {
        type: 'array',
        items: { type: 'string' },
        description: 'Dates to stop skipping — the class meets again.',
      },
    },
    required: ['class_id'],
  },
};

const SET_CLASS_PRICE: Anthropic.Messages.Tool = {
  name: 'set_class_price',
  description:
    'Change what a class costs. Prices are in DOLLARS here and stored as cents. Set only the fields the ' +
    'director actually asked about.',
  input_schema: {
    type: 'object',
    properties: {
      class_id: { type: 'string' },
      price_dollars: { type: 'number', description: 'The main price.' },
      member_price_dollars: { type: 'number' },
      drop_in_price_dollars: { type: 'number' },
    },
    required: ['class_id'],
  },
};

const SET_COURT_RATE: Anthropic.Messages.Tool = {
  name: 'set_court_rate',
  description:
    'Change an existing court rate — its price per hour, the hours it covers, the days it applies to, or ' +
    'how far ahead that audience may book. Get the rate id from list_court_rates first.',
  input_schema: {
    type: 'object',
    properties: {
      rate_id: { type: 'string' },
      price_dollars: { type: 'number', description: 'Per hour.' },
      time_start: { type: 'string', description: 'HH:MM 24-hour.' },
      time_end: { type: 'string', description: 'HH:MM 24-hour.' },
      days_of_week: {
        type: 'array',
        items: { type: 'number' },
        description: '0=Sunday..6=Saturday. An empty array means every day.',
      },
      advance_days: { type: 'number' },
      label: { type: 'string' },
    },
    required: ['rate_id'],
  },
};

const ADD_COURT_RATE: Anthropic.Messages.Tool = {
  name: 'add_court_rate',
  description:
    'Add a court rate. Use it for a new slice of the week — an evening peak, a weekend rate. Remember ' +
    'the narrower window wins where two overlap, so an evening peak on top of an all-day base rate ' +
    'works the way a director expects.',
  input_schema: {
    type: 'object',
    properties: {
      label: { type: 'string', description: 'e.g. "Peak", "Weekend".' },
      applies_to: { type: 'string', enum: ['member', 'public'] },
      price_dollars: { type: 'number', description: 'Per hour. Zero is valid — members often play free.' },
      time_start: { type: 'string', description: 'HH:MM, default 00:00.' },
      time_end: { type: 'string', description: 'HH:MM, default 23:59.' },
      days_of_week: { type: 'array', items: { type: 'number' }, description: '0=Sun..6=Sat; empty = every day.' },
      advance_days: { type: 'number', description: 'How far ahead this audience may book.' },
    },
    required: ['label', 'applies_to', 'price_dollars'],
  },
};

// ------------------------------------------------------------------- helpers

type ProgramRow = Record<string, unknown> & {
  id: string;
  title: string;
  slug: string;
  status: string;
  range_start: string;
  range_end: string;
  days_of_week: number[] | null;
  exclusions: string[] | null;
  time_start: string;
  time_end: string;
  price_cents: number;
  member_price_cents: number | null;
  drop_in_price_cents: number | null;
  capacity: number | null;
  blocks_courts: boolean;
  court_count: number | null;
};

async function loadProgram(ctx: Ctx, id: string): Promise<ProgramRow | null> {
  const { data } = await ctx.db
    .from('club_programs')
    .select('*')
    .eq('id', id)
    .eq('club_id', ctx.clubId)
    .maybeSingle();
  return (data as ProgramRow | null) ?? null;
}

/** One class, described the way a director talks about it. */
function describeProgram(p: ProgramRow, tz: string, counts?: { enrolled: number; waitlist: number }) {
  const s = programSessions(p, tz);
  return {
    id: p.id,
    title: p.title,
    status: p.status,
    when: `${daysLabel(p.days_of_week)}, ${formatTimeRange(p.time_start, p.time_end)}`,
    sessions: s.count,
    first_date: s.dates[0] ?? null,
    last_date: s.dates[s.dates.length - 1] ?? null,
    skip_dates: s.skipped,
    price: formatPrice(p.price_cents),
    member_price: p.member_price_cents == null ? null : formatPrice(p.member_price_cents),
    capacity: p.capacity,
    holds_courts: p.blocks_courts ? `${p.court_count} courts` : false,
    ...(counts ? { enrolled: counts.enrolled, waitlist: counts.waitlist } : {}),
  };
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const toCents = (dollars: number) => Math.round(dollars * 100);

/** Only the fields the caller actually mentioned, converted to cents. */
function priceFields(input: Record<string, unknown>) {
  const out: Record<string, number> = {};
  const map: [string, string][] = [
    ['price_dollars', 'price_cents'],
    ['member_price_dollars', 'member_price_cents'],
    ['drop_in_price_dollars', 'drop_in_price_cents'],
  ];
  for (const [from, to] of map) {
    const v = input[from];
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) out[to] = toCents(v);
  }
  return out;
}

// --------------------------------------------------------------------- tools

const tools: ToolDef<Ctx>[] = [
  {
    schema: LIST_CLASSES,
    async run(input, ctx) {
      let q = ctx.db
        .from('club_programs')
        .select('*')
        .eq('club_id', ctx.clubId)
        .neq('status', 'archived')
        .order('display_order')
        .order('range_start');
      if (input?.include_drafts === false) q = q.eq('status', 'published');

      const { data } = await q;
      const rows = (data as ProgramRow[] | null) ?? [];
      if (rows.length === 0) return { ok: true, classes: [], note: 'No classes set up yet.' };

      const { data: regs } = await ctx.db
        .from('club_program_registrations')
        .select('program_id, status')
        .in('program_id', rows.map((r) => r.id))
        .neq('status', 'cancelled');

      const counts = new Map<string, { enrolled: number; waitlist: number }>();
      for (const r of (regs as { program_id: string; status: string }[] | null) ?? []) {
        const c = counts.get(r.program_id) ?? { enrolled: 0, waitlist: 0 };
        if (r.status === 'enrolled') c.enrolled += 1;
        else if (r.status === 'waitlist') c.waitlist += 1;
        counts.set(r.program_id, c);
      }

      return {
        ok: true,
        club: ctx.clubName,
        classes: rows.map((p) => describeProgram(p, ctx.timeZone, counts.get(p.id))),
      };
    },
  },

  {
    schema: CLASS_ROSTER,
    async run(input, ctx) {
      const program = await loadProgram(ctx, String(input?.class_id ?? ''));
      if (!program) return { ok: false, error: 'No class with that id.' };

      const { data } = await ctx.db
        .from('club_program_registrations')
        .select('participant_name, parent_name, parent_email, status, payment_status, amount_cents')
        .eq('program_id', program.id)
        .order('status')
        .order('created_at');

      const rows = (data as {
        participant_name: string;
        parent_name: string | null;
        parent_email: string;
        status: string;
        payment_status: string;
        amount_cents: number | null;
      }[] | null) ?? [];

      const live = rows.filter((r) => r.status !== 'cancelled');
      const unpaid = live.filter((r) => r.payment_status === 'pending' && (r.amount_cents ?? 0) > 0);

      return {
        ok: true,
        class: program.title,
        capacity: program.capacity,
        enrolled: live.filter((r) => r.status === 'enrolled').length,
        waitlisted: live.filter((r) => r.status === 'waitlist').length,
        owed: formatPrice(unpaid.reduce((n, r) => n + (r.amount_cents ?? 0), 0)),
        players: live.map((r) => ({
          name: r.participant_name,
          parent: r.parent_name,
          email: r.parent_email,
          status: r.status,
          payment: r.payment_status,
        })),
      };
    },
  },

  {
    schema: LIST_RATES,
    async run(_input, ctx) {
      const { data } = await ctx.db
        .from('court_rate_cards')
        .select('*')
        .eq('club_id', ctx.clubId)
        .order('display_order');
      const rows = (data as RateCard[] | null) ?? [];
      const active = rows.filter((r) => r.active !== false);

      return {
        ok: true,
        online_booking: active.length > 0 ? 'on' : 'off — no active rates',
        rates: rows.map((r) => ({
          id: r.id,
          label: r.label,
          for: r.applies_to,
          days: daysLabel(r.days_of_week),
          hours: `${r.time_start.slice(0, 5)}–${r.time_end.slice(0, 5)}`,
          per_hour: formatPrice(r.price_cents),
          book_ahead_days: r.advance_days,
          active: r.active !== false,
        })),
      };
    },
  },

  {
    schema: QUOTE_COURT,
    async run(input, ctx) {
      const date = String(input?.date ?? '');
      const time = String(input?.time ?? '');
      const minutes = Number(input?.minutes);
      const audience = input?.audience === 'member' ? 'member' : 'public';
      if (!YMD.test(date)) return { ok: false, error: 'date must be YYYY-MM-DD.' };
      if (!HHMM.test(time)) return { ok: false, error: 'time must be HH:MM, 24-hour.' };
      if (!Number.isFinite(minutes) || minutes <= 0) return { ok: false, error: 'minutes must be positive.' };

      const { data } = await ctx.db
        .from('court_rate_cards')
        .select('*')
        .eq('club_id', ctx.clubId)
        .eq('active', true);
      const cards = (data as RateCard[] | null) ?? [];

      // Day of week read in CLUB time. Vercel runs UTC, and a Tuesday evening
      // here is Wednesday there.
      const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(
        new Intl.DateTimeFormat('en-US', { timeZone: ctx.timeZone, weekday: 'short' }).format(
          new Date(`${date}T12:00:00Z`),
        ),
      );

      const price = priceBooking(cards, { audience, dayOfWeek: dow, startTime: time, minutes });
      if (!price.ok) {
        return {
          ok: true,
          bookable: false,
          reason: `No ${audience} rate covers ${price.uncoveredFrom}–${price.uncoveredTo}, so that time cannot be booked.`,
        };
      }

      return {
        ok: true,
        bookable: true,
        when: `${formatSessionDate(date, ctx.timeZone, { weekday: true })}, ${time}–${toHHMM(toMinutes(time) + minutes)}`,
        audience,
        total: formatPrice(price.cents),
        // Shown whenever the price was made of parts, which is the case a
        // director most often doubts.
        made_of:
          price.segments.length > 1
            ? price.segments.map(
                (s) => `${s.minutes} min at ${formatPrice(s.price_cents_per_hour)}/hr (${s.label})`,
              )
            : undefined,
      };
    },
  },

  {
    schema: UPCOMING_BOOKINGS,
    async run(input, ctx) {
      const { data } = await ctx.db
        .from('court_bookings')
        .select(
          'booker_name, booker_email, rate_applied, minutes, amount_cents, payment_status, status, courts(name, number), reservations!inner(starts_at)',
        )
        .eq('club_id', ctx.clubId)
        .eq('status', 'booked')
        .limit(200);

      type Row = {
        booker_name: string;
        booker_email: string;
        rate_applied: string;
        minutes: number;
        amount_cents: number;
        payment_status: string;
        courts: { name: string | null; number: number | null } | null;
        reservations: { starts_at: string } | null;
      };
      const nowIso = new Date().toISOString();
      let rows = ((data as unknown as Row[]) ?? []).filter(
        (r) => (r.reservations?.starts_at ?? '') >= nowIso,
      );
      if (input?.unpaid_only) {
        rows = rows.filter((r) => r.payment_status === 'pending' && r.amount_cents > 0);
      }
      rows.sort((a, b) =>
        (a.reservations?.starts_at ?? '').localeCompare(b.reservations?.starts_at ?? ''),
      );

      return {
        ok: true,
        count: rows.length,
        total_owed: formatPrice(
          rows
            .filter((r) => r.payment_status === 'pending')
            .reduce((n, r) => n + r.amount_cents, 0),
        ),
        bookings: rows.slice(0, 40).map((r) => ({
          when: r.reservations
            ? new Intl.DateTimeFormat('en-US', {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
                timeZone: ctx.timeZone,
              }).format(new Date(r.reservations.starts_at))
            : null,
          court: r.courts?.name || (r.courts?.number != null ? `Court ${r.courts.number}` : null),
          who: r.booker_name,
          email: r.booker_email,
          rate: r.rate_applied,
          minutes: r.minutes,
          owes: r.payment_status === 'pending' && r.amount_cents > 0 ? formatPrice(r.amount_cents) : null,
        })),
      };
    },
  },

  // ------------------------------------------------------------------ writes

  {
    schema: SET_SKIP_DATES,
    destructive: true,
    async preview(input, ctx) {
      const built = await prepareSkipDates(input, ctx);
      if ('error' in built) return { ok: false, ...built };
      return {
        ok: true,
        class: built.program.title,
        sessions_now: built.after.count,
        sessions_before: built.before.count,
        newly_skipping: built.newlySkipped.map((d) => formatSessionDate(d, ctx.timeZone, { weekday: true })),
        meeting_again: built.restored.map((d) => formatSessionDate(d, ctx.timeZone, { weekday: true })),
        families_affected: built.families,
        also: built.program.blocks_courts
          ? 'The courts this class holds will be rebuilt to match.'
          : undefined,
        reminder:
          built.families > 0
            ? 'This does NOT email anyone. The Notify button on the classes screen does that.'
            : undefined,
      };
    },
    async run(input, ctx) {
      const built = await prepareSkipDates(input, ctx);
      if ('error' in built) return { ok: false, ...built };

      const { data: after, error } = await ctx.db
        .from('club_programs')
        .update({ exclusions: built.exclusions })
        .eq('id', built.program.id)
        .eq('club_id', ctx.clubId)
        .select('*')
        .maybeSingle();
      if (error) return { ok: false, error: error.message };

      // Same pairing the hand path guarantees: the date leaves the page AND
      // the court comes back.
      const blocks = await resyncProgramBlocks(ctx.db, after as unknown as BlockableProgram, {
        timeZone: ctx.timeZone,
        createdBy: ctx.userId,
      });

      return {
        ok: true,
        class: built.program.title,
        sessions: built.after.count,
        skip_dates: built.after.skipped.map((d) => formatSessionDate(d, ctx.timeZone)),
        courts_rebuilt: blocks ? blocks.blocked : null,
        families_to_tell: built.families,
      };
    },
  },

  {
    schema: SET_CLASS_PRICE,
    destructive: true,
    async preview(input, ctx) {
      const program = await loadProgram(ctx, String(input?.class_id ?? ''));
      if (!program) return { ok: false, error: 'No class with that id.' };
      const fields = priceFields(input as Record<string, unknown>);
      if (Object.keys(fields).length === 0) return { ok: false, error: 'No price given.' };

      const { count } = await ctx.db
        .from('club_program_registrations')
        .select('id', { count: 'exact', head: true })
        .eq('program_id', program.id)
        .neq('status', 'cancelled');

      return {
        ok: true,
        class: program.title,
        changes: Object.entries(fields).map(([k, v]) => ({
          field: k.replace('_cents', ''),
          from: formatPrice(program[k] as number | null),
          to: formatPrice(v),
        })),
        families_already_signed_up: count ?? 0,
        note:
          (count ?? 0) > 0
            ? 'Families already signed up keep the amount they were charged; this changes the price for new sign-ups.'
            : undefined,
      };
    },
    async run(input, ctx) {
      const program = await loadProgram(ctx, String(input?.class_id ?? ''));
      if (!program) return { ok: false, error: 'No class with that id.' };
      const fields = priceFields(input as Record<string, unknown>);
      if (Object.keys(fields).length === 0) return { ok: false, error: 'No price given.' };

      const { data, error } = await ctx.db
        .from('club_programs')
        .update(fields)
        .eq('id', program.id)
        .eq('club_id', ctx.clubId)
        .select('price_cents, member_price_cents, drop_in_price_cents')
        .maybeSingle();
      if (error) return { ok: false, error: error.message };

      const r = data as Record<string, number | null>;
      return {
        ok: true,
        class: program.title,
        price: formatPrice(r.price_cents),
        member_price: r.member_price_cents == null ? null : formatPrice(r.member_price_cents),
        drop_in_price: r.drop_in_price_cents == null ? null : formatPrice(r.drop_in_price_cents),
      };
    },
  },

  {
    schema: SET_COURT_RATE,
    destructive: true,
    async preview(input, ctx) {
      const built = await prepareRateChange(input, ctx);
      if ('error' in built) return { ok: false, ...built };
      return { ok: true, rate: built.rate.label, changes: built.described };
    },
    async run(input, ctx) {
      const built = await prepareRateChange(input, ctx);
      if ('error' in built) return { ok: false, ...built };

      const { data, error } = await ctx.db
        .from('court_rate_cards')
        .update(built.patch)
        .eq('id', built.rate.id)
        .eq('club_id', ctx.clubId)
        .select('*')
        .maybeSingle();
      if (error) return { ok: false, error: error.message };

      const r = data as RateCard;
      return {
        ok: true,
        rate: r.label,
        for: r.applies_to,
        days: daysLabel(r.days_of_week),
        hours: `${r.time_start.slice(0, 5)}–${r.time_end.slice(0, 5)}`,
        per_hour: formatPrice(r.price_cents),
        book_ahead_days: r.advance_days,
      };
    },
  },

  {
    schema: ADD_COURT_RATE,
    destructive: true,
    async preview(input, ctx) {
      const row = buildNewRate(input);
      if ('error' in row) return { ok: false, ...row };
      const { count } = await ctx.db
        .from('court_rate_cards')
        .select('id', { count: 'exact', head: true })
        .eq('club_id', ctx.clubId)
        .eq('active', true);
      return {
        ok: true,
        will_add: {
          label: row.label,
          for: row.applies_to,
          days: daysLabel(row.days_of_week),
          hours: `${row.time_start}–${row.time_end}`,
          per_hour: formatPrice(row.price_cents),
          book_ahead_days: row.advance_days,
        },
        turns_booking_on: (count ?? 0) === 0,
      };
    },
    async run(input, ctx) {
      const row = buildNewRate(input);
      if ('error' in row) return { ok: false, ...row };
      const { data, error } = await ctx.db
        .from('court_rate_cards')
        .insert({ ...row, club_id: ctx.clubId })
        .select('id, label')
        .maybeSingle();
      if (error) return { ok: false, error: error.message };
      return { ok: true, added: (data as { label: string }).label, id: (data as { id: string }).id };
    },
  },
];

// -------------------------------------------------------- write preparation
// Each write is prepared once and used by BOTH preview and run, so what the
// director approves is exactly what happens. Two code paths would eventually
// disagree, and the one that disagreed would be the one that ran.

async function prepareSkipDates(input: Record<string, unknown> | undefined, ctx: Ctx) {
  const program = await loadProgram(ctx, String(input?.class_id ?? ''));
  if (!program) return { error: 'No class with that id. Call list_classes first.' };

  const add = (Array.isArray(input?.add) ? (input!.add as string[]) : []).filter((d) => YMD.test(d));
  const remove = (Array.isArray(input?.remove) ? (input!.remove as string[]) : []).filter((d) =>
    YMD.test(d),
  );
  if (add.length === 0 && remove.length === 0) {
    return { error: 'Give at least one date to add or remove, as YYYY-MM-DD.' };
  }

  const before = programSessions(program, ctx.timeZone);
  const current = new Set((program.exclusions ?? []).map((d) => String(d).slice(0, 10)));
  for (const d of add) current.add(d);
  for (const d of remove) current.delete(d);
  const exclusions = [...current].sort();

  const after = programSessions({ ...program, exclusions }, ctx.timeZone);

  const { count } = await ctx.db
    .from('club_program_registrations')
    .select('id', { count: 'exact', head: true })
    .eq('program_id', program.id)
    .neq('status', 'cancelled');

  return {
    program,
    exclusions,
    before,
    after,
    // Only dates that were actually going to be meetings — telling a director
    // they just skipped a Sunday on a Tue/Thu class is noise.
    newlySkipped: after.skipped.filter((d) => !before.skipped.includes(d)),
    restored: before.skipped.filter((d) => !after.skipped.includes(d)),
    families: count ?? 0,
  };
}

async function prepareRateChange(input: Record<string, unknown> | undefined, ctx: Ctx) {
  const { data } = await ctx.db
    .from('court_rate_cards')
    .select('*')
    .eq('id', String(input?.rate_id ?? ''))
    .eq('club_id', ctx.clubId)
    .maybeSingle();
  const rate = data as RateCard | null;
  if (!rate) return { error: 'No rate with that id. Call list_court_rates first.' };

  const patch: Record<string, unknown> = {};
  const described: { field: string; from: string; to: string }[] = [];

  if (typeof input?.price_dollars === 'number' && input.price_dollars >= 0) {
    patch.price_cents = toCents(input.price_dollars);
    described.push({
      field: 'price per hour',
      from: formatPrice(rate.price_cents),
      to: formatPrice(patch.price_cents as number),
    });
  }
  for (const key of ['time_start', 'time_end'] as const) {
    const v = input?.[key];
    if (typeof v === 'string' && HHMM.test(v)) {
      patch[key] = v;
      described.push({ field: key.replace('_', ' '), from: rate[key].slice(0, 5), to: v });
    }
  }
  if (Array.isArray(input?.days_of_week)) {
    const days = (input!.days_of_week as number[]).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
    patch.days_of_week = [...new Set(days)].sort((a, b) => a - b);
    described.push({
      field: 'days',
      from: daysLabel(rate.days_of_week),
      to: daysLabel(patch.days_of_week as number[]),
    });
  }
  if (typeof input?.advance_days === 'number' && input.advance_days >= 0) {
    patch.advance_days = Math.round(input.advance_days);
    described.push({
      field: 'book ahead',
      from: `${rate.advance_days} days`,
      to: `${patch.advance_days} days`,
    });
  }
  if (typeof input?.label === 'string' && input.label.trim()) {
    patch.label = input.label.trim().slice(0, 80);
    described.push({ field: 'name', from: rate.label, to: patch.label as string });
  }

  if (Object.keys(patch).length === 0) return { error: 'Nothing to change.' };

  // Merged against the stored row, because a change to one end of the window
  // has to be checked against the other end as it already is.
  const start = String(patch.time_start ?? rate.time_start).slice(0, 5);
  const end = String(patch.time_end ?? rate.time_end).slice(0, 5);
  if (end <= start) return { error: `${end} is not after ${start}.` };

  return { rate, patch, described };
}

function buildNewRate(input: Record<string, unknown> | undefined) {
  const label = String(input?.label ?? '').trim();
  if (!label) return { error: 'The rate needs a name.' };
  const applies_to = input?.applies_to === 'member' ? 'member' : 'public';
  const dollars = Number(input?.price_dollars);
  if (!Number.isFinite(dollars) || dollars < 0) return { error: 'Give a price per hour.' };

  const time_start = typeof input?.time_start === 'string' && HHMM.test(input.time_start) ? input.time_start : '00:00';
  const time_end = typeof input?.time_end === 'string' && HHMM.test(input.time_end) ? input.time_end : '23:59';
  if (time_end <= time_start) return { error: `${time_end} is not after ${time_start}.` };

  const days = Array.isArray(input?.days_of_week)
    ? [...new Set((input!.days_of_week as number[]).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort(
        (a, b) => a - b,
      )
    : [];

  return {
    label: label.slice(0, 80),
    applies_to,
    price_cents: toCents(dollars),
    time_start,
    time_end,
    days_of_week: days,
    advance_days:
      typeof input?.advance_days === 'number' && input.advance_days >= 0
        ? Math.round(input.advance_days)
        : applies_to === 'member'
          ? 7
          : 3,
    min_minutes: 60,
    max_minutes: 120,
    active: true,
  };
}

// -------------------------------------------------------------------- export

export const clubSitePack: DomainPack<Ctx> = {
  domain: 'club-site',

  actionsPrompt: `
CLUB SITE — you can read and change the club's classes and court prices.

What you can do:
- Read anything: classes and their real dates, rosters, court rates, what a booking would cost, who
  has booked a court and who owes money.
- Change skip dates on a class, class prices, and court rates.

Rules:
- ALWAYS call list_classes or list_court_rates first to get an id. Never guess one.
- Use quote_court_price rather than doing the arithmetic yourself. A booking that crosses two rates is
  charged per part, and the engine is the only thing that gets that right.
- Every change gives you a preview first. Show the director the specifics — the dates, the old and new
  price, how many families are signed up — and wait for a clear yes before confirming.
- If the director is ambiguous about WHICH dates ("move it to 4" — this week, or every week?), ask.
  Rewriting a term by guessing is the one mistake that costs them trust.
- Changing skip dates does NOT email the families. Say so, and point at the Notify button on the
  classes screen, which shows the recipient count and the wording before sending.

What you CANNOT do, and should say plainly if asked:
- Publish or unpublish a site or a class. That is one click on their screen and it is a decision.
- Send any email to members or families.
- Delete a class, or change who has paid.
- Add a NEW class, or change website copy. Those are the Classes and Club site screens.
- Build a new feature. If they ask for something the club site cannot do — a members-only court
  waitlist, seasonal pricing, per-court prices, guest fees — say it does not exist yet, that you have
  noted it, and that a person will follow up. Never imply it has been built or scheduled.
`.trim(),

  async resolve(userId, page) {
    /*
     * Where the assistant widget actually renders. NOT '/c/' — a club's own
     * public site deliberately has no ClubMode chrome on it, so listing it
     * here would be a branch that can never run and a claim the code does not
     * honour.
     */
    const relevant =
      !page ||
      page.startsWith('/run') ||
      page.startsWith('/courtsheet') ||
      page.startsWith('/tools');
    if (!relevant) return null;

    const db = getSupabaseAdmin();

    /*
     * The club they have CHOSEN, before the club they happen to own first.
     *
     * This used to take the alphabetically-first owned club, which is the
     * same bug that once silently repointed a working director's tools at a
     * prospect's club because "Lafayette" sorts before "Sleepy Hollow". The
     * switcher is the user's explicit answer to "which club am I running" and
     * the assistant has to honour it, or it edits one club while the screen
     * shows another.
     */
    const { active } = await resolveActiveClub(userId, null);
    if (active) {
      const { data } = await db
        .from('cc_clubs')
        .select('id, name, slug, timezone')
        .eq('id', active.id)
        .maybeSingle();
      const chosen = data as { id: string; name: string; slug: string; timezone: string } | null;
      if (chosen) {
        return {
          userId,
          db,
          clubId: chosen.id,
          clubName: chosen.name,
          clubSlug: chosen.slug,
          timeZone: chosen.timezone || CLUB_TZ,
        };
      }
    }

    // Fallbacks, for a context with no cookie to read: a club they own, else
    // one they are staff at. Same precedence as requireStaffForClub, so the
    // assistant never reaches a club the hand path would refuse.
    const { data: owned } = await db
      .from('cc_clubs')
      .select('id, name, slug, timezone')
      .eq('owner_id', userId)
      .order('name')
      .limit(1)
      .maybeSingle();

    let club = owned as { id: string; name: string; slug: string; timezone: string } | null;

    if (!club) {
      const { data: staff } = await db
        .from('cc_club_members')
        .select('club_id')
        .eq('user_id', userId)
        .in('role', ['owner', 'director', 'coach', 'front_desk'])
        .limit(1)
        .maybeSingle();
      const clubId = (staff as { club_id: string } | null)?.club_id;
      if (!clubId) return null;
      const { data } = await db
        .from('cc_clubs')
        .select('id, name, slug, timezone')
        .eq('id', clubId)
        .maybeSingle();
      club = data as typeof club;
    }

    if (!club) return null;

    return {
      userId,
      db,
      clubId: club.id,
      clubName: club.name,
      clubSlug: club.slug,
      timeZone: club.timezone || CLUB_TZ,
    };
  },

  tools,
};
