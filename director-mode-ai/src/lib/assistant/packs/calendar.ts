import type { DomainPack } from '../framework';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import {
  buildScoreContext, toPlanItem, ITEM_COLUMNS, type CalendarItemRow,
} from '@/lib/calendar/server';
import { recommendDates, scoreSlot } from '@/lib/calendar/score';
import { generateSlots } from '@/lib/calendar/slots';
import { buildYearPlan, summarizePlan } from '@/lib/calendar/plan';
import { itemFromCatalog } from '@/lib/calendar/promote';
import { filterCatalog, catalogEntry } from '@/lib/calendar/catalog';
import { monthName, shortLabel } from '@/lib/calendar/dates';

// CalendarMode pack — conversational control of the year plan.
//
// "Move the Calcutta to October." "Why is the Member-Guest there?" "What
// should we run in February?" These are the questions a director actually
// asks about a calendar, and they're tedious as clicks and natural as speech.
//
// Every answer about DATES comes from the same deterministic engine the year
// grid uses, so the assistant and the UI can never disagree. The model chooses
// which tool to call and how to phrase the result; it never invents a date or
// a reason.
//
// Writes are marked destructive, so the framework forces preview → confirm.

interface Ctx {
  userId: string;
  db: ReturnType<typeof getSupabaseAdmin>;
  clubId: string;
  clubName: string;
  planId: string;
  year: number;
  goals: Record<string, unknown>;
  seasonWindows: unknown[];
}

const LIST_TOOL = {
  name: 'list_calendar',
  description:
    "List the club's planned events for the year, with dates, departments, audiences and status. " +
    'Use this first for any question about what is on the calendar, when something is, or where the gaps are.',
  input_schema: {
    type: 'object' as const,
    properties: {
      month: { type: 'number', description: 'Limit to one month, 1-12. Omit for the whole year.' },
      department: { type: 'string', description: 'tennis | pickleball | swim | fitness | social | other' },
    },
  },
};

const SUGGEST_TOOL = {
  name: 'suggest_dates',
  description:
    'Recommend the best dates for an event, with the reasoning behind each. Pass an event already on the ' +
    'calendar by name, or a catalog key to check dates before adding it. Always use this rather than ' +
    'choosing a date yourself.',
  input_schema: {
    type: 'object' as const,
    properties: {
      event: { type: 'string', description: 'Name of an event on the calendar, or a catalog key like "calcutta".' },
      limit: { type: 'number', description: 'How many dates to return (default 4, max 10).' },
    },
    required: ['event'],
  },
};

const EXPLAIN_TOOL = {
  name: 'explain_date',
  description:
    "Explain why an event's current date scores the way it does — anchors, weather, conflicts, spacing, " +
    'audience overlap, staffing and courts. Use this for any "why is X there?" or "is X a good date?" question.',
  input_schema: {
    type: 'object' as const,
    properties: {
      event: { type: 'string', description: 'Name of an event on the calendar.' },
      date: { type: 'string', description: 'Optional YYYY-MM-DD to test a hypothetical date instead.' },
    },
    required: ['event'],
  },
};

const IDEAS_TOOL = {
  name: 'browse_ideas',
  description:
    'Search the library of club event concepts. Use when the director asks what they could run — in a ' +
    'given month, for a given audience, or for a department.',
  input_schema: {
    type: 'object' as const,
    properties: {
      month: { type: 'number', description: '1-12.' },
      audience: { type: 'string', description: 'adult | junior | family | ladies | men | mixed | member-guest | senior' },
      department: { type: 'string', description: 'tennis | pickleball | swim | fitness | social | other' },
      query: { type: 'string', description: 'Free text.' },
    },
  },
};

const ADD_TOOL = {
  name: 'add_event',
  description:
    'Add an event to the calendar. Prefer a catalog key so it arrives with sensible courts, staffing, fee ' +
    'and format already set. The engine picks the date unless one is given.',
  input_schema: {
    type: 'object' as const,
    properties: {
      catalogKey: { type: 'string', description: 'A catalog key, e.g. "calcutta". Strongly preferred.' },
      title: { type: 'string', description: 'Only for an event not in the catalog.' },
      date: { type: 'string', description: 'YYYY-MM-DD. Omit to let the engine choose.' },
    },
  },
};

const MOVE_TOOL = {
  name: 'move_event',
  description: 'Move an event to a different date, or to the engine\'s best available date.',
  input_schema: {
    type: 'object' as const,
    properties: {
      event: { type: 'string', description: 'Name of the event to move.' },
      date: { type: 'string', description: 'YYYY-MM-DD. Omit to move it to the best available date.' },
    },
    required: ['event'],
  },
};

