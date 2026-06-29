import { NextResponse } from 'next/server';
import centroids from '@/app/benchmarks/_data/zipcentroids.json';

// ZIP -> [lat, lng] lookup (US ZIP centroids). Kept server-side so the ~900KB
// table never ships in the client bundle; the benchmarks page calls this to
// resolve the GM's chosen "within X miles of ZIP" origin point.
const MAP = centroids as unknown as Record<string, [number, number]>;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const zip = (searchParams.get('zip') || '').replace(/\D/g, '').slice(0, 5);
  const c = MAP[zip];
  if (!c) return NextResponse.json({ found: false }, { status: 404 });
  return NextResponse.json({ found: true, zip, lat: c[0], lng: c[1] });
}
