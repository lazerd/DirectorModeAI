/**
 * Finding new clubs to write to, on our own.
 *
 * The DCA roster is finite (519 clubs, one first impression each), so half of
 * each day's cold letters go to clubs this module finds: private and community
 * racquet clubs that run member play, with ONE named person whose address is
 * printed on the club's own website.
 *
 * ── HOW ──────────────────────────────────────────────────────────────────
 * One research call per run. The model gets Anthropic's server-side web search
 * and web fetch, today's focus states (rotated by date so a week of runs does
 * not all land in one town), and a single client tool, report_clubs, to hand
 * back what it found. It is asked for a few more candidates than we need so
 * dedupe still leaves `count`.
 *
 * ── WHAT CODE CHECKS, NOT THE MODEL ──────────────────────────────────────
 * The model's word is not the gate. Every candidate is then:
 *   - fetched by US, from the source URL it cited, and the email must appear
 *     on that page literally (after undoing the usual &#64; / [at] hiding).
 *     A model that "found" an address by guessing first.last@domain fails here.
 *   - dropped if it is in our own backyard (a conflict of interest for both
 *     reps), Rossmoor or Sleepy Hollow, or outside the lower 48 + DC (the send
 *     window is keyed to three US time zones).
 *   - dropped if the club (name + state, or website domain) or the address is
 *     already in the CRM, or the address/club is suppressed.
 *   - dropped if the address is a shared mailbox (info@, office@…) unless the
 *     model marked the club small AND named a person.
 *
 * Never throws for a model problem: an outage, a refusal or an empty answer
 * returns `added: []` with the reason in `note`, so the morning plan still runs.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { getSupabaseAdmin } from '@/lib/supabase/admin';
import type { AnthropicLike } from './write';

type Db = ReturnType<typeof getSupabaseAdmin>;

const MODEL = process.env.AI_MODEL_DISCOVER ?? 'claude-opus-5';
const EFFORT = process.env.AI_DISCOVER_EFFORT ?? 'medium';
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY ?? process.env.AI_API_KEY;

/** Web search is billed per search; this bounds one run. */
export const MAX_SEARCHES = 8;
export const MAX_FETCHES = 10;
/** How many server-tool continuations (pause_turn) before giving up. */
const MAX_CONTINUES = 4;
/** Staff pages are short; a whole site dumped into context is what costs money. */
const FETCH_TOKENS = 6000;

// ------------------------------------------------------------- geography

/**
 * State → the three send-window regions (settings.zoneForRegion). Mountain
 * states read Pacific: 8 AM PT is 9 AM MT, inside anyone's morning. Alaska and
 * Hawaii are not targeted at all — 8 AM Pacific is 5 AM in Honolulu.
 */
const WEST = ['WA', 'OR', 'CA', 'NV', 'ID', 'MT', 'WY', 'UT', 'CO', 'AZ', 'NM'];
const CENTRAL = ['ND', 'SD', 'NE', 'KS', 'OK', 'TX', 'MN', 'IA', 'MO', 'AR', 'LA', 'WI', 'IL', 'MS', 'AL', 'TN'];
const EAST = [
  'MI', 'IN', 'OH', 'KY', 'GA', 'FL', 'SC', 'NC', 'VA', 'WV', 'MD', 'DE', 'DC', 'PA', 'NJ', 'NY', 'CT', 'RI', 'MA',
  'VT', 'NH', 'ME',
];
export const TARGET_STATES = [...WEST, ...CENTRAL, ...EAST];

export function regionForState(state: string | null | undefined): 'West' | 'Central' | 'East' | null {
  const s = (state ?? '').trim().toUpperCase();
  if (WEST.includes(s)) return 'West';
  if (CENTRAL.includes(s)) return 'Central';
  if (EAST.includes(s)) return 'East';
  return null;
}

/**
 * Today's focus: two states, walking the list by day number, so consecutive
 * days land in different parts of the country and every state comes round
 * about once a month. Interleaves the regions so a pair is never two
 * neighbours.
 */
export function focusStates(day: Date, n = 2): string[] {
  const order: string[] = [];
  const lists = [EAST, CENTRAL, WEST];
  for (let i = 0; order.length < TARGET_STATES.length; i++) {
    for (const l of lists) if (i < l.length) order.push(l[i]);
  }
  const dayNo = Math.floor(day.getTime() / 86_400_000);
  const start = (dayNo * n) % order.length;
  return Array.from({ length: n }, (_, k) => order[(start + k) % order.length]);
}

// ---------------------------------------------------------------- filters

