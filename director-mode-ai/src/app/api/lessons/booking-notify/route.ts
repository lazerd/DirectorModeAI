import { NextRequest, NextResponse } from 'next/server';
import { sendBilledEmail, creditLimitResponse, CreditLimitError } from '@/lib/email';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { esc, loadCoach, loadMyClient, sessionUserId, slotWhen } from '@/lib/lessons/notify';

import { APP_URL } from '@/lib/appUrl';

/** How long after booking the confirmation may still be sent. */
const RECENT_MS = 15 * 60 * 1000;

function generateCalendarLinks(title: string, start: string, end: string, location?: string | null) {
  const encodedTitle = encodeURIComponent(title);
  const details = encodeURIComponent(`Lesson booked via LessonMode`);
  const loc = encodeURIComponent(location || '');

  const googleUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodedTitle}&dates=${start}/${end}&details=${details}&location=${loc}`;
  const outlookUrl = `https://outlook.live.com/calendar/0/deeplink/compose?subject=${encodedTitle}&startdt=${start}&enddt=${end}&body=${details}&location=${loc}`;

  return { googleUrl, outlookUrl };
}

/**
 * POST { slotId } — after the signed-in client books a slot, email the coach
 * and the client. Sent only when that slot is booked by the caller; who gets
 * mail, the names and the time all come from the slot, coach and client rows.
 */
export async function POST(request: NextRequest) {
  try {
    const userId = await sessionUserId();
    if (!userId) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

    const { slotId } = await request.json().catch(() => ({}));
    if (!slotId || typeof slotId !== 'string') {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const db = getSupabaseAdmin();
    const client = await loadMyClient(db, userId);
    const { data: slot } = await db
      .from('lesson_slots')
      .select('id, coach_id, start_time, end_time, location, status, booked_by_client_id, booked_at')
      .eq('id', slotId)
      .maybeSingle();
    if (!client || !slot || slot.status !== 'booked' || slot.booked_by_client_id !== client.id) {
      return NextResponse.json({ error: 'Not your booking.' }, { status: 403 });
    }
    // The page calls this right after booking. A replay of an old booking is not
    // a reason to email the coach again.
    if (!slot.booked_at || Date.now() - new Date(slot.booked_at as string).getTime() > RECENT_MS) {
      return NextResponse.json({ success: true, emailed: false });
    }
    const coach = await loadCoach(db, slot.coach_id as string);
    if (!coach) return NextResponse.json({ error: 'not_found' }, { status: 404 });

    const when = slotWhen(slot.start_time as string, slot.end_time as string, coach.timezone);
    const slotDate = when.date;
    const slotTime = when.time;
    const location = (slot.location as string | null) ? esc(slot.location) : '';
    const rawClientName = client.name || client.email || 'A client';
    const rawCoachName = coach.display_name || '';
    const clientName = esc(rawClientName);
    const coachName = esc(rawCoachName);

    // Email to coach (the coach pays for both emails — they own the booking)
    const ownerUserId = coach.profile_id;
    const coachCalendarLinks = generateCalendarLinks(`Tennis Lesson with ${rawClientName}`, when.startStamp, when.endStamp, slot.location as string | null);
    if (coach.email) {
      await sendBilledEmail(ownerUserId, {
        from: 'LessonMode <noreply@mail.clubmode.ai>',
        to: coach.email,
        subject: `New Booking: ${rawClientName} booked a lesson`,
        clubId: coach.club_id,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #16a34a;">New Lesson Booked! 🎉</h2>
            <p>Hi ${coachName || 'Coach'},</p>
            <p><strong>${clientName}</strong> just booked a lesson with you:</p>
            <div style="background: #f0fdf4; padding: 16px; border-radius: 8px; margin: 16px 0;">
              <p style="margin: 0;"><strong>Date:</strong> ${slotDate}</p>
              <p style="margin: 8px 0 0 0;"><strong>Time:</strong> ${slotTime}</p>
              ${location ? `<p style="margin: 8px 0 0 0;"><strong>Location:</strong> ${location}</p>` : ''}
            </div>
            <p style="margin-top: 24px;"><strong>Add to your calendar:</strong></p>
            <div style="margin: 16px 0;">
              <a href="${coachCalendarLinks.googleUrl}" style="display: inline-block; background: #4285f4; color: white; padding: 10px 20px; border-radius: 6px; text-decoration: none; margin-right: 10px;">📅 Google Calendar</a>
              <a href="${coachCalendarLinks.outlookUrl}" style="display: inline-block; background: #0078d4; color: white; padding: 10px 20px; border-radius: 6px; text-decoration: none;">📅 Outlook</a>
            </div>
            <a href="${APP_URL}/lessons/dashboard" style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; margin-top: 16px;">View Dashboard</a>
          </div>
        `
      });
    }

    // Email to client (if email provided)
    const clientEmail = client.email;
    if (clientEmail) {
      const clientCalendarLinks = generateCalendarLinks(`Tennis Lesson with ${rawCoachName || 'Coach'}`, when.startStamp, when.endStamp, slot.location as string | null);
      await sendBilledEmail(ownerUserId, {
        from: 'LessonMode <noreply@mail.clubmode.ai>',
        to: clientEmail,
        subject: `Booking Confirmed: Lesson with ${rawCoachName || 'your coach'}`,
        clubId: coach.club_id,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #16a34a;">Lesson Confirmed! ✅</h2>
            <p>Hi ${clientName},</p>
            <p>Your lesson with <strong>${coachName || 'your coach'}</strong> is confirmed:</p>
            <div style="background: #f0fdf4; padding: 16px; border-radius: 8px; margin: 16px 0;">
              <p style="margin: 0;"><strong>Date:</strong> ${slotDate}</p>
              <p style="margin: 8px 0 0 0;"><strong>Time:</strong> ${slotTime}</p>
              ${location ? `<p style="margin: 8px 0 0 0;"><strong>Location:</strong> ${location}</p>` : ''}
            </div>
            <p style="margin-top: 24px;"><strong>Add to your calendar:</strong></p>
            <div style="margin: 16px 0;">
              <a href="${clientCalendarLinks.googleUrl}" style="display: inline-block; background: #4285f4; color: white; padding: 10px 20px; border-radius: 6px; text-decoration: none; margin-right: 10px;">📅 Google Calendar</a>
              <a href="${clientCalendarLinks.outlookUrl}" style="display: inline-block; background: #0078d4; color: white; padding: 10px 20px; border-radius: 6px; text-decoration: none;">📅 Outlook</a>
            </div>
            <a href="${APP_URL}/client/dashboard" style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; margin-top: 16px;">View My Lessons</a>
          </div>
        `
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof CreditLimitError) return creditLimitResponse(error);
    console.error('Booking notification error:', error);
    return NextResponse.json({ error: 'Failed to send notification' }, { status: 500 });
  }
}
