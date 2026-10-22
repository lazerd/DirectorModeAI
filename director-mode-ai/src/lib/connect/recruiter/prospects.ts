/**
 * RECRUITER step 2 — rank prospects against a job's ideal-candidate profile.
 *
 * Two pools:
 *   (a) opted-in connect_candidates (open_to_work) — consented to opportunity alerts;
 *   (b) directors from the public 990 dataset (benchmarks.json) — NOT opted in.
 *
 * Scoring is the pure policy in ./policy.ts (comp tier, distance, relative club
 * size, role match). The top N land in connect_prospect_targets.
 */
import rawData from '@/app/benchmarks/_data/benchmarks.json';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { milesBetween, zipToLatLng } from '@/lib/geo';
import { fitReason, scoreProspect, TOP_N, type Tier } from './policy';
import { policyEvaluation, SOURCED_JOB_FIELDS, type Evaluation, type SourcedJob } from './evaluate';

export type Person990 = {
  club: string; ein: string; state: string; dept: string; title: string; name: string;
  total: number; revenue?: number; year: string; recent?: boolean;
  zip?: string | null; lat?: number | null; lng?: number | null;
};
const DATA = rawData as Person990[];

export type CandidateRow = {
  id: string; full_name: string | null; email: string | null; dept: string; headline: string | null;
  current_comp: number; min_comp: number | null; home_lat: number | null; home_lng: number | null;
  radius_miles: number | null; claimed_ein: string | null; open_to_work: boolean | null;
};

export type RankJob = {
  club_name: string | null;
  club_ein: string | null;
  club_revenue: number | null;
  role_level: string | null;
  lat: number | null;
  lng: number | null;
};

export type RankedProspect = {
  candidate_id: string | null;
  prospect_ein: string | null;
  prospect_name: string;
  prospect_club: string | null;
  prospect_comp: number;
  prospect_city: string | null;
  prospect_state: string | null;
  distance_miles: number | null;
  fit_score: number;
  fit_reason: string;
  tier: Tier;
};

const norm = (s: string | null | undefined) =>
  (s || '').toLowerCase().replace(/\b(the|inc|incorporated|club|country|cc|golf|tennis|and|of)\b/g, '').replace(/[^a-z0-9]/g, '');
const personKey = (r: Person990) => `${r.ein}|${r.name.toLowerCase().replace(/\s+/g, ' ').trim()}`;
const lastName = (n: string | null | undefined) => (n || '').trim().toLowerCase().split(/\s+/).pop() || '';
const titleCase = (s: string) => (s === s.toUpperCase() ? s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : s);

/** Latest filing per person in a dept; drops filings older than `minYear`. */
export function people990(dept: string, minYear: number, data: Person990[] = DATA): Person990[] {
  const by = new Map<string, Person990>();
  for (const r of data) {
    if (r.dept !== dept || !r.name || !(r.total > 0)) continue;
    const key = personKey(r);
    const prev = by.get(key);
    if (!prev || Number(r.year) > Number(prev.year)) by.set(key, r);
  }
  return [...by.values()].filter((r) => Number(r.year) >= minYear);
}

/**
 * Rank both pools for one job. Pure (data passed in). Excludes the job's own club
 * (the incumbent and colleagues) and 990 rows that are an opted-in candidate's
 * own claimed filing (they're already in pool a).
 */
