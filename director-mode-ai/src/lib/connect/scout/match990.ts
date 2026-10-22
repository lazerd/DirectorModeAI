/**
 * Scout — Form 990 matching and comp estimation.
 *
 * Pure functions take the 990 rows as an argument (tested in match990.test.ts);
 * the `*FromDataset` wrappers bind them to benchmarks.json the same way
 * prospects.ts / clubOpportunities.ts load it. Server-only (the JSON is large).
 */
import rawData from '@/app/benchmarks/_data/benchmarks.json';
import { normalizeName } from './text';
import type { RoleLevel } from './types';

export type Row990 = {
  club: string; ein: string; state: string; region?: string; dept: string;
  title?: string; name?: string; total: number; revenue?: number; year?: string;
  recent?: boolean; zip?: string | null; lat?: number | null; lng?: number | null;
};

// Words every club name shares — they count for little when matching.
const GENERIC = new Set([
  'club', 'country', 'cc', 'golf', 'tennis', 'racquet', 'racquets', 'swim', 'swimming', 'athletic', 'association',
  'assn', 'yacht', 'beach', 'lake', 'hills', 'park', 'valley', 'river', 'creek', 'sports', 'sport', 'field',
  'center', 'society', 'members', 'hill', 'lake', 'creek', 'community', 'resort', 'gcc', 'cricket', 'hunt', 'riding', 'polo', 'casino',
]);

const ABBR: Record<string, string[]> = {
  cc: ['country', 'club'], gcc: ['golf', 'country', 'club'], gc: ['golf', 'club'], tc: ['tennis', 'club'],
  ac: ['athletic', 'club'], yc: ['yacht', 'club'], rc: ['racquet', 'club'], 'st': ['saint'], mt: ['mount'],
};

export function nameTokens(s: string): string[] {
  const out: string[] = [];
  for (const w of normalizeName(s).split(' ')) {
    if (!w) continue;
    if (ABBR[w]) out.push(...ABBR[w]);
    // Light singularization ("lakes" → "lake") that leaves tennis/paradise/campus alone.
    else out.push(GENERIC.has(w) || w.length <= 4 || /(ss|is|us)$/.test(w) ? w : w.replace(/s$/, ''));
  }
  return out;
}

/**
 * Similarity 0..1 of a posting's club name `a` to a 990 filer name `b`:
 * weighted Dice over tokens (generic words weigh 0.5). Every distinctive word
 * of the posting name must appear in the filer name ("Epping Forest Yacht
 * Club" is not "The Forest Country Club"); each extra distinctive word in the
 * filer name costs 0.08 ("Ridgewood CC" vs "Ridgewood CC of Paramus").
 */
export function clubNameScore(a: string, b: string): number {
  const ta = new Set(nameTokens(a));
  const tb = new Set(nameTokens(b));
  if (!ta.size || !tb.size) return 0;
  const w = (t: string) => (GENERIC.has(t) ? 0.5 : 1);
  const distinctA = [...ta].filter((t) => !GENERIC.has(t));
  const distinctB = [...tb].filter((t) => !GENERIC.has(t));
  if (!distinctA.length || distinctA.some((t) => !tb.has(t))) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared += w(t);
  const total = [...ta].reduce((s, t) => s + w(t), 0) + [...tb].reduce((s, t) => s + w(t), 0);
  const extra = distinctB.length - distinctA.length;
  return Math.max(0, (2 * shared) / total - 0.08 * extra);
}

export type ClubMatch = { ein: string; club: string; revenue: number | null; score: number; lat: number | null; lng: number | null; zip: string | null };

/** Best same-state 990 filer for a club name (score ≥ threshold), or null. */
export function matchClub990(rows: Row990[], clubName: string | null, state: string | null, threshold = 0.72): ClubMatch | null {
  if (!clubName || !state) return null;
  const st = state.toUpperCase();
  const byEin = new Map<string, Row990>();
  for (const r of rows) {
    if (r.state !== st) continue;
    const prev = byEin.get(r.ein);
    // Keep the filing with the latest year (revenue is per filing).
    if (!prev || Number(r.year || 0) > Number(prev.year || 0)) byEin.set(r.ein, r);
  }
  let best: ClubMatch | null = null;
  for (const r of byEin.values()) {
    const score = clubNameScore(clubName, r.club);
    if (score >= threshold && (!best || score > best.score)) {
      best = {
        ein: r.ein, club: r.club, revenue: r.revenue && r.revenue > 0 ? Math.round(r.revenue) : null, score,
        lat: r.lat ?? null, lng: r.lng ?? null, zip: r.zip ?? null,
      };
    }
  }
  return best;
}

const ROLE_FACTOR: Record<RoleLevel, number | null> = {
  // 990s only list highly paid staff (Schedule J), so peers are directors: estimate directors only.
  director: 1, gm: null, head_pro: null, assistant: null, other: null,
};

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};

/**
 * Estimated total comp for a racquets role when the posting gives none.
 * Peers = recent Tennis/Racquets 990 filings at clubs of similar revenue
 * (½×–2×, widening to ¼×–4× if fewer than 5); without a revenue, same-state
 * then national. 990s list only highly paid staff, so the peers are
 * directors: estimate directors only (head pros/assistants/GMs → null). Rounded to the nearest $1,000. Null when there's no basis.
 */
export function estimateComp(rows: Row990[], opts: { revenue: number | null; state: string | null; roleLevel: RoleLevel }): number | null {
  const factor = ROLE_FACTOR[opts.roleLevel];
  if (factor == null) return null;
  const pool = rows.filter((r) => r.dept === 'Tennis/Racquets' && r.recent !== false && r.total > 0);
  let peers: number[] = [];
  if (opts.revenue && opts.revenue > 0) {
    for (const [lo, hi] of [[0.5, 2], [0.25, 4]] as const) {
      peers = pool.filter((r) => (r.revenue ?? 0) >= opts.revenue! * lo && (r.revenue ?? 0) <= opts.revenue! * hi).map((r) => r.total);
      if (peers.length >= 5) break;
    }
  }
  if (peers.length < 5 && opts.state) peers = pool.filter((r) => r.state === opts.state!.toUpperCase()).map((r) => r.total);
  if (peers.length < 5) peers = pool.map((r) => r.total);
  const m = median(peers);
  if (m == null) return null;
  return Math.round((m * factor) / 1000) * 1000;
}

const DATA = rawData as unknown as Row990[];

export const matchClubFromDataset = (club: string | null, state: string | null) => matchClub990(DATA, club, state);
export const estimateCompFromDataset = (opts: { revenue: number | null; state: string | null; roleLevel: RoleLevel }) => estimateComp(DATA, opts);
