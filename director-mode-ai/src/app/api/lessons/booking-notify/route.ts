import { Resend } from 'resend';
import { NextRequest, NextResponse } from 'next/server';

const resend = new Resend(process.env.RESEND_API_KEY);

function formatDateForCalendar(dateStr: string, timeStr: string): { start: string; end: string } {
  // Parse "Friday, December 5, 2025" and "9:00 AM - 10:00 AM"
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
    
    // Return in format: 20251205T090000 (no Z = local time)
    return `${year}${month}${day}T${h}${m}00`;
  };

  return {
    start: parseTime(startTime, date),
    end: parseTime(endTime, date)
  };
}

function generateCalendarLinks(clientName: string, slotDate: string, slotTime: string, location?: string) {
  const { start, end } = formatDateForCalendar(slotDate, slotTime);
  const title = encodeURIComponent(`Tennis Lesson with ${clientName}`);
  const details = encodeURIComponent(`Lesson booked via LastMinute Lessons`);
  const loc = encodeURIComponent(location || '');

  const googleUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${start}/${end}&details=${details}&location=${loc}`;
  
  const outlookUrl = `https://outlook.live.com/calendar/0/deeplink/compose?subject=${title}&startdt=${start}&enddt=${end}&body=${details}&location=${loc}`;

  return { googleUrl, outlookUrl };
}

export async function POST(request: NextRequest) {
  try {
    const { coachEmail, coachName, clientName, slotDate, slotTime, location } = await request.json();

    if (!coachEmail || !clientName || !slotDate || !slotTime) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const { googleUrl, outlookUrl } = generateCalendarLinks(clientName, slotDate, slotTime, location);

    await resend.emails.send({
      from: 'LastMinute Lessons <notifications@mixermodeai.com>',
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
            <a href="${googleUrl}" style="display: inline-block; background: #4285f4; color: white; padding: 10px 20px; border-radius: 6px; text-decoration: none; margin-right: 10px;">📅 Google Calendar</a>
            <a href="${outlookUrl}" style="display: inline-block; background: #0078d4; color: white; padding: 10px 20px; border-radius: 6px; text-decoration: none;">📅 Outlook</a>
          </div>
          
          <p style="margin-top: 24px;">View your dashboard to see all bookings.</p>
          <a href="https://director-mode-ai.vercel.app/lessons/dashboard" style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; margin-top: 8px;">View Dashboard</a>
        </div>
      `
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Booking notification error:', error);
    return NextResponse.json({ error: 'Failed to send notification' }, { status: 500 });
  }
}
