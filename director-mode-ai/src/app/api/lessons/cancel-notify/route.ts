import { NextRequest, NextResponse } from 'next/server';
import { sendBilledEmail, creditLimitResponse, CreditLimitError } from '@/lib/email';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { lessonCancelEmail } from '@/lib/lessons/cancelEmail';
import { esc, isLinked, loadCoach, loadMyClient, sessionUserId, slotWhen } from '@/lib/lessons/notify';

/**
 * POST { slotId, cancelledBy: 'client' | 'coach' } — email the other side of a
 * cancelled lesson. The recipient is never taken from the request:
 *   - 'coach':  the caller must own the slot, which must still be booked (the
 *               coach dashboard calls this before deleting it); the booked
 *               client is emailed.
 *   - 'client': the client dashboard calls this after reopening the slot, so
 *               the booking is already gone; the caller must be a client of
 *               the slot's coach, the slot must be open and still ahead. The
 *               coach is emailed.
 * The coach pays either way.
 */
export async function POST(request: NextRequest) {
  try {
    const userId = await sessionUserId();
    if (!userId) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

    const { slotId, cancelledBy } = await request.json().catch(() => ({}));
    if (!slotId || typeof slotId !== 'string' || (cancelledBy !== 'client' && cancelledBy !== 'coach')) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const db = getSupabaseAdmin();
    const { data: slot } = await db
      .from('lesson_slots')
      .select('id, coach_id, start_time, end_time, location, status, booked_by_client_id')
      .eq('id', slotId)
      .maybeSingle();
    if (!slot) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    const coach = await loadCoach(db, slot.coach_id as string);
    if (!coach) return NextResponse.json({ error: 'not_found' }, { status: 404 });

    let to: string | null;
    let recipientName: string | null;
    let otherPartyName: string;
    if (cancelledBy === 'coach') {
      if (coach.profile_id !== userId || slot.status !== 'booked' || !slot.booked_by_client_id) {
        return NextResponse.json({ error: 'Not your booked lesson.' }, { status: 403 });
      }
      const { data: client } = await db
        .from('lesson_clients')
        .select('name, email')
        .eq('id', slot.booked_by_client_id as string)
        .maybeSingle();
      to = (client as any)?.email || null;
      recipientName = (client as any)?.name || null;
      otherPartyName = coach.display_name || 'Your coach';
    } else {
      const client = await loadMyClient(db, userId);
      const reopened = slot.status === 'open' && !slot.booked_by_client_id;
      const ahead = new Date(slot.start_time as string).getTime() > Date.now();
      if (!client || !reopened || !ahead || !(await isLinked(db, client.id, coach.id))) {
        return NextResponse.json({ error: 'Not your lesson.' }, { status: 403 });
      }
      to = coach.email;
      recipientName = coach.display_name;
      otherPartyName = client.name || client.email || 'Your client';
    }
    if (!to) return NextResponse.json({ success: true, emailed: false });

    const when = slotWhen(slot.start_time as string, slot.end_time as string, coach.timezone);
    // The message itself is built in lib/lessons/cancelEmail.ts, shared with the assistant.
    const msg = lessonCancelEmail({
      recipientName: recipientName ? esc(recipientName) : null,
      cancelledBy,
      otherPartyName: esc(otherPartyName),
      slotDate: when.date,
      slotTime: when.time,
      location: slot.location ? esc(slot.location) : null,
    });
    await sendBilledEmail(coach.profile_id, {
      ...msg,
      // The subject is plain text; undo the HTML escaping the name got for the body.
      subject: msg.subject.replace(esc(otherPartyName), () => otherPartyName),
      to,
      clubId: coach.club_id,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof CreditLimitError) return creditLimitResponse(error);
    console.error('Cancel notification error:', error);
    return NextResponse.json({ error: 'Failed to send notification' }, { status: 500 });
  }
}
