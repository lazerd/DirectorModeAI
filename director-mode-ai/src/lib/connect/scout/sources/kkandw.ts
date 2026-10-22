/**
 * Kopplin, Kuebler & Wallace (private-club executive search) — current openings.
 * https://kkandw.com/for-candidates/current-job-career-openings-golf-course-private-clubs/
 * robots.txt on kkandw.com allows everything (Crawl-delay: 60 — we make one
 * request per run). The page renders the first page of their search table
 * (title | category | club | location). Each row links to a detail page on
 * kkandw.my.salesforce-sites.com, whose robots.txt disallows all crawling, so
 * we never fetch it: rows are taken as list-only facts and we link humans to it.
 * Later table pages are behind an AJAX postback, so only page 1 (newest) is read.
 */
import { politeGet } from '../http';
import { decodeEntities, looksLikeRacquetsRole } from '../text';
import type { ListItem, SourceAdapter } from '../types';

const PAGE = 'https://kkandw.com/for-candidates/current-job-career-openings-golf-course-private-clubs/';
const DETAIL_BASE = 'https://kkandw.my.salesforce-sites.com';

const cell = (td: string) => decodeEntities(td.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

/** Pure: pull racquets rows out of the KK&W openings table HTML. */
export function parseKkwTable(html: string): ListItem[] {
  const out: ListItem[] = [];
  for (const m of html.matchAll(/<tr>\s*(<td class="atsSearchResultsData[\s\S]*?)<\/tr>/g)) {
    const tds = [...m[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map((x) => x[1]);
    if (tds.length < 4) continue;
    const href = tds[0].match(/href="([^"]+)"/)?.[1];
    const category = cell(tds[1]);
    const club = cell(tds[2]);
    const location = cell(tds[3]);
    // First column is "<Club> <Title>" — strip the club prefix for the title.
    let title = cell(tds[0]);
    if (club && title.toLowerCase().startsWith(club.toLowerCase())) title = title.slice(club.length).trim();
    if (!href || !title) continue;
    if (!looksLikeRacquetsRole(title) && !looksLikeRacquetsRole(category)) continue;
    const url = new URL(decodeEntities(href), DETAIL_BASE).toString();
    out.push({
      source: 'kkandw',
      url,
      externalId: url.match(/jobId=([A-Za-z0-9]+)/)?.[1] ?? null,
      title,
      club: club || null,
      location: location || null,
      listingOnly: true,
    });
  }
  return out;
}

export const kkandw: SourceAdapter = {
  id: 'kkandw',
  label: 'Kopplin, Kuebler & Wallace',
  homeUrl: PAGE,
  cap: 25,
  async list() {
    const r = await politeGet(PAGE);
    if (!r.ok) return { items: [], errors: [`openings page: ${r.error}`] };
    return { items: parseKkwTable(r.body).slice(0, this.cap), errors: [] };
  },
};
