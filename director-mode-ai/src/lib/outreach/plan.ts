/**
 * Picking tomorrow's deck.
 *
 * The planner is two halves on purpose. `selectIntros` / `selectFollowUps` are
 * pure: they take rows and a clock and return decisions, so every rule below
 * is testable without a database and without spending a model call. `planDay`
 * is the thin driver that loads those rows, calls the model for the bodies,
 * and writes `planned` queue rows.
 *
 * ── WHO IS ELIGIBLE ─────────────────────────────────────────────────────
 * A cold club, once. stage='researching' (a live deal is a human's job, not
 * the deck's), at least one contact with an email, nothing suppressed, nothing
 * we have written to before, and not a club another rep already owns.
 *
 * ── THE ORDER ───────────────────────────────────────────────────────────
 * queued_at first — a rep starring a club off the cold list is the strongest
 * signal there is, and it must beat every heuristic. Then West, Central, East,
 * International/unknown. West first because that is where we are: a club in
 * California can be told about Rossmoor and Lafayette by name and know the
 * places, and the first few days of a brand-new sending domain are the days
 * you most want a reply.
 *
 * ── THE RAMP ────────────────────────────────────────────────────────────
 * outreach.clubmode.ai has never sent an email. capForDay() walks the warmup
 * steps in the settings row — 5/day for three days, then 10, then the full cap
 * — so the ramp is something Darrin can change in one UPDATE, not a constant
 * somebody has to find.
 *
 * ── ONE FOLLOW-UP ───────────────────────────────────────────────────────
 * Ever. `kind='followup'` rows can only descend from a `sent` intro, and the
 * dedupe key makes a second one impossible even if this file is wrong.
 */

import type { getSupabaseAdmin } from '@/lib/supabase/admin';
import { daysBetween, type ISODate } from '@/lib/crm/dates';
import { firstNameOf } from '@/lib/crm/compose';
import { capForDay, normalizeSettings, outreachToday } from './settings';
import { draftEmail, whyLine, type ClubFacts, type TemplateRow } from './write';
import { REGIONS, type OutreachSettings, type QueueRow } from './types';

type Db = ReturnType<typeof getSupabaseAdmin>;

/** Never a second email to the same club inside this many days. */
export const MIN_DAYS_BETWEEN_EMAILS = 30;

// --------------------------------------------------------------- the rows

export interface CandidateContact {
  id: string;
  full_name: string;
  title: string | null;
  email: string;
  is_primary: boolean;
  do_not_contact: boolean;
  /** Recorded upstream by the DCA import, in the contact's notes. */
  is_personal_email: boolean;
}

export interface Candidate {
  org_id: string;
  org_name: string;
  region: string | null;
  queued_at: string | null;
  stage: string;
  owner_email: string | null;
  city: string | null;
  state: string | null;
  website: string | null;
  contacts: CandidateContact[];
  /** Newest send to this club from any path, or null. */
  last_send_at: string | null;
  /** The club itself is suppressed. */
  suppressed: boolean;
  /** Addresses at this club that are suppressed on their own. */
  suppressed_emails: string[];
  /** This club already has a queue row of any status. */
  has_queue_row: boolean;
}

export interface Pick {
  candidate: Candidate;
  contact: CandidateContact;
}

export type SkipReason =
  | 'not_researching'
  | 'suppressed'
  | 'no_sendable_contact'
  | 'already_written'
  | 'too_recent'
  | 'already_queued'
  | 'another_rep'
  | 'over_cap';

// ------------------------------------------------------------- the picking

function regionRank(region: string | null): number {
  const i = (REGIONS as readonly string[]).indexOf((region ?? '').trim());
  // Unknown sorts with International: last, and warmed into rather than led with.
  return i === -1 ? REGIONS.length - 1 : i;
}

/**
 * The one person at this club who gets the letter.
 *
 * Primary wins outright — a rep set it deliberately. Otherwise a work address
 * beats a gmail: writing to alyson@theclub.org is a business note to someone
 * at their desk, writing to the same person's personal gmail is a stranger in
 * their private inbox, and the second one is how a domain gets complaints.
 * Ties break on name so the choice is stable across re-runs.
 */
