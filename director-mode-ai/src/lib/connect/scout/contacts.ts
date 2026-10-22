/**
 * Scout — contact finder. For an active sourced job with no contacts yet:
 * find the club's own website, read a handful of its public pages (robots.txt
 * respected via politeGet), and have Claude pull out the GM, board/president,
 * tennis committee chair, HR and hiring contact. An email or phone is kept
 * ONLY if it literally appears on the page it came from — never guessed.
 * No emails are sent from here (the recruiter engine owns outreach).
 */
import Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import { politeGet } from './http';
import { nameTokens } from './match990';
import { htmlToText, linksIn, normalizeName } from './text';

const MODEL = process.env.AI_MODEL_SCOUT ?? 'claude-sonnet-5-5';
const KEY = () => process.env.ANTHROPIC_API_KEY ?? process.env.AI_API_KEY;

export type ContactRole = 'gm' | 'board' | 'tennis_committee' | 'hr' | 'hiring_contact';
const ROLES: ContactRole[] = ['gm', 'board', 'tennis_committee', 'hr', 'hiring_contact'];

export type FoundContact = {
  name: string | null;
  role: ContactRole;
  title: string | null;
  email: string | null;
  phone: string | null;
  source_url: string;
};

export type JobForContacts = {
  id: string;
  club_name: string | null;
  state: string | null;
  source_url: string;
  apply_url: string | null;
  apply_email: string | null;
  contact_name: string | null;
};

// Job boards, ATSs and webmail — never "the club's website".
const NOT_CLUB_HOST = /(^|\.)(rspa\.net|uspta\.(com|org)|mycoachingtree\.com|ptrtennis\.org|hospitalityonline\.com|salesforce-sites\.com|force\.com|applytojob\.com|jazz\.co|greenhouse\.io|lever\.co|indeed\.com|linkedin\.com|glassdoor\.com|ziprecruiter\.com|paycom\.com|paylocity\.com|adp\.com|ultipro\.com|ukg\.com|myworkdayjobs\.com|workday\.com|icims\.com|bamboohr\.com|careerplug\.com|betterteam\.com|smartjobboard\.com|clubcareers\.|cmaa\.org|google\.com|forms\.gle|facebook\.com|instagram\.com|twitter\.com|x\.com|youtube\.com|kkandw\.com|ggapartners\.com|monster\.com|theladders\.com|careerbuilder\.com|hcareers\.com|clubessential\.com|wix\.com|squarespace\.com|bit\.ly)$/i;
const FREEMAIL = /^(gmail|googlemail|yahoo|ymail|hotmail|outlook|live|msn|aol|icloud|me|mac|comcast|verizon|att|sbcglobal|bellsouth|cox|charter|proton|protonmail)\./i;

const PATHS = ['/', '/contact', '/contact-us', '/staff', '/club-staff', '/our-team', '/about', '/about-us', '/leadership', '/board', '/board-of-directors'];
const LINK_HINT = /contact|staff|team|leadership|board|governance|directors|about|management|administration|tennis|racquet/i;
const MAX_PAGES = 8;

/** Distinctive words of a club name (for checking a page is really that club). */
export function distinctiveTokens(club: string): string[] {
  const generic = new Set(['country', 'club', 'golf', 'tennis', 'racquet', 'swim', 'athletic', 'association', 'yacht', 'beach', 'sport', 'sports', 'center', 'resort', 'saint', 'mount', 'lake', 'park']);
  return nameTokens(club).filter((t) => t.length > 2 && !generic.has(t));
}

/** Pure: plausible club domains to try when nothing else names the website. */
export function guessDomains(club: string): string[] {
  const all = nameTokens(club).filter((t) => t !== 'the');
  const dist = distinctiveTokens(club);
  if (!dist.length) return [];
  const core = dist.join('');
  const abbrev = (w: string[]) => w.map((t) => t[0]).join('');
  const tail = all.slice(all.indexOf(dist[dist.length - 1]) + 1); // e.g. ['country','club']
  const stems = new Set<string>([
    `${core}${abbrev(tail)}`, // waccabuccc
    `${core}${tail.join('')}`, // waccabuccountryclub
    core, // waccabuc
    `${core}club`,
  ]);
  const out: string[] = [];
  for (const s of stems) if (s.length >= 4) for (const tld of ['.org', '.com']) out.push(`https://www.${s}${tld}`);
  return out.slice(0, 8);
}

