import { NextRequest, NextResponse } from 'next/server';
import { sendBilledEmail, resolveCoachUserId, creditLimitResponse, CreditLimitError } from '@/lib/email';
import { lessonCancelEmail } from '@/lib/lessons/cancelEmail';

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

    // The coach pays. If client cancelled, recipient is the coach. If coach cancelled, find them by recipientEmail anyway since we don't track which side it was.
    const ownerUserId = await resolveCoachUserId(undefined, recipientEmail);

    if (!recipientEmail || !slotDate || !slotTime) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // The message itself is built in lib/lessons/cancelEmail.ts, shared with the assistant.
    await sendBilledEmail(ownerUserId, {
      ...lessonCancelEmail({ recipientName, cancelledBy, otherPartyName, slotDate, slotTime, location }),
      to: recipientEmail,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof CreditLimitError) return creditLimitResponse(error);
    console.error('Cancel notification error:', error);
    return NextResponse.json({ error: 'Failed to send notification' }, { status: 500 });
  }
}
