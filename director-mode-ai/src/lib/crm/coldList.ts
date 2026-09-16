/**
 * The cold list: 519 clubs, and never one endless scroll.
 *
 * Searching, filtering, sorting and paging all happen here, in one pure
 * function over rows the server already sent. That is a deliberate choice over
 * a query per keystroke: 519 trimmed rows are about 60KB, they arrive once
 * with the page, and typing three letters then filters them in under a
 * millisecond with no spinner and no race between two in-flight requests. At
 * five thousand clubs this becomes a server query; at five hundred it would be
 * a worse experience for more code.
 *
 * Tested in coldList.test.ts.
 */

import type { ColdRow } from './types';
import type { Stage } from './stages';

export const PAGE_SIZE = 50;

export type ColdSort = 'name' | 'contacts' | 'touched';

export interface ColdFilters {
  /** Matches the club name, and any contact's name or email. */
  q: string;
  /** '' for any. */
  region: string;
  /** 'any' | 'yes' | 'no' — does anyone at this club have a name on file? */
  hasContact: 'any' | 'yes' | 'no';
  /** '' for any. */
  stage: Stage | '';
  sort: ColdSort;
  /** Zero-based. */
  page: number;
}

export const DEFAULT_FILTERS: ColdFilters = {
  q: '',
  region: '',
  hasContact: 'any',
  stage: '',
  sort: 'name',
  page: 0,
};

/**
 * Accept only a shape we recognise.
 *
 * The filters are remembered in localStorage, which is a string a browser
 * extension, a stale deploy or a rep's own devtools can have written anything
 * into. Anything unexpected falls back to the default for that one field
 * rather than throwing the whole saved view away — a bad `sort` should not
 * cost someone their region filter.
 */
export function coerceFilters(raw: unknown): ColdFilters {
  const o = (raw ?? {}) as Record<string, unknown>;
  const sort = o.sort;
  const has = o.hasContact;
  const page = Number(o.page);
  return {
    q: typeof o.q === 'string' ? o.q.slice(0, 120) : '',
    region: typeof o.region === 'string' ? o.region.slice(0, 40) : '',
    hasContact: has === 'yes' || has === 'no' ? has : 'any',
    stage: typeof o.stage === 'string' ? (o.stage as Stage) : '',
    sort: sort === 'contacts' || sort === 'touched' ? sort : 'name',
    page: Number.isFinite(page) && page > 0 ? Math.floor(page) : 0,
  };
}

export interface ColdPage {
  /** The rows on this page. */
  rows: ColdRow[];
  /** How many matched the filters, before paging. */
  total: number;
  /** Zero-based, clamped into range — a filter change resets a page 7 to 0. */
  page: number;
  pageCount: number;
  /** Every id that matched, so "select all" means all of them, not this page. */
  matchedIds: string[];
}

export function filterCold(rows: ColdRow[], f: ColdFilters): ColdPage {
  const q = f.q.trim().toLowerCase();
  const terms = q ? q.split(/\s+/).filter(Boolean) : [];

  const matched = rows.filter((r) => {
    if (f.region && (r.region ?? '') !== f.region) return false;
    if (f.hasContact === 'yes' && r.contact_count === 0) return false;
    if (f.hasContact === 'no' && r.contact_count > 0) return false;
    if (f.stage && r.stage !== f.stage) return false;
    if (!terms.length) return true;
    // Every word has to appear somewhere — "walnut creek" should not match a
    // club called Walnut Hills in a different state.
    const hay = `${r.name} ${r.state ?? ''} ${r.region ?? ''} ${r.contact_names}`.toLowerCase();
    return terms.every((t) => hay.includes(t));
  });

  const sorted = [...matched].sort((a, b) => {
    if (f.sort === 'contacts') {
      // Most contacts first — that is the useful end of that sort, because a
      // club with four names on it is a club you can write to today.
      if (a.contact_count !== b.contact_count) return b.contact_count - a.contact_count;
      return a.name.localeCompare(b.name);
    }
    if (f.sort === 'touched') {
      // Most recently touched first; never-touched last, by name.
      const at = a.last_activity_at ?? '';
      const bt = b.last_activity_at ?? '';
      if (at !== bt) return bt.localeCompare(at);
      return a.name.localeCompare(b.name);
    }
    return a.name.localeCompare(b.name);
  });

  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const page = Math.min(Math.max(0, f.page), pageCount - 1);
  return {
    rows: sorted.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE),
    total: sorted.length,
    page,
    pageCount,
    matchedIds: sorted.map((r) => r.id),
  };
}

/** "519 clubs" / "1 club" / "No clubs match that." */
export function coldSummary(total: number, all: number): string {
  if (total === 0) return 'No clubs match that.';
  if (total === all) return `${all.toLocaleString('en-US')} clubs`;
  return `${total.toLocaleString('en-US')} of ${all.toLocaleString('en-US')} clubs`;
}
