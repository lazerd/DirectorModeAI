import { NextResponse } from 'next/server';
import { resolvePublicClub } from '@/lib/courtsheet/routeAuth';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { localToUtc } from '@/lib/courtsheet/timezones';

export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ clubSlug: string }>;
}

/**
 * GET /api/courtsheet/public/[clubSlug]?date=YYYY-MM-DD
 *
 * The public member view feed. Returns:
 *   - club metadata (name, sports, timezone, operating_hours)
 *   - courts list
 *   - reservations for the date that are open_for_signups OR are happening
 *     today (so members can see what's running even without joining)
 *
 * Unauthenticated. The route enforces is_public=true on the club.
 */
export async function GET(req: Request, { params }: RouteParams) {
  const { clubSlug } = await params;
  const club = await resolvePublicClub(clubSlug);
  if (!club) return NextResponse.json({ error: 'Club not found' }, { status: 404 });

  const url = new URL(req.url);
  const date = url.searchParams.get('date') ?? new Date().toISOString().slice(0, 10);

  const db = getSupabaseAdmin();
  const { data: courts } = await db
    .from('courts')
    .select('*')
    .eq('club_id', club.id)
    .neq('status', 'hidden')
    .order('display_order', { ascending: true });

  const startUtc = localToUtc(date, '00:00', club.timezone).toISOString();
  const endUtc = localToUtc(addOneDay(date), '00:00', club.timezone).toISOString();

  const { data: reservationsRaw } = await db
    .from('reservations')
    .select('*')
    .eq('club_id', club.id)
    .eq('status', 'confirmed')
    .lt('starts_at', endUtc)
    .gt('ends_at', startUtc)
    .order('starts_at', { ascending: true });
  const reservations = (reservationsRaw ?? []) as Array<{
    id: string;
    court_id: string;
    starts_at: string;
    ends_at: string;
    type: string;
    source: string;
    title: string;
    color: string | null;
    signups_open: boolean;
    signups_capacity: number | null;
    signups_pitch: string | null;
    meta: Record<string, unknown>;
  }>;

  // For each reservation that is signups_open, count the active signups so
  // the UI can show "X spots left".
  const openIds = reservations.filter((r) => r.signups_open).map((r) => r.id);
  let countsById: Record<string, number> = {};
  if (openIds.length > 0) {
    const { data: signupRows } = await db
      .from('reservation_signups')
      .select('reservation_id, status')
      .in('reservation_id', openIds)
      .in('status', ['requested', 'confirmed']);
    for (const row of signupRows ?? []) {
      countsById[row.reservation_id] = (countsById[row.reservation_id] ?? 0) + 1;
    }
  }

  return NextResponse.json({
    club,
    courts: courts ?? [],
    reservations: reservations.map((r) => ({
      ...r,
      signups_count: countsById[r.id] ?? 0,
    })),
  });
}

function addOneDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
