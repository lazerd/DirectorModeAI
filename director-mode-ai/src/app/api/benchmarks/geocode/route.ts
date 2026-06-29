import { NextResponse } from 'next/server';
import { zipToLatLng, normalizeZip } from '@/lib/geo';

// ZIP -> [lat, lng] lookup (US ZIP centroids). The centroid table is kept
// server-side (in @/lib/geo) so the ~900KB JSON never ships in the client
// bundle; the benchmarks page calls this to resolve the GM's chosen
// "within X miles of ZIP" origin point.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const zip = normalizeZip(searchParams.get('zip'));
  const c = zipToLatLng(zip);
  if (!c) return NextResponse.json({ found: false }, { status: 404 });
  return NextResponse.json({ found: true, zip, lat: c.lat, lng: c.lng });
}
