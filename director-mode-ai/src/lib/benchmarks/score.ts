import { milesBetween } from '@/lib/geo';

// "Know Your Number" comp scoring. Pure + server-side: takes the 990 rows and a
// director's inputs, returns where they sit in the market. Shared by the
// /benchmarks/score wedge and (later) the board-facing Comp Advisor.

export type ScoreRow = {
  club: string; dept: string; title: string; name: string;
  total: number; revenue: number; pct: number | null; year: string;
  state: string; region: string; recent: boolean;
  lat?: number | null; lng?: number | null;
};

export type ScoreInput = {
  dept: string;
  currentComp: number;
  origin?: { lat: number; lng: number } | null;
  revenue?: number | null;
  radiusMiles?: number;
};

export type Comparable = {
  club: string; title: string; total: number; year: string;
  pct: number | null; distanceMiles: number | null;
};

export type ScoreResult = {
  dept: string;
  currentComp: number;
  n: number;
  percentile: number;            // 0–100, where currentComp lands nationally (recent filings)
  median: number;
  avg: number;
  p25: number; p75: number; p90: number;
  max: number;
  gapToMedian: number;           // median - currentComp (negative => above market)
  gapToP75: number;              // p75 - currentComp (an aspirational target)
  medianPct: number | null;      // dept's median comp as % of club revenue
  expectedByRevenue: number | null; // revenue * medianPct, if revenue supplied
  local: { n: number; median: number; radiusMiles: number } | null;
  comparables: Comparable[];
  verdict: 'underpaid' | 'market' | 'above';
};

function pctile(sortedAsc: number[], p: number): number {
  if (!sortedAsc.length) return 0;
  const i = Math.min(sortedAsc.length - 1, Math.floor((p / 100) * sortedAsc.length));
  return sortedAsc[i];
}
const median = (a: number[]) => (a.length ? a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)] : 0);

export function computeScore(rows: ScoreRow[], input: ScoreInput): ScoreResult {
  const { dept, currentComp } = input;
  const radius = input.radiusMiles ?? 250;

  // National cohort: same department, most-recent filing per club.
  const cohort = rows.filter((r) => r.dept === dept && r.recent && r.total > 0);
  const totals = cohort.map((r) => r.total).sort((a, b) => a - b);
  const n = totals.length;

  const med = pctile(totals, 50);
  const p25 = pctile(totals, 25);
  const p75 = pctile(totals, 75);
  const p90 = pctile(totals, 90);
  const max = totals.length ? totals[totals.length - 1] : 0;
  const avg = totals.length ? Math.round(totals.reduce((a, b) => a + b, 0) / totals.length) : 0;
  const below = totals.filter((t) => t <= currentComp).length;
  const percentile = n ? Math.round((below / n) * 100) : 0;

  const pcts = cohort.map((r) => r.pct).filter((x): x is number => x != null && x > 0);
  const medianPct = pcts.length ? median(pcts) : null;
  const expectedByRevenue = input.revenue && medianPct ? Math.round(input.revenue * medianPct) : null;

  // Local cohort + comparables when a ZIP origin is supplied.
  let local: ScoreResult['local'] = null;
  let comparables: Comparable[] = [];
  if (input.origin) {
    const withDist = cohort
      .filter((r) => r.lat != null && r.lng != null)
      .map((r) => ({ r, d: milesBetween(input.origin!.lat, input.origin!.lng, r.lat!, r.lng!) }))
      .filter((x) => x.d <= radius)
      .sort((a, b) => a.d - b.d);
    if (withDist.length >= 5) {
      const lt = withDist.map((x) => x.r.total).sort((a, b) => a - b);
      local = { n: withDist.length, median: pctile(lt, 50), radiusMiles: radius };
    }
    comparables = withDist.slice(0, 8).map(({ r, d }) => ({
      club: r.club, title: r.title, total: r.total, year: r.year, pct: r.pct,
      distanceMiles: Math.round(d),
    }));
  }
  // Fallback comparables: clubs whose comp is closest to theirs (peers).
  if (comparables.length === 0) {
    comparables = cohort
      .slice()
      .sort((a, b) => Math.abs(a.total - currentComp) - Math.abs(b.total - currentComp))
      .slice(0, 8)
      .map((r) => ({ club: r.club, title: r.title, total: r.total, year: r.year, pct: r.pct, distanceMiles: null }));
  }

  const gapToMedian = med - currentComp;
  const verdict: ScoreResult['verdict'] = currentComp < p25 ? 'underpaid' : currentComp > p75 ? 'above' : 'market';

  return {
    dept, currentComp, n, percentile,
    median: med, avg, p25, p75, p90, max,
    gapToMedian, gapToP75: p75 - currentComp,
    medianPct, expectedByRevenue, local, comparables, verdict,
  };
}
