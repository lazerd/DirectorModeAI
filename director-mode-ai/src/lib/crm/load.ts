/**
 * Reads. Everything goes through the service-role client the caller already
 * proved they may use (lib/crm/server.ts) — the route is the access check.
 */

import type { getSupabaseAdmin } from '@/lib/supabase/admin';
import type { ActivityKind } from './stages';
import { regionOf } from './region';
import {
  ACTIVITY_COLS,
  CONTACT_COLS,
  ORG_COLS,
  type Activity,
  type ColdRow,
  type Contact,
  type Org,
  type OrgCard,
} from './types';

type Db = ReturnType<typeof getSupabaseAdmin>;

/**
 * Every org, with the two derived facts a pipeline card needs.
 *
 * Two queries rather than a join with an aggregate: PostgREST cannot give a
 * MAX(occurred_at) per parent without a view, and at three prospects — or three
 * hundred — pulling the id/occurred_at pairs and folding them in memory is both
 * faster to write and impossible to get subtly wrong.
 */
export async function loadPipeline(db: Db): Promise<OrgCard[]> {
  const { data: orgs } = await db.from('crm_orgs').select(ORG_COLS).order('name');
  const rows = (orgs as Org[] | null) || [];
  if (!rows.length) return [];

  const [{ data: acts }, { data: contacts }] = await Promise.all([
    db
      .from('crm_activities')
      .select('org_id, occurred_at, kind, body')
      .order('occurred_at', { ascending: false }),
    db.from('crm_contacts').select('org_id'),
  ]);

  type ActRow = { org_id: string; occurred_at: string; kind: ActivityKind; body: string };
  const latest = new Map<string, ActRow>();
  for (const a of (acts as ActRow[] | null) || []) {
    // Ordered newest-first, so the first one wins.
    if (!latest.has(a.org_id)) latest.set(a.org_id, a);
  }
  const counts = new Map<string, number>();
  for (const c of (contacts as { org_id: string }[] | null) || []) {
    counts.set(c.org_id, (counts.get(c.org_id) ?? 0) + 1);
  }

  return rows.map((o) => {
    const a = latest.get(o.id) ?? null;
    return {
      ...o,
      last_activity_at: a?.occurred_at ?? null,
      last_activity_kind: a?.kind ?? null,
      last_activity_body: a?.body ?? null,
      contact_count: counts.get(o.id) ?? 0,
    };
  });
}

/**
 * The two halves of /crm.
 *
 * A "live deal" is one somebody has actually done something about: it has
 * moved off `researching`, or there is at least one activity against it. The
 * other 519 are the cold list.
 *
 * Note what this is NOT: a filter on `source`. If Darrin logs a call against a
 * DCA club tomorrow morning, that club is a live deal by lunchtime without
 * anyone remembering to change a field — which is the only version of this
 * rule that survives contact with a working week. The board stays the handful
 * of real deals it was before 519 rows arrived.
 */
export function splitDeals(orgs: OrgCard[]): { live: OrgCard[]; cold: OrgCard[] } {
  const live: OrgCard[] = [];
  const cold: OrgCard[] = [];
  for (const o of orgs) {
    if (o.stage !== 'researching' || o.last_activity_at) live.push(o);
    else cold.push(o);
  }
  return { live, cold };
}

/**
 * Cold clubs, trimmed to what the list draws.
 *
 * `contact_names` is one string per club rather than an array of contacts:
 * the search box needs to match "benin" against whoever is there, and a
 * lower-cased haystack is both smaller on the wire and faster to test than
 * walking an array per keystroke across 519 rows.
 */
export function toColdRows(
  cold: OrgCard[],
  contactsByOrg: Map<string, { full_name: string; email: string | null }[]>,
): ColdRow[] {
  return cold.map((o) => ({
    id: o.id,
    name: o.name,
    region: regionOf(o),
    state: o.state,
    stage: o.stage,
    contact_count: o.contact_count,
    contact_names: (contactsByOrg.get(o.id) ?? [])
      .map((c) => `${c.full_name} ${c.email ?? ''}`)
      .join(' ')
      .toLowerCase()
      .slice(0, 400),
    last_activity_at: o.last_activity_at,
    queued_at: o.queued_at,
  }));
}

