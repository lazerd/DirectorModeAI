/**
 * "Ask your pipeline" — the CRM's tools.
 *
 * Same architecture as the rest of the app's assistant (src/lib/assistant/
 * framework.ts) and the CourtSheet command layer (src/lib/courtsheet/ai/*):
 * the model reads through tools and it never writes. Anything that would
 * change a row comes back as a PROPOSAL — a sentence, some detail lines, and
 * an argument bag of resolved ids — which the page renders with Confirm and
 * Cancel. Only /api/crm/ask/confirm mutates, and only from a click.
 *
 * This is stronger than the shared pack's confirm flag. There, the model calls
 * the tool a second time with confirm:true, so "never applied straight from
 * the model" rests on the model doing as it is told. Here the mutating code is
 * not reachable from the model's side of the wire at all.
 *
 * TWO HARD RULES, both enforced below rather than written down and hoped for:
 *
 *   1. NOTHING RUNS FOR A NON-CRM USER. Every tool goes through runCrmTool(),
 *      which refuses before it looks at the input if ctx.allowed is not true.
 *      The route checks requireCrm() as well; this is the second lock, and the
 *      one a test can hold a knife to.
 *   2. CRM TABLES ONLY. Every read goes through crmTable(), which throws on
 *      any name that is not in CRM_TABLES. There is no path from this file to
 *      cc_clubs, cc_club_members, players, lessons or anything else in the
 *      database — the sales assistant cannot see a single member of a single
 *      club, by construction, not by care.
 */

import type Anthropic from '@anthropic-ai/sdk';
import type { getSupabaseAdmin } from '@/lib/supabase/admin';
import { isISODate, type ISODate } from '../dates';
import { ACTIVITY_KINDS, STAGES, STAGE_LABEL, isActivityKind, isStage } from '../stages';
import { regionOf } from '../region';
import { looksLikeAReply } from '../today';

type Db = ReturnType<typeof getSupabaseAdmin>;

/**
 * The entire surface this assistant may read. Adding a name here is the moment
 * to ask whether the sales pipeline should be able to see it.
 */
export const CRM_TABLES = [
  'crm_orgs',
  'crm_contacts',
  'crm_activities',
  'crm_email_sends',
  'crm_users',
  'crm_templates',
] as const;
export type CrmTable = (typeof CRM_TABLES)[number];

/** The only way this file reaches the database. Anything else is a bug. */
export function crmTable(db: Db, name: CrmTable) {
  if (!(CRM_TABLES as readonly string[]).includes(name)) {
    throw new Error(`crmTable: ${name} is not a CRM table`);
  }
  return db.from(name);
}

export interface CrmAskContext {
  /** requireCrm() said yes. Nothing runs when this is false. */
  allowed: boolean;
  db: Db;
  repEmail: string;
  repName: string;
  today: ISODate;
  /** On /crm/[id], the club every question and every action is pinned to. */
  orgId: string | null;
}

export type ToolKind = 'read' | 'action';

/** What a rep is shown, and the exact arguments Confirm will re-validate. */
export interface Proposal {
  action: ProposalAction;
  /** One sentence: "Move Rossmoor Tennis Club to Demo done". */
  title: string;
  /** Detail lines under it. Empty is fine. */
  detail: string[];
  args: Record<string, unknown>;
}

export const PROPOSAL_ACTIONS = [
  'set_stage',
  'set_next_step',
  'add_note',
  'add_contact',
  'set_do_not_contact',
  'queue_for_outreach',
  'draft_email',
] as const;
export type ProposalAction = (typeof PROPOSAL_ACTIONS)[number];

export type ToolResult =
  | ({ ok: true } & Record<string, unknown>)
  | { ok: true; proposal: Proposal }
  | { ok: false; error: string };