export function pickContact(contacts: CandidateContact[], suppressed: string[] = []): CandidateContact | null {
  const blocked = new Set(suppressed.map((e) => e.toLowerCase()));
  const usable = contacts.filter(
    (c) => !!c.email && !c.do_not_contact && !blocked.has(c.email.toLowerCase()),
  );
  if (!usable.length) return null;
  const score = (c: CandidateContact) => (c.is_primary ? 0 : c.is_personal_email ? 2 : 1);
  return [...usable].sort(
    (a, b) => score(a) - score(b) || a.full_name.localeCompare(b.full_name),
  )[0];
}

/** Freemail domains, for rows the importer did not flag. */
const PERSONAL_DOMAINS = new Set([
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com', 'icloud.com',
  'me.com', 'msn.com', 'comcast.net', 'live.com', 'mac.com', 'sbcglobal.net',
  'verizon.net', 'att.net', 'bellsouth.net', 'protonmail.com', 'ymail.com',
]);

export function looksPersonal(email: string, note: string | null | undefined): boolean {
  if ((note ?? '').toLowerCase().includes('personal email address')) return true;
  const domain = (email.split('@')[1] ?? '').toLowerCase();
  return PERSONAL_DOMAINS.has(domain);
}

export interface SelectResult {
  picks: Pick[];
  skipped: { org_id: string; org_name: string; reason: SkipReason }[];
}

/**
 * Today's intros, in order, capped.
 *
 * `alreadyPlannedToday` is what the day already holds — a re-run at noon must
 * top the deck up to the cap, not add a fresh cap's worth on top of it.
 */
export function selectIntros(
  candidates: Candidate[],
  opts: { cap: number; today: ISODate; repEmail: string; alreadyPlannedToday?: number },
): SelectResult {
  const skipped: SelectResult['skipped'] = [];
  const eligible: Pick[] = [];

  for (const c of candidates) {
    const note = (reason: SkipReason) => skipped.push({ org_id: c.org_id, org_name: c.org_name, reason });
    if (c.stage !== 'researching') { note('not_researching'); continue; }
    if (c.suppressed) { note('suppressed'); continue; }
    if (c.has_queue_row) { note('already_queued'); continue; }
    if (c.owner_email && c.owner_email.toLowerCase() !== opts.repEmail.toLowerCase()) {
      note('another_rep');
      continue;
    }
    if (c.last_send_at) {
      // Written to before is a permanent disqualifier for an INTRO — this
      // deck's job is first contact. The 30-day rule below is the belt to
      // that braces, and it is what a future "second campaign" would hit.
      const days = daysBetween(c.last_send_at.slice(0, 10), opts.today);
      note(days < MIN_DAYS_BETWEEN_EMAILS ? 'too_recent' : 'already_written');
      continue;
    }
    const contact = pickContact(c.contacts, c.suppressed_emails);
    if (!contact) { note('no_sendable_contact'); continue; }
    eligible.push({ candidate: c, contact });
  }

  eligible.sort((a, b) => {
    const qa = a.candidate.queued_at;
    const qb = b.candidate.queued_at;
    if (qa && qb) return qa.localeCompare(qb) || a.candidate.org_name.localeCompare(b.candidate.org_name);
    if (qa) return -1;
    if (qb) return 1;
    return (
      regionRank(a.candidate.region) - regionRank(b.candidate.region) ||
      a.candidate.org_name.localeCompare(b.candidate.org_name)
    );
  });

  const room = Math.max(0, opts.cap - (opts.alreadyPlannedToday ?? 0));
  for (const over of eligible.slice(room)) {
    skipped.push({ org_id: over.candidate.org_id, org_name: over.candidate.org_name, reason: 'over_cap' });
  }
  return { picks: eligible.slice(0, room), skipped };
}

// ------------------------------------------------------------- follow-ups

export interface FollowUpSource {
  queue: Pick_<QueueRow, 'id' | 'org_id' | 'contact_id' | 'rep_email' | 'subject' | 'body' | 'sent_at' | 'kind' | 'status'>;
  /** Is there already a followup descending from this row? */
  has_follow_up: boolean;
  /** The club or the address has been suppressed since — a bounce, a reply, a no. */
  suppressed: boolean;
}

type Pick_<T, K extends keyof T> = { [P in K]: T[P] };

/**
 * The one follow-up, `follow_up_days` after the intro landed.
 *
 * Every condition here is a reason NOT to write: a reply (the rep logs it,
 * which suppresses the club), a bounce (the webhook suppresses the address),
 * an existing follow-up, or a send that has not aged yet. What is left is a
 * club that heard from us once, a week ago, and said nothing.
 */
