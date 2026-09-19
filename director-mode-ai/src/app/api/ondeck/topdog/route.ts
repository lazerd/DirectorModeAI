import { NextRequest, NextResponse } from 'next/server';
import { parseSchedule, scheduleUrl } from '@/lib/ondeck/topdog';

export const dynamic = 'force-dynamic';

/**
 * Read a TopDog tournament's order of play.
 *
 * TopDog publishes this page to anyone — no login, no token — so there is
 * nothing to authorise here. It is proxied rather than fetched from the
 * browser for one reason: TopDog sends no CORS headers, so the desk page
 * cannot read it directly the way it can read Serve Tennis.
 *
 * The host is fixed in the library, and the tournament id is digits only,
 * so this cannot be pointed at anything but Sleepy Hollow's TopDog site.
 */

/** TopDog is a classic-ASP site; it can be slow, but it is never slow for long. */
const TIMEOUT_MS = 15_000;

export async function GET(request: NextRequest) {
  const tournamentId = (request.nextUrl.searchParams.get('tournamentId') ?? '').trim();
  const date = (request.nextUrl.searchParams.get('date') ?? '').trim();

  if (!/^\d{1,10}$/.test(tournamentId)) {
    return NextResponse.json({ error: 'bad_tournament_id' }, { status: 400 });
  }
  if (date && !/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(date)) {
    return NextResponse.json({ error: 'bad_date' }, { status: 400 });
  }

  const url = scheduleUrl(tournamentId, date || undefined);

  let html: string;
  try {
    const res = await fetch(url, {
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        // Plain-browser headers: the page renders differently for what it
        // thinks is a bot, and we want exactly what Darrin sees.
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        accept: 'text/html,application/xhtml+xml',
      },
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: 'topdog_error', status: res.status },
        { status: 502, headers: { 'cache-control': 'no-store' } }
      );
    }
    html = await res.text();
  } catch (e) {
    const message = e instanceof Error ? e.message : 'fetch failed';
    return NextResponse.json({ error: 'unreachable', message }, { status: 502 });
  }

  const schedule = parseSchedule(html, tournamentId);

  // An empty sheet is almost always a wrong tournament id rather than a day
  // with no tennis on it, and it is worth saying so on screen.
  return NextResponse.json(
    { ...schedule, sourceUrl: url, fetchedAt: new Date().toISOString() },
    { headers: { 'cache-control': 'no-store' } }
  );
}
