import { NextResponse } from 'next/server';
import rawData from '@/app/benchmarks/_data/benchmarks.json';
import { zipToLatLng } from '@/lib/geo';
import { computeAdvisor } from '@/lib/benchmarks/advisor';
import type { ScoreRow } from '@/lib/benchmarks/score';

// POST /api/benchmarks/advisor — board-facing recommended comp band for a role,
// from club revenue + region. Computed server-side; works for any club via a
// log-linear comp-vs-ln(revenue) model fit per department.
const DATA = rawData as ScoreRow[];
const DEPTS = new Set(['Tennis/Racquets', 'Golf', 'GM']);
const REGIONS = new Set(['Northeast', 'South', 'Midwest', 'West']);

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const dept = String(body.dept || '');
  if (!DEPTS.has(dept)) return NextResponse.json({ error: 'invalid dept' }, { status: 400 });
  const revenue = Number(body.revenue);
  if (!Number.isFinite(revenue) || revenue <= 0) {
    return NextResponse.json({ error: 'revenue required' }, { status: 400 });
  }
  const region = REGIONS.has(String(body.region)) ? String(body.region) : null;
  const origin = body.zip ? zipToLatLng(String(body.zip)) : null;
  const currentComp = Number.isFinite(Number(body.currentComp)) && Number(body.currentComp) > 0 ? Number(body.currentComp) : null;

  const result = computeAdvisor(DATA, { dept, revenue, region, origin, currentComp });
  return NextResponse.json(result);
}
