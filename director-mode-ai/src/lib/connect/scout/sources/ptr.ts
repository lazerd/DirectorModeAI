/**
 * PTR Career Services job bulletin — https://ptrtennis.org/job_bulletin
 * The site is a single-page app; the bulletin is served by its own public
 * JSON endpoints (/api/content/job-listings, /api/content/submitted-jobs/:id),
 * the same calls the page makes. robots.txt: "Allow: /".
 */
import { politeGet } from '../http';
import { looksLikeRacquetsRole, toIsoDate } from '../text';
import type { ListItem, SourceAdapter } from '../types';

const BASE = 'https://ptrtennis.org';

type PtrListing = {
  id: number; title?: string; organization?: string; city?: string; state?: string;
  deadline?: string; bulletinUrl?: string; description?: string; startDate?: string;
};

export const ptr: SourceAdapter = {
  id: 'ptr',
  label: 'PTR Job Bulletin',
  homeUrl: `${BASE}/job_bulletin`,
  cap: 30,
  async list() {
    const errors: string[] = [];
    const r = await politeGet(`${BASE}/api/content/job-listings`, 'application/json');
    if (!r.ok) return { items: [], errors: [`job-listings: ${r.error}`] };
    let rows: PtrListing[] = [];
    try {
      const j = JSON.parse(r.body);
      rows = Array.isArray(j) ? j : [];
    } catch {
      return { items: [], errors: ['job-listings: bad JSON'] };
    }
    const items: ListItem[] = [];
    for (const row of rows.slice(0, this.cap)) {
      if (!row?.id || !row.title || !looksLikeRacquetsRole(row.title)) continue;
      // Detail carries the description we read (never store).
      let text: string | null = null;
      const d = await politeGet(`${BASE}/api/content/submitted-jobs/${row.id}`, 'application/json');
      if (d.ok) {
        try {
          text = (JSON.parse(d.body) as PtrListing).description ?? null;
        } catch {
          /* fall through with row facts only */
        }
      } else errors.push(`submitted-jobs/${row.id}: ${d.error}`);
      items.push({
        source: 'ptr',
        url: `${BASE}${row.bulletinUrl || `/job_bulletin/submission-${row.id}`}`,
        externalId: String(row.id),
        title: row.title.trim(),
        club: row.organization?.trim() || null,
        location: [row.city?.trim(), row.state?.trim()].filter(Boolean).join(', ') || null,
        deadline: toIsoDate(row.deadline),
        text,
      });
    }
    return { items, errors };
  },
};
