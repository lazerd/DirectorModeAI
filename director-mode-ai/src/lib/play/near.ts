import 'server-only';
import { randomBytes } from 'crypto';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { levelFits, LEVEL_SCALE, type LevelSport } from './levels';
import type { Sport } from './core';

/**
 * "Games near me" and "tell me when a game near me needs one".
 * Only games the host listed, with a pinned place, that still need players.
 */
export const miles = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const R = 3958.8, r = (d: number) => (d * Math.PI) / 180;
  const x = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
};
const box = (p: { lat: number; lng: number }, mi: number) => {
  const dLat = mi / 69, dLng = mi / (69 * Math.max(0.2, Math.cos((p.lat * Math.PI) / 180)));
  return { lat0: p.lat - dLat, lat1: p.lat + dLat, lng0: p.lng - dLng, lng1: p.lng + dLng };
};
export const isSport = (v: unknown): v is Sport => v === 'tennis' || v === 'pickleball' || v === 'padel';

export interface NearGame {
  code: string; title: string; sport: Sport; format: string; starts_at: string | null; when_text: string | null;
  location: string | null; place_address: string | null; lat: number; lng: number; miles: number;
  level: string | null; level_min: number | null; level_max: number | null; fits: boolean;
  /** null = no cap (all welcome). */
  spots: number | null; in: number; open: number; host: string | null; status: string;
}

export async function nearGames(o: { lat: number; lng: number; radius: number; sport?: Sport | null; level?: number | null; days?: number }): Promise<NearGame[]> {
  const radius = Math.min(60, Math.max(1, o.radius));
  const b = box(o, radius);
  const now = Date.now();
  let q = getSupabaseAdmin().from('play_events')
    .select('id, code, title, sport, format, starts_at, when_text, location, place_address, place_lat, place_lng, level, level_min, level_max, spots, host_name, status')
    .eq('listed', true).eq('status', 'open')
    .gte('place_lat', b.lat0).lte('place_lat', b.lat1).gte('place_lng', b.lng0).lte('place_lng', b.lng1)
    .gte('starts_at', new Date(now - 2 * 3600e3).toISOString()).lte('starts_at', new Date(now + (o.days ?? 21) * 864e5).toISOString())
    .order('starts_at').limit(200);
  if (o.sport) q = q.eq('sport', o.sport);
  const { data } = await q;
  const rows = (data ?? []) as Record<string, unknown>[];
  if (!rows.length) return [];
  const { data: rs } = await getSupabaseAdmin().from('play_rsvps').select('event_id, status').in('event_id', rows.map((r) => r.id as string)).eq('status', 'in');
  const count = new Map<string, number>();
  for (const r of rs ?? []) count.set(r.event_id, (count.get(r.event_id) ?? 0) + 1);
  return rows.map((r): NearGame => {
    const lat = Number(r.place_lat), lng = Number(r.place_lng);
    const n = count.get(r.id as string) ?? 0, spots = r.spots == null ? null : Number(r.spots);
    const range = { min: r.level_min == null ? null : Number(r.level_min), max: r.level_max == null ? null : Number(r.level_max) };
    return {
      code: r.code as string, title: r.title as string, sport: r.sport as Sport, format: r.format as string,
      starts_at: r.starts_at as string | null, when_text: r.when_text as string | null,
      location: r.location as string | null, place_address: r.place_address as string | null, lat, lng,
      miles: Math.round(miles(o, { lat, lng }) * 10) / 10,
      level: r.level as string | null, level_min: range.min, level_max: range.max,
      fits: levelFits(range, o.level ?? null, r.sport as string),
      spots, in: n, open: spots == null ? 99 : Math.max(0, spots - n), host: r.host_name as string | null, status: r.status as string,
    };
  }).filter((g) => g.miles <= radius && g.open > 0);
}

/* ---------- alerts ---------- */
const okEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) && e.length <= 200;

export async function subscribeAlert(a: { email: string; sport: Sport; level: number | null; lat: number; lng: number; radius: number; label?: string | null }): Promise<boolean> {
  const email = a.email.trim().toLowerCase();
  if (!okEmail(email) || !isSport(a.sport) || !Number.isFinite(a.lat) || !Number.isFinite(a.lng)) return false;
  const sc = LEVEL_SCALE[a.sport as LevelSport];
  const level = a.level != null && Number.isFinite(a.level) && a.level >= sc.min && a.level <= sc.max ? a.level : null;
  const db = getSupabaseAdmin();
  const row = { email, sport: a.sport, level, lat: a.lat, lng: a.lng, radius_mi: Math.min(50, Math.max(1, a.radius || 10)), place_label: a.label?.slice(0, 80) ?? null };
  const { data: have } = await db.from('play_alerts').select('id').ilike('email', email).eq('sport', a.sport).maybeSingle();
  if (have) await db.from('play_alerts').update(row).eq('id', have.id);
  else await db.from('play_alerts').insert({ ...row, token: randomBytes(18).toString('base64url') });
  return true;
}

export async function unsubscribeAlert(token: string): Promise<{ email: string; sport: string } | null> {
  if (!/^[A-Za-z0-9_-]{10,40}$/.test(token)) return null;
  const db = getSupabaseAdmin();
  const { data } = await db.from('play_alerts').select('id, email, sport').eq('token', token).maybeSingle();
  if (!data) return null;
  await db.from('play_alerts').delete().eq('id', data.id);
  return { email: data.email, sport: data.sport };
}
