/**
 * CourtConnect event adapter — write reservations from cc_events.
 *
 * cc_events has `event_date`, `start_time`, `end_time`, `court_count INT`
 * but NO specific court labels. Strategy: claim N consecutive court ids
 * from the club's courts list, in display_order, for the event window.
 *
 * Phase 5 improvement: surface a court picker in /courtconnect/events/new
 * so users explicitly choose. Today we auto-assign.
 */

import {
  getAdapterContext,
  resolveUserClubId,
  upsertReservation,
  cancelReservationsBySource,
  logAdapterRun,
  safeRun,
} from './common';

interface CcEvent {
  id: string;
  created_by: string;
  event_date: string;
  start_time: string;
  end_time: string | null;
  court_count: number | null;
  title: string;
  event_type: string;
  organization_id: string | null;
}

export async function syncCourtConnectEvent(event_id: string): Promise<{
  ok: boolean;
  reservations_created: number;
  reason?: string;
} | null> {
  return safeRun('syncCourtConnectEvent', async () => {
    const { db } = getAdapterContext();
    const { data: rawEvent } = await db
      .from('cc_events')
      .select('id, created_by, event_date, start_time, end_time, court_count, title, event_type, organization_id')
      .eq('id', event_id)
      .maybeSingle();
    const event = rawEvent as CcEvent | null;
    if (!event) return { ok: false, reservations_created: 0, reason: 'event_not_found' };

    const club_id = await resolveUserClubId(db, event.created_by);
    if (!club_id) return { ok: false, reservations_created: 0, reason: 'club_not_found' };

    const { data: clubRow } = await db
      .from('cc_clubs')
      .select('timezone')
      .eq('id', club_id)
      .single();
    const timezone = (clubRow as { timezone: string } | null)?.timezone ?? 'America/Los_Angeles';

    const { data: courts } = await db
      .from('courts')
      .select('id, number, display_order')
      .eq('club_id', club_id)
      .eq('status', 'active')
      .order('display_order', { ascending: true });
    const allCourts = (courts ?? []) as Array<{ id: string; number: number }>;
    const want = event.court_count ?? 1;
    const courtIds = allCourts.slice(0, want).map((c) => c.id);
    if (courtIds.length === 0) {
      return { ok: false, reservations_created: 0, reason: 'no_courts' };
    }

    await cancelReservationsBySource(db, 'courtconnect', event_id);

    const startHHMM = event.start_time.slice(0, 5);
    const endHHMM = event.end_time
      ? event.end_time.slice(0, 5)
      : addHours(startHHMM, 2);

    const { localToUtc } = await import('../timezones');
    const startsAt = localToUtc(event.event_date, startHHMM, timezone).toISOString();
    const endsAt = localToUtc(event.event_date, endHHMM, timezone).toISOString();

    let created = 0;
    for (const court_id of courtIds) {
      const result = await upsertReservation(db, {
        club_id,
        court_id,
        starts_at: startsAt,
        ends_at: endsAt,
        type: event.event_type === 'match' ? 'match' : 'event',
        source: 'courtconnect',
        source_id: event_id,
        title: event.title,
        created_by: event.created_by,
        meta: { event_id, event_type: event.event_type },
      });
      if (result.ok) created++;
    }

    await logAdapterRun(db, {
      club_id,
      actor_user_id: event.created_by,
      action: 'plan_applied',
      intent: { adapter: 'courtconnect', event_id, court_count: courtIds.length },
      diff: { created },
      channel: 'api',
    });

    return { ok: created > 0, reservations_created: created };
  });
}

export async function cancelCourtConnectEvent(event_id: string): Promise<number | null> {
  return safeRun('cancelCourtConnectEvent', async () => {
    const { db } = getAdapterContext();
    return cancelReservationsBySource(db, 'courtconnect', event_id);
  });
}

function addHours(hhmm: string, hours: number): string {
  const [h, m] = hhmm.split(':').map((s) => parseInt(s, 10));
  const total = h * 60 + (m || 0) + hours * 60;
  const hh = Math.floor(total / 60) % 24;
  const mm = total % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}
