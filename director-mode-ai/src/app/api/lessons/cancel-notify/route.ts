import { Resend } from 'resend';
import { NextRequest, NextResponse } from 'next/server';

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(request: NextRequest) {
  try {
    const { 
      recipientEmail, 
      recipientName, 
      cancelledBy,
      otherPartyName,
      slotDate, 
      slotTime,
      location 
    } = await request.json();

    if (!recipientEmail || !slotDate || !slotTime) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const isCoachNotification = cancelledBy === 'client';
    
    const subject = isCoachNotification 
      ? `Lesson Cancelled: ${otherPartyName} cancelled their booking`
      : `Lesson Cancelled: Your lesson with ${otherPartyName} has been cancelled`;

    const heading = isCoachNotification
      ? 'Lesson Cancelled by Client'
      : 'Your Lesson Has Been Cancelled';

    const message = isCoachNotification
      ? `<p><strong>${otherPartyName}</strong> has cancelled their lesson with you:</p>`
      : `<p><strong>${otherPartyName}</strong> has cancelled your scheduled lesson:</p>`;

    const dashboardUrl = isCoachNotification
      ? 'https://director-mode-ai.vercel.app/lessons/dashboard'
      : 'https://director-mode-ai.vercel.app/client/dashboard';

    const buttonText = isCoachNotification ? 'View Dashboard' : 'Book Another Lesson';

    await resend.emails.send({
      from: 'LastMinute Lessons <notifications@mixermodeai.com>',
      to: recipientEmail,
      subject,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #dc2626;">❌ ${heading}</h2>
          <p>Hi ${recipientName || 'there'},</p>
          ${message}
          <div style="background: #fef2f2; padding: 16px; border-radius: 8px; margin: 16px 0; border-left: 4px solid #dc2626;">
            <p style="margin: 0;"><strong>Date:</strong> ${slotDate}</p>
            <p style="margin: 8px 0 0 0;"><strong>Time:</strong> ${slotTime}</p>
            ${location ? `<p style="margin: 8px 0 0 0;"><strong>Location:</strong> ${location}</p>` : ''}
          </div>
          <p>This time slot is now available again.</p>
          <a href="${dashboardUrl}" style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; margin-top: 16px;">${buttonText}</a>
        </div>
      `
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Cancel notification error:', error);
    return NextResponse.json({ error: 'Failed to send notification' }, { status: 500 });
  }
}
