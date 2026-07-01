import rawData from '@/app/benchmarks/_data/benchmarks.json';
import { milesBetween } from '@/lib/geo';

// Warm-start recruiting: instead of only matching directors who've opted into
// ClubMode Recruiting (a cold pool at launch), surface real leaders straight
// from the public 990 comp dataset who fit an opening's pay band + location.
// Pure + data-only (no DB, no I/O) so it's easy to test.

type Raw = {
  club: string; ein: string; state: string; region: string; dept: string;
  title: string; name: string; total: number; revenue?: number; pct?: number | null;
  year: string; url?: string; recent?: boolean;
  zip?: string | null; lat?: number | null; lng?: number | null;
};
const DATA = rawData as Raw[];

export type Prospect = {
  name: string;
  ein: string;
  club: string;
  state: string;
  title: string;
  dept: string;
  comp: number;
  year: string;
  url: string | null;
  distanceMiles: number | null;
  // Relationship of their current pay to the offered band:
  //   raise    — they earn at/below the band floor (a bump → most likely to move)
  //   in_band  — their pay sits inside the band (a lateral)
  //   stretch  — slightly above the band top (would take a small cut)
  fit: 'raise' | 'in_band' | 'stretch';
  // Underpaid for their own club's size (comp well below the median at
  // similarly-sized clubs in their role) → the most recruitable prospects.
  likelyToMove: boolean;
  sizeExpected: number | null; // median comp at similar-size clubs for this role
};

export type BandInsight = {
  bandMin: number | null;
  bandMax: number;
  sampleSize: number;         // recent filings for this role (national)
  regionSample: number;       // recent filings for this role in the region
  median: number | null;
  p25: number | null;
  p75: number | null;
  p90: number | null;
  verdict: 'strong' | 'competitive' | 'below';
  headline: string;
  detail: string;
  prospectCount: number;      // affordable, in-radius directors found
};

const FIT_RANK: Record<Prospect['fit'], number> = { raise: 0, in_band: 1, stretch: 2 };
const usd = (n: number) => `$${Math.round(n).toLocaleString()}`;

function percentile(sortedAsc: number[], p: number): number | null {
  if (sortedAsc.length === 0) return null;
  const i = Math.min(sortedAsc.length - 1, Math.floor((p / 100) * sortedAsc.length));
  return sortedAsc[i];
}

// One row per real person (an individual can appear across several tax years).
// Keep their most recent filing.
function latestPerPerson(dept: string): Raw[] {
  const byPerson = new Map<string, Raw>();
  for (const r of DATA) {
    if (r.dept !== dept || !r.name || !(r.total > 0)) continue;
    // Normalize the name — the 990 data mixes casing across years
    // ("Peter Benko" vs "PETER BENKO"), which otherwise leaks duplicate people.
    const key = `${r.ein}|${r.name.toLowerCase().replace(/\s+/g, ' ').trim()}`;
    const prev = byPerson.get(key);
    if (!prev || Number(r.year) > Number(prev.year)) byPerson.set(key, r);
  }
  return [...byPerson.values()];
}

