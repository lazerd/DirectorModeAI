import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { createClient } from '@supabase/supabase-js';

const resend = new Resend(process.env.RESEND_API_KEY);

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
  try {
    const { coachId, slotIds, clientEmails, coachName, coachEmail } = await request.json();

    // Get slot details
    const { data: slots } = await supabase
      .from('lesson_slots')
      .select('*')
      .in('id', slotIds)
      .order('start_time');

    if (!slots || slots.length === 0) {
      return NextResponse.json({ error: 'No slots found' }, { status: 400 });
    }

    // Format slots for email
    const slotList = slots.map(slot => {
      const start = new Date(slot.start_time);
      const end = new Date(slot.end_time);
      const dateStr = start.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
      const startTime = start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      const endTime = end.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      const location = slot.location ? ` at ${slot.location}` : '';
      return `• ${dateStr}: ${startTime} - ${endTime}${location}`;
    }).join('\n');

    const emailHtml = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #2563eb;">Last Minute Lesson Availability! 🎾</h2>
        <p>Hi there!</p>
        <p><strong>${coachName || 'Your coach'}</strong> has last-minute lesson availability:</p>
        <div style="background: #f3f4f6; padding: 16px; border-radius: 8px; margin: 16px 0;">
          <pre style="margin: 0; white-space: pre-wrap; font-family: sans-serif;">${slotList}</pre>
        </div>
        <p>Interested? Reply to this email or contact your coach directly to book!</p>
        <p style="color: #6b7280; font-size: 14px; margin-top: 24px;">
          — Sent via LastMinute Lessons
        </p>
      </div>
    `;

    // Send to all clients
    const emailPromises = clientEmails.map((email: string) =>
      resend.emails.send({
        from: process.env.RESEND_FROM_EMAIL || 'LastMinute Lessons <onboarding@resend.dev>',
        to: email,
        replyTo: coachEmail,
        subject: `🎾 Last Minute Lesson Opening${slots.length > 1 ? 's' : ''} Available!`,
        html: emailHtml,
      })
    );

    const results = await Promise.allSettled(emailPromises);
    const successCount = results.filter(r => r.status === 'fulfilled').length;
    const failCount = results.filter(r => r.status === 'rejected').length;

    // Mark slots as notified
    await supabase
      .from('lesson_slots')
      .update({ notifications_sent: true, notified_at: new Date().toISOString() })
      .in('id', slotIds);

    // Record the blast
    await supabase.from('lesson_blasts').insert({
      coach_id: coachId,
      slots_count: slots.length,
      recipients_count: successCount,
      sent_at: new Date().toISOString(),
      subject: `Last Minute Lesson Opening${slots.length > 1 ? 's' : ''} Available!`
    });

    return NextResponse.json({ 
      success: true, 
      sent: successCount, 
      failed: failCount 
    });

  } catch (error) {
    console.error('Blast error:', error);
    return NextResponse.json({ error: 'Failed to send blast' }, { status: 500 });
  }
}
