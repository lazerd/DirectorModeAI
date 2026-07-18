import type { DomainPack } from '../framework';
import rawData from '@/app/benchmarks/_data/benchmarks.json';
import type { ScoreRow } from '@/lib/benchmarks/score';
import { zipToLatLng, milesBetween, normalizeZip } from '@/lib/geo';
import { computeAdvisor } from '@/lib/benchmarks/advisor';

// Benchmarks pack — conversational access to the compensation dataset that
// powers /benchmarks (IRS Form 990 comp data). Both tools are pure reads over
// the same bundled JSON the page uses, so they have no side effects and need no
// confirmation. Available to any signed-in user, so comp questions work from
// anywhere in the app, not just the benchmarks page.

type Row = ScoreRow & { zip?: string | null };
const DATA = rawData as Row[];

const DEPT_LABEL: Record<string, string> = {
  'Tennis/Racquets': 'Director of Tennis / Racquets',
  Golf: 'Director of Golf',
  GM: 'General Manager / COO',
};
const REGIONS = ['Northeast', 'South', 'Midwest', 'West'];

// Map a free-text position to a canonical dept key, or null for "any".
function normDept(input: unknown): string | null {
  const s = String(input ?? '').trim().toLowerCase();
  if (!s || s === 'all' || s === 'any') return null;
  if (s.includes('gm') || s.includes('general manager') || s.includes('coo')) return 'GM';
  if (s.includes('golf')) return 'Golf';
  if (s.includes('tennis') || s.includes('racquet') || s.includes('racket')) return 'Tennis/Racquets';
  return null;
}

