import { NextRequest, NextResponse } from 'next/server';
import { sendBilledEmail, resolveCoachUserId, creditLimitResponse, CreditLimitError } from '@/lib/email';

export async function POST(request: NextRequest) {
  try {
    const { coachEmail, coachName, clientName, clientEmail, message } = await request.json();

    if (!coachEmail || !clientName) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const ownerUserId = await resolveCoachUserId(undefined, coachEmail);
    await sendBilledEmail(ownerUserId, {
      from: 'LastMinute Lessons <notifications@coachmode.ai>',
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
          <a href="https://club.coachmode.ai/lessons/clients" style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; margin-top: 16px;">View Client Requests</a>
        </div>
      `
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof CreditLimitError) return creditLimitResponse(error);
    console.error('Client request notification error:', error);
    return NextResponse.json({ error: 'Failed to send notification' }, { status: 500 });
  }
}