export function selectFollowUps(
  sources: FollowUpSource[],
  opts: { cap: number; today: ISODate; followUpDays: number },
): FollowUpSource[] {
  const due = sources.filter((s) => {
    if (s.queue.kind !== 'intro' || s.queue.status !== 'sent' || !s.queue.sent_at) return false;
    if (s.has_follow_up || s.suppressed) return false;
    return daysBetween(s.queue.sent_at.slice(0, 10), opts.today) >= opts.followUpDays;
  });
  // Oldest first: a follow-up eleven days late is worth more than one that is
  // exactly on time, and the cap should spend itself on the stalest.
  due.sort((a, b) => (a.queue.sent_at ?? '').localeCompare(b.queue.sent_at ?? ''));
  return due.slice(0, Math.max(0, opts.cap));
}

// -------------------------------------------------------------- the driver

export interface PlanResult {
  date: ISODate;
  cap: number;
  paused: boolean;
  /** Rows actually written (0 in a dry run). */
  planned: number;
  intros: number;
  follow_ups: number;
  /** Cards the plan produced, whether or not they were written. */
  cards: {
    org_id: string;
    org_name: string;
    contact_id: string;
    to: string;
    kind: 'intro' | 'followup';
    subject: string;
    body: string;
    why: string;
    generated_by: 'model' | 'template';
    rejected?: string[];
  }[];
  skipped: SelectResult['skipped'];
  note?: string;
}

export async function loadSettings(db: Db): Promise<OutreachSettings> {
  const { data } = await db
    .from('crm_outreach_settings')
    .select('daily_cap, send_window_start, send_window_end, paused, warmup_start_date, warmup_steps, follow_up_days')
    .eq('id', 1)
    .maybeSingle();
  return normalizeSettings(data as Partial<OutreachSettings> | null);
}

async function loadTemplates(db: Db): Promise<Record<string, TemplateRow>> {
  const { data } = await db
    .from('crm_templates')
    .select('slug, subject, body')
    .in('slug', ['outreach-intro', 'outreach-followup']);
  const out: Record<string, TemplateRow> = {};
  for (const row of (data as TemplateRow[] | null) ?? []) out[row.slug] = row;
  return out;
}

/**
 * Everything the pure selector needs, in five queries.
 *
 * Wholesale rather than filtered: 522 orgs and 729 contacts is one page each,
 * and a planner that reasons over the whole board in memory cannot develop the
 * classic bug where a filter and a cap disagree about which rows exist.
 */
export async function loadCandidates(db: Db): Promise<Candidate[]> {
  const [orgsRes, contactsRes, sendsRes, queueRes, suppRes] = await Promise.all([
    db
      .from('crm_orgs')
      .select('id, name, stage, owner_email, city, state, website, notes, region, queued_at')
      .eq('stage', 'researching')
      .limit(5000),
    db.from('crm_contacts').select('id, org_id, full_name, title, email, is_primary, do_not_contact, notes').limit(5000),
    db.from('crm_email_sends').select('org_id, created_at').eq('status', 'sent').limit(5000),
    db.from('crm_outreach_queue').select('org_id, sent_at, status').limit(5000),
    db.from('crm_outreach_suppression').select('email, org_id').limit(5000),
  ]);

  type OrgRow = {
    id: string; name: string; stage: string; owner_email: string | null;
    city: string | null; state: string | null; website: string | null;
    notes: string | null; region?: string | null; queued_at?: string | null;
  };
  const orgs = (orgsRes.data as OrgRow[] | null) ?? [];

  const byOrg = new Map<string, CandidateContact[]>();
  for (const c of ((contactsRes.data as (CandidateContact & { org_id: string; notes: string | null })[] | null) ?? [])) {
    if (!c.email) continue;
    const list = byOrg.get(c.org_id) ?? [];
    list.push({
      id: c.id,
      full_name: c.full_name,
      title: c.title,
      email: c.email,
      is_primary: c.is_primary,
      do_not_contact: c.do_not_contact,
      is_personal_email: looksPersonal(c.email, c.notes),
    });
    byOrg.set(c.org_id, list);
  }

  const lastSend = new Map<string, string>();
  const bump = (orgId: string, at: string | null) => {
    if (!at) return;
    const cur = lastSend.get(orgId);
    if (!cur || at > cur) lastSend.set(orgId, at);
  };
  for (const s of ((sendsRes.data as { org_id: string; created_at: string }[] | null) ?? [])) bump(s.org_id, s.created_at);

  const queued = new Set<string>();
  for (const q of ((queueRes.data as { org_id: string; sent_at: string | null; status: string }[] | null) ?? [])) {
    queued.add(q.org_id);
    bump(q.org_id, q.sent_at);
  }

  const suppressedOrgs = new Set<string>();
  const suppressedEmails = new Set<string>();
  for (const s of ((suppRes.data as { email: string | null; org_id: string | null }[] | null) ?? [])) {
    if (s.org_id) suppressedOrgs.add(s.org_id);
    if (s.email) suppressedEmails.add(s.email.toLowerCase());
  }

  return orgs.map((o) => {
    const contacts = byOrg.get(o.id) ?? [];
    return {
      org_id: o.id,
      org_name: o.name,
      // `region` may not exist yet on a branch where the other migration has
      // not landed; the select would have failed loudly, so this is only ever
      // a null column, and the notes fallback keeps the ordering honest.
      region: o.region ?? regionFromNotes(o.notes),
      queued_at: o.queued_at ?? null,
      stage: o.stage,
      owner_email: o.owner_email,
      city: o.city,
      state: o.state,
      website: o.website,
      contacts,
      last_send_at: lastSend.get(o.id) ?? null,
      suppressed: suppressedOrgs.has(o.id),
      suppressed_emails: contacts.map((c) => c.email.toLowerCase()).filter((e) => suppressedEmails.has(e)),
      has_queue_row: queued.has(o.id),
    };
  });
}

