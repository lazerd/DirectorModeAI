import { NextResponse } from 'next/server';
import { zipToLatLng, normalizeZip } from '@/lib/geo';
import { findProspects, bandInsight } from '@/lib/connect/prospects';

// POST /api/connect/prospects — warm-start candidate suggestions for a club
// opening, pulled straight from the public 990 dataset (no opt-in required),
// plus a read on how competitive the pay band is. Public data, so no auth; the
// result is capped so it can't be used to dump the dataset.
const DEPTS = new Set(['Tennis/Racquets', 'Golf', 'GM']);
const REGIONS = new Set(['Northeast', 'South', 'Midwest', 'West']);

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));

  const dept = String(body.dept || '');
  if (!DEPTS.has(dept)) {
    return NextResponse.json({ error: 'invalid dept' }, { status: 400 });
  }

  const compMax = Number(body.comp_max);
  if (!Number.isFinite(compMax) || compMax <= 0) {
    return NextResponse.json({ error: 'comp_max required' }, { status: 400 });
  }
  const compMinRaw = Number(body.comp_min);
  const compMin = Number.isFinite(compMinRaw) && compMinRaw > 0 ? compMinRaw : null;

  const zip = normalizeZip(body.zip);
  const origin = zipToLatLng(zip);
  const region = REGIONS.has(String(body.region)) ? String(body.region) : null;
  const radiusRaw = Number(body.radius);
  const radiusMiles = Number.isFinite(radiusRaw) && radiusRaw > 0 ? Math.min(radiusRaw, 500) : 150;

  const prospects = findProspects({
    dept,
    lat: origin?.lat ?? null,
    lng: origin?.lng ?? null,
    compMin,
    compMax,
    radiusMiles,
    limit: 40,
  });

  const insight = bandInsight({ dept, region, compMin, compMax, prospectCount: prospects.length });

  return NextResponse.json({
    geocoded: !!origin,
    zip: zip || null,
    radiusMiles,
    insight,
    prospects,
  });
}