export function rankProspects(
  job: RankJob,
  profile: Evaluation,
  candidates: CandidateRow[],
  people: Person990[],
  limit = TOP_N,
): RankedProspect[] {
  const bands = profile.bands;
  if (!bands) return [];
  const hasOrigin = job.lat != null && job.lng != null;
  const dist = (lat: number | null | undefined, lng: number | null | undefined) =>
    hasOrigin && lat != null && lng != null ? milesBetween(job.lat!, job.lng!, lat, lng) : null;
  const jobClub = norm(job.club_name);
  const ctx = { revenue: job.club_revenue, roleLevel: job.role_level };
  const out: RankedProspect[] = [];

  const claimed = new Set<string>();
  for (const c of candidates) {
    if (!c.open_to_work || c.dept !== profile.dept) continue;
    if (c.claimed_ein) claimed.add(`${c.claimed_ein}|${lastName(c.full_name)}`);
    const d = dist(c.home_lat, c.home_lng);
    const s = scoreProspect(
      { comp: c.current_comp, distanceMiles: d, revenue: null, title: c.headline, optedIn: true, candidateRadius: c.radius_miles, candidateMinComp: c.min_comp },
      bands,
      ctx,
    );
    if (!s) continue;
    out.push({
      candidate_id: c.id,
      prospect_ein: null,
      prospect_name: c.full_name || 'Candidate',
      prospect_club: null,
      prospect_comp: c.current_comp,
      prospect_city: null,
      prospect_state: null,
      distance_miles: d == null ? null : Math.round(d),
      fit_score: s.score,
      fit_reason: fitReason({ comp: c.current_comp, club: null, distanceMiles: d, optedIn: true }, s, bands),
      tier: s.tier,
    });
  }

  for (const r of people) {
    if (r.dept !== profile.dept) continue;
    if ((job.club_ein && r.ein === job.club_ein) || (jobClub && norm(r.club) === jobClub)) continue;
    if (claimed.has(`${r.ein}|${lastName(r.name)}`)) continue;
    if (hasOrigin && (r.lat == null || r.lng == null)) continue; // can't place them
    const d = dist(r.lat, r.lng);
    const s = scoreProspect({ comp: r.total, distanceMiles: d, revenue: r.revenue ?? null, title: r.title, optedIn: false }, bands, ctx);
    if (!s) continue;
    const club = titleCase(r.club);
    out.push({
      candidate_id: null,
      prospect_ein: r.ein,
      prospect_name: titleCase(r.name),
      prospect_club: club,
      prospect_comp: r.total,
      prospect_city: null,
      prospect_state: r.state,
      distance_miles: d == null ? null : Math.round(d),
      fit_score: s.score,
      fit_reason: fitReason({ comp: r.total, club, distanceMiles: d, optedIn: false }, s, bands),
      tier: s.tier,
    });
  }

  out.sort((a, b) => b.fit_score - a.fit_score || (a.distance_miles ?? 1e9) - (b.distance_miles ?? 1e9) || b.prospect_comp - a.prospect_comp);
  return out.slice(0, limit);
}

const MIN_990_YEAR = new Date().getFullYear() - 4;

async function openCandidates(dept: string): Promise<CandidateRow[]> {
  const { data } = await getSupabaseAdmin()
    .from('connect_candidates')
    .select('id, full_name, email, dept, headline, current_comp, min_comp, home_lat, home_lng, radius_miles, claimed_ein, open_to_work')
    .eq('open_to_work', true)
    .eq('dept', dept);
  return (data as CandidateRow[] | null) ?? [];
}

type TargetKey = { sourced_job_id?: string | null; opening_id?: string | null };

/** Insert new targets and refresh scores on existing ones (status is never reset). */
async function saveTargets(key: TargetKey, ranked: RankedProspect[]): Promise<number> {
  const db = getSupabaseAdmin();
  let q = db.from('connect_prospect_targets').select('id, candidate_id, prospect_ein, prospect_name');
  q = key.sourced_job_id ? q.eq('sourced_job_id', key.sourced_job_id) : q.eq('opening_id', key.opening_id!);
  const { data: existing } = await q;
  const k = (r: { candidate_id: string | null; prospect_ein: string | null; prospect_name: string | null }) =>
    r.candidate_id ? `c:${r.candidate_id}` : `p:${r.prospect_ein}|${(r.prospect_name || '').toLowerCase()}`;
  const have = new Map((existing ?? []).map((r) => [k(r), r.id as string]));
  const now = new Date().toISOString();
  const inserts: Record<string, unknown>[] = [];
  for (const r of ranked) {
    const row = { ...r, sourced_job_id: key.sourced_job_id ?? null, opening_id: key.opening_id ?? null, updated_at: now };
    const id = have.get(k(r));
    if (id) {
      await db
        .from('connect_prospect_targets')
        .update({ fit_score: r.fit_score, fit_reason: r.fit_reason, tier: r.tier, distance_miles: r.distance_miles, prospect_comp: r.prospect_comp, updated_at: now })
        .eq('id', id);
    } else inserts.push(row);
  }
  if (inserts.length) {
    const { error } = await db.from('connect_prospect_targets').insert(inserts);
    if (error) console.error('[recruiter/prospects] insert failed', error.message);
  }
  return ranked.length;
}

