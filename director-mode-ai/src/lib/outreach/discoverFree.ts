/**
 * Finding new clubs on free tiers only: Brave Search + our own page fetches +
 * Gemini flash. The same recipe Active 10 (chiropractors) and Pickle Noise
 * Block use, so it costs nothing.
 *
 *   1. Brave web search, a few queries per focus state (free plan: 1/second).
 *   2. Keep club websites only (no directories, socials, news, USTA), one per
 *      domain, and fetch the home page plus the usual staff/contact pages.
 *   3. Only pages that print an email address go on. Gemini reads the page
 *      text in small batches and names the club, the person and their title,
 *      choosing the email ONLY from the addresses literally on that page.
 *   4. discover.ts then runs the same code checks as before (email on page,
 *      backyard, shared mailbox, already in the CRM).
 *
 * Gemini's free tier gives each flash model its own daily quota, so calls walk
 * a chain of models and skip any that are spent. Never throws for an outage or
 * a spent quota: the note says why and the morning plan carries on.
 */

import type { Candidate } from './discover';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const STATE_NAMES: Record<string, string> = {
  AL: 'Alabama', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware',
  DC: 'Washington DC', FL: 'Florida', GA: 'Georgia', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas',
  KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
  MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon',
  PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah',
  VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};

/** Hosts that are never a club's own website. */
const NOT_A_CLUB = /(^|\.)(facebook|instagram|twitter|x|linkedin|youtube|tiktok|yelp|tripadvisor|usta|playtennis|tennislink|wikipedia|mapquest|yellowpages|bbb|groupon|eventbrite|meetup|nextdoor|reddit|pinterest|zillow|indeed|glassdoor|golfdigest|clubcorp|invitedclubs|pickleheads|places2play|usapickleball|tennisrecord|utrsports|google|apple|bing|patch|newspapers|craigslist|opentable|wedding\w*|theknot|countryclubs|clubessential|clubrunner|teamsnap|leagueapps|playbypoint|courtreserve|clubautomation|wix|squarespace|weebly|godaddy)\.[a-z.]+$/i;

const PAGE_PATHS = ['/staff', '/contact', '/board', '/tennis', '/contact-us', '/about', '/leadership', ''];

const STAFF_TITLE = /\b(director of (tennis|racquets?|racket sports|pickleball)|tennis director|head (tennis )?pro|general manager|club manager|president|board of directors)\b/gi;
const isSharedLocal = (e: string) =>
  /^(info|office|admin|contact|hello|frontdesk|front\.?desk|reception|membership|members|events|mail|general|club|tennis|proshop|pro\.?shop|staff|inquiries|team|play)@/.test(e);

export interface FreeDeps {
  braveKey?: string;
  geminiKey?: string;
  fetcher?: (url: string) => Promise<string>;
  /** Tests: skip the 1-per-second / 7-per-minute pacing. */
  noPacing?: boolean;
  /** Manual runs: see each page kept and what Gemini said about it. */
  debug?: (line: string) => void;
}

export interface FreeUsage {
  searches: number;
  pages: number;
  gemini: number;
}

interface Page {
  url: string;
  domain: string;
  emails: string[];
  text: string;
}

export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

export function isClubHost(host: string | null): boolean {
  return !!host && !NOT_A_CLUB.test(host) && !host.endsWith('.gov') && !host.endsWith('.edu');
}

