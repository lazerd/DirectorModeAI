import { Resend } from 'resend';
import { NextRequest, NextResponse } from 'next/server';

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(request: NextRequest) {
  try {
    const { coachEmail, coachName, clientName, slotDate, slotTime } = await request.json();

    if (!coachEmail || !clientName || !slotDate || !slotTime) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    await resend.emails.send({
      from: 'LastMinute Lessons <notifications@directormode.ai>',
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
          </div>
          <p>View your dashboard to see all bookings.</p>
          <a href="https://director-mode-ai.vercel.app/lessons/dashboard" style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; margin-top: 16px;">View Dashboard</a>
        </div>
      `
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Booking notification error:', error);
    return NextResponse.json({ error: 'Failed to send notification' }, { status: 500 });
  }
}