export interface CrmTool {
  schema: Anthropic.Messages.Tool;
  kind: ToolKind;
  run: (input: any, ctx: CrmAskContext) => Promise<ToolResult>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function str(v: unknown, max = 500): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

// =====================================================================
// Resolving a club from what the rep called it
// =====================================================================

interface OrgLite {
  id: string;
  name: string;
  stage: string;
  region: string | null;
  state: string | null;
  notes: string | null;
  next_step: string | null;
  next_step_at: string | null;
  owner_email: string | null;
  source: string | null;
  demo_url: string | null;
  queued_at: string | null;
  website: string | null;
}

const ORG_LITE =
  'id, name, stage, region, state, notes, next_step, next_step_at, owner_email, source, demo_url, queued_at, website';

/**
 * "Rossmoor" → the club, or a list to choose from.
 *
 * Never guesses between two matches. Two clubs called Rossmoor is exactly the
 * case where picking one and moving its stage is worse than asking, and the
 * model is told to relay the choice rather than flip a coin.
 */
async function resolveOrg(
  ctx: CrmAskContext,
  nameOrId: string,
): Promise<{ ok: true; org: OrgLite } | { ok: false; error: string }> {
  // A pinned page wins over anything the model names, so a question typed on
  // Rossmoor's page can never act on Lafayette.
  const wanted = ctx.orgId ?? nameOrId;
  if (!wanted) return { ok: false, error: 'Which club?' };

  if (UUID_RE.test(wanted)) {
    const { data } = await crmTable(ctx.db, 'crm_orgs').select(ORG_LITE).eq('id', wanted).maybeSingle();
    if (!data) return { ok: false, error: 'No club with that id.' };
    return { ok: true, org: data as unknown as OrgLite };
  }

  const q = wanted.replace(/[%,()]/g, ' ').trim();
  const { data } = await crmTable(ctx.db, 'crm_orgs')
    .select(ORG_LITE)
    .ilike('name', `%${q}%`)
    .order('name')
    .limit(12);
  const hits = (data as unknown as OrgLite[] | null) || [];
  if (!hits.length) return { ok: false, error: `Nothing in the pipeline matches "${wanted}".` };
  if (hits.length === 1) return { ok: true, org: hits[0] };

  const exact = hits.filter((o) => o.name.toLowerCase() === q.toLowerCase());
  if (exact.length === 1) return { ok: true, org: exact[0] };

  return {
    ok: false,
    error: `"${wanted}" matches ${hits.length} clubs: ${hits.map((o) => o.name).join(', ')}. Ask which one.`,
  };
}

async function contactsFor(ctx: CrmAskContext, orgId: string) {
  const { data } = await crmTable(ctx.db, 'crm_contacts')
    .select('id, full_name, title, email, phone, role, is_primary, do_not_contact')
    .eq('org_id', orgId)
    .order('is_primary', { ascending: false })
    .order('full_name');
  return (data as
    | {
        id: string;
        full_name: string;
        title: string | null;
        email: string | null;
        phone: string | null;
        role: string | null;
        is_primary: boolean;
        do_not_contact: boolean;
      }[]
    | null) || [];
}

// =====================================================================
// Read tools
// =====================================================================

const SEARCH_SCHEMA: Anthropic.Messages.Tool = {
  name: 'search_clubs',
  description:
    'Search the clubs in the CRM. Every filter is optional and they combine. Use this for "which West clubs have no contact?", ' +
    '"how many clubs in Texas?", "who haven\'t we followed up with?", "what\'s overdue?". ' +
    'Returns a total count for the whole filtered set plus the first `limit` clubs, so a "how many" question ' +
    'is answered by the count and does not need a big limit.',
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Free text matched against the club name.' },
      region: {
        type: 'string',
        description: 'One of East, Central, West, International. Use "none" for clubs with no region recorded.',
      },
      state: { type: 'string', description: 'Two-letter state code, e.g. TX for Texas, CA for California.' },
      stage: { type: 'string', description: `One of: ${STAGES.join(', ')}.` },
      has_contact: { type: 'boolean', description: 'true for clubs with at least one contact, false for clubs with none.' },
      overdue: { type: 'boolean', description: 'true for clubs whose next step date has passed.' },
      no_next_step: { type: 'boolean', description: 'true for clubs with no next step written down.' },
      untouched: {
        type: 'boolean',
        description: 'true for clubs nobody has logged anything against — the cold list. false for clubs with a history.',
      },
      quiet_days: {
        type: 'number',
        description: 'Only clubs with nothing logged for at least this many days. Use for "who haven\'t we followed up with?".',
      },
      queued: { type: 'boolean', description: 'true for clubs already flagged for the outreach queue.' },
      owner_email: { type: 'string', description: 'The rep who owns the deal.' },
      limit: { type: 'number', description: 'How many clubs to list (default 12, max 40). The count is always the full total.' },
    },
  },
};

