/**
 * What is actually live at the club I am running.
 *
 * "Show everything marked running" would be useless here, and that is the
 * whole point of this route. A real club has events that were run months ago
 * and never closed out — Sleepy Hollow had nine marked 'running', eight of
 * them from July — so a bar listing them all would be ten rows of which one
 * mattered, and a director would learn to ignore it within a day.
 *
 * So "live" is judged, not looked up:
 *   - OPEN for signup counts whenever the date is still ahead. That is the
 *     thing a director is most often hunting for, because it is the thing
 *     people are signing up to right now.
 *   - RUNNING only counts NEAR ITS DATE. An event still flagged running two
 *     months after it happened is stale data, not a live event.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { resolveActiveClub } from '@/lib/clubs/activeClub';
import { TOURNAMENT_FORMATS } from '@/lib/eventCategory';
import { compareLive, daysUntil, isStaleRunning, livePhase } from '@/lib/events/live';

export const dynamic = 'force-dynamic';

type EventRow = {
  id: string;
  name: string;
  slug: string | null;
  event_code: string | null;
  match_format: string | null;
  public_status: string;
  event_date: string | null;
  start_time: string | null;
};

/** The page a PLAYER would open — the one a director wants to share. */
function publicHref(e: EventRow): string | null {
  if (e.match_format === 'quads' && e.slug) return `/quads/${e.slug}`;
  if (e.match_format && TOURNAMENT_FORMATS.has(e.match_format) && e.slug) {
    return `/tournaments/${e.slug}`;
  }
  return e.event_code ? `/event/${e.event_code}` : null;
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ events: [] });

  const { active } = await resolveActiveClub(user.id, user.email);
  if (!active) return NextResponse.json({ events: [] });

  const db = getSupabaseAdmin();

  const { data: clubRow } = await db
    .from('cc_clubs')
    .select('owner_id, timezone')
    .eq('id', active.id)
    .maybeSingle();
  const ownerId = (clubRow as { owner_id: string } | null)?.owner_id;

  // Club-linked events, plus the club owner's own — the same pair the member
  // clubhouse uses, because older events predate club_id being set.
  const filter = ownerId
    ? `club_id.eq.${active.id},user_id.eq.${ownerId}`
    : `club_id.eq.${active.id}`;

  const { data } = await db
    .from('events')
    .select('id, name, slug, event_code, match_format, public_status, event_date, start_time')
    .or(filter)
    .in('public_status', ['open', 'running'])
    .order('event_date', { ascending: true })
    .limit(100);

  const rows = (data as EventRow[] | null) ?? [];
  const today = new Date().toISOString().slice(0, 10);

  // The judgement lives in lib/events/live so the route and its tests cannot
  // drift into two versions of "live" that disagree.
  const live = rows
    .map((e) => {
      const daysAway = daysUntil(e.event_date, today);
      const phase = livePhase({ public_status: e.public_status, daysAway });
      return phase ? { ...e, daysAway, phase } : null;
    })
    .filter((e): e is NonNullable<typeof e> => e !== null)
    .sort(compareLive);

  // How many were thrown out as stale, so the bar can mention them without
  // listing them. Useful, not nagging.
  const stale = rows.filter((e) =>
    isStaleRunning({ public_status: e.public_status, daysAway: daysUntil(e.event_date, today) }),
  ).length;

  return NextResponse.json({
    club: { id: active.id, name: active.name },
    events: live.slice(0, 6).map((e) => ({
      id: e.id,
      name: e.name,
      phase: e.phase,
      days_away: e.daysAway,
      date: e.event_date?.slice(0, 10) ?? null,
      start_time: e.start_time,
      /** Where the director manages it. */
      manage_href: `/mixer/events/${e.id}`,
      /** Where a player sees it — what a director wants to send. */
      public_href: publicHref(e),
    })),
    stale_running: stale,
  });
}