/** Our own backyard: both reps work at clubs near here. Never write to it. */
const BACKYARD_CITIES = ['orinda', 'moraga', 'lafayette', 'walnut creek', 'alamo', 'danville'];
const NEVER_CLUBS = [/\bsleepy hollow\b/i, /\brossmoor\b/i];

export function isBackyard(c: { club: string; city: string | null; state: string | null }): boolean {
  if (NEVER_CLUBS.some((re) => re.test(c.club))) return true;
  const city = (c.city ?? '').trim().toLowerCase();
  const state = (c.state ?? '').trim().toUpperCase();
  return state === 'CA' && BACKYARD_CITIES.includes(city);
}

const GENERIC_LOCAL = /^(info|office|admin|administration|contact|hello|frontdesk|front\.?desk|reception|membership|members|events|mail|general|club|tennis|pro\.?shop|proshop|manager|gm|staff|inquiries|enquiries)$/i;

export function isGenericMailbox(email: string): boolean {
  const local = email.split('@')[0] ?? '';
  return GENERIC_LOCAL.test(local);
}

const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;

export function normalizeEmail(e: string | null | undefined): string | null {
  const s = (e ?? '').trim().toLowerCase().replace(/^mailto:/, '');
  return EMAIL_RE.test(s) ? s : null;
}

