/**
 * Mixer event adapter — sync events.id ↔ N reservations.
 *
 * One reservation per court for the event's date+time window. Court
 * resolution honors `events.court_names TEXT[]` first (Quads/Tournaments
 * +extended-mixer pattern), falls back to `events.num_courts` as
 * numbered courts 1..N.
 *
 * Idempotent — re-running with the same event_id updates the existing
 * reservations (keyed by source='mixer', source_id=event_id). If a
 * reservation already exists with a different court but the same
 * source_id+court combo, we'll create new + cancel the stale ones.
 *
 * Called from:
 *   - POST /api/courtsheet/adapters/mixer-event (client-side after insert)
 *   - Server-side from the mixer scheduling routes
 */

import {
  ADAPTERS_ENABLED,
  getAdapterContext,
  resolveUserClubId,
  resolveCourtId,
  upsertReservation,
  cancelReservationsBySource,
  logAdapterRun,
  safeRun,
} from './common';

interface EventRow {
  id: string;
  user_id: string;
  event_date: string;
  start_time: string | null;
  end_date: string | null;
  daily_start_time: string | null;
  daily_end_time: string | null;
  num_courts: number | null;
  court_names: string[] | null;
  match_format: string | null;
  name: string;
  round_length_minutes: number | null;
}

/**
 * Sync the reservations for a mixer event. Returns a report.
 */
export async function syncMixerEvent(event_id: string): Promise<{
  ok: boolean;
  reservations_created: number;
  reservations_cancelled: number;
  reason?: string;
} | null> {
  return safeRun('syncMixerEvent', async () => {
    const { db } = getAdapterContext();

    const { data: rawEvent } = await db
      .from('events')
      .select(
        'id, user_id, event_date, start_time, end_date, daily_start_time, daily_end_time, num_courts, court_names, match_format, name, round_length_minutes'
      )
      .eq('id', event_id)
      .maybeSingle();
    const event = rawEvent as EventRow | null;
    if (!event) {
      return {
        ok: false,
        reservations_created: 0,
        reservations_cancelled: 0,
        reason: 'event_not_found',
      };
    }

    const club_id = await resolveUserClubId(db, event.user_id);
    if (!club_id) {
      return {
        ok: false,
        reservations_created: 0,
        reservations_cancelled: 0,
        reason: 'club_not_found',
      };
    }

    // Determine the date range. Single-day events use event_date. Multi-day
    // (multi_day_tournament) sweeps event_date..end_date.
    const startDate = event.event_date;
    const endDate = event.end_date || event.event_date;
    const dailyStart = (event.daily_start_time || event.start_time || '09:00').slice(0, 5);
    const dailyEnd = (event.daily_end_time || addHours(dailyStart, 4)).slice(0, 5);

    const courtLabels = resolveCourtLabels(event);
    if (courtLabels.length === 0) {
      return {
        ok: false,
        reservations_created: 0,
        reservations_cancelled: 0,
        reason: 'no_courts_specified',
      };
    }

    // Resolve labels → court_ids.
    const courtIds: string[] = [];
    for (const label of courtLabels) {
      const id = await resolveCourtId(db, club_id, label);
      if (id) courtIds.push(id);
    }
    if (courtIds.length === 0) {
      return {
        ok: false,
        reservations_created: 0,
        reservations_cancelled: 0,
        reason: 'no_courts_in_club_matched',
      };
    }

    // Cancel any prior reservations for this event before re-writing —
    // simpler and safer than diffing. The EXCLUDE constraint ignores
    // cancelled rows, so re-creating into the same slot works.
    const cancelled = await cancelReservationsBySource(db, 'mixer', event_id);

    // Get the club's timezone for date→UTC conversion.
    const { data: clubRow } = await db
      .from('cc_clubs')
      .select('timezone')
      .eq('id', club_id)
      .single();
    const timezone = (clubRow as { timezone: string } | null)?.timezone ?? 'America/Los_Angeles';

    // Walk every (date × court) and write one reservation.
    // Mixer events are typically 1 day with a known time window. Multi-day
    // tournaments span end_date inclusive.
    const { enumerateDates, localToUtc } = await import('../timezones');
    const dates = enumerateDates(startDate, endDate);

    let created = 0;
    let firstFailReason: string | null = null;
    for (const date of dates) {
      const startsAt = localToUtc(date, dailyStart, timezone).toISOString();
      const endsAt = localToUtc(date, dailyEnd, timezone).toISOString();
      for (const court_id of courtIds) {
        const result = await upsertReservation(db, {
          club_id,
          court_id,
          starts_at: startsAt,
          ends_at: endsAt,
          type: 'event',
          source: 'mixer',
          source_id: event_id,
          title: event.name,
          created_by: event.user_id,
          meta: {
            event_id,
            match_format: event.match_format,
            date,
          },
        });
        if (result.ok) created++;
        else if (!firstFailReason) firstFailReason = result.reason;
      }
    }

    await logAdapterRun(db, {
      club_id,
      actor_user_id: event.user_id,
      action: 'plan_applied',
      intent: {
        adapter: 'mixer',
        event_id,
        court_count: courtIds.length,
        date_range: [startDate, endDate],
      },
      diff: { created, cancelled, failure_reason: firstFailReason },
      channel: 'api',
    });

    return {
      ok: created > 0,
      reservations_created: created,
      reservations_cancelled: cancelled,
      reason: firstFailReason ?? undefined,
    };
  });
}

/**
 * Cancel reservations when a mixer event is deleted.
 */
export async function cancelMixerEvent(event_id: string): Promise<number | null> {
  return safeRun('cancelMixerEvent', async () => {
    const { db } = getAdapterContext();
    return cancelReservationsBySource(db, 'mixer', event_id);
  });
}

function resolveCourtLabels(event: EventRow): Array<string | number> {
  if (event.court_names && event.court_names.length > 0) return event.court_names;
  if (event.num_courts && event.num_courts > 0) {
    return Array.from({ length: event.num_courts }, (_, i) => i + 1);
  }
  return [];
}

function addHours(hhmm: string, hours: number): string {
  const [h, m] = hhmm.split(':').map((s) => parseInt(s, 10));
  const total = h * 60 + (m || 0) + hours * 60;
  const hh = Math.floor(total / 60) % 24;
  const mm = total % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/** Export for the public to know whether adapter writes are on. */
export const isEnabled = () => ADAPTERS_ENABLED;
