/**
 * Hospitality Online — https://www.hospitalityonline.com (resort & club jobs).
 * robots.txt allows /jobs?what=… and /jobs/<id>-<slug> (it disallows only
 * apply/track/members paths and /jobs/*\/job_search). Its search only works
 * with one-word queries; we keep racquets titles and fetch each detail page.
 */
import { politeGet } from '../http';
import { decodeEntities, htmlToText, looksLikeRacquetsRole } from '../text';
import type { ListItem, SourceAdapter } from '../types';

const BASE = 'https://www.hospitalityonline.com';
const QUERIES = ['tennis', 'pickleball', 'racquets', 'padel'];

/** Pure: job links + their anchor text from a search results page. */
export function parseHoResults(html: string): { url: string; title: string }[] {
  const out = new Map<string, string>();
  for (const m of html.matchAll(/<a\b[^>]*href="(\/jobs\/(\d+)-[^"?#]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const title = decodeEntities(m[3].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    const url = `${BASE}${m[1]}`;
    if (!out.has(url) || (title && !out.get(url))) out.set(url, title);
  }
  return [...out].map(([url, title]) => ({
    url,
    // Fall back to the slug when the anchor wraps an image.
    title: title || decodeURIComponent(url.split('/').pop()!.replace(/^\d+-/, '').replace(/-/g, ' ')),
  }));
}

export const hospitalityonline: SourceAdapter = {
  id: 'hospitalityonline',
  label: 'Hospitality Online',
  homeUrl: `${BASE}/jobs?what=tennis`,
  cap: 15,
  async list() {
    const errors: string[] = [];
    const found = new Map<string, string>();
    for (const q of QUERIES) {
      const r = await politeGet(`${BASE}/jobs?what=${q}`);
      if (!r.ok) {
        // The site answers 404 when a search has no results.
        if (r.status !== 404) errors.push(`search ${q}: ${r.error}`);
        continue;
      }
      for (const j of parseHoResults(r.body)) if (looksLikeRacquetsRole(j.title)) found.set(j.url, j.title);
    }
    const items: ListItem[] = [];
    for (const [url, title] of [...found].slice(0, this.cap)) {
      const d = await politeGet(url);
      if (!d.ok) {
        errors.push(`${url}: ${d.error}`);
        continue;
      }
      items.push({
        source: 'hospitalityonline',
        url,
        externalId: url.match(/\/jobs\/(\d+)-/)?.[1] ?? null,
        title,
        text: htmlToText(d.body).slice(0, 15000),
      });
    }
    return { items, errors };
  },
};
