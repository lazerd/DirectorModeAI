import { Resend } from 'resend';
import { NextRequest, NextResponse } from 'next/server';

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(request: NextRequest) {
  try {
    const { coachEmail, coachName, clientName, clientEmail, message } = await request.json();

    if (!coachEmail || !clientName) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    await resend.emails.send({
      from: 'LastMinute Lessons <notifications@mixermodeai.com>',
      to: coachEmail,
      subject: `New Client Request: ${clientName} wants to book lessons`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #2563eb;">New Client Request! 👋</h2>
          <p>Hi ${coachName || 'Coach'},</p>
          <p><strong>${clientName}</strong> wants to become your client and book lessons with you.</p>
          
          <div style="background: #eff6ff; padding: 16px; border-radius: 8px; margin: 16px 0;">
            <p style="margin: 0;"><strong>Name:</strong> ${clientName}</p>
            ${clientEmail ? `<p style="margin: 8px 0 0 0;"><strong>Email:</strong> ${clientEmail}</p>` : ''}
            ${message ? `<p style="margin: 8px 0 0 0;"><strong>Message:</strong> ${message}</p>` : ''}
          </div>
          
          <p>Go to your dashboard to approve or decline this request.</p>
          <a href="https://director-mode-ai.vercel.app/lessons/clients" style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; margin-top: 16px;">View Client Requests</a>
        </div>
      `
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Client request notification error:', error);
    return NextResponse.json({ error: 'Failed to send notification' }, { status: 500 });
  }
}
