/**
 * Quads match adapter — one reservation per scheduled quad_matches row.
 *
 * quad_matches has `scheduled_at TIME` (no date — date = events.event_date)
 * and `court TEXT`. After autoScheduleQuads() runs and the rows are
 * UPDATEd with their assignments, the client calls this adapter with
 * the event_id to sync ALL of its matches.
 */

import {
  getAdapterContext,
  resolveUserClubId,
  resolveCourtId,
  upsertReservation,
  cancelReservationsBySource,
  logAdapterRun,
  safeRun,
} from './common';

interface QuadMatch {
  id: string;
  flight_id: string;
  round: number;
  match_type: string;
  scheduled_at: string | null; // 'HH:MM'
  court: string | null;
}

interface EventRow {
  id: string;
  user_id: string;
  event_date: string;
  round_duration_minutes: number | null;
  name: string;
}

export async function syncQuadsEvent(event_id: string): Promise<{
  ok: boolean;
  matches_synced: number;
  reservations_created: number;
} | null> {
  return safeRun('syncQuadsEvent', async () => {
    const { db } = getAdapterContext();

    const { data: rawEvent } = await db
      .from('events')
      .select('id, user_id, event_date, round_duration_minutes, name')
      .eq('id', event_id)
      .maybeSingle();
    const event = rawEvent as EventRow | null;
    if (!event) return { ok: false, matches_synced: 0, reservations_created: 0 };

    const club_id = await resolveUserClubId(db, event.user_id);
    if (!club_id) return { ok: false, matches_synced: 0, reservations_created: 0 };

    const { data: clubRow } = await db
      .from('cc_clubs')
      .select('timezone')
      .eq('id', club_id)
      .single();
    const timezone = (clubRow as { timezone: string } | null)?.timezone ?? 'America/Los_Angeles';

    // Fetch all matches via the event's flights.
    const { data: flights } = await db
      .from('quad_flights')
      .select('id')
      .eq('event_id', event_id);
    const flightIds = ((flights ?? []) as Array<{ id: string }>).map((f) => f.id);
    if (flightIds.length === 0) return { ok: true, matches_synced: 0, reservations_created: 0 };

    const { data: rawMatches } = await db
      .from('quad_matches')
      .select('id, flight_id, round, match_type, scheduled_at, court')
      .in('flight_id', flightIds);
    const matches = (rawMatches ?? []) as QuadMatch[];

    // Refresh from scratch: cancel all prior quads reservations for this event,
    // then re-write any matches that have BOTH scheduled_at + court.
    await cancelAllForQuadsEvent(db, matches.map((m) => m.id));

    const durationMin = event.round_duration_minutes ?? 45;
    const { localToUtc } = await import('../timezones');

    let created = 0;
    let synced = 0;
    for (const match of matches) {
      if (!match.scheduled_at || !match.court) continue;
      const courtId = await resolveCourtId(db, club_id, match.court);
      if (!courtId) continue;

      const startsAt = localToUtc(
        event.event_date,
        match.scheduled_at.slice(0, 5),
        timezone
      );
      const endsAt = new Date(startsAt.getTime() + durationMin * 60_000);
      synced++;

      const result = await upsertReservation(db, {
        club_id,
        court_id: courtId,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        type: 'match',
        source: 'quads',
        source_id: match.id,
        title: `${event.name} — R${match.round} ${match.match_type}`,
        created_by: event.user_id,
        meta: {
          event_id,
          flight_id: match.flight_id,
          round: match.round,
          match_type: match.match_type,
        },
      });
      if (result.ok) created++;
    }

    await logAdapterRun(db, {
      club_id,
      actor_user_id: event.user_id,
      action: 'plan_applied',
      intent: { adapter: 'quads', event_id, match_count: synced },
      diff: { created },
      channel: 'api',
    });

    return { ok: true, matches_synced: synced, reservations_created: created };
  });
}

async function cancelAllForQuadsEvent(
  db: ReturnType<typeof getAdapterContext>['db'],
  match_ids: string[]
): Promise<void> {
  if (match_ids.length === 0) return;
  await db
    .from('reservations')
    .update({ status: 'cancelled' })
    .eq('source', 'quads')
    .in('source_id', match_ids)
    .neq('status', 'cancelled');
}

/** Cancel reservations for a single match (when score gets entered? maybe not — match still claims the slot). */
export async function cancelQuadsMatch(match_id: string): Promise<number | null> {
  return safeRun('cancelQuadsMatch', async () => {
    const { db } = getAdapterContext();
    return cancelReservationsBySource(db, 'quads', match_id);
  });
}
