import { NextResponse } from 'next/server';
import { zipToLatLng, normalizeZip } from '@/lib/geo';
import { findClubOpportunities } from '@/lib/benchmarks/clubOpportunities';

// POST /api/benchmarks/club-openings — for a director, nearby clubs whose size
// supports paying more than they earn now. Public data, capped, no auth.
const DEPTS = new Set(['Tennis/Racquets', 'Golf', 'GM']);

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));

  const dept = String(body.dept || '');
  if (!DEPTS.has(dept)) return NextResponse.json({ error: 'invalid dept' }, { status: 400 });

  const currentComp = Number(body.current_comp);
  if (!Number.isFinite(currentComp) || currentComp <= 0) {
    return NextResponse.json({ error: 'current_comp required' }, { status: 400 });
  }

  const zip = normalizeZip(body.zip);
  const origin = zipToLatLng(zip);
  const radiusRaw = Number(body.radius);
  const radiusMiles = Number.isFinite(radiusRaw) && radiusRaw > 0 ? Math.min(radiusRaw, 500) : 150;

  const clubs = findClubOpportunities({
    dept,
    currentComp,
    lat: origin?.lat ?? null,
    lng: origin?.lng ?? null,
    radiusMiles,
    limit: 15,
  });

  return NextResponse.json({ geocoded: !!origin, radiusMiles, clubs });
}
