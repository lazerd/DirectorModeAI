import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendBilledEmail, resolveCoachUserId, CreditLimitError } from '@/lib/email';

import { APP_URL } from '@/lib/appUrl';
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// The server runs in UTC, so every human-facing time must name a zone — else a
// 4:00 PM Pacific lesson reads "11:00 PM". Coach's zone first, then the club's home.
const DEFAULT_TZ = 'America/Los_Angeles';

/** Google's compact UTC form (the trailing Z makes it an instant, not a wall time). */
function toGoogleUtc(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function generateCalendarLinks(title: string, startTime: Date, endTime: Date, location?: string | null) {
  const encodedTitle = encodeURIComponent(title);
  const details = encodeURIComponent('Lesson reminder from LessonMode');
  const loc = encodeURIComponent(location || '');

  const googleUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodedTitle}&dates=${toGoogleUtc(startTime)}/${toGoogleUtc(endTime)}&details=${details}&location=${loc}`;
  const outlookUrl = `https://outlook.live.com/calendar/0/deeplink/compose?subject=${encodedTitle}&startdt=${encodeURIComponent(startTime.toISOString())}&enddt=${encodeURIComponent(endTime.toISOString())}&body=${details}&location=${loc}`;

  return { googleUrl, outlookUrl };
}

function formatTime(date: Date, timeZone: string): string {
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone });
}

function formatDate(date: Date, timeZone: string): string {
  return date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone });
}

/** A usable IANA zone name, or the default when it's missing or bogus. */
function resolveTimeZone(tz: unknown): string {
  if (typeof tz !== 'string' || !tz) return DEFAULT_TZ;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_TZ;
  }
}

export async function GET(request: NextRequest) {
  // Verify cron secret to prevent unauthorized access
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    // Allow without auth in development or if no secret set
    if (process.env.CRON_SECRET && process.env.NODE_ENV === 'production') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  try {
    const now = new Date();
    const in23Hours = new Date(now.getTime() + 23 * 60 * 60 * 1000);
    const in25Hours = new Date(now.getTime() + 25 * 60 * 60 * 1000);

    // Find booked lessons starting in ~24 hours that haven't been reminded
    const { data: slots, error } = await supabase
      .from('lesson_slots')
      .select(`
        id,
        start_time,
        end_time,
        location,
        reminder_sent,
        lesson_coaches(display_name, email, timezone),
        lesson_clients(name, email)
      `)
      .eq('status', 'booked')
      .gte('start_time', in23Hours.toISOString())
      .lte('start_time', in25Hours.toISOString())
      .or('reminder_sent.is.null,reminder_sent.eq.false');

    if (error) {
      console.error('Error fetching slots:', error);
      return NextResponse.json({ error: 'Failed to fetch slots' }, { status: 500 });
    }

    if (!slots || slots.length === 0) {
      return NextResponse.json({ message: 'No reminders to send', sent: 0 });
    }

    let sentCount = 0;

    for (const slot of slots) {
      const startTime = new Date(slot.start_time);
      const endTime = new Date(slot.end_time);
      const coach = (slot as any).lesson_coaches;
      const client = (slot as any).lesson_clients;

      if (!client?.email) continue;

      const coachName = coach?.display_name || 'your coach';
      const clientName = client?.name || 'there';
      const tz = resolveTimeZone(coach?.timezone);
      const calendarLinks = generateCalendarLinks(
        `Tennis Lesson with ${coachName}`,
        startTime,
        endTime,
        slot.location
      );

      // Send reminder to client. Each reminder is billed to the owning coach.
      // If the coach has hit their cap (e.g., free tier), skip this one but keep iterating.
      const coachUserId = await resolveCoachUserId(undefined, coach?.email);
      try {
        await sendBilledEmail(coachUserId, {
          from: 'LessonMode <noreply@mail.clubmode.ai>',
          to: client.email,
          subject: `Reminder: Lesson with ${coachName} tomorrow`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #2563eb;">⏰ Lesson Reminder</h2>
              <p>Hi ${clientName},</p>
              <p>This is a friendly reminder that you have a lesson scheduled for <strong>tomorrow</strong>:</p>
              <div style="background: #eff6ff; padding: 16px; border-radius: 8px; margin: 16px 0; border-left: 4px solid #2563eb;">
                <p style="margin: 0;"><strong>Coach:</strong> ${coachName}</p>
                <p style="margin: 8px 0 0 0;"><strong>Date:</strong> ${formatDate(startTime, tz)}</p>
                <p style="margin: 8px 0 0 0;"><strong>Time:</strong> ${formatTime(startTime, tz)} - ${formatTime(endTime, tz)}</p>
                ${slot.location ? `<p style="margin: 8px 0 0 0;"><strong>Location:</strong> ${slot.location}</p>` : ''}
              </div>
              <p style="margin-top: 24px;"><strong>Add to your calendar:</strong></p>
              <div style="margin: 16px 0;">
                <a href="${calendarLinks.googleUrl}" style="display: inline-block; background: #4285f4; color: white; padding: 10px 20px; border-radius: 6px; text-decoration: none; margin-right: 10px;">📅 Google Calendar</a>
                <a href="${calendarLinks.outlookUrl}" style="display: inline-block; background: #0078d4; color: white; padding: 10px 20px; border-radius: 6px; text-decoration: none;">📅 Outlook</a>
              </div>
              <p style="color: #666; font-size: 14px; margin-top: 24px;">
                Need to cancel? <a href="${APP_URL}/client/dashboard" style="color: #2563eb;">Manage your lessons</a>
              </p>
            </div>
          `
        });

        // Mark as reminded
        await supabase
          .from('lesson_slots')
          .update({ reminder_sent: true })
          .eq('id', slot.id);

        sentCount++;
      } catch (emailError) {
        if (emailError instanceof CreditLimitError) {
          console.warn(`[reminder] Skipped slot ${slot.id} for coach ${coachUserId}: ${emailError.message}`);
        } else {
          console.error('Failed to send reminder for slot:', slot.id, emailError);
        }
      }
    }

    return NextResponse.json({ 
      message: `Sent ${sentCount} reminder(s)`, 
      sent: sentCount,
      checked: slots.length 
    });

  } catch (error) {
    console.error('Reminder job error:', error);
    return NextResponse.json({ error: 'Failed to process reminders' }, { status: 500 });
  }
}
