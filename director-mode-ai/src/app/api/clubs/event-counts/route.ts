/**
 * GET /api/clubs/event-counts?event_ids=a,b,c — how many people are going.
 *
 * The public club page used to count RSVPs by reading cc_event_players from the
 * browser, which required that table to be world-readable — and it carries
 * guest names and, potentially, guest emails. A count is all the page ever
 * wanted, so it gets a count, and the roster itself is now private to the
 * organiser and the player.
 */
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get('event_ids') || '';
  const ids = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 50); // a page shows a handful; the cap stops it being a scraper

  if (!ids.length) return NextResponse.json({ counts: {} });

  const db = getSupabaseAdmin();
  const { data } = await db
    .from('cc_event_players')
    .select('event_id')
    .in('event_id', ids)
    .eq('status', 'accepted');

  const counts: Record<string, number> = {};
  for (const id of ids) counts[id] = 0;
  for (const row of ((data as { event_id: string }[]) || [])) {
    counts[row.event_id] = (counts[row.event_id] || 0) + 1;
  }

  // Numbers only — never who.
  return NextResponse.json({ counts });
}
