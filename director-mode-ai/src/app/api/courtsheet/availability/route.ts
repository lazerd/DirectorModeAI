import { NextResponse } from 'next/server';
import { requireStaffForClub } from '@/lib/courtsheet/routeAuth';
import { CourtSheetEngine } from '@/lib/courtsheet/engine';

export const dynamic = 'force-dynamic';

/**
 * GET /api/courtsheet/availability?start=YYYY-MM-DD&end=YYYY-MM-DD
 *   optional: &courts=1,2,3 &days=1,2,3,4,5
 *             &time_start=08:00 &time_end=20:00 &sport=tennis &min=30
 *
 * Returns open slots for the user's club. Used by the empty-state "what's
 * free?" affordance + by the AI query_availability tool.
 */
export async function GET(req: Request) {
  const ctx = await requireStaffForClub();
  if ('error' in ctx) return ctx.error;

  const url = new URL(req.url);
  const start = url.searchParams.get('start');
  const end = url.searchParams.get('end');
  if (!start || !end) {
    return NextResponse.json({ error: 'Missing start or end' }, { status: 400 });
  }

  const courtsParam = url.searchParams.get('courts');
  const daysParam = url.searchParams.get('days');
  const timeStart = url.searchParams.get('time_start');
  const timeEnd = url.searchParams.get('time_end');
  const sport = url.searchParams.get('sport') ?? undefined;
  const minMinutes = parseInt(url.searchParams.get('min') ?? '30', 10);

  const engine = await CourtSheetEngine.load({ db: ctx.db, club_id: ctx.club.id });
  const slots = await engine.availability({
    date_range: { start, end },
    courts: courtsParam
      ? courtsParam.split(',').map((s) => {
          const n = parseInt(s, 10);
          return Number.isNaN(n) ? s : n;
        })
      : undefined,
    days_of_week: daysParam
      ? (daysParam.split(',').map((s) => parseInt(s, 10) as 0 | 1 | 2 | 3 | 4 | 5 | 6))
      : undefined,
    time_range: timeStart && timeEnd ? { start: timeStart, end: timeEnd } : undefined,
    sport,
    min_minutes: Number.isNaN(minMinutes) ? 30 : minMinutes,
  });

  return NextResponse.json({ slots });
}
