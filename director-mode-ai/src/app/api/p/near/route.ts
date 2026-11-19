import { NextResponse, type NextRequest } from 'next/server';
import { isSport, nearGames } from '@/lib/play/near';

/** GET /api/p/near?lat=&lng=&radius=15&sport=tennis&level=3.5 (no lat/lng: the visitor's IP area). */
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  let lat = Number(p.get('lat')), lng = Number(p.get('lng'));
  let source: 'device' | 'ip' | 'none' = 'device';
  if (!p.get('lat') || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    lat = Number(req.headers.get('x-vercel-ip-latitude')); lng = Number(req.headers.get('x-vercel-ip-longitude'));
    source = Number.isFinite(lat) && Number.isFinite(lng) && (lat || lng) ? 'ip' : 'none';
  }
  const city = req.headers.get('x-vercel-ip-city');
  const label = source === 'ip' && city ? decodeURIComponent(city) : null;
  if (source === 'none') return NextResponse.json({ origin: null, games: [] });
  const sport = isSport(p.get('sport')) ? (p.get('sport') as 'tennis') : null;
  const level = p.get('level') ? Number(p.get('level')) : null;
  const games = await nearGames({ lat, lng, radius: Number(p.get('radius')) || 15, sport, level: Number.isFinite(level) ? level : null });
  return NextResponse.json({ origin: { lat, lng, source, label }, games }, { headers: { 'cache-control': 'no-store' } });
}
