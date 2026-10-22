/**
 * ClubMode Recruiting — AI fit scoring and candidate ranking.
 *
 * scoreApplication: reads one application (opening + candidate), asks Claude for
 * a job-related fit read, and stores it on the application. Platform-paid, never
 * metered to the club. Never throws: a failed score just leaves the row unscored.
 *
 * Fairness: the prompt scores ONLY job-related criteria (experience, scope,
 * certifications, program results, location and comp fit). Every strength and
 * gap must cite the candidate's own stated info; unknowns are called out as
 * unknown, never guessed.
 *
 * rankCandidatesForOpening: the pure matcher (dept + radius + comp) over
 * open-to-work candidates, best first. Used by the club's "Invite top matches".
 */
import Anthropic from '@anthropic-ai/sdk';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { evaluate, type Candidate as MatchCandidate, type MatchEdge } from './match';

const MODEL = 'claude-sonnet-5-5';
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY ?? process.env.AI_API_KEY;

export type FitOpening = {
  club_name?: string | null;
  title?: string | null;
  dept?: string | null;
  comp_min?: number | null;
  comp_max?: number | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  description?: string | null;
  requirements?: string | null;
};

export type FitCandidate = {
  headline?: string | null;
  dept?: string | null;
  years_experience?: number | null;
  current_comp?: number | null;
  min_comp?: number | null;
  home_zip?: string | null;
  radius_miles?: number | null;
  experience_summary?: string | null;
  certifications?: string | null;
  cover_note?: string | null;
};

export type Fit = {
  score: number;
  summary: string;
  strengths: string[];
  gaps: string[];
  questions: string[];
};

const money = (n: number | null | undefined) =>
  n == null || !Number.isFinite(Number(n)) ? 'not stated' : `$${Math.round(Number(n)).toLocaleString()}`;
const txt = (s: string | null | undefined, max = 4000) => {
  const t = (s ?? '').toString().trim();
  return t ? t.slice(0, max) : 'not stated';
};

/**
 * Build the scoring prompt. Pure. Deliberately excludes the candidate's name,
 * email, phone and LinkedIn: identity is not job-related evidence.
 */
export function buildFitPrompt(opening: FitOpening, candidate: FitCandidate): string {
  const where = [opening.city, opening.state].filter(Boolean).join(', ') || opening.zip || 'not stated';
  const band = opening.comp_min ? `${money(opening.comp_min)} to ${money(opening.comp_max)}` : `up to ${money(opening.comp_max)}`;
  return [
    'You are screening a candidate for a private-club racquets leadership role. Assess fit using ONLY job-related criteria:',
    'relevant experience and years, scope of programs/staff/facilities managed, certifications (e.g. USPTA, PTR, USPTR, PPR), program results',
    '(growth, participation, revenue, retention, player development), and location and compensation fit.',
    '',
    'Rules:',
    '- Do NOT consider or mention age, gender, ethnicity, national origin, religion, health, disability, family or marital status, or "culture fit". Do not infer any of these.',
    '- Every strength and every gap must cite the candidate\'s own stated information (quote or paraphrase it). If there is no evidence, say so as a gap or question; never assume.',
    '- Where information is missing, mark it as unknown and lower confidence; do not penalise beyond the uncertainty.',
    '- Be concise and professional; the hiring club reads this.',
    '',
    '## Opening',
    `Club: ${txt(opening.club_name, 200)}`,
    `Role: ${txt(opening.title || opening.dept, 200)} (department: ${txt(opening.dept, 100)})`,
    `Location: ${where}`,
    `Pay band: ${band}`,
    `Description: ${txt(opening.description)}`,
    `Requirements: ${txt(opening.requirements)}`,
    '',
    '## Candidate (self-reported)',
    `Headline: ${txt(candidate.headline, 300)}`,
    `Department: ${txt(candidate.dept, 100)}`,
    `Years of experience: ${candidate.years_experience ?? 'not stated'}`,
    `Current compensation: ${money(candidate.current_comp)}`,
    `Minimum compensation sought: ${money(candidate.min_comp ?? candidate.current_comp)}`,
    `Home ZIP: ${txt(candidate.home_zip, 20)}; willing to relocate up to ${candidate.radius_miles ?? 'not stated'} miles`,
    `Certifications: ${txt(candidate.certifications, 1000)}`,
    `Experience summary: ${txt(candidate.experience_summary, 6000)}`,
    `Cover note to this club: ${txt(candidate.cover_note, 3000)}`,
    '',
    'Respond with ONLY a JSON object, no prose, in exactly this shape:',
    '{"score": <integer 0-100>, "summary": "<2-3 sentences>", "strengths": ["<evidence-cited strength>", ...], "gaps": ["<evidence-cited gap or unknown>", ...], "questions": ["<interview question to resolve a gap>", ...]}',
    'Use at most 5 items per list.',
  ].join('\n');
}

