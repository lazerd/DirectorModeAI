/**
 * RECRUITER step 1 — evaluate a job into an ideal-candidate profile.
 *
 * The policy half (target comp, comp bands, search radius) is pure and lives in
 * ./policy.ts. Claude adds the qualitative half: must-haves, scope, certifications,
 * red flags, a one-paragraph ideal candidate and three screening questions, using
 * job-related criteria only.
 *
 * Sourced jobs store the result on connect_sourced_jobs.evaluation. Retained
 * openings (clubs already on terms) get a policy-only profile computed on the fly.
 */
import Anthropic from '@anthropic-ai/sdk';
import rawData from '@/app/benchmarks/_data/benchmarks.json';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { EVALUATION_VERSION, needsEvaluation, targetBands, targetCompFor, type TargetBands } from './policy';

export { targetBands, targetCompFor, needsEvaluation } from './policy';

const MODEL = 'claude-sonnet-5-5';
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY ?? process.env.AI_API_KEY;

export type SourcedJob = {
  id: string;
  source: string;
  source_url: string | null;
  club_name: string | null;
  title: string | null;
  dept: string | null;
  role_level: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  lat: number | null;
  lng: number | null;
  comp_min: number | null;
  comp_max: number | null;
  comp_text: string | null;
  summary: string | null;
  requirements: string | null;
  deadline: string | null;
  status: string;
  club_ein: string | null;
  club_revenue: number | null;
  est_comp: number | null;
  evaluation: Evaluation | null;
  evaluated_at: string | null;
  opening_id: string | null;
  updated_at?: string | null;
};

export const SOURCED_JOB_FIELDS =
  'id, source, source_url, club_name, title, dept, role_level, city, state, zip, lat, lng, comp_min, comp_max, comp_text, summary, requirements, deadline, status, club_ein, club_revenue, est_comp, evaluation, evaluated_at, opening_id, updated_at';

export type Evaluation = {
  version: number;
  target_comp: number | null;
  comp_source: 'posted' | 'estimated' | 'market_median' | 'none';
  dept: string;
  role_level: string | null;
  bands: TargetBands | null;
  must_haves: string[];
  nice_to_haves: string[];
  program_scope: { club_size: string | null; sports: string[]; notes: string | null };
  certifications: string[];
  red_flags: string[];
  ideal_candidate: string;
  screening_questions: string[];
  ai: boolean;
  model: string | null;
};

type Raw = { dept: string; total: number; recent?: boolean; state: string; region: string };
const DATA = rawData as Raw[];

/** Benchmarks dept for a job: GM roles compare to GMs, else the job's dept. */
export function deptFor(job: { dept?: string | null; role_level?: string | null }): string {
  if (job.role_level === 'gm') return 'GM';
  const d = job.dept || 'Tennis/Racquets';
  if (/golf/i.test(d)) return 'Golf';
  if (/^gm$|general manager/i.test(d)) return 'GM';
  return 'Tennis/Racquets';
}

/** National median recent comp for a dept: last-resort target when nothing is posted or estimated. */
function marketMedian(dept: string): number | null {
  const t = DATA.filter((r) => r.dept === dept && r.recent && r.total > 0).map((r) => r.total).sort((a, b) => a - b);
  return t.length ? t[Math.floor(t.length / 2)] : null;
}

/** Policy-only profile (no AI). Used for retained openings and as the AI fallback. */
export function policyEvaluation(job: Pick<SourcedJob, 'dept' | 'role_level' | 'comp_max' | 'comp_min' | 'est_comp'>): Evaluation {
  const dept = deptFor(job);
  const t = targetCompFor(job);
  let comp = t.comp;
  let source: Evaluation['comp_source'] = t.source;
  if (comp == null) {
    comp = marketMedian(dept);
    source = comp == null ? 'none' : 'market_median';
  }
  return {
    version: EVALUATION_VERSION,
    target_comp: comp,
    comp_source: source,
    dept,
    role_level: job.role_level ?? null,
    bands: comp ? targetBands(comp, job.role_level) : null,
    must_haves: [],
    nice_to_haves: [],
    program_scope: { club_size: null, sports: [], notes: null },
    certifications: [],
    red_flags: [],
    ideal_candidate: '',
    screening_questions: [],
    ai: false,
    model: null,
  };
}

const usd = (n: number | null | undefined) => (n ? `$${Math.round(n).toLocaleString()}` : 'not stated');

