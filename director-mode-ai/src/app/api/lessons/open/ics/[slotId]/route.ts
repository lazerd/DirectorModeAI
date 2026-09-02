/**
 * GET /api/lessons/open/ics/[slotId] — the booked lesson, as a calendar file.
 *
 * This is what makes the Apple/iCloud path work. We cannot write to a published
 * feed, so the confirmation email carries the lesson itself: one tap on a phone
 * adds it, with an hour-before alarm. Google-connected instructors get the same
 * link, because clients on any platform want it too.
 *
 * Unauthenticated on purpose — the id is an unguessable uuid and the file says
 * no more than the confirmation email the same person just received.
 */
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { buildLessonIcs } from '@/lib/lessons/icsCalendar';
import { APP_HOST } from '@/lib/appUrl';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { slotId: string } }) {
  const db = getSupabaseAdmin();
  const { data: slot } = await db
    .from('lesson_slots')
    .select('id, coach_id, start_time, end_time, location, guest_name, guest_email, guest_note, status')
    .eq('id', params.slotId)
    .maybeSingle();

  if (!slot || slot.status !== 'booked') {
    return new Response('Not found', { status: 404 });
  }

  const { data: coach } = await db
    .from('lesson_coaches')
    .select('display_name, email')
    .eq('id', slot.coach_id as string)
    .maybeSingle();

  const coachName = (coach?.display_name as string) || 'your coach';
  const minutes = Math.round(
    (new Date(slot.end_time as string).getTime() - new Date(slot.start_time as string).getTime()) / 60000,
  );

  const ics = buildLessonIcs({
    uid: `lesson-${slot.id}@${APP_HOST}`,
    start: slot.start_time as string,
    end: slot.end_time as string,
    summary: `Tennis lesson — ${(slot.guest_name as string) || 'ClubMode'} with ${coachName}`,
    description: [
      `${minutes} minutes with ${coachName}`,
      (slot.guest_email as string) || null,
      (slot.guest_note as string) ? `Note: ${slot.guest_note as string}` : null,
      `Booked through ClubMode`,
    ]
      .filter(Boolean)
      .join('\n'),
    location: (slot.location as string) || null,
    organizerEmail: (coach?.email as string) || null,
  });

  return new Response(ics, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="lesson-${String(slot.id).slice(0, 8)}.ics"`,
      'Cache-Control': 'no-store',
    },
  });
}
