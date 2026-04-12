import { Resend } from 'resend';
import { NextRequest, NextResponse } from 'next/server';
import { safeResendSend } from '@/lib/emailUnsubscribe';

const resend = new Resend(process.env.RESEND_API_KEY);

function formatDateForCalendar(dateStr: string, timeStr: string): { start: string; end: string } {
  const date = new Date(dateStr);
  const [startTime, endTime] = timeStr.split(' - ');
  
  const parseTime = (timeString: string, baseDate: Date): string => {
    const [time, period] = timeString.split(' ');
    let [hours, minutes] = time.split(':').map(Number);
    if (period === 'PM' && hours !== 12) hours += 12;
    if (period === 'AM' && hours === 12) hours = 0;
    
    const year = baseDate.getFullYear();
    const month = String(baseDate.getMonth() + 1).padStart(2, '0');
    const day = String(baseDate.getDate()).padStart(2, '0');
    const h = String(hours).padStart(2, '0');
    const m = String(minutes).padStart(2, '0');
    
    return `${year}${month}${day}T${h}${m}00`;
  };

  return {
    start: parseTime(startTime, date),
    end: parseTime(endTime, date)
  };
}

function generateCalendarLinks(title: string, slotDate: string, slotTime: string, location?: string) {
  const { start, end } = formatDateForCalendar(slotDate, slotTime);
  const encodedTitle = encodeURIComponent(title);
  const details = encodeURIComponent(`Lesson booked via LastMinute Lessons`);
  const loc = encodeURIComponent(location || '');

  const googleUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodedTitle}&dates=${start}/${end}&details=${details}&location=${loc}`;
  const outlookUrl = `https://outlook.live.com/calendar/0/deeplink/compose?subject=${encodedTitle}&startdt=${start}&enddt=${end}&body=${details}&location=${loc}`;

  return { googleUrl, outlookUrl };
}

export async function POST(request: NextRequest) {
  try {
    const { coachEmail, coachName, clientName, clientEmail, slotDate, slotTime, location } = await request.json();

    if (!coachEmail || !clientName || !slotDate || !slotTime) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Email to coach
    const coachCalendarLinks = generateCalendarLinks(`Tennis Lesson with ${clientName}`, slotDate, slotTime, location);
    await safeResendSend(resend, {
      from: process.env.RESEND_FROM_EMAIL || 'CoachMode Lessons <noreply@coachmode.ai>',
      to: coachEmail,
      subject: `New Booking: ${clientName} booked a lesson`,
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
          <a href="https://club.coachmode.ai/lessons/dashboard" style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; margin-top: 16px;">View Dashboard</a>
        </div>
      `
    });

    // Email to client (if email provided)
    if (clientEmail) {
      const clientCalendarLinks = generateCalendarLinks(`Tennis Lesson with ${coachName || 'Coach'}`, slotDate, slotTime, location);
      await safeResendSend(resend, {
        from: process.env.RESEND_FROM_EMAIL || 'CoachMode Lessons <noreply@coachmode.ai>',
        to: clientEmail,
        subject: `Booking Confirmed: Lesson with ${coachName || 'your coach'}`,
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
            <a href="https://club.coachmode.ai/client/dashboard" style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; margin-top: 16px;">View My Lessons</a>
          </div>
        `
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Booking notification error:', error);
    return NextResponse.json({ error: 'Failed to send notification' }, { status: 500 });
  }
}
