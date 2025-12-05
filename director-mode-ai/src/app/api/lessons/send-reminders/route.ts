import { Resend } from 'resend';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const resend = new Resend(process.env.RESEND_API_KEY);

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function formatDateForCalendar(startTime: Date, endTime: Date): { start: string; end: string } {
  const formatDate = (d: Date): string => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    return `${year}${month}${day}T${h}${m}00`;
  };

  return {
    start: formatDate(startTime),
    end: formatDate(endTime)
  };
}

function generateCalendarLinks(title: string, startTime: Date, endTime: Date, location?: string | null) {
  const { start, end } = formatDateForCalendar(startTime, endTime);
  const encodedTitle = encodeURIComponent(title);
  const details = encodeURIComponent('Lesson reminder from LastMinute Lessons');
  const loc = encodeURIComponent(location || '');

  const googleUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodedTitle}&dates=${start}/${end}&details=${details}&location=${loc}`;
  const outlookUrl = `https://outlook.live.com/calendar/0/deeplink/compose?subject=${encodedTitle}&startdt=${start}&enddt=${end}&body=${details}&location=${loc}`;

  return { googleUrl, outlookUrl };
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
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
        lesson_coaches(display_name, email),
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
      const calendarLinks = generateCalendarLinks(
        `Tennis Lesson with ${coachName}`,
        startTime,
        endTime,
        slot.location
      );

      // Send reminder to client
      try {
        await resend.emails.send({
          from: 'LastMinute Lessons <notifications@mixermodeai.com>',
          to: client.email,
          subject: `Reminder: Lesson with ${coachName} tomorrow`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #2563eb;">⏰ Lesson Reminder</h2>
              <p>Hi ${clientName},</p>
              <p>This is a friendly reminder that you have a lesson scheduled for <strong>tomorrow</strong>:</p>
              <div style="background: #eff6ff; padding: 16px; border-radius: 8px; margin: 16px 0; border-left: 4px solid #2563eb;">
                <p style="margin: 0;"><strong>Coach:</strong> ${coachName}</p>
                <p style="margin: 8px 0 0 0;"><strong>Date:</strong> ${formatDate(startTime)}</p>
                <p style="margin: 8px 0 0 0;"><strong>Time:</strong> ${formatTime(startTime)} - ${formatTime(endTime)}</p>
                ${slot.location ? `<p style="margin: 8px 0 0 0;"><strong>Location:</strong> ${slot.location}</p>` : ''}
              </div>
              <p style="margin-top: 24px;"><strong>Add to your calendar:</strong></p>
              <div style="margin: 16px 0;">
                <a href="${calendarLinks.googleUrl}" style="display: inline-block; background: #4285f4; color: white; padding: 10px 20px; border-radius: 6px; text-decoration: none; margin-right: 10px;">📅 Google Calendar</a>
                <a href="${calendarLinks.outlookUrl}" style="display: inline-block; background: #0078d4; color: white; padding: 10px 20px; border-radius: 6px; text-decoration: none;">📅 Outlook</a>
              </div>
              <p style="color: #666; font-size: 14px; margin-top: 24px;">
                Need to cancel? <a href="https://director-mode-ai.vercel.app/client/dashboard" style="color: #2563eb;">Manage your lessons</a>
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
        console.error('Failed to send reminder for slot:', slot.id, emailError);
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