function hostOf(u: string | null | undefined): string | null {
  try {
    return u ? new URL(u).hostname.toLowerCase().replace(/^www\./, '') : null;
  } catch {
    return null;
  }
}

/** Pure: a host could be the club's own site. */
export function isClubHost(host: string | null): boolean {
  return !!host && host.includes('.') && !NOT_CLUB_HOST.test(host);
}

/** The name minus filler and trailing generic words: "The Bear Lakes Country Club, Inc." → "bear lakes". */
export function clubCore(club: string): string {
  const words = normalizeName(club.replace(/\([^)]*\)/g, ' ')).split(' ').filter(Boolean);
  const tailGeneric = new Set(['club', 'country', 'cc', 'golf', 'association', 'assn', 'resort', 'center']);
  while (words.length > 1 && tailGeneric.has(words[words.length - 1])) words.pop();
  return words.join(' ');
}

/** Pure: does page text look like this club's site? The core name must appear as a phrase. */
export function pageMatchesClub(text: string, club: string): boolean {
  const core = clubCore(club);
  if (core.length < 4 || !distinctiveTokens(club).length) return false;
  const norm = ` ${normalizeName(text)} `;
  return norm.includes(` ${core} `) || norm.replace(/ /g, '').includes(core.replace(/ /g, '') + 'club');
}

/** Emails that literally appear in an HTML page (mailto links + visible text). */
export function emailsOnPage(html: string): string[] {
  const out = new Set<string>();
  const decoded = html.replace(/&#64;|&commat;/gi, '@').replace(/&#46;/g, '.');
  for (const m of decoded.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)) {
    const e = m[0].toLowerCase().replace(/\.$/, '');
    if (!/\.(png|jpe?g|gif|svg|webp|css|js)$/.test(e) && !/sentry|wixpress|example\.com|domain\.com/.test(e)) out.add(e);
  }
  return [...out];
}

const digits = (s: string) => s.replace(/\D/g, '');

/** Pure: keep only contacts whose email/phone/name are literally on their source page. */
export function verifyContacts(raw: unknown[], pages: Map<string, { html: string; text: string }>): FoundContact[] {
  const out: FoundContact[] = [];
  for (const r of raw as Record<string, unknown>[]) {
    const role = ROLES.includes(r?.role as ContactRole) ? (r.role as ContactRole) : null;
    if (!role) continue;
    const want = typeof r.source_url === 'string' ? r.source_url.trim() : '';
    const src = [want, want.replace(/\/$/, ''), `${want}/`].find((u) => pages.has(u));
    const page = src ? pages.get(src)! : null;
    if (!page || !src) continue;
    const s = (v: unknown, n = 160) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null);
    let email = s(r.email, 200)?.toLowerCase() ?? null;
    if (email && !emailsOnPage(page.html).includes(email)) email = null;
    let phone = s(r.phone, 40);
    if (phone && (digits(phone).length < 10 || !digits(page.text).includes(digits(phone).slice(-10)))) phone = null;
    let name = s(r.name, 120);
    if (name && !page.text.toLowerCase().includes(name.toLowerCase().split(' ').pop()!)) name = null;
    if (!email && !phone && !name) continue;
    out.push({ name, role, title: s(r.title, 120), email, phone, source_url: src });
  }
  return out;
}

