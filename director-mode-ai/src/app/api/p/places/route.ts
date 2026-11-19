import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

/**
 * Place suggestions for the /play location field.
 *
 *  1. Places other games already used ("Heather Farm Park" again, spelled the
 *     same way), so a court's games and its crown page stay together.
 *  2. OpenStreetMap search (Photon, free, no key), biased toward where the
 *     visitor is (Vercel's IP geo headers, no permission prompt).
 *
 * GET /api/p/places?q=heather
 */
export const maxDuration = 10;

export interface PlaceHit { name: string; address: string | null; lat: number | null; lng: number | null; source: 'used' | 'map'; games?: number }

type Feature = {
  properties: { name?: string; street?: string; housenumber?: string; city?: string; town?: string; village?: string; district?: string; state?: string; postcode?: string; countrycode?: string; osm_key?: string; osm_value?: string };
  geometry: { coordinates: [number, number] };
};

const SPORTY = /tennis|pickle|padel|racquet|racket|sport|court|club|park|recreation|athletic|country club|school|college|ymca|community/i;
const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get('q') ?? '').trim().slice(0, 80);
  if (q.length < 2) return NextResponse.json({ places: [] });
  const lat = Number(req.headers.get('x-vercel-ip-latitude')), lng = Number(req.headers.get('x-vercel-ip-longitude'));
  const near = Number.isFinite(lat) && Number.isFinite(lng) && (lat || lng) ? { lat, lng } : null;

  const [used, map] = await Promise.all([usedPlaces(q).catch(() => []), mapPlaces(q, near).catch(() => [])]);
  const seen = new Set(used.map((p) => key(p.name)));
  const places = [...used, ...map.filter((p) => !seen.has(key(p.name)))].slice(0, 7);
  return NextResponse.json({ places }, { headers: { 'cache-control': 'private, max-age=300' } });
}

async function usedPlaces(q: string): Promise<PlaceHit[]> {
  const like = `%${q.replace(/[%_\\]/g, '')}%`;
  const { data } = await getSupabaseAdmin().from('play_events')
    .select('location, place_address, place_lat, place_lng')
    .ilike('location', like).order('updated_at', { ascending: false }).limit(300);
  const by = new Map<string, PlaceHit>();
  for (const r of (data ?? []) as { location: string; place_address: string | null; place_lat: number | null; place_lng: number | null }[]) {
    const k = key(r.location);
    const have = by.get(k);
    if (have) { have.games = (have.games ?? 1) + 1; if (have.lat == null && r.place_lat != null) Object.assign(have, { address: r.place_address, lat: r.place_lat, lng: r.place_lng }); continue; }
    by.set(k, { name: r.location, address: r.place_address, lat: r.place_lat, lng: r.place_lng, source: 'used', games: 1 });
  }
  return [...by.values()].sort((a, b) => (b.games ?? 0) - (a.games ?? 0)).slice(0, 3);
}

async function mapPlaces(q: string, near: { lat: number; lng: number } | null): Promise<PlaceHit[]> {
  const u = new URL('https://photon.komoot.io/api/');
  u.searchParams.set('q', q); u.searchParams.set('limit', '10'); u.searchParams.set('lang', 'en');
  if (near) { u.searchParams.set('lat', String(near.lat)); u.searchParams.set('lon', String(near.lng)); }
  const ctl = AbortSignal.timeout(4000);
  const r = await fetch(u, { signal: ctl, headers: { 'user-agent': 'play-place-search/1.0' }, next: { revalidate: 86400 } });
  if (!r.ok) return [];
  const j = (await r.json()) as { features?: Feature[] };
  const hits = (j.features ?? []).map((f): PlaceHit & { score: number } => {
    const p = f.properties;
    const town = p.city ?? p.town ?? p.village ?? p.district;
    const street = [p.housenumber, p.street].filter(Boolean).join(' ');
    // OSM often names a court just "Tennis": call it by its street instead.
    const generic = !!p.name && /^(tennis|pickleball|padel|tennis courts?|pickleball courts?|courts?)$/i.test(p.name.trim());
    const name = generic ? `${/court/i.test(p.name!) ? p.name : `${p.name} courts`}${street || p.street ? `, ${p.street ?? street}` : town ? `, ${town}` : ''}` : p.name || street || town || q;
    const address = [p.name ? street : '', town, p.state, p.countrycode && p.countrycode !== 'US' ? p.countrycode : ''].filter(Boolean).join(', ') || null;
    const sporty = SPORTY.test(`${p.name ?? ''} ${p.osm_key ?? ''} ${p.osm_value ?? ''}`) ? 1 : 0;
    return { name, address, lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], source: 'map', score: sporty };
  });
  // Keep the map's order, but float courts, parks and clubs up.
  return hits.map((h, i) => ({ h, i })).sort((a, b) => b.h.score - a.h.score || a.i - b.i).slice(0, 5).map(({ h: { score: _s, ...rest } }) => rest);
}
