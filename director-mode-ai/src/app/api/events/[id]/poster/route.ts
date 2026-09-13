/**
 * GET /api/events/[id]/poster — the event's sign-up poster, as a PDF.
 *
 * What the Download button on the Share tab produces. A bare QR PNG is not
 * something you pin up: somebody walking past the pro shop needs to know what
 * the event is and when, or the square on the wall is just a square.
 *
 * Themed from events.display_theme — the same column that dresses the TV
 * console — so the poster outside the room and the screen inside it match
 * without being set up twice.
 *
 * Staff only. The poster is public information once printed, but generating it
 * reads the event record, and the club's own events are not a public index.
 */

import { NextResponse } from 'next/server';
import QRCode from 'qrcode';
import { requireStaffForClub } from '@/lib/courtsheet/routeAuth';
import { displayTheme } from '@/lib/events/displayTheme';
import { buildEventPoster } from '@/lib/events/posterPdf';

export const dynamic = 'force-dynamic';

/** The club's own wall-clock day and time, never the server's. */
function whenLine(
  eventDate: string | null,
  startTime: string | null,
  endTime: string | null,
  timeZone: string,
): string | null {
  if (!eventDate) return null;
  const day = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(new Date(`${eventDate.slice(0, 10)}T12:00:00Z`));

  const clock = (t: string | null) => {
    if (!t) return null;
    const [h, m] = t.split(':').map((n) => parseInt(n, 10));
    if (Number.isNaN(h)) return null;
    const suffix = h >= 12 ? 'pm' : 'am';
    const hour = h % 12 === 0 ? 12 : h % 12;
    return m ? `${hour}:${String(m).padStart(2, '0')}${suffix}` : `${hour}${suffix}`;
  };

  const from = clock(startTime);
  const to = clock(endTime);
  if (from && to) return `${day} · ${from}–${to}`;
  if (from) return `${day} · ${from}`;
  return day;
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireStaffForClub();
  if ('error' in ctx) return ctx.error;

  const { data: event } = await ctx.db
    .from('events')
    .select('id, name, event_code, event_date, start_time, end_time, venue, display_theme, logo_url, club_id, user_id')
    .eq('id', id)
    .maybeSingle();

  if (!event) return NextResponse.json({ error: 'No such event.' }, { status: 404 });

  const e = event as {
    name: string;
    event_code: string | null;
    event_date: string | null;
    start_time: string | null;
    end_time: string | null;
    venue: string | null;
    display_theme: string | null;
    logo_url: string | null;
    club_id: string | null;
    user_id: string | null;
  };

  // Reachable only from the club it belongs to, or by its creator — the same
  // boundary the event's own pages enforce.
  const mine = e.club_id === ctx.club.id || e.user_id === ctx.user.id;
  if (!mine) return NextResponse.json({ error: 'Not your event.' }, { status: 403 });

  if (!e.event_code) {
    return NextResponse.json(
      { error: 'This event has no code yet, so there is nothing to scan.' },
      { status: 400 },
    );
  }

  const origin = new URL(req.url).origin;
  const publicUrl = `${origin}/event/${e.event_code}`;

  /*
   * Maximum error correction, and a wide quiet zone.
   *
   * This is printed and pinned to a wall where it gets creased, sun-faded and
   * thumbed. 'H' survives about 30% of the code being damaged, which costs a
   * denser image and is worth it on paper in a way it would not be on screen.
   */
  const qrPng = await QRCode.toBuffer(publicUrl, {
    type: 'png',
    width: 900, // well above the 300pt it is drawn at, so print stays crisp
    margin: 2,
    errorCorrectionLevel: 'H',
    color: { dark: '#000000', light: '#ffffff' },
  });

  // The club's mark, where it set one. Fetched best-effort: a slow or dead
  // image URL must not cost the club its poster.
  let logo: { bytes: Uint8Array; type: 'png' | 'jpg' } | null = null;
  if (e.logo_url) {
    try {
      const res = await fetch(e.logo_url, { signal: AbortSignal.timeout(4000) });
      if (res.ok) {
        const type = (res.headers.get('content-type') || '').includes('jpeg') ? 'jpg' : 'png';
        logo = { bytes: new Uint8Array(await res.arrayBuffer()), type };
      }
    } catch {
      /* no logo on the poster, everything else still prints */
    }
  }

  const pdf = await buildEventPoster({
    eventName: e.name,
    whenLine: whenLine(e.event_date, e.start_time, e.end_time, ctx.club.timezone || 'America/Los_Angeles'),
    venue: e.venue || ctx.club.name,
    eventCode: e.event_code,
    publicUrl,
    qrPng: new Uint8Array(qrPng),
    theme: displayTheme(e.display_theme),
    logo,
  });

  const safeName = e.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${safeName || 'event'}-poster.pdf"`,
      'Cache-Control': 'no-store',
    },
  });
}