const strList = (v: unknown): string[] =>
  Array.isArray(v)
    ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((s) => s.trim().slice(0, 500)).slice(0, 5)
    : [];

/** Parse the model's reply into a Fit. Tolerates code fences and stray prose. Null if unusable. */
export function parseFit(text: string): Fit | null {
  if (!text) return null;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let raw: any;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const n = Number(raw.score);
  if (!Number.isFinite(n)) return null;
  const summary = typeof raw.summary === 'string' ? raw.summary.trim().slice(0, 1200) : '';
  return {
    score: Math.max(0, Math.min(100, Math.round(n))),
    summary,
    strengths: strList(raw.strengths),
    gaps: strList(raw.gaps),
    questions: strList(raw.questions),
  };
}

/** Score one application and store the result. Never throws. */
export async function scoreApplication(applicationId: string): Promise<void> {
  try {
    if (!ANTHROPIC_KEY) {
      console.warn('[connect/aiFit] ANTHROPIC_API_KEY missing; skipping score');
      return;
    }
    const db = getSupabaseAdmin();
    const { data: app } = await db
      .from('connect_applications')
      .select('id, opening_id, candidate_id, cover_note')
      .eq('id', applicationId)
      .maybeSingle();
    if (!app) return;
    const [{ data: opening }, { data: candidate }] = await Promise.all([
      db
        .from('connect_openings')
        .select('club_name, title, dept, comp_min, comp_max, city, state, zip, description, requirements')
        .eq('id', app.opening_id)
        .maybeSingle(),
      db
        .from('connect_candidates')
        .select('headline, dept, years_experience, current_comp, min_comp, home_zip, radius_miles, experience_summary, certifications')
        .eq('id', app.candidate_id)
        .maybeSingle(),
    ]);
    if (!opening || !candidate) return;

    const prompt = buildFitPrompt(opening, { ...candidate, cover_note: app.cover_note });
    const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY });
    const msg = (await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1200,
      messages: [{ role: 'user', content: prompt }],
    } as never)) as unknown as { content?: { type: string; text?: string }[] };
    const text = (msg.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text || '')
      .join('');
    const fit = parseFit(text);
    if (!fit) {
      console.warn('[connect/aiFit] unparseable fit for', applicationId);
      return;
    }
    await db
      .from('connect_applications')
      .update({
        ai_fit_score: fit.score,
        ai_fit: { summary: fit.summary, strengths: fit.strengths, gaps: fit.gaps, questions: fit.questions },
        ai_fit_at: new Date().toISOString(),
      })
      .eq('id', applicationId);
  } catch (err) {
    console.error('[connect/aiFit] scoreApplication failed', applicationId, err);
  }
}

export type RankedCandidate = MatchEdge & {
  email: string | null;
  full_name: string | null;
  years_experience: number | null;
};

/**
 * Open-to-work candidates that pass the matcher (dept + radius + comp) for this
 * opening, best first. Server-only; returns contact info for the invite email —
 * callers must never hand these identities to the club.
 */
export async function rankCandidatesForOpening(openingId: string, limit = 15): Promise<RankedCandidate[]> {
  const db = getSupabaseAdmin();
  const { data: opening } = await db
    .from('connect_openings')
    .select('id, dept, comp_max, lat, lng, status')
    .eq('id', openingId)
    .maybeSingle();
  if (!opening) return [];
  const { data: rows } = await db
    .from('connect_candidates')
    .select('id, dept, current_comp, min_comp, home_lat, home_lng, radius_miles, open_to_work, email, full_name, years_experience')
    .eq('open_to_work', true)
    .eq('dept', opening.dept);
  const ranked: RankedCandidate[] = [];
  for (const c of rows || []) {
    const edge = evaluate(opening, c as MatchCandidate);
    if (edge) ranked.push({ ...edge, email: c.email ?? null, full_name: c.full_name ?? null, years_experience: c.years_experience ?? null });
  }
  ranked.sort((a, b) => b.score - a.score);
  return ranked.slice(0, Math.max(0, limit));
}
