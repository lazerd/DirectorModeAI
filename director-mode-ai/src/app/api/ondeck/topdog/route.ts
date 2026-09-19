import { NextRequest, NextResponse } from 'next/server';
import { parseSchedule, scheduleUrl } from '@/lib/ondeck/topdog';
import { mergeResults, missingLiveMatches, parseResults, resultsUrl } from '@/lib/ondeck/topdogResults';

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

  // TopDog serves a bot page to anything that doesn't look like a browser,
  // so these headers are load-bearing, not decoration.
  const headers = {
    'user-agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    accept: 'text/html,application/xhtml+xml',
  };

  const get = (target: string) =>
    fetch(target, { cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS), headers });

  let html: string;
  // The results page is a bonus, not a requirement: if it fails the desk
  // still works, it just goes back to Darrin clearing courts by hand.
  let resultsHtml: string | null = null;
  try {
    const [scheduleRes, resultsRes] = await Promise.allSettled([
      get(url),
      get(resultsUrl(tournamentId)),
    ]);

    if (scheduleRes.status === 'rejected' || !scheduleRes.value.ok) {
      const status = scheduleRes.status === 'fulfilled' ? scheduleRes.value.status : 0;
      return NextResponse.json(
        { error: 'topdog_error', status },
        { status: 502, headers: { 'cache-control': 'no-store' } }
      );
    }
    html = await scheduleRes.value.text();

    if (resultsRes.status === 'fulfilled' && resultsRes.value.ok) {
      resultsHtml = await resultsRes.value.text();
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : 'fetch failed';
    return NextResponse.json({ error: 'unreachable', message }, { status: 502 });
  }

  const schedule = parseSchedule(html, tournamentId);
  const { divisions, results } = resultsHtml
    ? parseResults(resultsHtml)
    : { divisions: [], results: [] };

  // A match TopDog has a score for is finished, whatever the order of play
  // still shows — this is what lets the desk open a court by itself.
  const matches = mergeResults(schedule.matches, results);

  // The one thing that must never happen: a match TopDog still lists as
  // "Scheduled" missing from the desk. mergeResults is built so it can't;
  // this says so loudly in the logs and the response if it ever does.
  const missing = missingLiveMatches(matches, results);
  if (missing.length) {
    console.error('[ondeck/topdog] live matches hidden from the desk', missing);
  }

  return NextResponse.json(
    {
      ...schedule,
      matches,
      missingLive: missing,
      divisions,
      resultsAvailable: resultsHtml !== null,
      sourceUrl: url,
      fetchedAt: new Date().toISOString(),
    },
    { headers: { 'cache-control': 'no-store' } }
  );
}
