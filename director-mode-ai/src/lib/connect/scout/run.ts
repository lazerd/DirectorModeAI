/**
 * Scout run: scrape every source → extract → 990 match + comp estimate →
 * geocode → upsert connect_sourced_jobs → expire stale rows.
 *
 * Never throws: every failure lands in the returned summary. With
 * `write: false` it reads the DB (to skip postings it already knows) but
 * writes nothing.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { zipToLatLng } from '@/lib/geo';
import { extractJob, extractorConfigured } from './extract';
import { politeGet } from './http';
import { sourceLabel } from './labels';
import { estimateCompFromDataset, matchClubFromDataset } from './match990';
import { SOURCES } from './sources';
import { fingerprint, htmlToText, parseLocation } from './text';
import type { ListItem, RoleLevel, SourceAdapter, SourcedJobRow } from './types';

export const STALE_DAYS = 21;

export type SourceSummary = {
  source: string;
  listed: number;
  known: number;       // already in the DB → last_seen_at bumped, no model call
  extracted: number;   // model calls made
  kept: number;
  rejected: number;
  deferred: number;    // out of time this run
  errors: string[];
  samples: Pick<SourcedJobRow, 'club_name' | 'title' | 'role_level' | 'city' | 'state' | 'comp_text' | 'est_comp' | 'club_ein' | 'summary' | 'source_url'>[];
};

export type ScoutSummary = {
  startedAt: string;
  finishedAt: string;
  write: boolean;
  sources: SourceSummary[];
  inserted: number;
  updated: number;
  touched: number;
  expired: number;
  matched990: number;
  errors: string[];
  rows?: SourcedJobRow[]; // only when returnRows
};

/** Pure: role level from a title (used for list-only rows). */
export function roleLevelFromTitle(title: string): RoleLevel {
  const t = title.toLowerCase();
  if (/general manager|\bgm\b|\bcoo\b/.test(t)) return 'gm';
  if (/director|head of|manager of (tennis|racquet)/.test(t)) return 'director';
  if (/\bhead\b|lead pro|senior pro/.test(t)) return 'head_pro';
  if (/assistant|associate|staff pro|instructor|coach|professional|\bpro\b/.test(t)) return 'assistant';
  return 'other';
}

/** Pure: a list-only row (no detail page) → our own one-line summary. */
export function listingOnlySummary(item: ListItem, city: string | null, state: string | null): string {
  const place = [city, state].filter(Boolean).join(', ');
  return (
    `${sourceLabel(item.source)} is running the search for ${item.club || 'a private club'}'s ${item.title}` +
    `${place ? ` in ${place}` : ''}. Full details and how to apply are on their posting.`
  );
}

export function enrich(base: Omit<SourcedJobRow, 'fingerprint' | 'lat' | 'lng' | 'club_ein' | 'club_revenue' | 'est_comp'>): SourcedJobRow {
  const m = matchClubFromDataset(base.club_name, base.state);
  const ll = zipToLatLng(base.zip) ?? (m?.lat != null && m?.lng != null ? { lat: m.lat, lng: m.lng } : null);
  const hasComp = !!(base.comp_min || base.comp_max);
  return {
    ...base,
    fingerprint: fingerprint(base.club_name, base.title, base.state),
    lat: ll?.lat ?? null,
    lng: ll?.lng ?? null,
    zip: base.zip ?? m?.zip ?? null,
    club_ein: m?.ein ?? null,
    club_revenue: m?.revenue ?? null,
    est_comp: hasComp ? null : estimateCompFromDataset({ revenue: m?.revenue ?? null, state: base.state, roleLevel: base.role_level }),
  };
}

async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}

