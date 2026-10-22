/**
 * Scout — the shared Claude extractor. Reads one posting and returns facts
 * plus OUR OWN short summary and requirement bullets. The poster's text is
 * only ever input here; it is never stored or republished.
 */
import Anthropic from '@anthropic-ai/sdk';
import { toIsoDate, toStateCode } from './text';
import type { ExtractedJob, ListItem, RoleLevel } from './types';

const MODEL = process.env.AI_MODEL_SCOUT ?? 'claude-sonnet-5-5';
const KEY = () => process.env.ANTHROPIC_API_KEY ?? process.env.AI_API_KEY;

export const extractorConfigured = () => !!KEY();

const ROLE_LEVELS: RoleLevel[] = ['director', 'head_pro', 'assistant', 'gm', 'other'];

const TOOL = {
  name: 'record_job',
  description: 'Record the structured facts of one racquets job posting.',
  input_schema: {
    type: 'object',
    properties: {
      keep: { type: 'boolean', description: 'true only for a US club/resort/facility racquet-sports leadership or teaching-pro role (tennis, pickleball, padel, platform, squash). false for college/school coaching, camps, part-time ambassadors, front desk, maintenance, non-US.' },
      reject_reason: { type: ['string', 'null'] },
      club_name: { type: ['string', 'null'], description: 'Hiring club/facility name as written (not the search firm or job board).' },
      title: { type: ['string', 'null'], description: 'Job title, title case, no club name.' },
      role_level: { type: 'string', enum: ROLE_LEVELS, description: 'director = Director of Tennis/Racquets/Pickleball/Sport (runs the department); head_pro = head/lead professional; assistant = assistant/staff teaching pro or coach; gm = general manager; other.' },
      city: { type: ['string', 'null'] },
      state: { type: ['string', 'null'], description: 'Two-letter US state code.' },
      zip: { type: ['string', 'null'], description: '5-digit ZIP only if written in the posting.' },
      comp_min: { type: ['integer', 'null'], description: 'Annual USD. Hourly × 2080. Only if stated.' },
      comp_max: { type: ['integer', 'null'], description: 'Annual USD. Only if stated. "$120,000+" → comp_min 120000, comp_max null.' },
      comp_text: { type: ['string', 'null'], description: 'The pay as stated, ≤ 80 chars, e.g. "$85k base + lesson revenue".' },
      requirements: { type: 'array', items: { type: 'string' }, description: '3–6 short bullets IN YOUR OWN WORDS (certifications, years, skills). Do not copy sentences.' },
      summary: { type: ['string', 'null'], description: '2–3 sentences IN YOUR OWN WORDS: the club, the role scope (courts, members, programs), and what makes it notable. Do not quote or copy the posting.' },
      apply_url: { type: ['string', 'null'], description: 'Direct application link if given (not the job-board page).' },
      apply_email: { type: ['string', 'null'], description: 'Only an email literally written in the posting.' },
      contact_name: { type: ['string', 'null'], description: 'Hiring contact named in the posting.' },
      club_website: { type: ['string', 'null'], description: "The club's own website if written in the posting." },
      posted_at: { type: ['string', 'null'], description: 'YYYY-MM-DD' },
      deadline: { type: ['string', 'null'], description: 'Application deadline YYYY-MM-DD if stated.' },
    },
    required: ['keep', 'club_name', 'title', 'role_level', 'state', 'summary', 'requirements'],
  },
};

const str = (v: unknown, max = 300) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const int = (v: unknown) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(/[^0-9.]/g, '')) : NaN;
  return Number.isFinite(n) && n >= 15000 && n <= 2_000_000 ? Math.round(n) : null;
};
const email = (v: unknown) => {
  const s = str(v, 200);
  return s && /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(s) ? s.toLowerCase() : null;
};
const url = (v: unknown) => {
  const s = str(v, 500);
  if (!s) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    return u.hostname.includes('.') ? u.toString() : null;
  } catch {
    return null;
  }
};

/** Normalize whatever the model returned into a safe ExtractedJob. Pure (tested). */
export function cleanExtraction(raw: Record<string, unknown>, sourceText = ''): ExtractedJob {
  const level = ROLE_LEVELS.includes(raw.role_level as RoleLevel) ? (raw.role_level as RoleLevel) : 'other';
  let compMin = int(raw.comp_min);
  let compMax = int(raw.comp_max);
  if (compMin && compMax && compMin > compMax) [compMin, compMax] = [compMax, compMin];
  const zip = str(raw.zip, 10)?.match(/\b\d{5}\b/)?.[0] ?? null;
  // Emails must literally appear in the posting — never guessed.
  const applyEmail = email(raw.apply_email);
  return {
    keep: raw.keep === true,
    reject_reason: str(raw.reject_reason, 200),
    club_name: str(raw.club_name, 160),
    title: str(raw.title, 160),
    role_level: level,
    city: str(raw.city, 80),
    state: toStateCode(str(raw.state, 40)),
    zip,
    comp_min: compMin,
    comp_max: compMax,
    comp_text: str(raw.comp_text, 120),
    requirements: (Array.isArray(raw.requirements) ? raw.requirements : [])
      .map((r) => str(r, 160))
      .filter((r): r is string => !!r)
      .slice(0, 6),
    summary: str(raw.summary, 700),
    apply_url: url(raw.apply_url),
    apply_email: applyEmail && (!sourceText || sourceText.toLowerCase().includes(applyEmail)) ? applyEmail : null,
    contact_name: str(raw.contact_name, 120),
    club_website: url(raw.club_website),
    posted_at: toIsoDate(str(raw.posted_at, 40)),
    deadline: toIsoDate(str(raw.deadline, 40)),
  };
}

/** One model call per posting. Returns null on any failure (never throws). */
export async function extractJob(item: ListItem, text: string): Promise<ExtractedJob | null> {
  const key = KEY();
  if (!key) return null;
  const body = text.slice(0, 14000);
  const prompt =
    `Today is ${new Date().toISOString().slice(0, 10)}. Below is a job posting from ${item.source}.\n` +
    `Listing title: ${item.title}\n` +
    (item.club ? `Employer (per listing): ${item.club}\n` : '') +
    (item.location ? `Location (per listing): ${item.location}\n` : '') +
    (item.postedAt ? `Listed on: ${item.postedAt}\n` : '') +
    (item.deadline ? `Deadline (per listing): ${item.deadline}\n` : '') +
    '\nRespond only by calling the record_job tool exactly once (keep=false if it is not a fit). Write the summary and requirement bullets in your own words — ' +
    'short, factual, no marketing language, never copied sentences. Only fill emails, URLs, names and ' +
    'pay that are literally in the posting; otherwise null.\n\n---\n' +
    body;
  try {
    const anthropic = new Anthropic({ apiKey: key });
    const msg = (await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1200,
      tools: [TOOL],
      // This model rejects forced tool_choice; auto + an explicit instruction instead.
      tool_choice: { type: 'auto' },
      messages: [{ role: 'user', content: prompt }],
    } as never)) as { content?: { type: string; input?: unknown }[] };
    const raw = (msg.content || []).find((b) => b.type === 'tool_use')?.input as Record<string, unknown> | undefined;
    return raw ? cleanExtraction(raw, body) : null;
  } catch (e) {
    console.warn('[scout] extract failed', item.url, e instanceof Error ? e.message : e);
    return null;
  }
}
