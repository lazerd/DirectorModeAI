/**
 * Lessons adapter — one reservation per lesson_slots row that has a court_id.
 *
 * Today's lesson_slots table has NO court_id. Migration 010 adds it as a
 * nullable column. Slots created WITHOUT a court_id continue to work and
 * don't write to CourtSheet. Slots created WITH a court_id flow through
 * here.
 *
 * Phase 5 will add a court picker to the slot-creation UI; Phase 3 lands
 * the adapter so the integration is ready as soon as the UI is.
 */

import {
  getAdapterContext,
  resolveUserClubId,
  upsertReservation,
  cancelReservationsBySource,
  logAdapterRun,
  safeRun,
} from './common';

interface LessonSlot {
  id: string;
  coach_id: string;
  court_id: string | null;
  start_time: string; // timestamptz
  end_time: string;
  status: string;
  location: string | null;
}

interface CoachRow {
  id: string;
  profile_id: string;
  display_name: string | null;
}

export async function syncLessonSlot(slot_id: string): Promise<{
  ok: boolean;
  reason?: string;
} | null> {
  return safeRun('syncLessonSlot', async () => {
    const { db } = getAdapterContext();
    const { data: rawSlot } = await db
      .from('lesson_slots')
      .select('id, coach_id, court_id, start_time, end_time, status, location')
      .eq('id', slot_id)
      .maybeSingle();
    const slot = rawSlot as LessonSlot | null;
    if (!slot) return { ok: false, reason: 'slot_not_found' };

    // No court → CourtSheet doesn't track this slot.
    if (!slot.court_id) {
      await cancelReservationsBySource(db, 'lessons', slot_id);
      return { ok: true, reason: 'no_court' };
    }

    // Cancelled slot → cancel reservation.
    if (slot.status === 'cancelled') {
      await cancelReservationsBySource(db, 'lessons', slot_id);
      return { ok: true, reason: 'slot_cancelled' };
    }

    // Look up the coach + their primary club.
    const { data: rawCoach } = await db
      .from('lesson_coaches')
      .select('id, profile_id, display_name')
      .eq('id', slot.coach_id)
      .maybeSingle();
    const coach = rawCoach as CoachRow | null;
    if (!coach) return { ok: false, reason: 'coach_not_found' };

    const club_id = await resolveUserClubId(db, coach.profile_id);
    if (!club_id) return { ok: false, reason: 'club_not_found' };

    // Verify the slot's court belongs to this club.
    const { data: courtRow } = await db
      .from('courts')
      .select('id, club_id')
      .eq('id', slot.court_id)
      .maybeSingle();
    if (!courtRow || (courtRow as { club_id: string }).club_id !== club_id) {
      return { ok: false, reason: 'court_outside_club' };
    }

    const result = await upsertReservation(db, {
      club_id,
      court_id: slot.court_id,
      starts_at: slot.start_time,
      ends_at: slot.end_time,
      type: 'lesson',
      source: 'lessons',
      source_id: slot_id,
      title: coach.display_name
        ? `${coach.display_name} — Lesson`
        : 'Lesson slot',
      created_by: coach.profile_id,
      meta: {
        slot_id,
        coach_id: coach.id,
        slot_status: slot.status,
        location: slot.location,
      },
    });

    if (!result.ok) return { ok: false, reason: result.reason };

    await logAdapterRun(db, {
      club_id,
      actor_user_id: coach.profile_id,
      action: 'plan_applied',
      intent: { adapter: 'lessons', slot_id, coach_id: coach.id },
      diff: { reservation_id: result.reservation_id },
      channel: 'api',
    });

    return { ok: true };
  });
}

export async function cancelLessonSlot(slot_id: string): Promise<number | null> {
  return safeRun('cancelLessonSlot', async () => {
    const { db } = getAdapterContext();
    return cancelReservationsBySource(db, 'lessons', slot_id);
  });
}