const DROP_TOOL = {
  name: 'drop_event',
  description: 'Remove an event from the calendar.',
  input_schema: {
    type: 'object' as const,
    properties: { event: { type: 'string', description: 'Name of the event to remove.' } },
    required: ['event'],
  },
};

export const calendarPack: DomainPack<Ctx> = {
  domain: 'calendar',

  actionsPrompt: `
CALENDAR MODE — you can read and change the club's year event calendar.

Rules:
- NEVER pick a date yourself. Call suggest_dates or explain_date and report what the engine returns. Its
  reasoning accounts for school calendars, weather, holidays, court load, staff fatigue and audience overlap
  that you cannot see.
- When you report a date, give the top one or two reasons the engine gave, in your own words.
- Prefer catalog keys when adding events so logistics and format come pre-filled.
- add_event, move_event and drop_event change the plan. You will get a preview first — show it to the
  director and wait for a clear yes before confirming.
- If an event cannot be placed, say why (the engine tells you) rather than proposing a date anyway.
`.trim(),

  async resolve(userId, _page) {
    const db = getSupabaseAdmin();

    // Any club this user is staff at, preferring one they own.
    const { data: memberships } = await db
      .from('cc_club_members')
      .select('club_id, role')
      .eq('user_id', userId)
      .in('role', ['owner', 'director']);

    const clubId = (memberships ?? [])[0]?.club_id;
    if (!clubId) return null;

    const { data: club } = await db
      .from('cc_clubs')
      .select('id, name')
      .eq('id', clubId)
      .maybeSingle();
    if (!club) return null;

    // Only active when a plan already exists — the assistant should not create
    // a director's first calendar as a side effect of them asking a question.
    const { data: plan } = await db
      .from('calendar_plans')
      .select('id, year, goals, season_windows')
      .eq('club_id', clubId)
      .order('year', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!plan) return null;

    return {
      userId,
      db,
      clubId,
      clubName: (club as any).name,
      planId: (plan as any).id,
      year: (plan as any).year,
      goals: (plan as any).goals ?? {},
      seasonWindows: (plan as any).season_windows ?? [],
    };
  },

  tools: [
    {
      schema: LIST_TOOL,
      async run(input, ctx) {
        const items = await loadItems(ctx);
        let filtered = items;
        if (input?.month) filtered = filtered.filter((i) => i.target_date?.slice(5, 7) === String(input.month).padStart(2, '0'));
        if (input?.department) filtered = filtered.filter((i) => i.department === input.department);

        const summary = summarizePlan(items.map(toPlanItem));
        return {
          ok: true,
          year: ctx.year,
          club: ctx.clubName,
          count: filtered.length,
          events: filtered.map((i) => ({
            title: i.title,
            date: i.target_date,
            when: i.target_date ? shortLabel(i.target_date) : 'not scheduled',
            department: i.department,
            audience: i.audience,
            status: i.status,
            promoted: !!i.event_id,
          })),
          emptyMonths: summary.emptyMonths.map((m) => monthName(m)),
          projectedRevenue: `$${Math.round(summary.projectedRevenueCents / 100).toLocaleString()}`,
        };
      },
    },

    {
      schema: SUGGEST_TOOL,
      async run(input, ctx) {
        const resolved = await resolveEvent(ctx, String(input?.event ?? ''));
        if ('error' in resolved) return { ok: false, ...resolved };

        const scoreCtx = await scoreContext(ctx, resolved.item.id);
        const slots = generateSlots(ctx.year);
        const limit = Math.min(10, Math.max(1, Number(input?.limit) || 4));
        const recs = recommendDates(resolved.item, slots, scoreCtx, limit);

        return {
          ok: true,
          event: resolved.item.title,
          recommendations: recs.map((r) => ({
            date: r.date,
            when: shortLabel(r.date),
            score: r.score,
            blocked: r.blocked,
            reasons: r.reasons.slice(0, 4).map((x) => x.detail),
          })),
        };
      },
    },

    {
      schema: EXPLAIN_TOOL,
      async run(input, ctx) {
        const resolved = await resolveEvent(ctx, String(input?.event ?? ''));
        if ('error' in resolved) return { ok: false, ...resolved };

        const date = typeof input?.date === 'string' ? input.date : resolved.item.target_date;
        if (!date) return { ok: false, error: `${resolved.item.title} has no date yet. Use suggest_dates.` };

        const all = generateSlots(ctx.year, { daysOfWeek: [0, 1, 2, 3, 4, 5, 6] });
        const slot = all.find((s) => s.date === date);
        if (!slot) return { ok: false, error: `${date} is not in the ${ctx.year} plan year.` };

        const scored = scoreSlot(resolved.item, slot, await scoreContext(ctx, resolved.item.id));
        return {
          ok: true,
          event: resolved.item.title,
          date,
          when: shortLabel(date),
          score: scored.score,
          blocked: scored.blocked,
          reasons: scored.reasons.map((r) => ({ detail: r.detail, points: r.points })),
        };
      },
    },

    {
      schema: IDEAS_TOOL,
      async run(input) {
        const results = filterCatalog({
          month: input?.month ? Number(input.month) : undefined,
          audience: input?.audience,
          department: input?.department,
          q: input?.query,
        }).slice(0, 12);

        return {
          ok: true,
          count: results.length,
          ideas: results.map((c) => ({
            key: c.key,
            title: c.title,
            tagline: c.tagline,
            department: c.department,
            audience: c.audience,
            effort: c.effort,
            months: c.idealMonths.map((m) => monthName(m)),
            typicalFee: c.typicalFeeCents ? `$${(c.typicalFeeCents / 100).toFixed(0)}` : 'free',
          })),
        };
      },
    },

    {
      schema: ADD_TOOL,
      destructive: true,
      async preview(input, ctx) {
        const built = await prepareAdd(input, ctx);
        if ('error' in built) return { ok: false, ...built };
        return {
          ok: true,
          willAdd: built.title,
          onDate: built.date ? shortLabel(built.date) : 'no date could be found',
          because: built.reasons.slice(0, 3),
        };
      },
      async run(input, ctx) {
        const built = await prepareAdd(input, ctx);
        if ('error' in built) return { ok: false, ...built };

        const { error } = await ctx.db.from('calendar_items').insert({
          ...built.row,
          target_date: built.date,
          status: built.date ? 'scheduled' : 'idea',
          score_breakdown: { reasons: built.reasons.map((detail) => ({ detail })) },
        });
        if (error) return { ok: false, error: error.message };

        return {
          ok: true,
          added: built.title,
          date: built.date,
          when: built.date ? shortLabel(built.date) : null,
        };
      },
    },

    {
      schema: MOVE_TOOL,
      destructive: true,
      async preview(input, ctx) {
        const move = await prepareMove(input, ctx);
        if ('error' in move) return { ok: false, ...move };
        return {
          ok: true,
          event: move.item.title,
          from: move.item.target_date ? shortLabel(move.item.target_date) : 'unscheduled',
          to: shortLabel(move.date),
          because: move.reasons.slice(0, 3),
          warning: move.blocked ? 'That date is blocked by something already on the calendar.' : null,
        };
      },
      async run(input, ctx) {
        const move = await prepareMove(input, ctx);
        if ('error' in move) return { ok: false, ...move };

        const { error } = await ctx.db
          .from('calendar_items')
          .update({
            target_date: move.date,
            status: 'scheduled',
            score_breakdown: { reasons: move.reasons.map((detail) => ({ detail })) },
          })
          .eq('id', move.item.id)
          .eq('club_id', ctx.clubId);
        if (error) return { ok: false, error: error.message };

        // The old date's courts must not stay locked.
        await ctx.db
          .from('reservations')
          .update({ status: 'cancelled' })
          .eq('club_id', ctx.clubId)
          .eq('source', 'calendar')
          .eq('source_id', move.item.id)
          .neq('status', 'cancelled');

        return { ok: true, event: move.item.title, movedTo: move.date, when: shortLabel(move.date) };
      },
    },

    {
      schema: DROP_TOOL,
      destructive: true,
      async preview(input, ctx) {
        const resolved = await resolveEvent(ctx, String(input?.event ?? ''));
        if ('error' in resolved) return { ok: false, ...resolved };
        return {
          ok: true,
          willRemove: resolved.item.title,
          currentlyOn: resolved.item.target_date ? shortLabel(resolved.item.target_date) : 'no date',
          note: resolved.row.event_id
            ? 'This event has already been promoted to a real event — that event will NOT be deleted.'
            : null,
        };
      },
      async run(input, ctx) {
        const resolved = await resolveEvent(ctx, String(input?.event ?? ''));
        if ('error' in resolved) return { ok: false, ...resolved };

        await ctx.db
          .from('reservations')
          .update({ status: 'cancelled' })
          .eq('club_id', ctx.clubId)
          .eq('source', 'calendar')
          .eq('source_id', resolved.item.id);

        const { error } = await ctx.db
          .from('calendar_items')
          .delete()
          .eq('id', resolved.item.id)
          .eq('club_id', ctx.clubId);
        if (error) return { ok: false, error: error.message };

        return { ok: true, removed: resolved.item.title };
      },
    },
  ],
};

