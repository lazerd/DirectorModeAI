import { milesBetween } from '@/lib/geo';
import type { ScoreRow } from '@/lib/benchmarks/score';

// Club Comp Advisor (board-facing). Given a club's revenue + region + the role
// it's filling, recommend a defensible comp band — and crucially it works for
// ANY club, including the tens of thousands NOT in the 990 data, via a
// log-linear model of comp vs ln(revenue) fit per department.

export type AdvisorInput = {
  dept: string;
  revenue: number;
  region?: string | null;
  state?: string | null;
  origin?: { lat: number; lng: number } | null;
  currentComp?: number | null;   // what the club pays today (optional sanity check)
};

export type AdvisorResult = {
  dept: string;
  revenue: number;
  low: number; mid: number; high: number;  // recommended band (p25 / median / p75-style)
  method: 'model' | 'cohort';               // regression vs empirical fallback
  n: number;                                 // sample behind the fit
  pctOfRevenue: number;                      // mid / revenue
  deptMedianPct: number | null;              // typical comp as % of revenue for the dept
  regionAdjusted: boolean;
  cohortMedian: number | null;               // empirical median at similar-size clubs (cross-check)
  cohortN: number;
  currentVerdict: 'below' | 'in' | 'above' | null;
  comparables: { club: string; title: string; total: number; revenue: number; pct: number | null; state: string; distanceMiles: number | null }[];
};

const quantile = (sortedAsc: number[], q: number) => {
  if (!sortedAsc.length) return 0;
  const i = Math.min(sortedAsc.length - 1, Math.max(0, Math.floor(q * sortedAsc.length)));
  return sortedAsc[i];
};
const median = (a: number[]) => quantile(a.slice().sort((x, y) => x - y), 0.5);

export function computeAdvisor(rows: ScoreRow[], input: AdvisorInput): AdvisorResult {
  const { dept, revenue } = input;
  const cohort = rows.filter((r) => r.dept === dept && r.recent && r.total > 0 && r.revenue > 0);

  const deptPcts = cohort.map((r) => r.pct).filter((x): x is number => x != null && x > 0).sort((a, b) => a - b);
  const deptMedianPct = deptPcts.length ? median(deptPcts) : null;

  // --- Log-linear OLS: total = a + b * ln(revenue) ---
  let low = 0, mid = 0, high = 0, method: 'model' | 'cohort' = 'cohort', n = cohort.length, regionAdjusted = false;
  const lnRev = Math.log(revenue);

  if (cohort.length >= 15) {
    const xs = cohort.map((r) => Math.log(r.revenue));
    const ys = cohort.map((r) => r.total);
    const N = xs.length;
    const sx = xs.reduce((a, b) => a + b, 0), sy = ys.reduce((a, b) => a + b, 0);
    const sxx = xs.reduce((a, b) => a + b * b, 0), sxy = xs.reduce((a, b, i) => a + b * ys[i], 0);
    const denom = N * sxx - sx * sx;
    const b = denom !== 0 ? (N * sxy - sx * sy) / denom : 0;
    const a = (sy - b * sx) / N;
    const resid = ys.map((y, i) => y - (a + b * xs[i]));

    // Region shift: how this region's roles sit vs the national fit.
    let shift = 0;
    if (input.region) {
      const rr = cohort.map((r, i) => ({ region: r.region, e: resid[i] })).filter((o) => o.region === input.region).map((o) => o.e);
      if (rr.length >= 8) { shift = median(rr); regionAdjusted = true; }
    }

    const pred = a + b * lnRev + shift;
    const rsort = resid.slice().sort((x, y) => x - y);
    mid = Math.round(pred);
    low = Math.round(pred + quantile(rsort, 0.25));
    high = Math.round(pred + quantile(rsort, 0.75));
    method = 'model';
  }

  // --- Empirical cross-check / fallback: similar-size clubs (0.5x–2x revenue) ---
  let band = cohort.filter((r) => r.revenue >= revenue * 0.5 && r.revenue <= revenue * 2);
  if (input.region) {
    const regional = band.filter((r) => r.region === input.region);
    if (regional.length >= 8) band = regional;
  }
  const bandTotals = band.map((r) => r.total).sort((a, b) => a - b);
  const cohortMedian = bandTotals.length ? median(bandTotals) : null;

  if (method === 'cohort') {
    // Regression not viable — use the empirical band directly.
    low = bandTotals.length ? quantile(bandTotals, 0.25) : 0;
    mid = cohortMedian ?? 0;
    high = bandTotals.length ? quantile(bandTotals, 0.75) : 0;
    n = band.length;
  }

  low = Math.max(0, low); mid = Math.max(0, mid); high = Math.max(low, high);

  // Comparables: similar-size clubs, nearest first if we have an origin.
  let comps = band.slice();
  let withDist: { r: ScoreRow; d: number | null }[];
  if (input.origin) {
    withDist = comps.filter((r) => r.lat != null && r.lng != null)
      .map((r) => ({ r, d: milesBetween(input.origin!.lat, input.origin!.lng, r.lat!, r.lng!) }))
      .sort((a, b) => (a.d as number) - (b.d as number));
  } else {
    withDist = comps
      .sort((a, b) => Math.abs(a.revenue - revenue) - Math.abs(b.revenue - revenue))
      .map((r) => ({ r, d: null }));
  }
  const comparables = withDist.slice(0, 8).map(({ r, d }) => ({
    club: r.club, title: r.title, total: r.total, revenue: r.revenue, pct: r.pct, state: r.state,
    distanceMiles: d == null ? null : Math.round(d),
  }));

  const currentVerdict = input.currentComp && input.currentComp > 0
    ? (input.currentComp < low ? 'below' : input.currentComp > high ? 'above' : 'in')
    : null;

  return {
    dept, revenue, low, mid, high, method, n,
    pctOfRevenue: revenue ? mid / revenue : 0,
    deptMedianPct, regionAdjusted,
    cohortMedian, cohortN: band.length,
    currentVerdict, comparables,
  };
}