async function searchClubs(input: any, ctx: CrmAskContext): Promise<ToolResult> {
  const limit = Math.max(1, Math.min(40, Number(input?.limit) || 12));

  let q = crmTable(ctx.db, 'crm_orgs').select(ORG_LITE);
  if (ctx.orgId) q = q.eq('id', ctx.orgId);

  const query = str(input?.query, 120);
  if (query) q = q.ilike('name', `%${query.replace(/[%,()]/g, ' ')}%`);
  const region = str(input?.region, 40);
  if (region && region.toLowerCase() === 'none') q = q.is('region', null);
  else if (region) q = q.ilike('region', region);
  const state = str(input?.state, 4);
  if (state) q = q.ilike('state', state);
  if (isStage(input?.stage)) q = q.eq('stage', input.stage);
  if (input?.overdue === true) q = q.lt('next_step_at', ctx.today);
  if (input?.no_next_step === true) q = q.is('next_step', null);
  if (input?.queued === true) q = q.not('queued_at', 'is', null);
  if (input?.queued === false) q = q.is('queued_at', null);
  const owner = str(input?.owner_email, 200);
  if (owner) q = q.ilike('owner_email', `%${owner}%`);

  const { data, error } = await q.order('name').limit(600);
  if (error) return { ok: false, error: error.message };
  let orgs = (data as unknown as OrgLite[] | null) || [];

  // Contact counts and last-touch need the other two tables; fold them in
  // rather than ask PostgREST for an aggregate it cannot do per parent.
  const ids = new Set(orgs.map((o) => o.id));
  const { data: cRows } = await crmTable(ctx.db, 'crm_contacts').select('org_id, full_name, email, do_not_contact');
  const contactsBy = new Map<string, { full_name: string; email: string | null; do_not_contact: boolean }[]>();
  for (const c of (cRows as { org_id: string; full_name: string; email: string | null; do_not_contact: boolean }[] | null) || []) {
    if (!ids.has(c.org_id)) continue;
    const list = contactsBy.get(c.org_id);
    if (list) list.push(c);
    else contactsBy.set(c.org_id, [c]);
  }
  const { data: aRows } = await crmTable(ctx.db, 'crm_activities')
    .select('org_id, occurred_at')
    .order('occurred_at', { ascending: false });
  const lastBy = new Map<string, string>();
  for (const a of (aRows as { org_id: string; occurred_at: string }[] | null) || []) {
    if (!lastBy.has(a.org_id)) lastBy.set(a.org_id, a.occurred_at);
  }

  if (input?.has_contact === true) orgs = orgs.filter((o) => (contactsBy.get(o.id)?.length ?? 0) > 0);
  if (input?.has_contact === false) orgs = orgs.filter((o) => (contactsBy.get(o.id)?.length ?? 0) === 0);
  if (input?.untouched === true) orgs = orgs.filter((o) => !lastBy.has(o.id));
  if (input?.untouched === false) orgs = orgs.filter((o) => lastBy.has(o.id));

  const quietDays = Number(input?.quiet_days);
  if (Number.isFinite(quietDays) && quietDays > 0) {
    const cutoff = Date.now() - quietDays * 86_400_000;
    orgs = orgs.filter((o) => {
      const last = lastBy.get(o.id);
      // Never touched counts as quiet — it is the strongest form of it.
      if (!last) return true;
      return new Date(last).getTime() <= cutoff;
    });
  }

  return {
    ok: true,
    count: orgs.length,
    showing: Math.min(limit, orgs.length),
    clubs: orgs.slice(0, limit).map((o) => ({
      id: o.id,
      name: o.name,
      stage: STAGE_LABEL[o.stage as keyof typeof STAGE_LABEL] ?? o.stage,
      region: regionOf(o),
      state: o.state,
      contacts: contactsBy.get(o.id)?.length ?? 0,
      contact_names: (contactsBy.get(o.id) ?? []).slice(0, 4).map((c) => c.full_name),
      next_step: o.next_step,
      next_step_at: o.next_step_at,
      last_touch: lastBy.get(o.id) ?? null,
      owner: o.owner_email,
      queued: !!o.queued_at,
    })),
  };
}

const SUMMARY_SCHEMA: Anthropic.Messages.Tool = {
  name: 'pipeline_summary',
  description:
    'The shape of the whole pipeline in one call: how many clubs, how many are live deals versus cold prospects, ' +
    'the count in each stage, how many are overdue or due today, how many have no contact at all, and a breakdown ' +
    'by region and by state. Use for "how big is the pipeline?" and as a first call when a question is about totals.',
  input_schema: { type: 'object', properties: {} },
};

async function pipelineSummary(_input: any, ctx: CrmAskContext): Promise<ToolResult> {
  const { data } = await crmTable(ctx.db, 'crm_orgs').select(
    'id, name, stage, region, state, notes, next_step, next_step_at, mrr_target_cents, queued_at',
  );
  const orgs = (data as unknown as (OrgLite & { mrr_target_cents: number })[] | null) || [];
  const { data: cRows } = await crmTable(ctx.db, 'crm_contacts').select('org_id');
  const counts = new Map<string, number>();
  for (const c of (cRows as { org_id: string }[] | null) || []) {
    counts.set(c.org_id, (counts.get(c.org_id) ?? 0) + 1);
  }
  const { data: aRows } = await crmTable(ctx.db, 'crm_activities').select('org_id');
  const touched = new Set(((aRows as { org_id: string }[] | null) || []).map((a) => a.org_id));

  const live = orgs.filter((o) => o.stage !== 'researching' || touched.has(o.id));
  const byStage: Record<string, number> = {};
  for (const s of STAGES) byStage[STAGE_LABEL[s]] = orgs.filter((o) => o.stage === s).length;
  const byRegion: Record<string, number> = {};
  for (const o of orgs) {
    const r = regionOf(o) ?? 'no region recorded';
    byRegion[r] = (byRegion[r] ?? 0) + 1;
  }
  const byState: Record<string, number> = {};
  for (const o of orgs) {
    if (!o.state) continue;
    byState[o.state] = (byState[o.state] ?? 0) + 1;
  }

  const open = live.filter((o) => o.stage !== 'won' && o.stage !== 'lost');
  return {
    ok: true,
    total_clubs: orgs.length,
    live_deals: live.length,
    cold_prospects: orgs.length - live.length,
    clubs_with_no_contact: orgs.filter((o) => !counts.get(o.id)).length,
    total_contacts: (cRows as unknown[] | null)?.length ?? 0,
    queued_for_outreach: orgs.filter((o) => o.queued_at).length,
    overdue: open.filter((o) => o.next_step_at && o.next_step_at < ctx.today).length,
    due_today: open.filter((o) => o.next_step_at === ctx.today).length,
    open_value_per_month_dollars: Math.round(
      open.reduce((s, o) => s + (o.mrr_target_cents ?? 0), 0) / 100,
    ),
    by_stage: byStage,
    by_region: byRegion,
    by_state: byState,
    today: ctx.today,
  };
}

