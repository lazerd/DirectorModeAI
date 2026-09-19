/**
 * A TopDog tournament's public match schedule, for one day, as JSON.
 *   GET ?t=<tournament id>&host=<club>.topdoglive.com&date=9/19/2026
 *
 * Reads the same no-login page parents see (courtschedule.asp); nothing is
 * written to TopDog. `host` is limited to *.topdoglive.com so this can't be
 * pointed anywhere else. Without `date`, TopDog picks the day.
 */
import { NextResponse } from 'next/server';
import { parseCourtSchedule } from '@/lib/topdog/courtSchedule';

export const dynamic = 'force-dynamic';

const DEFAULT_HOST = 'sleepyhollowswimtennis.topdoglive.com';

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const t = q.get('t') || '';
  const host = (q.get('host') || DEFAULT_HOST).toLowerCase();
  const date = q.get('date') || '';

  if (!/^\d{1,7}$/.test(t)) {
    return NextResponse.json({ error: 'Pass the TopDog tournament number as ?t=' }, { status: 400 });
  }
  if (!/^[a-z0-9-]+\.topdoglive\.com$/.test(host)) {
    return NextResponse.json({ error: 'That is not a TopDog site.' }, { status: 400 });
  }
  if (date && !/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(date)) {
    return NextResponse.json({ error: 'Date must look like 9/19/2026.' }, { status: 400 });
  }

  const url = `https://${host}/pages/tournaments/courtschedule.asp`;
  const headers = { 'User-Agent': 'Mozilla/5.0 (ClubMode announcer)' };
  let res: Response;
  try {
    res = date
      ? await fetch(url, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ tournamentid: t, currentdate: date }).toString(),
          cache: 'no-store',
        })
      : await fetch(`${url}?tournamentid=${t}`, { headers, cache: 'no-store' });
  } catch {
    return NextResponse.json({ error: 'TopDog did not answer. Try again in a minute.' }, { status: 502 });
  }
  if (!res.ok) {
    return NextResponse.json({ error: `TopDog answered ${res.status}.` }, { status: 502 });
  }

  const schedule = parseCourtSchedule(await res.text());
  return NextResponse.json(
    { ...schedule, source: `${url}?tournamentid=${t}`, fetchedAt: new Date().toISOString() },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