async function findWebsite(job: JobForContacts, log: string[]): Promise<{ site: string; home: { html: string; text: string } } | null> {
  const club = job.club_name || '';
  const candidates: string[] = [];
  const add = (u: string | null) => {
    const h = hostOf(u);
    if (h && isClubHost(h) && !candidates.some((c) => hostOf(c) === h)) candidates.push(`https://${h}`);
  };
  add(job.apply_url);
  const emailDomain = job.apply_email?.split('@')[1] ?? null;
  if (emailDomain && !FREEMAIL.test(emailDomain)) add(`https://${emailDomain}`);

  // Links on the original posting whose host carries the club's distinctive name.
  const toks = distinctiveTokens(club);
  const posting = await politeGet(job.source_url);
  if (posting.ok) {
    for (const l of linksIn(posting.body, posting.url)) {
      const h = hostOf(l);
      if (h && isClubHost(h) && toks.some((t) => h.replace(/[^a-z0-9]/g, '').includes(t))) add(l);
    }
    for (const e of emailsOnPage(posting.body)) {
      const d = e.split('@')[1];
      if (d && !FREEMAIL.test(d) && toks.some((t) => d.includes(t))) add(`https://${d}`);
    }
  }
  for (const g of guessDomains(club)) add(g);

  for (const c of candidates.slice(0, 8)) {
    const r = await politeGet(c);
    if (!r.ok) continue;
    const text = htmlToText(r.body);
    if (pageMatchesClub(text.slice(0, 20000) + ' ' + (r.body.match(/<title>([^<]*)/i)?.[1] ?? ''), club)) {
      const u = new URL(r.url);
      return { site: u.origin, home: { html: r.body, text } };
    }
    log.push(`${c}: not ${club}`);
  }
  return null;
}

async function askClaude(club: string, pages: Map<string, { html: string; text: string }>): Promise<unknown[]> {
  const key = KEY();
  if (!key) return [];
  let budget = 30000;
  const parts: string[] = [];
  for (const [url, p] of pages) {
    if (budget <= 0) break;
    const emails = emailsOnPage(p.html);
    const chunk = `=== PAGE ${url}\n${p.text.slice(0, Math.min(8000, budget))}\n${emails.length ? `Emails on this page: ${emails.join(', ')}\n` : ''}`;
    parts.push(chunk);
    budget -= chunk.length;
  }
  const prompt =
    `These are public pages from the website of ${club}, a private club. List its decision-makers relevant to hiring a ` +
    'Director of Tennis/Racquets: general manager/COO (gm), president or board members (board), tennis/racquets committee ' +
    'chair (tennis_committee), HR/human resources (hr), and anyone named as the hiring contact (hiring_contact). ' +
    'For each, give the exact page URL it appears on. Copy an email or phone ONLY if it is written on that page next to ' +
    'that person (or is clearly their role address, e.g. gm@…); otherwise null. Never construct or guess an email. ' +
    'Respond by calling the record_contacts tool exactly once (an empty list is fine). Skip the tennis staff themselves, vendors and generic info@ addresses unless tied to one of these roles. Max 10.\n\n' +
    parts.join('\n');
  try {
    const anthropic = new Anthropic({ apiKey: key });
    const msg = (await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1500,
      tools: [{
        name: 'record_contacts',
        description: 'Record club decision-makers found on the pages.',
        input_schema: {
          type: 'object',
          properties: {
            contacts: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: ['string', 'null'] },
                  role: { type: 'string', enum: ROLES },
                  title: { type: ['string', 'null'] },
                  email: { type: ['string', 'null'] },
                  phone: { type: ['string', 'null'] },
                  source_url: { type: 'string' },
                },
                required: ['role', 'source_url'],
              },
            },
          },
          required: ['contacts'],
        },
      }],
      tool_choice: { type: 'auto' },
      messages: [{ role: 'user', content: prompt }],
    } as never)) as { content?: { type: string; input?: unknown }[] };
    const raw = (msg.content || []).find((b) => b.type === 'tool_use')?.input as { contacts?: unknown[] } | undefined;
    return Array.isArray(raw?.contacts) ? raw!.contacts : [];
  } catch (e) {
    console.warn('[scout] contacts extract failed', club, e instanceof Error ? e.message : e);
    return [];
  }
}