const CLUB_SCHEMA: Anthropic.Messages.Tool = {
  name: 'club_detail',
  description:
    'Everything on one club: its stage, region, source, next step, notes, every contact, and its timeline newest first. ' +
    'Use for "what happened with Rossmoor?" and before proposing any change to a club.',
  input_schema: {
    type: 'object',
    properties: {
      club: { type: 'string', description: 'The club name, or part of it. Ignored when the question is already about one club.' },
    },
  },
};

async function clubDetail(input: any, ctx: CrmAskContext): Promise<ToolResult> {
  const found = await resolveOrg(ctx, str(input?.club, 160));
  if (!found.ok) return found;
  const org = found.org;

  const [contacts, acts, sends] = await Promise.all([
    contactsFor(ctx, org.id),
    crmTable(ctx.db, 'crm_activities')
      .select('kind, body, occurred_at, created_by_email')
      .eq('org_id', org.id)
      .order('occurred_at', { ascending: false })
      .limit(30),
    crmTable(ctx.db, 'crm_email_sends')
      .select('to_email, subject, status, created_at, sent_by_email')
      .eq('org_id', org.id)
      .order('created_at', { ascending: false })
      .limit(10),
  ]);

  return {
    ok: true,
    club: {
      id: org.id,
      name: org.name,
      stage: STAGE_LABEL[org.stage as keyof typeof STAGE_LABEL] ?? org.stage,
      region: regionOf(org),
      state: org.state,
      source: org.source,
      website: org.website,
      owner: org.owner_email,
      next_step: org.next_step,
      next_step_at: org.next_step_at,
      demo_url: org.demo_url,
      queued_for_outreach: !!org.queued_at,
      notes: org.notes,
    },
    contacts: contacts.map((c) => ({
      id: c.id,
      name: c.full_name,
      title: c.title,
      email: c.email,
      role: c.role,
      primary: c.is_primary,
      do_not_contact: c.do_not_contact,
    })),
    timeline: (acts.data as { kind: string; body: string; occurred_at: string; created_by_email: string | null }[] | null) || [],
    emails_sent: (sends.data as unknown[] | null) || [],
  };
}

const WORK_SCHEMA: Anthropic.Messages.Tool = {
  name: 'recent_work',
  description:
    'What the reps have actually done lately — emails sent and activities logged, newest first, optionally filtered ' +
    'to one rep. Use for "who did Kevin email this week?" and "what have I done today?".',
  input_schema: {
    type: 'object',
    properties: {
      rep: { type: 'string', description: 'A rep\'s name or email. Omit for both of them.' },
      days: { type: 'number', description: 'How far back to look (default 7, max 90).' },
      limit: { type: 'number', description: 'Max rows of each kind (default 25, max 60).' },
    },
  },
};

