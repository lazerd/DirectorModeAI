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
    const { coachId, slotIds, clientEmails, coachName, coachEmail, timezone } = await request.json();

    // Get slot details
    const { data: slots } = await supabase
      .from('lesson_slots')
      .select('*')
      .in('id', slotIds)
      .order('start_time');

    if (!slots || slots.length === 0) {
      return NextResponse.json({ error: 'No slots found' }, { status: 400 });
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://director-mode-ai.vercel.app';

    // Format slots for email with direct booking links
    const slotListHtml = slots.map(slot => {
      const start = new Date(slot.start_time);
      const end = new Date(slot.end_time);
      
      // Format in a timezone-aware way
      const dateStr = start.toLocaleDateString('en-US', { 
        weekday: 'long', 
        month: 'long', 
        day: 'numeric',
        timeZone: timezone || 'America/Los_Angeles'
      });
      const startTime = start.toLocaleTimeString('en-US', { 
        hour: 'numeric', 
        minute: '2-digit',
        timeZone: timezone || 'America/Los_Angeles'
      });
      const endTime = end.toLocaleTimeString('en-US', { 
        hour: 'numeric', 
        minute: '2-digit',
        timeZone: timezone || 'America/Los_Angeles'
      });
      const location = slot.location ? `📍 ${slot.location}` : '';
      
      // Direct booking link
      const bookingUrl = `${baseUrl}/book/${slot.id}`;
      
      return `
        <div style="background: #f8fafc; border-radius: 12px; padding: 20px; margin-bottom: 16px; border: 1px solid #e2e8f0;">
          <p style="margin: 0 0 8px 0; font-size: 18px; font-weight: 600; color: #1e293b;">
            📅 ${dateStr}
          </p>
          <p style="margin: 0 0 12px 0; color: #475569; font-size: 16px;">
            🕐 ${startTime} - ${endTime}
          </p>
          ${location ? `<p style="margin: 0 0 12px 0; color: #475569; font-size: 14px;">${location}</p>` : ''}
          <a href="${bookingUrl}" style="display: inline-block; background: #16a34a; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 16px;">
            ✓ Book This Slot
          </a>
        </div>
      `;
    }).join('');

    const emailHtml = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="text-align: center; margin-bottom: 24px;">
          <h1 style="color: #1e293b; margin: 0; font-size: 28px;">🎾 Lesson Time Available!</h1>
        </div>
        
        <p style="color: #475569; font-size: 16px; line-height: 1.6;">Hi there!</p>
        
        <p style="color: #475569; font-size: 16px; line-height: 1.6;">
          Great news! <strong>${coachName || 'Your coach'}</strong> has ${slots.length > 1 ? 'some last-minute openings' : 'a last-minute opening'} available.
        </p>
        
        <div style="margin: 24px 0;">
          ${slotListHtml}
        </div>
        
        <p style="color: #64748b; font-size: 14px; line-height: 1.6;">
          ⚡ Spots are first-come, first-served. Click a slot above to book instantly!
        </p>
        
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 32px 0;" />
        
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
        subject: `🎾 ${coachName || 'Your Coach'} has lesson time available!`,
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
      subject: `Lesson Opening${slots.length > 1 ? 's' : ''} Available!`
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