/** Rank + save for one sourced job (must already have an evaluation). */
export async function rankSourcedJob(job: SourcedJob, opts: { save?: boolean; limit?: number } = {}): Promise<RankedProspect[]> {
  const profile = job.evaluation ?? policyEvaluation(job);
  let { lat, lng } = job;
  if ((lat == null || lng == null) && job.zip) {
    const g = zipToLatLng(job.zip);
    if (g) ({ lat, lng } = g);
  }
  const ranked = rankProspects(
    { club_name: job.club_name, club_ein: job.club_ein, club_revenue: job.club_revenue, role_level: job.role_level, lat, lng },
    profile,
    await openCandidates(profile.dept),
    people990(profile.dept, MIN_990_YEAR),
    opts.limit ?? TOP_N,
  );
  if (opts.save !== false) await saveTargets({ sourced_job_id: job.id }, ranked);
  return ranked;
}

export type OpeningRow = {
  id: string; owner_id: string; club_name: string | null; title: string | null; dept: string;
  comp_min: number | null; comp_max: number; lat: number | null; lng: number | null; zip: string | null;
  status: string; terms_accepted_at: string | null; is_public: boolean | null;
};
export const OPENING_FIELDS = 'id, owner_id, club_name, title, dept, comp_min, comp_max, lat, lng, zip, status, terms_accepted_at, is_public';

/** Rank + save for one retained opening (policy-only profile; clubs wrote their own requirements). */
export async function rankOpening(o: OpeningRow, opts: { save?: boolean } = {}): Promise<RankedProspect[]> {
  const profile = policyEvaluation({ dept: o.dept, role_level: o.dept === 'GM' ? 'gm' : 'director', comp_max: o.comp_max, comp_min: o.comp_min, est_comp: null });
  const ranked = rankProspects(
    { club_name: o.club_name, club_ein: null, club_revenue: null, role_level: o.dept === 'GM' ? 'gm' : 'director', lat: o.lat, lng: o.lng },
    profile,
    await openCandidates(profile.dept),
    people990(profile.dept, MIN_990_YEAR),
  );
  if (opts.save !== false) await saveTargets({ opening_id: o.id }, ranked);
  return ranked;
}

/** Rank every evaluated active sourced job and every open retained opening. */
export async function rankAll(): Promise<{ sourcedJobs: number; openings: number; targets: number }> {
  const db = getSupabaseAdmin();
  const { data: jobs } = await db
    .from('connect_sourced_jobs')
    .select(SOURCED_JOB_FIELDS)
    .eq('status', 'active')
    .is('opening_id', null)
    .not('evaluation', 'is', null)
    .limit(500);
  let targets = 0;
  for (const j of (jobs as SourcedJob[] | null) ?? []) targets += (await rankSourcedJob(j)).length;
  const { data: openings } = await db
    .from('connect_openings')
    .select(OPENING_FIELDS)
    .eq('status', 'open')
    .not('terms_accepted_at', 'is', null)
    .limit(200);
  for (const o of (openings as OpeningRow[] | null) ?? []) targets += (await rankOpening(o)).length;
  return { sourcedJobs: jobs?.length ?? 0, openings: openings?.length ?? 0, targets };
}