async function recentWork(input: any, ctx: CrmAskContext): Promise<ToolResult> {
  const days = Math.max(1, Math.min(90, Number(input?.days) || 7));
  const limit = Math.max(1, Math.min(60, Number(input?.limit) || 25));
  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  // "Kevin" has to become me@kgcarey.com before it can filter a column.
  let repEmail: string | null = null;
  const rep = str(input?.rep, 200);
  if (rep) {
    const { data: reps } = await crmTable(ctx.db, 'crm_users').select('email, full_name, initials');
    const list = (reps as { email: string; full_name: string | null; initials: string | null }[] | null) || [];
    const needle = rep.toLowerCase();
    const hit =
      list.find((r) => r.email.toLowerCase() === needle) ??
      list.find((r) => (r.full_name ?? '').toLowerCase().includes(needle)) ??
      list.find((r) => r.email.toLowerCase().includes(needle)) ??
      null;
    if (!hit) return { ok: false, error: `No rep called "${rep}". The reps are the rows in crm_users.` };
    repEmail = hit.email;
  }

  let sendQ = crmTable(ctx.db, 'crm_email_sends')
    .select('org_id, to_email, subject, status, created_at, sent_by_email')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(limit);
  let actQ = crmTable(ctx.db, 'crm_activities')
    .select('org_id, kind, body, occurred_at, created_by_email')
    .gte('occurred_at', since)
    .order('occurred_at', { ascending: false })
    .limit(limit);
  if (repEmail) {
    sendQ = sendQ.eq('sent_by_email', repEmail);
    actQ = actQ.eq('created_by_email', repEmail);
  }
  if (ctx.orgId) {
    sendQ = sendQ.eq('org_id', ctx.orgId);
    actQ = actQ.eq('org_id', ctx.orgId);
  }

  const [{ data: sends }, { data: acts }] = await Promise.all([sendQ, actQ]);

  const orgIds = new Set<string>([
    ...((sends as { org_id: string }[] | null) || []).map((s) => s.org_id),
    ...((acts as { org_id: string }[] | null) || []).map((a) => a.org_id),
  ]);
  const names = new Map<string, string>();
  if (orgIds.size) {
    const { data: orgs } = await crmTable(ctx.db, 'crm_orgs').select('id, name').in('id', [...orgIds]);
    for (const o of (orgs as { id: string; name: string }[] | null) || []) names.set(o.id, o.name);
  }

  return {
    ok: true,
    window_days: days,
    rep: repEmail ?? 'everyone',
    emails: ((sends as { org_id: string; to_email: string; subject: string; status: string; created_at: string; sent_by_email: string }[] | null) || []).map(
      (s) => ({ club: names.get(s.org_id) ?? '(unknown)', to: s.to_email, subject: s.subject, status: s.status, at: s.created_at, by: s.sent_by_email }),
    ),
    activities: ((acts as { org_id: string; kind: string; body: string; occurred_at: string; created_by_email: string | null }[] | null) || []).map(
      (a) => ({ club: names.get(a.org_id) ?? '(unknown)', kind: a.kind, body: a.body, at: a.occurred_at, by: a.created_by_email }),
    ),
  };
}

const NEEDS_SCHEMA: Anthropic.Messages.Tool = {
  name: 'whats_waiting',
  description:
    'The same four things the Today list on /crm shows: next steps overdue or due today, demos that went quiet, ' +
    'replies logged with no next step, and how many clubs are queued for outreach. Use for "what should I do today?" ' +
    'and "what\'s overdue?".',
  input_schema: { type: 'object', properties: {} },
};

async function whatsWaiting(_input: any, ctx: CrmAskContext): Promise<ToolResult> {
  const { data } = await crmTable(ctx.db, 'crm_orgs').select(ORG_LITE);
  const orgs = (data as unknown as OrgLite[] | null) || [];
  const { data: aRows } = await crmTable(ctx.db, 'crm_activities')
    .select('org_id, kind, body, occurred_at')
    .order('occurred_at', { ascending: false });
  const last = new Map<string, { kind: string; body: string; occurred_at: string }>();
  for (const a of (aRows as { org_id: string; kind: string; body: string; occurred_at: string }[] | null) || []) {
    if (!last.has(a.org_id)) last.set(a.org_id, a);
  }

  const live = orgs.filter((o) => o.stage !== 'researching' || last.has(o.id));
  const open = live.filter((o) => o.stage !== 'won' && o.stage !== 'lost');
  const name = (o: OrgLite) => ({ id: o.id, name: o.name, next_step: o.next_step, next_step_at: o.next_step_at });

  return {
    ok: true,
    today: ctx.today,
    overdue: open.filter((o) => o.next_step_at && o.next_step_at < ctx.today).map(name),
    due_today: open.filter((o) => o.next_step_at === ctx.today).map(name),
    quiet_demos: open
      .filter((o) => o.stage === 'demo_done')
      .map((o) => ({ ...name(o), last_touch: last.get(o.id)?.occurred_at ?? null })),
    replies_not_acted_on: open
      .filter((o) => !o.next_step && (last.get(o.id)?.kind === 'reply' || looksLikeAReply(last.get(o.id)?.body)))
      .map((o) => ({ ...name(o), reply: last.get(o.id)?.body ?? null })),
    queued_for_outreach: orgs.filter((o) => o.queued_at).length,
    clubs_with_no_next_step: open.filter((o) => !o.next_step).length,
  };
}

// =====================================================================
// Action tools — every one returns a proposal and writes nothing
// =====================================================================

function proposal(p: Proposal): ToolResult {
  return { ok: true, proposal: p, note: 'PROPOSED ONLY. Nothing has changed. The rep must press Confirm.' };
}

const STAGE_SCHEMA: Anthropic.Messages.Tool = {
  name: 'propose_stage',
  description:
    'Propose moving a club to a different pipeline stage. Returns a proposal for the rep to confirm; it does not change anything.',
  input_schema: {
    type: 'object',
    properties: {
      club: { type: 'string', description: 'The club name, or part of it.' },
      stage: { type: 'string', description: `One of: ${STAGES.join(', ')}.` },
    },
    required: ['stage'],
  },
};

