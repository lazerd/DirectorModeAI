import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { zipToLatLng, normalizeZip } from '@/lib/geo';
import { milesBetween } from '@/lib/geo';

// GET — anonymous market snapshot for the /connect landing page. Returns
// aggregate counts + comp bands by department, with PII fully stripped. Never
// exposes any individual candidate. Optional ?zip=&radius= narrows to a
// geographic area ("23 directors open to work within 50mi of you").
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const zip = normalizeZip(searchParams.get('zip'));
  const radius = Number(searchParams.get('radius')) || 0;
  const origin = zip ? zipToLatLng(zip) : null;

  const svc = await createServiceClient();
  const { data: candidates } = await svc
    .from('connect_candidates')
    .select('dept, current_comp, home_lat, home_lng')
    .eq('open_to_work', true);

  const { count: openOpenings } = await svc
    .from('connect_openings')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'open');

  let rows = candidates || [];
  if (origin && radius > 0) {
    rows = rows.filter(
      (c) =>
        c.home_lat != null &&
        c.home_lng != null &&
        milesBetween(origin.lat, origin.lng, c.home_lat, c.home_lng) <= radius
    );
  }

  const byDept: Record<string, { count: number; median_comp: number | null }> = {};
  for (const dept of ['Tennis/Racquets', 'Golf', 'GM']) {
    const comps = rows
      .filter((c) => c.dept === dept)
      .map((c) => c.current_comp)
      .filter((n): n is number => Number.isFinite(n))
      .sort((a, b) => a - b);
    byDept[dept] = {
      count: comps.length,
      median_comp: comps.length ? comps[Math.floor(comps.length / 2)] : null,
    };
  }

  return NextResponse.json({
    total_candidates: rows.length,
    open_openings: openOpenings ?? 0,
    by_dept: byDept,
    scoped: !!(origin && radius > 0),
    zip: origin ? zip : null,
    radius: origin && radius > 0 ? radius : null,
  });
}