/** Addresses printed in the HTML (after undoing &#64; hiding), minus junk. */
export function emailsIn(html: string): string[] {
  const t = html.replace(/&#0*64;|&#x0*40;|&commat;/gi, '@').replace(/&#0*46;|&#x0*2e;/gi, '.');
  const out = new Set<string>();
  for (const m of t.matchAll(/([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g)) {
    const e = m[1].toLowerCase().replace(/^mailto:/, '');
    if (/\.(png|jpe?g|gif|webp|svg|css|js)$|sentry|wixpress|example\.|domain\.com|godaddy|yourname|email\.com$|@2x/.test(e)) continue;
    out.add(e);
  }
  return [...out];
}

export function visibleText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&amp;|&#\d+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function queriesFor(state: string): string[] {
  const s = STATE_NAMES[state] ?? state;
  // Aimed at a club's own staff and board pages, where a named person and
  // their address sit together. Swim-and-tennis and country clubs are the
  // classic fit (volunteer boards, one director running member play).
  return [
    `"swim and tennis club" ${s} "director of tennis"`,
    `"tennis club" ${s} staff "head pro" email`,
    `"racquet club" ${s} "director of racquets" OR "tennis director"`,
    `"country club" ${s} "director of tennis" staff`,
    `"tennis club" ${s} "board of directors" president email`,
  ];
}

async function brave(q: string, key: string, pace: boolean): Promise<string[]> {
  const r = await fetch(`https://api.search.brave.com/res/v1/web/search?count=20&country=us&q=${encodeURIComponent(q)}`, {
    headers: { Accept: 'application/json', 'X-Subscription-Token': key },
    cache: 'no-store',
  });
  if (pace) await sleep(1100);
  if (!r.ok) throw new Error(`Brave ${r.status}`);
  const j = (await r.json()) as { web?: { results?: { url?: string }[] } };
  return (j.web?.results ?? []).map((x) => String(x.url ?? '')).filter(Boolean);
}

const MODELS = ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-2.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'];

async function gemini<T>(prompt: string, key: string, pace: boolean): Promise<T> {
  let last = '';
  for (const model of MODELS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0.1 },
        }),
      });
      const j = (await r.json().catch(() => ({}))) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
        error?: { message?: string; details?: unknown };
      };
      const text = j.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) {
        try {
          return JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, '')) as T;
        } catch {
          last = `${model} bad JSON`;
          break;
        }
      }
      last = `${model} ${r.status} ${String(j.error?.message ?? '').slice(0, 100)}`;
      if (r.status === 429 && JSON.stringify(j.error?.details ?? '').includes('PerDay')) break; // spent: next model
      if (r.status === 404 || r.status === 400) break; // retired or unsupported
      if (r.status !== 429 && r.status !== 503) throw new Error(`Gemini ${last}`);
      if (pace) await sleep(8000 * (attempt + 1));
    }
  }
  throw new Error(`Gemini free quota spent on every model today (${last})`);
}

async function defaultFetch(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ClubModeResearch/1.0)' },
      redirect: 'follow',
      signal: AbortSignal.timeout(10_000),
      cache: 'no-store',
    });
    if (!res.ok) return '';
    return (await res.text()).slice(0, 800_000);
  } catch {
    return '';
  }
}

type Extracted = {
  page: number;
  fits: boolean;
  club: string;
  city: string;
  state: string;
  contact_name: string;
  contact_title: string;
  email: string;
  why: string;
  small_club: boolean;
  shared_mailbox?: boolean;
};

function extractPrompt(pages: Page[]): string {
  return [
    'You read web pages from racquet clubs for a small company that makes club software (member mixers and round robins, members finding a game, court sign-ups, the club website).',
    'For EACH page below, decide whether it belongs to ONE club that has members and runs member play (mixers, socials, round robins, ladders, leagues, clinics): a private, member-run or community tennis, racquet, pickleball, swim-and-tennis or country club, or an independent tennis center with members. It does NOT fit if it is a public parks department, a multi-location chain, a resort, a school, a store, a coach for hire, a tournament organizer, a directory, a news or blog site, or outside the United States.',
    'If it fits, name ONE decision-maker printed on the page: the director of tennis or racquets, head pro, club manager or GM, or the board president. The email MUST be copied exactly from that page\'s EMAILS list, never invented or constructed. Use that person\'s own address if it is listed. If it is not, use the club\'s general mailbox (info@, office@, frontdesk@, or an address named after the club, including a club Gmail) and set shared_mailbox true. NEVER use a different individual\'s personal address. If there is no named person, or no usable address, set fits to false.',
    'Return JSON: an array with one object per page: {"page": <number>, "fits": boolean, "club": "", "city": "", "state": "two-letter code", "contact_name": "", "contact_title": "", "email": "", "shared_mailbox": boolean, "why": "one short line on what member play it runs", "small_club": boolean}.',
    '',
    ...pages.map((p, i) => `=== PAGE ${i} ${p.url}\nEMAILS: ${p.emails.join(', ')}\nTEXT: ${p.text.slice(0, 3500)}`),
  ].join('\n');
}

/**
 * Candidates for today's focus states, on free tiers. `want` bounds the work:
 * it stops fetching once it has plenty of pages worth reading.
 */