/** The DCA importer wrote the region into the note before it was a column. */
export function regionFromNotes(notes: string | null): string | null {
  const m = (notes ?? '').match(/DCA (West|Central|East|International) region/i);
  return m ? m[1][0].toUpperCase() + m[1].slice(1).toLowerCase().replace(/^i/, 'I') : null;
}

function factsFor(c: Candidate, contact: CandidateContact, repName: string): ClubFacts {
  return {
    club: c.org_name,
    region: c.region,
    firstName: firstNameOf(contact.full_name) || contact.full_name,
    contactTitle: contact.title,
    otherContacts: Math.max(0, c.contacts.length - 1),
    city: c.city,
    state: c.state,
    website: c.website,
    repName,
  };
}

/**
 * Plan one day.
 *
 * `dryRun` writes nothing and is what the "show me tomorrow without touching
 * anything" path uses — including the very first run against prod, where the
 * whole point was to look at 15 real cards and send none of them.
 */
export async function planDay(
  db: Db,
  opts: { repEmail: string; repName: string; date?: ISODate; dryRun?: boolean; now?: Date },
): Promise<PlanResult> {
  const now = opts.now ?? new Date();
  const today = opts.date ?? outreachToday(now);
  const settings = await loadSettings(db);
  // Null warmup_start_date means the domain has never sent — capForDay()
  // treats that as day zero of the ramp, not as "warmed up". See settings.ts.
  const cap = capForDay(settings, today);

  if (settings.paused) {
    return { date: today, cap, paused: true, planned: 0, intros: 0, follow_ups: 0, cards: [], skipped: [], note: 'Outreach is paused in settings. Nothing planned.' };
  }

  const [templates, candidates] = await Promise.all([loadTemplates(db), loadCandidates(db)]);
  const intro = templates['outreach-intro'];
  const followTpl = templates['outreach-followup'] ?? intro;
  if (!intro) {
    return { date: today, cap, paused: false, planned: 0, intros: 0, follow_ups: 0, cards: [], skipped: [], note: 'No outreach-intro template. Run supabase/migrations/crm_outreach.sql.' };
  }

  // Already on the board for this date, so a re-run tops up rather than doubles.
  const { count: plannedToday } = await db
    .from('crm_outreach_queue')
    .select('id', { count: 'exact', head: true })
    .eq('send_date', today)
    .in('status', ['planned', 'approved', 'sent']);

  // Follow-ups come out of the same cap and go first: a club that already
  // heard from us once is worth more than the 500th cold name.
  const followUps = await loadFollowUpSources(db);
  const dueFollowUps = selectFollowUps(followUps, { cap, today, followUpDays: settings.follow_up_days });

  const introRoom = Math.max(0, cap - (plannedToday ?? 0) - dueFollowUps.length);
  const { picks, skipped } = selectIntros(candidates, {
    cap: introRoom,
    today,
    repEmail: opts.repEmail,
    alreadyPlannedToday: 0,
  });

  const cards: PlanResult['cards'] = [];
  let written = 0;

  for (const f of dueFollowUps) {
    const c = candidates.find((x) => x.org_id === f.queue.org_id);
    const contact = c?.contacts.find((x) => x.id === f.queue.contact_id) ?? null;
    if (!c || !contact) continue;
    const facts = factsFor(c, contact, opts.repName);
    const draft = await draftEmail(facts, followTpl, { kind: 'followup', priorBody: f.queue.body });
    const why = whyLine(facts, {
      kind: 'followup',
      daysSinceFirst: daysBetween((f.queue.sent_at ?? today).slice(0, 10), today),
    });
    cards.push({
      org_id: c.org_id, org_name: c.org_name, contact_id: contact.id, to: contact.email,
      kind: 'followup', subject: draft.subject, body: draft.body, why,
      generated_by: draft.generated_by, rejected: draft.rejected,
    });
    if (!opts.dryRun) {
      written += await insertPlanned(db, {
        org_id: c.org_id, contact_id: contact.id, rep_email: opts.repEmail, send_date: today,
        subject: draft.subject, body: draft.body, why, kind: 'followup',
        follow_up_of: f.queue.id, generated_by: draft.generated_by,
        dedupe_key: `${c.org_id}:followup`,
      });
    }
  }

  for (const p of picks) {
    const facts = factsFor(p.candidate, p.contact, opts.repName);
    const draft = await draftEmail(facts, intro, { kind: 'intro' });
    const why = whyLine(facts, { kind: 'intro' });
    cards.push({
      org_id: p.candidate.org_id, org_name: p.candidate.org_name, contact_id: p.contact.id,
      to: p.contact.email, kind: 'intro', subject: draft.subject, body: draft.body, why,
      generated_by: draft.generated_by, rejected: draft.rejected,
    });
    if (!opts.dryRun) {
      written += await insertPlanned(db, {
        org_id: p.candidate.org_id, contact_id: p.contact.id, rep_email: opts.repEmail,
        send_date: today, subject: draft.subject, body: draft.body, why, kind: 'intro',
        follow_up_of: null, generated_by: draft.generated_by,
        dedupe_key: `${p.candidate.org_id}:intro`,
      });
    }
  }

  return {
    date: today,
    cap,
    paused: false,
    planned: written,
    intros: picks.length,
    follow_ups: dueFollowUps.length,
    cards,
    skipped,
  };
}

