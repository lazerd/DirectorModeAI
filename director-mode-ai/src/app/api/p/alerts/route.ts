import { NextResponse } from 'next/server';
import { isSport, subscribeAlert } from '@/lib/play/near';

/** POST { email, sport, level, lat, lng, radius, label } → "tell me when a game near me needs one". */
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (!isSport(b.sport)) return NextResponse.json({ error: 'Pick a sport.' }, { status: 400 });
  const ok = await subscribeAlert({
    email: String(b.email ?? ''), sport: b.sport, level: b.level == null || b.level === '' ? null : Number(b.level),
    lat: Number(b.lat), lng: Number(b.lng), radius: Number(b.radius) || 10, label: typeof b.label === 'string' ? b.label : null,
  });
  if (!ok) return NextResponse.json({ error: 'That email doesn’t look right.' }, { status: 400 });
  return NextResponse.json({ ok: true });
}