export async function researchFree(
  want: number,
  states: string[],
  deps: FreeDeps = {},
): Promise<{ candidates: Candidate[]; usage: FreeUsage; note?: string }> {
  const usage: FreeUsage = { searches: 0, pages: 0, gemini: 0 };
  const braveKey = deps.braveKey ?? process.env.BRAVE_API_KEY ?? '';
  const geminiKey = deps.geminiKey ?? process.env.GEMINI_API_KEY ?? '';
  if (!braveKey || !geminiKey) return { candidates: [], usage, note: 'BRAVE_API_KEY or GEMINI_API_KEY is not set' };
  const pace = !deps.noPacing;
  const fetcher = deps.fetcher ?? defaultFetch;

  // 1. Search.
  const hosts = new Map<string, string>(); // domain -> first URL seen
  try {
    for (const st of states) {
      for (const q of queriesFor(st)) {
        const urls = await brave(q, braveKey, pace);
        usage.searches += 1;
        for (const u of urls) {
          const h = hostOf(u);
          if (isClubHost(h) && !hosts.has(h!)) hosts.set(h!, u);
        }
      }
    }
  } catch (e) {
    if (!hosts.size) return { candidates: [], usage, note: `search failed: ${(e as Error).message}` };
  }

  // 2. Fetch: each club's own pages until one prints an email.
  const pages: Page[] = [];
  const maxPages = Math.max(8, want * 4);
  for (const [domain, first] of hosts) {
    if (pages.length >= maxPages) break;
    const origin = (() => {
      try {
        return new URL(first).origin;
      } catch {
        return null;
      }
    })();
    if (!origin) continue;
    // The page to read is the one that names staff next to their addresses,
    // not merely the first with any address on it (often a footer info@).
    const tries = [first, ...PAGE_PATHS.map((p) => origin + p)]
      .filter((u, i, a) => a.indexOf(u) === i && !/\.pdf($|\?)/i.test(u))
      .slice(0, 5);
    let best: (Page & { score: number }) | null = null;
    for (const url of tries) {
      const html = await fetcher(url);
      usage.pages += 1;
      if (!html) continue;
      const emails = emailsIn(html).filter((e) => !/noreply|no-reply|donotreply|privacy|webmaster|abuse|support@/.test(e));
      if (!emails.length) continue;
      const text = visibleText(html);
      const titles = (text.match(STAFF_TITLE) ?? []).length;
      const named = emails.filter((e) => !isSharedLocal(e)).length;
      const score = titles * 2 + named * 3 + emails.length;
      if (!best || score > best.score) best = { url, domain, emails, text, score };
      if (titles && named) break; // a staff page with people on it: good enough
    }
    if (best) {
      pages.push(best);
      deps.debug?.(`page ${best.url} score=${best.score} emails=${best.emails.join(',')}`);
    }
  }
  if (!pages.length) return { candidates: [], usage, note: `no club pages with an email (${hosts.size} sites searched)` };

  // 3. Read, four pages per Gemini call.
  const candidates: Candidate[] = [];
  let note: string | undefined;
  for (let i = 0; i < pages.length; i += 4) {
    const batch = pages.slice(i, i + 4);
    let rows: Extracted[] = [];
    try {
      rows = await gemini<Extracted[]>(extractPrompt(batch), geminiKey, pace);
      usage.gemini += 1;
    } catch (e) {
      note = (e as Error).message;
      break;
    }
    for (const r of Array.isArray(rows) ? rows : []) {
      deps.debug?.(`gemini ${JSON.stringify(r)}`);
      const p = batch[r?.page];
      if (!p || !r.fits) continue;
      const email = String(r.email ?? '').trim().toLowerCase();
      // The model may only choose from what the page printed.
      if (!p.emails.includes(email)) continue;
      candidates.push({
        club: String(r.club ?? '').trim(),
        city: String(r.city ?? '').trim() || null,
        state: String(r.state ?? '').trim().toUpperCase() || null,
        website: new URL(p.url).origin,
        contact_name: String(r.contact_name ?? '').trim(),
        contact_title: String(r.contact_title ?? '').trim() || null,
        email,
        source_url: p.url,
        why: String(r.why ?? '').trim(),
        small_club: r.small_club === true,
        shared_ok: r.shared_mailbox === true,
      });
    }
    if (candidates.length >= want + 3) break;
  }
  return { candidates, usage, note };
}