async function proposeStage(input: any, ctx: CrmAskContext): Promise<ToolResult> {
  const found = await resolveOrg(ctx, str(input?.club, 160));
  if (!found.ok) return found;
  const stage = input?.stage;
  if (!isStage(stage)) return { ok: false, error: `Stage must be one of: ${STAGES.join(', ')}.` };
  const org = found.org;
  if (org.stage === stage) {
    return { ok: false, error: `${org.name} is already at ${STAGE_LABEL[stage]}.` };
  }
  return proposal({
    action: 'set_stage',
    title: `Move ${org.name} to ${STAGE_LABEL[stage]}`,
    detail: [
      `Now: ${STAGE_LABEL[org.stage as keyof typeof STAGE_LABEL] ?? org.stage}`,
      'A stage change writes a line on the timeline.',
    ],
    args: { org_id: org.id, stage },
  });
}

const NEXT_STEP_SCHEMA: Anthropic.Messages.Tool = {
  name: 'propose_next_step',
  description:
    'Propose setting a club\'s next step and the date it is due. Returns a proposal for the rep to confirm.',
  input_schema: {
    type: 'object',
    properties: {
      club: { type: 'string', description: 'The club name, or part of it.' },
      next_step: { type: 'string', description: 'Who does what, next. One line.' },
      due: { type: 'string', description: 'YYYY-MM-DD. Resolve "Friday" or "next week" against today yourself. Omit for no date.' },
    },
    required: ['next_step'],
  },
};

async function proposeNextStep(input: any, ctx: CrmAskContext): Promise<ToolResult> {
  const found = await resolveOrg(ctx, str(input?.club, 160));
  if (!found.ok) return found;
  const step = str(input?.next_step, 300);
  if (!step) return { ok: false, error: 'What is the next step?' };
  const due = str(input?.due, 20) || null;
  if (due && !isISODate(due)) return { ok: false, error: 'The due date has to be YYYY-MM-DD.' };
  const org = found.org;
  return proposal({
    action: 'set_next_step',
    title: `Set ${org.name}'s next step`,
    detail: [
      `"${step}"${due ? ` — due ${due}` : ' — no date'}`,
      org.next_step ? `Replaces: "${org.next_step}"${org.next_step_at ? ` (${org.next_step_at})` : ''}` : 'There is no next step now.',
    ],
    args: { org_id: org.id, next_step: step, next_step_at: due },
  });
}

const NOTE_SCHEMA: Anthropic.Messages.Tool = {
  name: 'propose_note',
  description:
    'Propose adding a line to a club\'s timeline — a note, call, email, meeting, demo or proposal. Returns a proposal for the rep to confirm.',
  input_schema: {
    type: 'object',
    properties: {
      club: { type: 'string', description: 'The club name, or part of it.' },
      body: { type: 'string', description: 'What happened, in the rep\'s words.' },
      kind: { type: 'string', description: `One of: ${ACTIVITY_KINDS.filter((k) => k !== 'stage_change').join(', ')}. Defaults to note.` },
      occurred_on: { type: 'string', description: 'YYYY-MM-DD if it happened on a different day. Defaults to today.' },
    },
    required: ['body'],
  },
};

async function proposeNote(input: any, ctx: CrmAskContext): Promise<ToolResult> {
  const found = await resolveOrg(ctx, str(input?.club, 160));
  if (!found.ok) return found;
  const body = str(input?.body, 4000);
  if (!body) return { ok: false, error: 'What should the note say?' };
  const kind = isActivityKind(input?.kind) && input.kind !== 'stage_change' ? input.kind : 'note';
  const on = str(input?.occurred_on, 20) || null;
  if (on && !isISODate(on)) return { ok: false, error: 'The date has to be YYYY-MM-DD.' };
  return proposal({
    action: 'add_note',
    title: `Log a ${kind} on ${found.org.name}`,
    detail: [body, on && on !== ctx.today ? `Dated ${on}` : 'Dated today'],
    args: { org_id: found.org.id, body, kind, occurred_at: on },
  });
}

const CONTACT_SCHEMA: Anthropic.Messages.Tool = {
  name: 'propose_contact',
  description:
    'Propose adding a person to a club. Returns a proposal for the rep to confirm. ' +
    'Useful for the 128 clubs with nobody on file at all.',
  input_schema: {
    type: 'object',
    properties: {
      club: { type: 'string', description: 'The club name, or part of it.' },
      full_name: { type: 'string', description: 'Their name.' },
      title: { type: 'string', description: 'Their title at the club, if known. Do not guess one.' },
      email: { type: 'string', description: 'Their email, if known. Do not guess one.' },
      phone: { type: 'string' },
      role: { type: 'string', description: 'How they matter to the deal — decision maker, champion, gatekeeper.' },
    },
    required: ['full_name'],
  },
};