/**
 * Insert one planned row, treating a duplicate key as success.
 *
 * The unique index on dedupe_key is the real re-run guard, and a 23505 here
 * means another run already queued this club — which is the outcome we wanted.
 */
async function insertPlanned(db: Db, row: Record<string, unknown>): Promise<number> {
  const { error } = await db.from('crm_outreach_queue').insert(row);
  if (!error) return 1;
  if (error.code === '23505') return 0;
  throw new Error(`queue insert failed for ${row.org_id}: ${error.message}`);
}

export async function loadFollowUpSources(db: Db): Promise<FollowUpSource[]> {
  const [sentRes, allRes, suppRes] = await Promise.all([
    db
      .from('crm_outreach_queue')
      .select('id, org_id, contact_id, rep_email, subject, body, sent_at, kind, status')
      .eq('kind', 'intro')
      .eq('status', 'sent')
      .limit(5000),
    db.from('crm_outreach_queue').select('follow_up_of').eq('kind', 'followup').limit(5000),
    db.from('crm_outreach_suppression').select('org_id').not('org_id', 'is', null).limit(5000),
  ]);

  const hasFollowUp = new Set(
    ((allRes.data as { follow_up_of: string | null }[] | null) ?? []).map((r) => r.follow_up_of).filter(Boolean) as string[],
  );
  const suppressed = new Set(((suppRes.data as { org_id: string }[] | null) ?? []).map((r) => r.org_id));

  return ((sentRes.data as FollowUpSource['queue'][] | null) ?? []).map((q) => ({
    queue: q,
    has_follow_up: hasFollowUp.has(q.id),
    suppressed: suppressed.has(q.org_id),
  }));
}