/** "The Riverside Tennis & Swim Club, Inc." → "riverside tennis swim". */
export function normalizeClubName(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\bc\.?\s*c\.?\b/g, ' country club ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\b(the|inc|llc|club|country|and|association|assn|of)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** "https://www.foo-tennis.org/about" → "foo-tennis.org". */
export function domainOf(url: string | null | undefined): string | null {
  const s = (url ?? '').trim();
  if (!s) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    return u.hostname.toLowerCase().replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}

/**
 * Is `email` printed on this page? Undoes the common hiding first:
 * HTML entities (&#64; &#x40; &commat;), "name [at] domain [dot] org",
 * and Cloudflare's data-cfemail encoding.
 */
export function emailOnPage(html: string, email: string): boolean {
  const want = email.toLowerCase();
  let t = html
    .replace(/&#0*64;|&#x0*40;|&commat;/gi, '@')
    .replace(/&#0*46;|&#x0*2e;|&period;/gi, '.')
    .replace(/&amp;/gi, '&')
    .toLowerCase();
  if (t.includes(want)) return true;
  t = t
    .replace(/\s*[[(]\s*at\s*[\])]\s*/g, '@')
    .replace(/\s*[[(]\s*dot\s*[\])]\s*/g, '.')
    .replace(/\s+at\s+/g, '@')
    .replace(/\s+dot\s+/g, '.');
  if (t.includes(want)) return true;
  // Cloudflare email protection: data-cfemail="<hex>", XOR with the first byte.
  for (const m of html.matchAll(/data-cfemail="([0-9a-f]+)"/gi)) {
    const hex = m[1];
    const key = parseInt(hex.slice(0, 2), 16);
    let out = '';
    for (let i = 2; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
    if (out.toLowerCase() === want) return true;
  }
  return false;
}

// ------------------------------------------------------------- candidates

export interface Candidate {
  club: string;
  city: string | null;
  state: string | null;
  website: string | null;
  contact_name: string;
  contact_title: string | null;
  email: string;
  source_url: string;
  why: string;
  small_club: boolean;
}

export interface Known {
  /** normalized name + '|' + state (state may be '' for DCA rows with none). */
  names: Set<string>;
  /** normalized names with no state recorded — a match on name alone. */
  namesNoState: Set<string>;
  domains: Set<string>;
  emails: Set<string>;
  suppressedEmails: Set<string>;
}

/** Why a candidate may not be used, or null when it may. Pure. */
export function rejectReason(c: Candidate, known: Known): string | null {
  const email = normalizeEmail(c.email);
  if (!email) return 'no usable email';
  if (!c.contact_name?.trim()) return 'no named person';
  const state = (c.state ?? '').trim().toUpperCase();
  if (!regionForState(state)) return `outside target states (${state || 'none'})`;
  if (isBackyard(c)) return 'our own backyard';
  if (isGenericMailbox(email) && !c.small_club) return 'shared mailbox at a club that is not small';
  if (known.emails.has(email) || known.suppressedEmails.has(email)) return 'address already in the CRM or suppressed';
  const n = normalizeClubName(c.club);
  if (!n) return 'no club name';
  if (known.names.has(`${n}|${state}`) || known.namesNoState.has(n)) return 'club already in the CRM';
  const d = domainOf(c.website) ?? domainOf(c.source_url);
  if (d && known.domains.has(d)) return 'club website already in the CRM';
  const emailDomain = email.split('@')[1];
  if (emailDomain && known.domains.has(emailDomain) && !/^(gmail|yahoo|aol|hotmail|outlook|icloud|comcast)\./.test(emailDomain)) {
    return 'club domain already in the CRM';
  }
  return null;
}

async function loadKnown(db: Db): Promise<Known> {
  const [orgs, contacts, supp] = await Promise.all([
    db.from('crm_orgs').select('name, state, website').limit(10000),
    db.from('crm_contacts').select('email').not('email', 'is', null).limit(20000),
    db.from('crm_outreach_suppression').select('email').not('email', 'is', null).limit(20000),
  ]);
  const known: Known = {
    names: new Set(),
    namesNoState: new Set(),
    domains: new Set(),
    emails: new Set(),
    suppressedEmails: new Set(),
  };
  for (const o of (orgs.data as { name: string; state: string | null; website: string | null }[] | null) ?? []) {
    const n = normalizeClubName(o.name);
    const s = (o.state ?? '').trim().toUpperCase();
    if (s) known.names.add(`${n}|${s}`);
    else known.namesNoState.add(n);
    const d = domainOf(o.website);
    if (d) known.domains.add(d);
  }
  for (const c of (contacts.data as { email: string }[] | null) ?? []) {
    const e = normalizeEmail(c.email);
    if (e) known.emails.add(e);
  }
  for (const s of (supp.data as { email: string }[] | null) ?? []) {
    const e = normalizeEmail(s.email);
    if (e) known.suppressedEmails.add(e);
  }
  return known;
}

// ------------------------------------------------------------- the model

const REPORT_TOOL = {
  name: 'report_clubs',
  description: 'Hand back the clubs you found. Call exactly once, at the end.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['clubs'],
    properties: {
      clubs: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: [
            'club', 'city', 'state', 'website', 'contact_name', 'contact_title', 'email', 'source_url', 'why', 'small_club',
          ],
          properties: {
            club: { type: 'string', description: 'The club name as the club writes it.' },
            city: { type: 'string' },
            state: { type: 'string', description: 'Two-letter US state code.' },
            website: { type: 'string', description: "The club's own website." },
            contact_name: { type: 'string', description: 'Full name of the one person.' },
            contact_title: { type: 'string' },
            email: { type: 'string', description: 'Exactly as printed on source_url. Never constructed.' },
            source_url: { type: 'string', description: "The page on the club's own site where the email is printed." },
            why: { type: 'string', description: 'One short line: why this club fits (what member play it runs).' },
            small_club: { type: 'boolean', description: 'True for a small club run by volunteers or one pro.' },
          },
        },
      },
    },
  },
};

function systemPrompt(want: number, states: string[], avoid: string[]): string {
  return [
    'You research racquet clubs for a small software company that makes club software (member mixers and round robins, finding a game, court sign-ups, the club website, league captain tools).',
    '',
    `Find ${want} clubs in ${states.join(' or ')} that fit, each with ONE named decision-maker whose email address is printed on the club's own website.`,
    '',
    'A club fits when it is a private or member-run tennis, racquet, pickleball or country club, or a community tennis club, that runs member play: mixers, socials, round robins, ladders, leagues, clinics. Smaller and mid-size clubs are best, especially ones run by a volunteer board or a single director or head pro. Skip public parks departments, commercial chains, resorts, schools, USTA sections and tournament organizers.',
    '',
    'The person: the director of tennis / racquets, head pro, club manager or GM, or the board president. One per club.',
    '',
    'THE EMAIL RULE IS ABSOLUTE: use web_fetch to open the page on the club\'s own website and copy the address exactly as it is printed there. Never guess, construct or pattern-match an address (no first.last@ inference). If you cannot find a named person\'s address on the club\'s site, skip that club. A shared mailbox like info@ or office@ is acceptable only for a small club, and only with the person\'s name taken from the same site.',
    '',
    avoid.length ? `Already known, do not return: ${avoid.join('; ')}.` : '',
    'Never return anything in Orinda, Moraga, Lafayette, Walnut Creek, Alamo or Danville, California, and never Rossmoor or Sleepy Hollow.',
    '',
    `Be economical: at most ${MAX_SEARCHES} searches. When you have ${want} clubs (or have run out of searches), call report_clubs exactly once with what you have. Return fewer rather than guess.`,
  ]
    .filter((l) => l !== null)
    .join('\n');
}

type Block = { type: string; name?: string; input?: unknown };
type Resp = {
  content?: Block[];
  stop_reason?: string;
  usage?: { input_tokens?: number; output_tokens?: number; server_tool_use?: { web_search_requests?: number; web_fetch_requests?: number } };
};

export interface Usage {
  input: number;
  output: number;
  searches: number;
  fetches: number;
}

/** Rough dollars for a run: Opus 5 $5/$25 per MTok, web search $10 per 1,000. */
export function estimateCost(u: Usage): number {
  return (u.input * 5 + u.output * 25) / 1_000_000 + (u.searches * 10) / 1000;
}

/** Ask the model; return its candidates. Throws only on a programming error. */
export async function research(
  client: AnthropicLike,
  want: number,
  states: string[],
  avoid: string[],
): Promise<{ candidates: Candidate[]; usage: Usage; note?: string }> {
  const usage: Usage = { input: 0, output: 0, searches: 0, fetches: 0 };
  const messages: { role: 'user' | 'assistant'; content: unknown }[] = [
    { role: 'user', content: `Find ${want} clubs in ${states.join(' or ')}. Call report_clubs when done.` },
  ];

  for (let turn = 0; turn <= MAX_CONTINUES; turn++) {
    let res: Resp;
    try {
      res = (await client.messages.create({
        model: MODEL,
        max_tokens: 16000,
        output_config: { effort: EFFORT },
        system: systemPrompt(want, states, avoid),
        tools: [
          { type: 'web_search_20260209', name: 'web_search', max_uses: MAX_SEARCHES, user_location: { type: 'approximate', country: 'US' } },
          { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: MAX_FETCHES, max_content_tokens: FETCH_TOKENS },
          REPORT_TOOL,
        ],
        tool_choice: { type: 'auto' },
        messages,
      })) as Resp;
    } catch (e) {
      return { candidates: [], usage, note: `research call failed: ${(e as Error).message}` };
    }
    usage.input += res.usage?.input_tokens ?? 0;
    usage.output += res.usage?.output_tokens ?? 0;
    usage.searches += res.usage?.server_tool_use?.web_search_requests ?? 0;
    usage.fetches += res.usage?.server_tool_use?.web_fetch_requests ?? 0;

    if (res.stop_reason === 'refusal') return { candidates: [], usage, note: 'the model declined the research request' };

    const report = (res.content ?? []).find((b) => b.type === 'tool_use' && b.name === 'report_clubs');
    if (report) return { candidates: parseCandidates(report.input), usage };

    if (res.stop_reason === 'pause_turn') {
      // Server-side tool loop hit its iteration limit; hand the turn back as-is.
      messages.push({ role: 'assistant', content: res.content ?? [] });
      continue;
    }
    if (res.stop_reason === 'end_turn' && turn < MAX_CONTINUES) {
      messages.push({ role: 'assistant', content: res.content ?? [] });
      messages.push({ role: 'user', content: 'Call report_clubs now with whatever you found (an empty list is fine).' });
      continue;
    }
    return { candidates: [], usage, note: `model stopped without reporting (${res.stop_reason ?? 'unknown'})` };
  }
  return { candidates: [], usage, note: 'model kept pausing without reporting' };
}

export function parseCandidates(input: unknown): Candidate[] {
  const list = (input as { clubs?: unknown })?.clubs;
  if (!Array.isArray(list)) return [];
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  return list
    .map((r) => r as Record<string, unknown>)
    .map((r) => ({
      club: str(r.club) ?? '',
      city: str(r.city),
      state: str(r.state)?.toUpperCase() ?? null,
      website: str(r.website),
      contact_name: str(r.contact_name) ?? '',
      contact_title: str(r.contact_title),
      email: str(r.email) ?? '',
      source_url: str(r.source_url) ?? '',
      why: str(r.why) ?? '',
      small_club: r.small_club === true,
    }))
    .filter((c) => c.club && c.email && c.source_url);
}

/** Fetch a page ourselves; '' on any failure. */
async function fetchPage(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ClubModeResearch/1.0)' },
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
      cache: 'no-store',
    });
    if (!res.ok) return '';
    return (await res.text()).slice(0, 2_000_000);
  } catch {
    return '';
  }
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70);
}

