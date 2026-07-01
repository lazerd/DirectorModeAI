import rawData from '@/app/benchmarks/_data/benchmarks.json';
import { milesBetween } from '@/lib/geo';

// Candidate magnet: for a director, find nearby clubs whose SIZE supports paying
// more than they earn today — the proof that motivates opting into Recruiting.
// Uses the same defensible similar-size-club expectation as the Comp Score
// (median comp at clubs with revenue within 0.5x–2x), not pct×revenue.

type Raw = {
  club: string; ein: string; state: string; region: string; dept: string;
  title: string; name: string; total: number; revenue?: number; year: string;
  url?: string; recent?: boolean; lat?: number | null; lng?: number | null;
};
const DATA = rawData as Raw[];

export type ClubOpportunity = {
  club: string;
  state: string;
  revenue: number;
  distanceMiles: number | null;
  sizeExpected: number;   // median comp at similar-size clubs for this role
  upside: number;         // sizeExpected - the director's current comp
  currentTopComp: number; // what this club's top person in the role earns now
  year: string;
  url: string | null;
};

export function findClubOpportunities(opts: {
  dept: string;
  currentComp: number;
  lat: number | null;
  lng: number | null;
  radiusMiles: number;
  limit?: number;
}): ClubOpportunity[] {
  const { dept, currentComp, lat, lng, radiusMiles } = opts;
  const hasOrigin = lat != null && lng != null;

  const deptRev = DATA.filter(
    (r) => r.dept === dept && r.recent && r.total > 0 && (r.revenue ?? 0) > 0
  );
  const sizeExpectedFor = (revenue: number): number | null => {
    const band = deptRev.filter((r) => r.revenue! >= revenue * 0.5 && r.revenue! <= revenue * 2);
    if (band.length < 5) return null;
    const t = band.map((r) => r.total).sort((a, b) => a - b);
    return t[Math.floor(t.length / 2)];
  };

  // One row per club (most recent filing with a revenue figure).
  const byClub = new Map<string, Raw>();
  for (const r of DATA) {
    if (r.dept !== dept || !(r.total > 0) || !((r.revenue ?? 0) > 0)) continue;
    const prev = byClub.get(r.ein);
    if (!prev || Number(r.year) > Number(prev.year)) byClub.set(r.ein, r);
  }

  const out: ClubOpportunity[] = [];
  for (const r of byClub.values()) {
    let distance: number | null = null;
    if (hasOrigin) {
      if (r.lat == null || r.lng == null) continue;
      distance = milesBetween(lat!, lng!, r.lat, r.lng);
      if (distance > radiusMiles) continue;
    }
    const se = sizeExpectedFor(r.revenue!);
    if (se == null) continue;
    if (se < currentComp * 1.1) continue; // needs meaningful upside (10%+)

    out.push({
      club: r.club,
      state: r.state,
      revenue: r.revenue!,
      distanceMiles: distance != null ? Math.round(distance) : null,
      sizeExpected: se,
      upside: se - currentComp,
      currentTopComp: r.total,
      year: r.year,
      url: r.url ?? null,
    });
  }

  // Nearest first (this is a "near you" list); ties broken by biggest upside.
  out.sort((a, b) => {
    const da = a.distanceMiles ?? Number.POSITIVE_INFINITY;
    const db = b.distanceMiles ?? Number.POSITIVE_INFINITY;
    if (da !== db) return da - db;
    return b.upside - a.upside;
  });

  return out.slice(0, opts.limit ?? 15);
}