/** Find contacts for one job. Never throws. */
export async function findContactsForJob(job: JobForContacts): Promise<{ website: string | null; contacts: FoundContact[]; pagesRead: number; log: string[] }> {
  const log: string[] = [];
  const contacts: FoundContact[] = [];
  // The posting's own hiring contact (apply_email was verified literal at extraction).
  if (job.apply_email) {
    contacts.push({ name: job.contact_name, role: 'hiring_contact', title: null, email: job.apply_email, phone: null, source_url: job.source_url });
  }
  if (!job.club_name) return { website: null, contacts, pagesRead: 0, log: ['no club name'] };
  try {
    const found = await findWebsite(job, log);
    if (!found) return { website: null, contacts, pagesRead: 0, log: [...log, 'website not found'] };
    const pages = new Map<string, { html: string; text: string }>();
    pages.set(`${found.site}/`, found.home);
    // Prefer the site's own nav links to staff/contact/board pages, then the usual paths.
    const navLinks = linksIn(found.home.html, found.site)
      .filter((l) => hostOf(l) === hostOf(found.site) && LINK_HINT.test(new URL(l).pathname))
      .map((l) => l.split('#')[0]);
    const queue = [...new Set([...navLinks, ...PATHS.map((p) => `${found.site}${p}`)])].filter((u) => !pages.has(u));
    for (const u of queue) {
      if (pages.size >= MAX_PAGES) break;
      if (/\.(pdf|jpg|png|docx?)$/i.test(u) || /login|signin|member-?portal|wp-admin/i.test(u)) continue;
      const r = await politeGet(u);
      if (!r.ok) continue;
      if (/type="password"/i.test(r.body)) continue; // behind login
      pages.set(r.url, { html: r.body, text: htmlToText(r.body) });
    }
    const raw = await askClaude(job.club_name, pages);
    for (const c of verifyContacts(raw, pages)) {
      if (!contacts.some((x) => (c.email && x.email === c.email) || (!c.email && x.name === c.name && x.role === c.role))) contacts.push(c);
    }
    return { website: found.site, contacts, pagesRead: pages.size, log };
  } catch (e) {
    log.push(e instanceof Error ? e.message : String(e));
    return { website: null, contacts, pagesRead: 0, log };
  }
}

export type ContactsSummary = { jobsChecked: number; websitesFound: number; contactsFound: number; inserted: number; errors: string[] };

/** For active sourced jobs lacking contacts: find + upsert. Never throws. */
export async function runContacts(opts: { db: SupabaseClient; write: boolean; limit?: number; deadline?: number }): Promise<ContactsSummary> {
  const out: ContactsSummary = { jobsChecked: 0, websitesFound: 0, contactsFound: 0, inserted: 0, errors: [] };
  const db = opts.db;
  try {
    const { data: jobs, error } = await db
      .from('connect_sourced_jobs')
      .select('id, club_name, state, source_url, apply_url, apply_email, contact_name, role_level, first_seen_at')
      .eq('status', 'active')
      .order('first_seen_at', { ascending: false })
      .limit(300);
    if (error) throw new Error(error.message);
    const ids = (jobs || []).map((j) => j.id);
    const have = new Set<string>();
    for (let i = 0; i < ids.length; i += 100) {
      const { data } = await db.from('connect_club_contacts').select('sourced_job_id').in('sourced_job_id', ids.slice(i, i + 100));
      for (const c of data || []) if (c.sourced_job_id) have.add(c.sourced_job_id);
    }
    const rank = (r: string | null) => (r === 'director' ? 0 : r === 'head_pro' ? 1 : 2);
    const todo = (jobs || []).filter((j) => !have.has(j.id) && j.club_name).sort((a, b) => rank(a.role_level) - rank(b.role_level)).slice(0, opts.limit ?? 10);

    for (const job of todo) {
      if (opts.deadline && Date.now() > opts.deadline) break;
      out.jobsChecked++;
      const r = await findContactsForJob(job as JobForContacts);
      if (r.website) out.websitesFound++;
      out.contactsFound += r.contacts.length;
      if (!opts.write) continue;
      for (const c of r.contacts) {
        const row = {
          sourced_job_id: job.id, club_name: job.club_name, club_website: r.website, name: c.name, role: c.role,
          title: c.title, email: c.email, phone: c.phone, source_url: c.source_url, confidence: 'found',
        };
        if (c.email) {
          const { error: e } = await db.from('connect_club_contacts').upsert(row, { onConflict: 'club_name,email' });
          if (e) out.errors.push(`${job.club_name}: ${e.message}`);
          else out.inserted++;
        } else {
          const { data: dup } = await db.from('connect_club_contacts').select('id')
            .eq('club_name', job.club_name).eq('role', c.role).eq('name', c.name ?? '').limit(1);
          if (dup?.length) continue;
          const { error: e } = await db.from('connect_club_contacts').insert(row);
          if (e) out.errors.push(`${job.club_name}: ${e.message}`);
          else out.inserted++;
        }
      }
    }
  } catch (e) {
    out.errors.push(e instanceof Error ? e.message : String(e));
  }
  return out;
}