// ---------- helpers ----------

async function loadItems(ctx: Ctx): Promise<CalendarItemRow[]> {
  const { data } = await ctx.db
    .from('calendar_items')
    .select(ITEM_COLUMNS)
    .eq('plan_id', ctx.planId)
    .neq('status', 'dropped')
    .order('target_date', { ascending: true, nullsFirst: false });
  return (data ?? []) as unknown as CalendarItemRow[];
}

async function scoreContext(ctx: Ctx, excludeItemId?: string) {
  return buildScoreContext({
    db: ctx.db,
    clubId: ctx.clubId,
    planId: ctx.planId,
    year: ctx.year,
    goals: ctx.goals as any,
    seasonWindows: ctx.seasonWindows as any,
    excludeItemId,
    includeCourtLoad: true,
  });
}

/**
 * Find an event by name. Directors say "the Calcutta", not the full title, so
 * match loosely — but refuse an ambiguous match rather than guessing, because
 * the tools that use this can move or delete what it returns.
 */
async function resolveEvent(
  ctx: Ctx,
  name: string,
): Promise<{ item: ReturnType<typeof toPlanItem>; row: CalendarItemRow } | { error: string }> {
  const q = name.trim().toLowerCase();
  if (!q) return { error: 'Which event?' };

  const rows = await loadItems(ctx);
  if (rows.length === 0) return { error: 'The calendar has no events yet.' };

  const exact = rows.filter((r) => r.title.toLowerCase() === q);
  const byKey = rows.filter((r) => r.catalog_key === q);
  const partial = rows.filter((r) => r.title.toLowerCase().includes(q) || q.includes(r.title.toLowerCase()));
  const hits = exact.length ? exact : byKey.length ? byKey : partial;

  if (hits.length === 0) {
    return { error: `No event matching "${name}". On the calendar: ${rows.map((r) => r.title).join(', ')}.` };
  }
  if (hits.length > 1) {
    return { error: `"${name}" matches several events: ${hits.map((h) => h.title).join(', ')}. Which one?` };
  }

  return { item: toPlanItem(hits[0]), row: hits[0] };
}