async function proposeContact(input: any, ctx: CrmAskContext): Promise<ToolResult> {
  const found = await resolveOrg(ctx, str(input?.club, 160));
  if (!found.ok) return found;
  const fullName = str(input?.full_name, 160);
  if (!fullName) return { ok: false, error: 'Who is it?' };
  const email = str(input?.email, 200).toLowerCase() || null;
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: `"${email}" is not an email address.` };

  const already = (await contactsFor(ctx, found.org.id)).find(
    (c) => c.full_name.trim().toLowerCase() === fullName.toLowerCase(),
  );
  if (already) return { ok: false, error: `${fullName} is already on ${found.org.name}.` };

  return proposal({
    action: 'add_contact',
    title: `Add ${fullName} to ${found.org.name}`,
    detail: [
      [str(input?.title, 160), email, str(input?.phone, 60)].filter(Boolean).join(' · ') || 'Name only — fill the rest in later.',
      str(input?.role, 120) ? `Role: ${str(input?.role, 120)}` : '',
    ].filter(Boolean),
    args: {
      org_id: found.org.id,
      full_name: fullName,
      title: str(input?.title, 160) || null,
      email,
      phone: str(input?.phone, 60) || null,
      role: str(input?.role, 120) || null,
    },
  });
}

const DNC_SCHEMA: Anthropic.Messages.Tool = {
  name: 'propose_do_not_contact',
  description:
    'Propose marking someone "don\'t contact" (or clearing it). Returns a proposal for the rep to confirm. ' +
    'Once on, the compose panel refuses to pick them and the send route refuses again.',
  input_schema: {
    type: 'object',
    properties: {
      club: { type: 'string', description: 'The club name, or part of it.' },
      person: { type: 'string', description: 'Their name or email address at that club.' },
      on: { type: 'boolean', description: 'true to mark do-not-contact, false to clear it. Defaults to true.' },
    },
    required: ['person'],
  },
};

async function proposeDnc(input: any, ctx: CrmAskContext): Promise<ToolResult> {
  const found = await resolveOrg(ctx, str(input?.club, 160));
  if (!found.ok) return found;
  const who = str(input?.person, 200).toLowerCase();
  if (!who) return { ok: false, error: 'Which person?' };
  const list = await contactsFor(ctx, found.org.id);
  const hits = list.filter(
    (c) => c.full_name.toLowerCase().includes(who) || (c.email ?? '').toLowerCase() === who,
  );
  if (!hits.length) return { ok: false, error: `Nobody called "${input.person}" at ${found.org.name}.` };
  if (hits.length > 1) {
    return { ok: false, error: `"${input.person}" matches ${hits.map((c) => c.full_name).join(', ')}. Ask which.` };
  }
  const on = input?.on !== false;
  const c = hits[0];
  if (c.do_not_contact === on) {
    return { ok: false, error: `${c.full_name} is already ${on ? 'marked' : 'not marked'} do-not-contact.` };
  }
  return proposal({
    action: 'set_do_not_contact',
    title: on ? `Mark ${c.full_name} "don't contact"` : `Clear "don't contact" on ${c.full_name}`,
    detail: [`${found.org.name}${c.email ? ` · ${c.email}` : ''}`],
    args: { contact_id: c.id, on },
  });
}

const QUEUE_SCHEMA: Anthropic.Messages.Tool = {
  name: 'propose_queue_for_outreach',
  description:
    'Propose flagging clubs for the outreach queue, which is what the daily email deck draws from. ' +
    'Takes a list of club names. Returns a proposal for the rep to confirm. Nothing is sent by this — it is a flag.',
  input_schema: {
    type: 'object',
    properties: {
      clubs: { type: 'array', items: { type: 'string' }, description: 'Club names. Up to 50.' },
      unqueue: { type: 'boolean', description: 'true to take them back out of the queue.' },
    },
    required: ['clubs'],
  },
};

async function proposeQueue(input: any, ctx: CrmAskContext): Promise<ToolResult> {
  const raw = Array.isArray(input?.clubs) ? input.clubs : [];
  if (!raw.length) return { ok: false, error: 'Which clubs?' };
  if (raw.length > 50) return { ok: false, error: 'Fifty at a time at most — use the cold list for a bigger batch.' };

  const ids: string[] = [];
  const names: string[] = [];
  for (const item of raw.slice(0, 50)) {
    const found = await resolveOrg(ctx, str(item, 160));
    if (!found.ok) return found;
    if (ids.includes(found.org.id)) continue;
    ids.push(found.org.id);
    names.push(found.org.name);
  }
  const unqueue = input?.unqueue === true;
  return proposal({
    action: 'queue_for_outreach',
    title: unqueue
      ? `Take ${ids.length} club${ids.length === 1 ? '' : 's'} out of the outreach queue`
      : `Queue ${ids.length} club${ids.length === 1 ? '' : 's'} for outreach`,
    detail: [names.slice(0, 12).join(', ') + (names.length > 12 ? `, and ${names.length - 12} more` : '')],
    args: { org_ids: ids, unqueue },
  });
}