function quantile(sortedAsc: number[], q: number): number {
  if (!sortedAsc.length) return 0;
  const pos = (sortedAsc.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sortedAsc[lo];
  return Math.round(sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (pos - lo));
}

const SEARCH_TOOL = {
  name: 'search_candidates',
  description:
    "Search the compensation benchmark dataset (real IRS Form 990 filings) for club racquet/golf/GM leaders. " +
    "Filter by position, state, region, pay range, and distance from a ZIP. Returns matching people with their " +
    "club, title, total comp, club revenue, and comp-as-%-of-revenue, plus summary stats (count, median, average, " +
    "25th/75th percentile) for the whole filtered set. Use this to answer questions like " +
    "\"top GMs within 50 miles of 10514\" or \"tennis directors in Texas earning over $200k\".",
  input_schema: {
    type: 'object' as const,
    properties: {
      position: { type: 'string', description: 'One of: "GM", "Golf", "Tennis/Racquets", or omit for any position.' },
      state: { type: 'string', description: 'Two-letter state code, e.g. "TX". Omit for all states.' },
      region: { type: 'string', description: 'One of: Northeast, South, Midwest, West. Omit for all regions.' },
      min_comp: { type: 'number', description: 'Minimum total compensation in dollars.' },
      max_comp: { type: 'number', description: 'Maximum total compensation in dollars.' },
      zip: { type: 'string', description: '5-digit ZIP to measure distance from (pair with radius_miles).' },
      radius_miles: { type: 'number', description: 'Only include people within this many miles of zip.' },
      query: { type: 'string', description: 'Free text to match against club, person name, or title.' },
      recent_only: { type: 'boolean', description: 'If true, only the most recent filing per person/club.' },
      limit: { type: 'number', description: 'Max people to return (default 10, max 25).' },
    },
  },
};

const BAND_TOOL = {
  name: 'comp_band',
  description:
    "Recommend a defensible pay band (low / mid / high) for hiring a specific role at a club, from the club's " +
    "annual revenue and region, using a model fit on the benchmark dataset. Use for questions like " +
    "\"what should we pay a tennis director at a $4M club in the Northeast?\". Optionally compare a current salary " +
    "to the band. Returns the band, comp as % of revenue, an empirical cohort median cross-check, and, if a current " +
    "salary is given, whether it is below / in / above band.",
  input_schema: {
    type: 'object' as const,
    properties: {
      position: { type: 'string', description: 'Required. One of: "GM", "Golf", "Tennis/Racquets".' },
      revenue: { type: 'number', description: "Required. The club's annual revenue in dollars." },
      region: { type: 'string', description: 'Optional. Northeast, South, Midwest, or West — sharpens the estimate.' },
      zip: { type: 'string', description: 'Optional ZIP for a local cost adjustment.' },
      current_comp: { type: 'number', description: 'Optional current salary to compare against the band.' },
    },
  },
};

async function searchCandidates(input: any) {
  const dept = normDept(input.position);
  const state = input.state ? String(input.state).trim().toUpperCase() : null;
  const region = REGIONS.includes(String(input.region)) ? String(input.region) : null;
  const min = Number.isFinite(Number(input.min_comp)) ? Number(input.min_comp) : null;
  const max = Number.isFinite(Number(input.max_comp)) ? Number(input.max_comp) : null;
  const q = String(input.query ?? '').trim().toLowerCase();
  const recentOnly = input.recent_only === true;
  const limit = Math.max(1, Math.min(25, Number(input.limit) || 10));

  let origin: { lat: number; lng: number } | null = null;
  const radius = Number.isFinite(Number(input.radius_miles)) ? Number(input.radius_miles) : null;
  if (input.zip && radius) {
    const ll = zipToLatLng(normalizeZip(String(input.zip)));
    if (!ll) return { ok: false, error: `Couldn't locate ZIP "${input.zip}".` };
    origin = ll;
  }

  const matched: (Row & { _dist?: number })[] = [];
  for (const r of DATA) {
    if (dept && r.dept !== dept) continue;
    if (state && r.state !== state) continue;
    if (region && r.region !== region) continue;
    if (min != null && r.total < min) continue;
    if (max != null && r.total > max) continue;
    if (recentOnly && !r.recent) continue;
    if (q && !(`${r.club} ${r.name} ${r.title}`.toLowerCase().includes(q))) continue;
    if (origin && radius) {
      if (r.lat == null || r.lng == null) continue;
      const d = milesBetween(origin.lat, origin.lng, r.lat, r.lng);
      if (d > radius) continue;
      matched.push({ ...r, _dist: d });
    } else {
      matched.push(r);
    }
  }

  matched.sort((a, b) =>
    origin ? (a._dist ?? 0) - (b._dist ?? 0) : b.total - a.total
  );

  const totals = matched.map((r) => r.total).sort((a, b) => a - b);
  const summary = {
    count: matched.length,
    median: quantile(totals, 0.5),
    average: totals.length ? Math.round(totals.reduce((a, b) => a + b, 0) / totals.length) : 0,
    p25: quantile(totals, 0.25),
    p75: quantile(totals, 0.75),
  };

  const people = matched.slice(0, limit).map((r) => ({
    name: r.name,
    title: r.title,
    position: DEPT_LABEL[r.dept] ?? r.dept,
    club: r.club,
    state: r.state,
    region: r.region,
    total_comp: r.total,
    club_revenue: r.revenue,
    pct_of_revenue: r.pct,
    year: r.year,
    ...(r._dist != null ? { miles: Math.round(r._dist) } : {}),
  }));

  return { ok: true, summary, showing: people.length, people };
}

async function compBand(input: any) {
  const dept = normDept(input.position);
  if (!dept) return { ok: false, error: 'position must be one of GM, Golf, or Tennis/Racquets.' };
  const revenue = Number(input.revenue);
  if (!Number.isFinite(revenue) || revenue <= 0) return { ok: false, error: 'A positive club revenue is required.' };
  const region = REGIONS.includes(String(input.region)) ? String(input.region) : null;
  const origin = input.zip ? zipToLatLng(normalizeZip(String(input.zip))) : null;
  const currentComp = Number.isFinite(Number(input.current_comp)) && Number(input.current_comp) > 0
    ? Number(input.current_comp) : null;

  const result = computeAdvisor(DATA as ScoreRow[], { dept, revenue, region, origin, currentComp });
  return { ok: true, ...result, position: DEPT_LABEL[dept], revenue, region: region ?? 'national' };
}

export const benchmarksPack: DomainPack<Record<string, never>> = {
  domain: 'benchmarks',
  actionsPrompt: `You can look up real compensation data with your benchmark tools:
- search_candidates: find club GM/tennis/golf leaders by position, state, region, pay range, or distance from a ZIP, with summary pay stats.
- comp_band: recommend a defensible pay band for a role given a club's revenue and region.
When reporting figures, format dollars plainly (e.g. $196,737) and lead with the summary (count + median) before listing individuals. This data is public IRS Form 990 filings — say so if asked where it's from.`,
  // Always available to signed-in users; the dataset is global, not user-scoped.
  resolve: async () => ({}),
  tools: [
    { schema: SEARCH_TOOL, run: (input: any) => searchCandidates(input) },
    { schema: BAND_TOOL, run: (input: any) => compBand(input) },
  ],
};