async function prepareAdd(input: any, ctx: Ctx) {
  const key = typeof input?.catalogKey === 'string' ? input.catalogKey : null;
  const cat = key ? catalogEntry(key) : null;
  if (key && !cat) return { error: `No event idea called "${key}".` };

  const title = (cat?.title ?? String(input?.title ?? '')).trim();
  if (!title) return { error: 'What should the event be called?' };

  const row = key
    ? (itemFromCatalog(key, ctx.planId, ctx.clubId) as Record<string, unknown>)
    : { plan_id: ctx.planId, club_id: ctx.clubId, title, catalog_key: null, status: 'idea', department: 'tennis', audience: [] };

  // Score against a synthetic item so the date is chosen the same way the year
  // grid would choose it.
  const probe = toPlanItem({
    ...(row as any),
    id: '__new__',
    target_date: null,
    target_end_date: null,
    audience: (row as any).audience ?? [],
    department: (row as any).department ?? 'tennis',
  } as CalendarItemRow);

  if (typeof input?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.date)) {
    const all = generateSlots(ctx.year, { daysOfWeek: [0, 1, 2, 3, 4, 5, 6] });
    const slot = all.find((s) => s.date === input.date);
    if (!slot) return { error: `${input.date} is not in the ${ctx.year} plan year.` };
    const scored = scoreSlot(probe, slot, await scoreContext(ctx));
    return { title, row, date: input.date as string, reasons: scored.reasons.map((r) => r.detail) };
  }

  const placement = buildYearPlan([probe], await scoreContext(ctx));
  const placed = placement.placements[0];
  if (!placed) {
    return { error: placement.unplaced[0]?.reason ?? `Could not find a date for ${title}.` };
  }
  return { title, row, date: placed.date, reasons: placed.reasons.map((r) => r.detail) };
}

async function prepareMove(input: any, ctx: Ctx) {
  const resolved = await resolveEvent(ctx, String(input?.event ?? ''));
  if ('error' in resolved) return resolved;

  const scoreCtx = await scoreContext(ctx, resolved.item.id);

  if (typeof input?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.date)) {
    const all = generateSlots(ctx.year, { daysOfWeek: [0, 1, 2, 3, 4, 5, 6] });
    const slot = all.find((s) => s.date === input.date);
    if (!slot) return { error: `${input.date} is not in the ${ctx.year} plan year.` };
    const scored = scoreSlot(resolved.item, slot, scoreCtx);
    return {
      item: resolved.item,
      date: input.date as string,
      blocked: scored.blocked,
      reasons: scored.reasons.map((r) => r.detail),
    };
  }

  const [best] = recommendDates(resolved.item, generateSlots(ctx.year), scoreCtx, 1);
  if (!best) return { error: `No open date for ${resolved.item.title}.` };
  return {
    item: resolved.item,
    date: best.date,
    blocked: best.blocked,
    reasons: best.reasons.map((r) => r.detail),
  };
}
