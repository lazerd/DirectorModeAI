/**
 * Request guards for the public check-in routes: rate limits, input clamps,
 * the optional geofence, and "who is signed in, if anyone".
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { metresBetween, type PlayType } from './engine';
import { hashDevice, type Player, type SettingsRow } from './server';

/*
 * Per-instance buckets, like the court booking route. On serverless each warm
 * instance has its own map, so this is a speed bump for a phone hammering the
 * button or a script walking tokens, not a wall. The unguessable tokens are
 * the wall.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

function limited(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    if (buckets.size > 5000) for (const [k, v] of buckets) if (v.resetAt < now) buckets.delete(k);
    return false;
  }
  b.count += 1;
  return b.count > max;
}

export function clientIp(req: Request): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0].trim() || req.headers.get('x-real-ip') || 'unknown';
}

/** The random id the phone keeps in localStorage. Only its hash is stored. */
export function deviceHash(req: Request): string | null {
  const raw = req.headers.get('x-checkin-device');
  return raw && /^[a-zA-Z0-9-]{8,64}$/.test(raw) ? hashDevice(raw) : null;
}

/** Writes: 12 a minute per IP and per device. Reads (polling): 60 a minute. */
export function rateLimit(req: Request, kind: 'write' | 'read'): NextResponse | null {
  const max = kind === 'write' ? 12 : 60;
  const ip = clientIp(req);
  const dev = deviceHash(req);
  // The IP ceiling is loose on purpose: a whole clubhouse on one Wi-Fi shares an IP.
  const hit = limited(`${kind}:ip:${ip}`, kind === 'write' ? max * 3 : max * 10, 60_000) || (dev ? limited(`${kind}:dev:${dev}`, max, 60_000) : false);
  return hit
    ? NextResponse.json({ error: 'Too many taps. Wait a moment and try again.' }, { status: 429 })
    : null;
}

export const clamp = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.replace(/\s+/g, ' ').trim();
  return t.length === 0 ? null : t.slice(0, max);
};

export const looksLikeEmail = (s: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);

export function parsePlayType(v: unknown): PlayType | null {
  return v === 'singles' || v === 'doubles' || v === 'other' ? v : null;
}

export function parseNames(v: unknown, max = 8): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((n) => clamp(n, 60)).filter((n): n is string => !!n).slice(0, max);
}

export function parseEmail(v: unknown): { email: string | null; error: string | null } {
  const raw = clamp(v, 200);
  if (!raw) return { email: null, error: null };
  return looksLikeEmail(raw) ? { email: raw.toLowerCase(), error: null } : { email: null, error: 'That email address does not look right.' };
}

/** Null when the check passes (or the club has not turned it on). */
export function geofenceError(settings: SettingsRow, body: Record<string, unknown>): string | null {
  if (!settings.geofence_enabled || settings.latitude === null || settings.longitude === null) return null;
  const lat = Number(body.lat);
  const lng = Number(body.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return 'This club asks you to be at the courts to check in. Allow location and try again.';
  }
  const d = metresBetween(lat, lng, settings.latitude, settings.longitude);
  return d > settings.geofence_meters ? 'You need to be at the club to check in.' : null;
}

/**
 * The signed-in person, if any, and whether they belong to this club. Used to
 * link a player to their member record — never to decide who may play.
 */
export async function signedInPlayer(clubId: string): Promise<{ userId: string; name: string | null; member: boolean } | null> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;
    const admin = getSupabaseAdmin();
    const [{ data: profile }, { data: membership }, { data: owned }] = await Promise.all([
      admin.from('profiles').select('full_name').eq('id', user.id).maybeSingle(),
      admin.from('cc_club_members').select('role').eq('club_id', clubId).eq('user_id', user.id).maybeSingle(),
      admin.from('cc_clubs').select('id').eq('id', clubId).eq('owner_id', user.id).maybeSingle(),
    ]);
    const meta = (user.user_metadata ?? {}) as { full_name?: string; name?: string };
    const name = (profile as { full_name?: string | null } | null)?.full_name || meta.full_name || meta.name || null;
    return { userId: user.id, name, member: !!membership || !!owned };
  } catch {
    return null;
  }
}

/** Attach the signed-in member to the first player, when the phone says that is them. */
export function playersFrom(names: string[], me: { userId: string; member: boolean } | null, firstIsMe: boolean): Player[] {
  return names.map((name, i) => (i === 0 && firstIsMe && me?.member ? { name, user_id: me.userId } : { name }));
}
