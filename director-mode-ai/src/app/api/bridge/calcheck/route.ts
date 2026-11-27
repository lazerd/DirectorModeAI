import { NextResponse } from 'next/server';
import { readDayEvents } from '@/lib/lessons/dayEvents';

/* Health check for the text staff's calendar read (club PC / bridge secret only): how many
 * events the director's connected Google Calendar shows on a date. No titles leave. */
export async function GET(req: Request) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.BRIDGE_SECRET}`) return NextResponse.json({ error: 'auth' }, { status: 401 });
  const u = new URL(req.url);
  const r = await readDayEvents(u.searchParams.get('user') ?? '', u.searchParams.get('date') ?? '');
  return NextResponse.json(r.ok ? { ok: true, count: r.events.length, times: r.events.map((e) => e.start) } : r);
}
