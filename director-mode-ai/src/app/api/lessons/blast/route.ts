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

    // Get the base URL from environment or request
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://director-mode-ai.vercel.app';

    // Format slots for email with booking links
    const slotListHtml = slots.map(slot => {
      const start = new Date(slot.start_time);
      const end = new Date(slot.end_time);
      const dateStr = start.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
      const startTime = start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      const endTime = end.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      const location = slot.location ? ` at ${slot.location}` : '';
      const bookingUrl = `${baseUrl}/client/coach/${coachId}?slot=${slot.id}`;
      
      return `
        <div style="background: #f8fafc; border-radius: 8px; padding: 16px; margin-bottom: 12px;">
          <p style="margin: 0 0 8px 0; font-weight: 600; color: #1e293b;">
            📅 ${dateStr}
          </p>
          <p style="margin: 0 0 8px 0; color: #475569;">
            🕐 ${startTime} - ${endTime}${location}
          </p>
          <a href="${bookingUrl}" style="display: inline-block; background: #2563eb; color: white; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-weight: 600;">
            Book This Slot →
          </a>
        </div>
      `;
    }).join('');

    const emailHtml = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="text-align: center; margin-bottom: 24px;">
          <h1 style="color: #1e293b; margin: 0;">🎾 Last Minute Lesson Availability!</h1>
        </div>
        
        <p style="color: #475569; font-size: 16px;">Hi there!</p>
        
        <p style="color: #475569; font-size: 16px;">
          <strong>${coachName || 'Your coach'}</strong> has ${slots.length > 1 ? 'some last-minute openings' : 'a last-minute opening'} available:
        </p>
        
        ${slotListHtml}
        
        <p style="color: #475569; font-size: 14px; margin-top: 24px;">
          Click any slot above to book instantly. Spots are first-come, first-served!
        </p>
        
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
        
        <p style="color: #94a3b8; font-size: 12px; text-align: center;">
          Sent via LastMinute Lessons<br/>
          Reply to this email to contact your coach directly
        </p>
      </div>
    `;

    // Send to all clients
    const emailPromises = clientEmails.map((email: string) =>
      resend.emails.send({
        from: process.env.RESEND_FROM_EMAIL || 'LastMinute Lessons <onboarding@resend.dev>',
        to: email,
        replyTo: coachEmail,
        subject: `🎾 ${slots.length > 1 ? `${slots.length} Last Minute Lesson Openings` : 'Last Minute Lesson Opening'} Available!`,
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