// ---------------------------------------------------------------- driver

export interface DiscoverResult {
  added: { orgId: string; contactId: string; club: string; email: string }[];
  skipped: string[];
  note?: string;
  /** Every candidate that passed, dry run or not — what would be inserted. */
  accepted?: Candidate[];
}

export async function discoverClubs(
  db: Db,
  opts: { count: number; dryRun?: boolean; client?: AnthropicLike; now?: Date; fetcher?: (url: string) => Promise<string> },
): Promise<DiscoverResult> {
  const count = Math.max(0, Math.floor(opts.count));
  if (!count) return { added: [], skipped: [], note: 'count is 0' };
  const client =
    opts.client ?? (ANTHROPIC_KEY ? (new Anthropic({ apiKey: ANTHROPIC_KEY, timeout: 280_000 }) as unknown as AnthropicLike) : null);
  if (!client) return { added: [], skipped: [], note: 'no ANTHROPIC_API_KEY' };
  const fetcher = opts.fetcher ?? fetchPage;

  const known = await loadKnown(db);
  const states = focusStates(opts.now ?? new Date());

  // The names we already hold in today's states, so the model does not spend
  // searches rediscovering them. Only rows with a state: the DCA rows mostly
  // have none and would be the whole list.
  const { data: inStates } = await db.from('crm_orgs').select('name').in('state', states).limit(200);
  const avoid = ((inStates as { name: string }[] | null) ?? []).map((o) => o.name);

  const { candidates, usage, note: researchNote } = await research(client, count + 3, states, avoid);
  const skipped: string[] = [];
  const accepted: Candidate[] = [];
  const seenThisRun = new Set<string>();

  for (const c of candidates) {
    if (accepted.length >= count) break;
    const reason = rejectReason(c, known);
    if (reason) {
      skipped.push(`${c.club}: ${reason}`);
      continue;
    }
    const email = normalizeEmail(c.email)!;
    const key = `${normalizeClubName(c.club)}|${c.state}`;
    if (seenThisRun.has(key) || seenThisRun.has(email)) {
      skipped.push(`${c.club}: duplicate within this run`);
      continue;
    }
    const html = await fetcher(c.source_url);
    if (!html) {
      skipped.push(`${c.club}: could not load ${c.source_url}`);
      continue;
    }
    if (!emailOnPage(html, email)) {
      skipped.push(`${c.club}: ${email} is not on ${c.source_url}`);
      continue;
    }
    seenThisRun.add(key);
    seenThisRun.add(email);
    accepted.push({ ...c, email });
  }

  const added: DiscoverResult['added'] = [];
  if (!opts.dryRun) {
    const today = (opts.now ?? new Date()).toISOString().slice(0, 10);
    for (const c of accepted) {
      const base = `disc-${slugify(c.club)}-${(c.state ?? '').toLowerCase()}`;
      const row = {
        name: c.club,
        type: 'club',
        stage: 'researching',
        source: 'discovered',
        region: regionForState(c.state),
        city: c.city,
        state: c.state,
        website: c.website,
        notes: `Found by discovery ${today}: ${c.why} Source: ${c.source_url}`,
      };
      let org: { id: string } | null = null;
      for (let n = 1; n <= 5 && !org; n++) {
        const { data, error } = await db
          .from('crm_orgs')
          .insert({ ...row, slug: n === 1 ? base : `${base}-${n}` })
          .select('id')
          .single();
        if (!error) org = data as { id: string };
        else if (error.code !== '23505') {
          skipped.push(`${c.club}: org insert failed (${error.message})`);
          break;
        }
      }
      if (!org) continue;
      const { data: contact, error: cErr } = await db
        .from('crm_contacts')
        .insert({
          org_id: org.id,
          full_name: c.contact_name,
          title: c.contact_title,
          email: c.email,
          is_primary: true,
          notes: `Email printed on ${c.source_url}`,
        })
        .select('id')
        .single();
      if (cErr || !contact) {
        // An org with no person is useless to the planner; take it back out.
        await db.from('crm_orgs').delete().eq('id', org.id);
        skipped.push(`${c.club}: contact insert failed (${cErr?.message ?? 'unknown'})`);
        continue;
      }
      added.push({ orgId: org.id, contactId: (contact as { id: string }).id, club: c.club, email: c.email });
    }
  }

  const cost = estimateCost(usage);
  const note = [
    researchNote,
    `states ${states.join('+')}`,
    `${candidates.length} candidates, ${accepted.length} passed`,
    `${usage.searches} searches, ${usage.fetches} fetches, ${usage.input} in / ${usage.output} out tokens, ~$${cost.toFixed(2)}`,
  ]
    .filter(Boolean)
    .join('; ');
  return { added, skipped, note, accepted };
}
