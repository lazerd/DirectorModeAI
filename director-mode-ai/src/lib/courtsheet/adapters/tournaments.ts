/**
 * Tournament match adapter — one reservation per scheduled
 * tournament_matches row.
 *
 * tournament_matches has `scheduled_date DATE`, `scheduled_at TIME`,
 * `court TEXT`. After /api/tournaments/events/[id]/auto-schedule completes
 * its batch UPDATE, the route calls syncTournamentEvent() server-side to
 * write all matches as reservations.
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

interface TournamentMatch {
  id: string;
  round: number;
  bracket_position: string | null;
  scheduled_date: string | null;
  scheduled_at: string | null;
  court: string | null;
  entry_a_id: string | null;
  entry_b_id: string | null;
}

interface EventRow {
  id: string;
  user_id: string;
  default_match_length_minutes: number | null;
  round_duration_minutes: number | null;
  name: string;
}

export async function syncTournamentEvent(event_id: string): Promise<{
  ok: boolean;
  matches_synced: number;
  reservations_created: number;
} | null> {
  return safeRun('syncTournamentEvent', async () => {
    const { db } = getAdapterContext();

    const { data: rawEvent } = await db
      .from('events')
      .select('id, user_id, default_match_length_minutes, round_duration_minutes, name')
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

    const { data: rawMatches } = await db
      .from('tournament_matches')
      .select('id, round, bracket_position, scheduled_date, scheduled_at, court, entry_a_id, entry_b_id')
      .eq('event_id', event_id);
    const matches = (rawMatches ?? []) as TournamentMatch[];

    // Refresh from scratch.
    if (matches.length > 0) {
      await db
        .from('reservations')
        .update({ status: 'cancelled' })
        .eq('source', 'tournaments')
        .in('source_id', matches.map((m) => m.id))
        .neq('status', 'cancelled');
    }

    const durationMin =
      event.default_match_length_minutes ?? event.round_duration_minutes ?? 60;
    const { localToUtc } = await import('../timezones');

    let synced = 0;
    let created = 0;
    for (const m of matches) {
      if (!m.scheduled_date || !m.scheduled_at || !m.court) continue;
      const courtId = await resolveCourtId(db, club_id, m.court);
      if (!courtId) continue;

      const startsAt = localToUtc(
        m.scheduled_date,
        m.scheduled_at.slice(0, 5),
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
        source: 'tournaments',
        source_id: m.id,
        title: `${event.name} — ${m.bracket_position ?? `R${m.round}`}`,
        created_by: event.user_id,
        meta: {
          event_id,
          round: m.round,
          bracket_position: m.bracket_position,
        },
      });
      if (result.ok) created++;
    }

    await logAdapterRun(db, {
      club_id,
      actor_user_id: event.user_id,
      action: 'plan_applied',
      intent: { adapter: 'tournaments', event_id, match_count: synced },
      diff: { created },
      channel: 'api',
    });

    return { ok: true, matches_synced: synced, reservations_created: created };
  });
}

export async function cancelTournamentMatch(match_id: string): Promise<number | null> {
  return safeRun('cancelTournamentMatch', async () => {
    const { db } = getAdapterContext();
    return cancelReservationsBySource(db, 'tournaments', match_id);
  });
}