const DRAFT_SCHEMA: Anthropic.Messages.Tool = {
  name: 'propose_email_draft',
  description:
    'Write a draft email to one person at one club. This does NOT send anything and cannot: confirming hands the ' +
    'draft to the compose panel on the club page, where the rep still has to press Preview and then Send. ' +
    'Write it plainly, as a person would — no marketing voice, no header, no bullet lists, four sentences at most. ' +
    'Do not write a signature; one is added automatically.',
  input_schema: {
    type: 'object',
    properties: {
      club: { type: 'string', description: 'The club name, or part of it.' },
      person: { type: 'string', description: 'Who it is to — their name or email at that club. Omit to use the primary contact.' },
      subject: { type: 'string', description: 'The subject line.' },
      body: { type: 'string', description: 'The message, without a signature.' },
    },
    required: ['subject', 'body'],
  },
};

async function proposeDraft(input: any, ctx: CrmAskContext): Promise<ToolResult> {
  const found = await resolveOrg(ctx, str(input?.club, 160));
  if (!found.ok) return found;
  const org = found.org;
  const list = (await contactsFor(ctx, org.id)).filter((c) => !!c.email && !c.do_not_contact);
  if (!list.length) {
    return {
      ok: false,
      error: `Nobody at ${org.name} has an email address you can write to. Find the racquets director first.`,
    };
  }
  const who = str(input?.person, 200).toLowerCase();
  let contact = list.find((c) => c.is_primary) ?? list[0];
  if (who) {
    const hits = list.filter((c) => c.full_name.toLowerCase().includes(who) || (c.email ?? '').toLowerCase() === who);
    if (!hits.length) return { ok: false, error: `Nobody called "${input.person}" at ${org.name} has an email address.` };
    if (hits.length > 1) return { ok: false, error: `"${input.person}" matches ${hits.map((c) => c.full_name).join(', ')}. Ask which.` };
    contact = hits[0];
  }
  const subject = str(input?.subject, 300);
  const body = str(input?.body, 6000);
  if (!subject) return { ok: false, error: 'Give it a subject.' };
  if (!body) return { ok: false, error: 'The message is empty.' };

  return proposal({
    action: 'draft_email',
    title: `Draft an email to ${contact.full_name} at ${org.name}`,
    detail: [`To: ${contact.email}`, `Subject: ${subject}`, body],
    args: { org_id: org.id, org_name: org.name, contact_id: contact.id, to: contact.email, subject, body },
  });
}

// =====================================================================
// The pack
// =====================================================================

export const CRM_TOOLS: CrmTool[] = [
  { schema: SEARCH_SCHEMA, kind: 'read', run: searchClubs },
  { schema: SUMMARY_SCHEMA, kind: 'read', run: pipelineSummary },
  { schema: CLUB_SCHEMA, kind: 'read', run: clubDetail },
  { schema: WORK_SCHEMA, kind: 'read', run: recentWork },
  { schema: NEEDS_SCHEMA, kind: 'read', run: whatsWaiting },
  { schema: STAGE_SCHEMA, kind: 'action', run: proposeStage },
  { schema: NEXT_STEP_SCHEMA, kind: 'action', run: proposeNextStep },
  { schema: NOTE_SCHEMA, kind: 'action', run: proposeNote },
  { schema: CONTACT_SCHEMA, kind: 'action', run: proposeContact },
  { schema: DNC_SCHEMA, kind: 'action', run: proposeDnc },
  { schema: QUEUE_SCHEMA, kind: 'action', run: proposeQueue },
  { schema: DRAFT_SCHEMA, kind: 'action', run: proposeDraft },
];

export const CRM_TOOL_SCHEMAS: Anthropic.Messages.Tool[] = CRM_TOOLS.map((t) => t.schema);

/**
 * Run one tool.
 *
 * The gate is first, before the name is looked up and before the input is
 * touched, so there is no tool and no argument shape that reaches a query
 * without ctx.allowed. A stranger gets the same "Not found." the rest of the
 * CRM gives them — this must not confirm that a pipeline exists either.
 */
export async function runCrmTool(name: string, input: unknown, ctx: CrmAskContext): Promise<ToolResult> {
  if (!ctx || ctx.allowed !== true) return { ok: false, error: 'Not found.' };
  const tool = CRM_TOOLS.find((t) => t.schema.name === name);
  if (!tool) return { ok: false, error: `There is no tool called ${name}.` };
  try {
    return await tool.run(input, ctx);
  } catch (e: unknown) {
    return { ok: false, error: (e as Error)?.message || 'That did not work.' };
  }
}

/** Did a tool result carry a proposal? */
export function proposalOf(r: ToolResult): Proposal | null {
  if (!r.ok) return null;
  const p = (r as { proposal?: Proposal }).proposal;
  return p && typeof p === 'object' && (PROPOSAL_ACTIONS as readonly string[]).includes(p.action) ? p : null;
}
