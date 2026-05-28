import { NextResponse } from 'next/server';
import { requireStaffForClub } from '@/lib/courtsheet/routeAuth';
import { localToUtc } from '@/lib/courtsheet/timezones';

export const dynamic = 'force-dynamic';

/**
 * GET /api/courtsheet/reservations?date=YYYY-MM-DD
 *   or ?start=YYYY-MM-DD&end=YYYY-MM-DD
 *
 * Returns all non-cancelled reservations in the date range (club-local).
 * Used by the sheet to paint blocks.
 */
export async function GET(req: Request) {
  const ctx = await requireStaffForClub();
  if ('error' in ctx) return ctx.error;

  const url = new URL(req.url);
  const date = url.searchParams.get('date');
  const startParam = url.searchParams.get('start');
  const endParam = url.searchParams.get('end');

  let startISO: string;
  let endExclusiveISO: string;

  if (startParam && endParam) {
    startISO = localToUtc(startParam, '00:00', ctx.club.timezone).toISOString();
    endExclusiveISO = localToUtc(
      addOneDay(endParam),
      '00:00',
      ctx.club.timezone
    ).toISOString();
  } else if (date) {
    startISO = localToUtc(date, '00:00', ctx.club.timezone).toISOString();
    endExclusiveISO = localToUtc(addOneDay(date), '00:00', ctx.club.timezone).toISOString();
  } else {
    return NextResponse.json({ error: 'Missing date or start+end' }, { status: 400 });
  }

  const { data } = await ctx.db
    .from('reservations')
    .select('*')
    .eq('club_id', ctx.club.id)
    .neq('status', 'cancelled')
    .lt('starts_at', endExclusiveISO)
    .gt('ends_at', startISO)
    .order('starts_at', { ascending: true });

  return NextResponse.json({ reservations: data ?? [] });
}

function addOneDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