export function buildEvaluationPrompt(job: SourcedJob, base: Evaluation): string {
  const where = [job.city, job.state].filter(Boolean).join(', ') || 'not stated';
  return [
    'You are helping a recruiter define the ideal candidate for a private-club racquets/golf leadership job.',
    'Use ONLY job-related criteria: experience, scope of programs/staff/facilities, sports offered (tennis, pickleball, padel, platform tennis, squash), certifications (USPTA, PTR, USPTR, PPR, CMAA/CCM), program results (growth, revenue, retention, player development), and the posting\'s stated requirements.',
    'Never mention or imply age, years-since-graduation, gender, ethnicity, national origin, religion, health, disability, family or marital status, or "culture fit". Do not invent facts that the posting does not support; when the posting is silent, keep items general and say "if applicable".',
    '',
    '## Job',
    `Club: ${job.club_name || 'not stated'}`,
    `Title: ${job.title || 'not stated'} (level: ${job.role_level || 'not stated'}, dept: ${base.dept})`,
    `Location: ${where}`,
    `Pay as posted: ${job.comp_text || usd(job.comp_max)}; target comp used for search: ${usd(base.target_comp)} (${base.comp_source})`,
    `Club annual revenue (990): ${usd(job.club_revenue)}`,
    `Summary: ${(job.summary || 'not stated').slice(0, 4000)}`,
    `Requirements: ${(job.requirements || 'not stated').slice(0, 4000)}`,
    '',
    'Respond with ONLY a JSON object, no prose, in exactly this shape:',
    '{"must_haves": [3-6 strings], "nice_to_haves": [2-5 strings], "program_scope": {"club_size": "<short phrase like \\"large full-service club, ~$20M revenue\\"> or null", "sports": [strings], "notes": "<string or null>"}, "certifications": [strings, may be empty], "red_flags": [2-4 job-related warning signs in a candidate history for THIS role], "ideal_candidate": "<one paragraph, 3-5 sentences>", "screening_questions": [exactly 3 job-related questions]}',
  ].join('\n');
}

const strs = (v: unknown, max = 8): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((s) => s.trim().slice(0, 400)).slice(0, max) : [];

/** Merge a tool-call result into the policy base. Pure; tolerant of junk. */
export function mergeAiProfile(base: Evaluation, raw: Record<string, unknown> | null | undefined): Evaluation {
  if (!raw || typeof raw !== 'object') return base;
  const scope = (raw.program_scope && typeof raw.program_scope === 'object' ? raw.program_scope : {}) as Record<string, unknown>;
  const ideal = typeof raw.ideal_candidate === 'string' ? raw.ideal_candidate.trim().slice(0, 2000) : '';
  return {
    ...base,
    must_haves: strs(raw.must_haves),
    nice_to_haves: strs(raw.nice_to_haves),
    program_scope: {
      club_size: typeof scope.club_size === 'string' ? scope.club_size.slice(0, 200) : null,
      sports: strs(scope.sports, 8),
      notes: typeof scope.notes === 'string' ? scope.notes.slice(0, 600) : null,
    },
    certifications: strs(raw.certifications),
    red_flags: strs(raw.red_flags, 5),
    ideal_candidate: ideal,
    screening_questions: strs(raw.screening_questions, 3),
    ai: !!ideal,
    model: ideal ? MODEL : null,
  };
}

/** Pull the JSON object out of a model reply (tolerates code fences / stray prose). */
export function parseProfileJson(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const v = JSON.parse(text.slice(start, end + 1));
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function aiProfile(job: SourcedJob, base: Evaluation): Promise<Evaluation> {
  if (!ANTHROPIC_KEY) return base;
  const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY });
  // This model does not accept a forced tool_choice, so ask for plain JSON (same as aiFit).
  const msg = (await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2000,
    messages: [{ role: 'user', content: buildEvaluationPrompt(job, base) }],
  } as never)) as unknown as { content?: { type: string; text?: string }[] };
  const text = (msg.content || []).filter((b) => b.type === 'text').map((b) => b.text || '').join('');
  return mergeAiProfile(base, parseProfileJson(text));
}

/** Evaluate one job (policy + AI). Never throws: AI failure falls back to policy-only. */
export async function evaluateJob(job: SourcedJob): Promise<Evaluation> {
  const base = policyEvaluation(job);
  try {
    return await aiProfile(job, base);
  } catch (err) {
    console.error('[recruiter/evaluate] AI profile failed', job.id, err);
    return base;
  }
}

/** Evaluate every active sourced job without a fresh evaluation. Returns how many were saved. */
export async function evaluatePending(opts: { limit?: number; now?: Date; jobIds?: string[] } = {}): Promise<{ evaluated: number; ids: string[] }> {
  const db = getSupabaseAdmin();
  const now = opts.now ?? new Date();
  let q = db.from('connect_sourced_jobs').select(SOURCED_JOB_FIELDS).eq('status', 'active').is('opening_id', null);
  if (opts.jobIds?.length) q = q.in('id', opts.jobIds);
  const { data } = await q.order('first_seen_at', { ascending: false }).limit(500);
  const pending = ((data as SourcedJob[] | null) ?? []).filter((j) => needsEvaluation(j, now)).slice(0, opts.limit ?? 15);
  const ids: string[] = [];
  for (const job of pending) {
    const evaluation = await evaluateJob(job);
    const { error } = await db
      .from('connect_sourced_jobs')
      .update({ evaluation, evaluated_at: new Date().toISOString() })
      .eq('id', job.id);
    if (!error) ids.push(job.id);
    else console.error('[recruiter/evaluate] save failed', job.id, error.message);
  }
  return { evaluated: ids.length, ids };
}