/** Every contact's name and address, grouped by club, for toColdRows(). */
export async function loadContactIndex(
  db: Db,
): Promise<Map<string, { full_name: string; email: string | null }[]>> {
  const { data } = await db.from('crm_contacts').select('org_id, full_name, email');
  const by = new Map<string, { full_name: string; email: string | null }[]>();
  for (const c of (data as { org_id: string; full_name: string; email: string | null }[] | null) || []) {
    const list = by.get(c.org_id);
    if (list) list.push(c);
    else by.set(c.org_id, [c]);
  }
  return by;
}

/**
 * How many emails are waiting in today's outreach deck.
 *
 * The deck (/crm/deck) and its crm_outreach_* tables are being built next to
 * this. Today's list wants the number; it must not be the reason the page
 * breaks if the table is not there yet, so this asks each candidate name in
 * turn and returns null the moment none of them answer. PostgREST reports an
 * unknown table as an error rather than throwing, so both paths are handled.
 *
 * Returns null for "there is no deck", which the caller renders as no line at
 * all — not as "0 emails queued", which would read as a deck that is empty.
 */
const DECK_TABLES = ['crm_outreach_queue', 'crm_outreach_emails', 'crm_outreach_drafts'];

export async function loadDeckCount(db: Db): Promise<number | null> {
  for (const table of DECK_TABLES) {
    try {
      const { count, error } = await db.from(table).select('id', { count: 'exact', head: true });
      if (!error && typeof count === 'number') return count;
    } catch {
      // Not there. Try the next name, then give up quietly.
    }
  }
  return null;
}

export interface OrgBundle {
  org: Org;
  contacts: Contact[];
  activities: Activity[];
}

/** One org and everything hanging off it. Null when the id is not ours. */
export async function loadOrg(db: Db, id: string): Promise<OrgBundle | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data: org } = await db.from('crm_orgs').select(ORG_COLS).eq('id', id).maybeSingle();
  if (!org) return null;

  const [{ data: contacts }, { data: activities }] = await Promise.all([
    db
      .from('crm_contacts')
      .select(CONTACT_COLS)
      .eq('org_id', id)
      .order('is_primary', { ascending: false })
      .order('full_name'),
    db
      .from('crm_activities')
      .select(ACTIVITY_COLS)
      .eq('org_id', id)
      .order('occurred_at', { ascending: false })
      .limit(200),
  ]);

  return {
    org: org as unknown as Org,
    contacts: (contacts as Contact[] | null) || [],
    activities: (activities as Activity[] | null) || [],
  };
}

/**
 * The reps, for turning crm_orgs.owner_email into initials on a card.
 *
 * Without this the badge falls back to the first two letters of the address —
 * "DA" for darrinjco@gmail.com, which is not what anyone calls him. Two rows,
 * so it is one cheap query rather than anything clever.
 */
export async function loadReps(db: Db): Promise<{ email: string; full_name: string | null; initials: string | null }[]> {
  const { data } = await db.from('crm_users').select('email, full_name, initials').eq('active', true);
  return (data as { email: string; full_name: string | null; initials: string | null }[] | null) || [];
}

export interface Template {
  id: string;
  slug: string;
  name: string;
  subject: string;
  body: string;
}

export async function loadTemplates(db: Db): Promise<Template[]> {
  const { data } = await db
    .from('crm_templates')
    .select('id, slug, name, subject, body')
    .eq('archived', false)
    .order('sort_order');
  return (data as Template[] | null) || [];
}

/**
 * Turn a name into a slug that is unique across crm_orgs.
 *
 * The seed sets slugs by hand; this is for /crm/new, where a rep types a club
 * name and should never have to think about a URL key. Collisions get a
 * numeric suffix rather than an error, because "Lafayette Tennis Club" being
 * taken is not the rep's problem to solve.
 */
export function slugify(name: string): string {
  return (name || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'club';
}

export async function uniqueSlug(db: Db, name: string): Promise<string> {
  const base = slugify(name);
  const { data } = await db.from('crm_orgs').select('slug').like('slug', `${base}%`);
  const taken = new Set(((data as { slug: string }[] | null) || []).map((r) => r.slug));
  if (!taken.has(base)) return base;
  for (let i = 2; i < 200; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
  return `${base}-${Date.now()}`;
}