export function findProspects(opts: {
  dept: string;
  lat: number | null;
  lng: number | null;
  compMin: number | null;
  compMax: number;
  radiusMiles: number;
  limit?: number;
}): Prospect[] {
  const { dept, lat, lng, compMin, compMax, radiusMiles } = opts;
  const hasOrigin = lat != null && lng != null;
  const floor = compMin ?? compMax; // at/below the floor is a clear raise

  // Same-role recent filings with a revenue figure — used to judge whether a
  // prospect is underpaid for the size of club they run.
  const deptRevRows = DATA.filter(
    (r) => r.dept === dept && r.recent && r.total > 0 && (r.revenue ?? 0) > 0
  );
  const sizeExpectedFor = (revenue: number): number | null => {
    const band = deptRevRows.filter((r) => r.revenue! >= revenue * 0.5 && r.revenue! <= revenue * 2);
    if (band.length < 5) return null;
    const totals = band.map((r) => r.total).sort((a, b) => a - b);
    return totals[Math.floor(totals.length / 2)];
  };

  const out: Prospect[] = [];
  for (const r of latestPerPerson(dept)) {
    let distance: number | null = null;
    if (hasOrigin) {
      if (r.lat == null || r.lng == null) continue; // can't place them → skip
      distance = milesBetween(lat!, lng!, r.lat, r.lng);
      if (distance > radiusMiles) continue;
    }

    const comp = r.total;
    let fit: Prospect['fit'];
    if (comp <= floor) fit = 'raise';
    else if (comp <= compMax) fit = 'in_band';
    else if (comp <= compMax * 1.15) fit = 'stretch';
    else continue; // out of budget

    const sizeExpected = (r.revenue ?? 0) > 0 ? sizeExpectedFor(r.revenue!) : null;
    const likelyToMove = sizeExpected != null && comp < sizeExpected * 0.85;

    out.push({
      name: r.name,
      ein: r.ein,
      club: r.club,
      state: r.state,
      title: r.title,
      dept: r.dept,
      comp,
      year: r.year,
      url: r.url ?? null,
      distanceMiles: distance != null ? Math.round(distance) : null,
      fit,
      likelyToMove,
      sizeExpected,
    });
  }

  // Nearest first (recruiting is local), then best fit, then most senior.
  out.sort((a, b) => {
    const da = a.distanceMiles ?? Number.POSITIVE_INFINITY;
    const db = b.distanceMiles ?? Number.POSITIVE_INFINITY;
    if (da !== db) return da - db;
    if (FIT_RANK[a.fit] !== FIT_RANK[b.fit]) return FIT_RANK[a.fit] - FIT_RANK[b.fit];
    return b.comp - a.comp;
  });

  return out.slice(0, opts.limit ?? 40);
}

export function bandInsight(opts: {
  dept: string;
  region: string | null;
  compMin: number | null;
  compMax: number;
  prospectCount: number;
}): BandInsight {
  const { dept, region, compMin, compMax, prospectCount } = opts;

  const recent = DATA.filter((r) => r.dept === dept && r.recent && r.total > 0);
  const totals = recent.map((r) => r.total).sort((a, b) => a - b);
  const median = percentile(totals, 50);
  const p25 = percentile(totals, 25);
  const p75 = percentile(totals, 75);
  const p90 = percentile(totals, 90);
  const regionSample = region ? recent.filter((r) => r.region === region).length : 0;

  let verdict: BandInsight['verdict'];
  let headline: string;
  let detail: string;

  if (median == null) {
    verdict = 'competitive';
    headline = 'Not enough public data for this role';
    detail = 'We couldn’t find enough recent filings to benchmark this band, but you can still save the opening.';
  } else if (compMax >= (p75 ?? median)) {
    verdict = 'strong';
    headline = 'Top-of-market band';
    detail = `Your ceiling of ${usd(compMax)} lands in the top quartile — the market median for this role is ${usd(median)}, and the top 25% earn ${usd(p75 ?? median)}+. You’ll attract experienced, in-demand directors.`;
  } else if (compMax >= median) {
    verdict = 'competitive';
    headline = 'Competitive band';
    detail = `Your ceiling of ${usd(compMax)} is at or above the market median of ${usd(median)}. Solid — you’ll draw qualified candidates, though the top quartile (${usd(p75 ?? median)}+) will look elsewhere.`;
  } else {
    verdict = 'below';
    headline = 'Below market';
    detail = `Your ceiling of ${usd(compMax)} is under the market median of ${usd(median)} for this role. You can still hire, but expect a smaller field — raising the top of your band toward ${usd(median)} widens it considerably.`;
  }

  return {
    bandMin: compMin,
    bandMax: compMax,
    sampleSize: recent.length,
    regionSample,
    median,
    p25,
    p75,
    p90,
    verdict,
    headline,
    detail,
    prospectCount,
  };
}