async function processSource(
  src: SourceAdapter,
  ctx: { db: SupabaseClient | null; deadline: number; concurrency: number },
): Promise<{ summary: SourceSummary; rows: SourcedJobRow[]; knownIds: string[] }> {
  const s: SourceSummary = { source: src.id, listed: 0, known: 0, extracted: 0, kept: 0, rejected: 0, deferred: 0, errors: [], samples: [] };
  const rows: SourcedJobRow[] = [];
  let items: ListItem[] = [];
  try {
    const r = await src.list();
    items = r.items.slice(0, src.cap);
    s.errors.push(...r.errors.slice(0, 10));
  } catch (e) {
    s.errors.push(`list failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  s.listed = items.length;

  // Postings we already have (same URL, or the same club|title|state from
  // another board) → just bump last_seen_at, no model spend.
  const knownIds = new Set<string>();
  const fresh: ListItem[] = [];
  if (ctx.db && items.length) {
    const byUrl = new Map<string, string>();
    const byFp = new Map<string, string>();
    const guess = (i: ListItem) => {
      const st = parseLocation(i.location).state;
      return i.club && st ? fingerprint(i.club, i.title, st) : null;
    };
    const fps = items.map(guess).filter((f): f is string => !!f);
    const [a, b] = await Promise.all([
      ctx.db.from('connect_sourced_jobs').select('id, source_url').in('source_url', items.map((i) => i.url)),
      fps.length ? ctx.db.from('connect_sourced_jobs').select('id, fingerprint').in('fingerprint', fps) : Promise.resolve({ data: [] as { id: string; fingerprint: string }[] }),
    ]);
    for (const r of a.data || []) byUrl.set(r.source_url, r.id);
    for (const r of b.data || []) byFp.set(r.fingerprint, r.id);
    for (const i of items) {
      const id = byUrl.get(i.url) ?? byFp.get(guess(i) ?? '');
      if (id) knownIds.add(id);
      else fresh.push(i);
    }
  } else fresh.push(...items);
  s.known = items.length - fresh.length;

  await pool(fresh, ctx.concurrency, async (item) => {
    try {
      if (Date.now() > ctx.deadline) {
        s.deferred++;
        return;
      }
      if (item.listingOnly) {
        const loc = parseLocation(item.location);
        if (!loc.state) {
          s.rejected++;
          return;
        }
        rows.push(enrich({
          source: item.source, source_url: item.url, external_id: item.externalId ?? null,
          club_name: item.club ?? null, title: item.title, dept: 'Tennis/Racquets',
          role_level: roleLevelFromTitle(item.title), city: loc.city, state: loc.state, zip: null,
          comp_min: null, comp_max: null, comp_text: null,
          summary: listingOnlySummary(item, loc.city, loc.state), requirements: null,
          apply_url: null, apply_email: null, contact_name: null,
          posted_at: item.postedAt ?? null, deadline: item.deadline ?? null,
        }));
        s.kept++;
        return;
      }
      if (!extractorConfigured()) {
        s.errors.push('ANTHROPIC_API_KEY not set — cannot extract');
        s.deferred++;
        return;
      }
      let text = item.text || '';
      if (text.length < 200) {
        const d = await politeGet(item.url);
        if (d.ok) text = htmlToText(d.body);
        else s.errors.push(`${item.url}: ${d.error}`);
      }
      if (!text) {
        s.rejected++;
        return;
      }
      s.extracted++;
      const x = await extractJob(item, text);
      const loc = parseLocation(item.location);
      const state = x?.state ?? loc.state;
      if (!x || !x.keep || !state || !(x.title || item.title)) {
        s.rejected++;
        return;
      }
      rows.push(enrich({
        source: item.source, source_url: item.url, external_id: item.externalId ?? null,
        club_name: x.club_name ?? item.club ?? null, title: x.title ?? item.title, dept: 'Tennis/Racquets',
        role_level: x.role_level, city: x.city ?? loc.city, state, zip: x.zip,
        comp_min: x.comp_min, comp_max: x.comp_max, comp_text: x.comp_text,
        summary: x.summary, requirements: x.requirements.length ? x.requirements.map((r) => `• ${r}`).join('\n') : null,
        apply_url: x.apply_url, apply_email: x.apply_email, contact_name: x.contact_name,
        posted_at: x.posted_at ?? item.postedAt ?? null, deadline: x.deadline ?? item.deadline ?? null,
      }));
      s.kept++;
    } catch (e) {
      s.errors.push(`${item.url}: ${e instanceof Error ? e.message : String(e)}`);
    }
  });

  s.samples = rows.slice(0, 5).map((r) => ({
    club_name: r.club_name, title: r.title, role_level: r.role_level, city: r.city, state: r.state,
    comp_text: r.comp_text, est_comp: r.est_comp, club_ein: r.club_ein, summary: r.summary, source_url: r.source_url,
  }));
  return { summary: s, rows, knownIds: [...knownIds] };
}

const FILLABLE: (keyof SourcedJobRow)[] = [
  'club_name', 'city', 'zip', 'lat', 'lng', 'comp_min', 'comp_max', 'comp_text', 'summary', 'requirements',
  'apply_url', 'apply_email', 'contact_name', 'posted_at', 'deadline', 'club_ein', 'club_revenue', 'est_comp',
];

export type WriteResult = { inserted: number; updated: number; touched: number; expired: number; errors: string[] };

/**
 * Upsert scraped rows by fingerprint (keeps first_seen_at, fills blanks,
 * never flips hidden/claimed back to active), bump last_seen_at on postings we
 * skipped as already known, then expire rows unseen for 21 days or past deadline.
 */
export async function writeSourcedJobs(db: SupabaseClient, rows: SourcedJobRow[], knownIds: string[]): Promise<WriteResult> {
  const out: WriteResult = { inserted: 0, updated: 0, touched: 0, expired: 0, errors: [] };
  const now = new Date().toISOString();
  const today = now.slice(0, 10);
  try {
    const live = rows.filter((r) => !r.deadline || r.deadline >= today);
    const fps = live.map((r) => r.fingerprint);
    const existing = new Map<string, Record<string, unknown>>();
    for (let i = 0; i < fps.length; i += 100) {
      const { data } = await db.from('connect_sourced_jobs').select('*').in('fingerprint', fps.slice(i, i + 100));
      for (const e of data || []) existing.set(e.fingerprint as string, e);
    }
    const inserts = live.filter((r) => !existing.has(r.fingerprint));
    for (let i = 0; i < inserts.length; i += 50) {
      const batch = inserts.slice(i, i + 50);
      const { error } = await db.from('connect_sourced_jobs').insert(batch.map((r) => ({ ...r, last_seen_at: now })));
      if (error) out.errors.push(`insert: ${error.message}`);
      else out.inserted += batch.length;
    }
    for (const r of live) {
      const e = existing.get(r.fingerprint);
      if (!e) continue;
      const patch: Record<string, unknown> = { last_seen_at: now, updated_at: now };
      for (const k of FILLABLE) if ((e[k] == null || e[k] === '') && r[k] != null) patch[k] = r[k];
      if (e.status === 'expired') patch.status = 'active';
      const { error } = await db.from('connect_sourced_jobs').update(patch).eq('id', e.id as string);
      if (error) out.errors.push(`update ${e.id}: ${error.message}`);
      else out.updated++;
    }
    for (let i = 0; i < knownIds.length; i += 100) {
      const { data, error } = await db
        .from('connect_sourced_jobs')
        .update({ last_seen_at: now })
        .in('id', knownIds.slice(i, i + 100))
        .select('id');
      if (error) out.errors.push(`touch: ${error.message}`);
      else out.touched += data?.length ?? 0;
    }
    const staleBefore = new Date(Date.now() - STALE_DAYS * 86400_000).toISOString();
    const a = await db.from('connect_sourced_jobs').update({ status: 'expired', updated_at: now })
      .eq('status', 'active').lt('last_seen_at', staleBefore).select('id');
    const b = await db.from('connect_sourced_jobs').update({ status: 'expired', updated_at: now })
      .eq('status', 'active').lt('deadline', today).select('id');
    out.expired = (a.data?.length ?? 0) + (b.data?.length ?? 0);
  } catch (e) {
    out.errors.push(`write: ${e instanceof Error ? e.message : String(e)}`);
  }
  return out;
}

export async function runScout(opts: {
  db: SupabaseClient | null;
  write: boolean;
  sources?: string[];
  /** Wall-clock budget for the scrape (ms). */
  budgetMs?: number;
  concurrency?: number;
  returnRows?: boolean;
}): Promise<ScoutSummary & { knownIds?: string[] }> {
  const startedAt = new Date().toISOString();
  const deadline = Date.now() + (opts.budgetMs ?? 200_000);
  const out: ScoutSummary & { knownIds?: string[] } = {
    startedAt, finishedAt: startedAt, write: opts.write, sources: [], inserted: 0, updated: 0, touched: 0, expired: 0, matched990: 0, errors: [],
  };
  const srcs = SOURCES.filter((s) => !opts.sources?.length || opts.sources.includes(s.id));
  const all: SourcedJobRow[] = [];
  const known: string[] = [];
  for (const src of srcs) {
    try {
      const r = await processSource(src, { db: opts.db, deadline, concurrency: opts.concurrency ?? 4 });
      out.sources.push(r.summary);
      all.push(...r.rows);
      known.push(...r.knownIds);
    } catch (e) {
      out.errors.push(`${src.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // First source to report a fingerprint wins (SOURCES order).
  const byFp = new Map<string, SourcedJobRow>();
  for (const r of all) if (!byFp.has(r.fingerprint)) byFp.set(r.fingerprint, r);
  const rows = [...byFp.values()];
  out.matched990 = rows.filter((r) => r.club_ein).length;
  if (opts.returnRows) {
    out.rows = rows;
    out.knownIds = known;
  }

  if (opts.write && opts.db) {
    const w = await writeSourcedJobs(opts.db, rows, known);
    Object.assign(out, { inserted: w.inserted, updated: w.updated, touched: w.touched, expired: w.expired });
    out.errors.push(...w.errors);
  }
  out.finishedAt = new Date().toISOString();
  return out;
}
