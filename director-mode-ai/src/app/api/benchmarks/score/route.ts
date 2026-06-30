import { NextResponse } from 'next/server';
import rawData from '@/app/benchmarks/_data/benchmarks.json';
import { zipToLatLng } from '@/lib/geo';
import { computeScore, type ScoreRow } from '@/lib/benchmarks/score';

// POST /api/benchmarks/score — "Know Your Number". Computed server-side so the
// 1.4MB dataset never ships to the client and the raw rows stay protected; the
// caller only gets aggregates + a short comparables list (public 990 facts).
const DATA = rawData as ScoreRow[];
const DEPTS = new Set(['Tennis/Racquets', 'Golf', 'GM']);

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const dept = String(body.dept || '');
  if (!DEPTS.has(dept)) return NextResponse.json({ error: 'invalid dept' }, { status: 400 });
  const currentComp = Number(body.currentComp);
  if (!Number.isFinite(currentComp) || currentComp <= 0) {
    return NextResponse.json({ error: 'currentComp required' }, { status: 400 });
  }

  const origin = body.zip ? zipToLatLng(String(body.zip)) : null;
  const revenue = Number.isFinite(Number(body.revenue)) && Number(body.revenue) > 0 ? Number(body.revenue) : null;

  const result = computeScore(DATA, { dept, currentComp, origin, revenue });
  return NextResponse.json(result);
}
