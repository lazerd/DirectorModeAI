/**
 * Reads. Everything goes through the service-role client the caller already
 * proved they may use (lib/crm/server.ts) — the route is the access check.
 */

import type { getSupabaseAdmin } from '@/lib/supabase/admin';
import { ACTIVITY_COLS, CONTACT_COLS, ORG_COLS, type Activity, type Contact, type Org, type OrgCard } from './types';

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
    db.from('crm_activities').select('org_id, occurred_at').order('occurred_at', { ascending: false }),
    db.from('crm_contacts').select('org_id'),
  ]);

  const latest = new Map<string, string>();
  for (const a of (acts as { org_id: string; occurred_at: string }[] | null) || []) {
    // Ordered newest-first, so the first one wins.
    if (!latest.has(a.org_id)) latest.set(a.org_id, a.occurred_at);
  }
  const counts = new Map<string, number>();
  for (const c of (contacts as { org_id: string }[] | null) || []) {
    counts.set(c.org_id, (counts.get(c.org_id) ?? 0) + 1);
  }

  return rows.map((o) => ({
    ...o,
    last_activity_at: latest.get(o.id) ?? null,
    contact_count: counts.get(o.id) ?? 0,
  }));
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
