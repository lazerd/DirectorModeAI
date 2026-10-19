/**
 * /pulse — the Director Pulse campaign landing page, the other half of the
 * 10/16/26 split test with /mixermode. Outreach letter P links here.
 *
 * Every figure on this page is computed here, at build time, from the public
 * IRS 990 rows in benchmarks.json — the same rows /benchmarks/pulse uses for
 * its baseline. Nothing is typed in by hand, so the page can't drift from the
 * data or invent a number. Pulse's own self-reported answers are never shown
 * here: that pool is small, and it stays behind give-to-get.
 */
import rawData from '@/app/benchmarks/_data/benchmarks.json';
import type { BenchmarkRow } from '@/lib/benchmarks/aggregate';
import PulseLanding, { type LandingStats } from './PulseLanding';

const BINS = [
  { label: '<$150K', lo: 0, hi: 150_000 },
  { label: '$150–200K', lo: 150_000, hi: 200_000 },
  { label: '$200–250K', lo: 200_000, hi: 250_000 },
  { label: '$250–300K', lo: 250_000, hi: 300_000 },
  { label: '$300–400K', lo: 300_000, hi: 400_000 },
  { label: '$400K+', lo: 400_000, hi: Infinity },
];

const REGION_ORDER = ['Northeast', 'South', 'West', 'Midwest'];

function quantile(sorted: number[], p: number): number {
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

/** Rounded to the nearest $1K: precise enough to be real, not so precise it reads as one person. */
const k = (n: number) => Math.round(n / 1000) * 1000;

function buildStats(): LandingStats {
  const rows = (rawData as BenchmarkRow[]).filter((r) => r.recent && r.dept === 'Tennis/Racquets');
  const totals = rows.map((r) => Number(r.total)).filter((n) => n > 0).sort((a, b) => a - b);
  const years = rows.map((r) => Number(r.year)).filter(Boolean);

  const byRegion = new Map<string, number[]>();
  for (const r of rows) {
    if (!r.region) continue;
    const list = byRegion.get(r.region) ?? [];
    list.push(Number(r.total));
    byRegion.set(r.region, list);
  }

  return {
    n: totals.length,
    clubs: new Set(rows.map((r) => r.ein)).size,
    states: new Set(rows.map((r) => r.state).filter(Boolean)).size,
    yearFrom: Math.min(...years),
    yearTo: Math.max(...years),
    median: k(quantile(totals, 0.5)),
    p25: k(quantile(totals, 0.25)),
    p75: k(quantile(totals, 0.75)),
    p90: k(quantile(totals, 0.9)),
    over300: totals.filter((t) => t >= 300_000).length,
    over400: totals.filter((t) => t >= 400_000).length,
    bins: BINS.map((b) => ({ label: b.label, count: totals.filter((t) => t >= b.lo && t < b.hi).length })),
    regions: REGION_ORDER.filter((name) => byRegion.has(name)).map((name) => {
      const v = byRegion.get(name)!.sort((a, b) => a - b);
      return { name, n: v.length, median: k(quantile(v, 0.5)) };
    }),
  };
}

const stats = buildStats();

export default function PulseLandingPage() {
  return <PulseLanding stats={stats} />;
}
