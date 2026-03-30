import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { createClient } from '@supabase/supabase-js';

const resend = new Resend(process.env.RESEND_API_KEY);

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Cron-triggered: send reminders for events happening tomorrow
export async function GET(request: NextRequest) {
  try {
    // Get tomorrow's date
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];

    // Find open events happening tomorrow
    const { data: events } = await supabase
      .from('cc_events')
      .select('*')
      .eq('event_date', tomorrowStr)
      .in('status', ['open', 'closed']);

    if (!events || events.length === 0) {
      return NextResponse.json({ message: 'No events tomorrow', sent: 0 });
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://club.coachmode.ai';
    let totalSent = 0;

    for (const event of events) {
      // Get accepted players
      const { data: eventPlayers } = await supabase
        .from('cc_event_players')
        .select('*, player:cc_players(display_name, profile_id)')
        .eq('event_id', event.id)
        .eq('status', 'accepted');

      if (!eventPlayers || eventPlayers.length === 0) continue;

      // Get creator name
      const { data: creator } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', event.created_by)
        .single();

      const sportLabel = event.sport.replace('_', ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
      const eventUrl = `${baseUrl}/courtconnect/events/${event.id}`;

      const eventDate = new Date(event.event_date).toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      });

      for (const ep of eventPlayers) {
        if (!ep.player?.profile_id) continue;

        const { data: profile } = await supabase
          .from('profiles')
          .select('email')
          .eq('id', ep.player.profile_id)
          .single();

        if (!profile?.email) continue;

        const emailHtml = `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="text-align: center; margin-bottom: 24px;">
              <div style="display: inline-block; background: linear-gradient(135deg, #22c55e, #10b981); color: white; padding: 8px 20px; border-radius: 20px; font-size: 14px; font-weight: 600;">
                CourtConnect
              </div>
            </div>

            <h1 style="color: #1e293b; text-align: center; font-size: 24px; margin-bottom: 8px;">
              Reminder: You're playing tomorrow!
            </h1>

            <div style="background: #f0fdf4; border-radius: 12px; padding: 24px; margin: 24px 0; border: 1px solid #bbf7d0;">
              <h2 style="margin: 0 0 16px 0; color: #166534; font-size: 20px;">${event.title}</h2>
              <table style="width: 100%; font-size: 15px; color: #334155;">
                <tr><td style="padding: 4px 0; font-weight: 600;">When:</td><td>${eventDate} at ${event.start_time.slice(0, 5)}${event.end_time ? ' - ' + event.end_time.slice(0, 5) : ''}</td></tr>
                ${event.location ? `<tr><td style="padding: 4px 0; font-weight: 600;">Where:</td><td>${event.location}</td></tr>` : ''}
                <tr><td style="padding: 4px 0; font-weight: 600;">Sport:</td><td>${sportLabel}</td></tr>
                <tr><td style="padding: 4px 0; font-weight: 600;">Organizer:</td><td>${creator?.full_name || 'Unknown'}</td></tr>
              </table>
            </div>

            <div style="text-align: center; margin: 32px 0;">
              <a href="${eventUrl}" style="display: inline-block; background: linear-gradient(135deg, #22c55e, #10b981); color: white; padding: 14px 32px; border-radius: 10px; text-decoration: none; font-weight: 600; font-size: 16px;">
                View Event Details
              </a>
            </div>

            <p style="color: #94a3b8; font-size: 12px; text-align: center;">
              Sent via CourtConnect by ClubMode AI
            </p>
          </div>
        `;

        try {
          await resend.emails.send({
            from: process.env.RESEND_FROM_EMAIL || 'CourtConnect <notifications@coachmode.ai>',
            to: profile.email,
            subject: `Reminder: ${event.title} is tomorrow!`,
            html: emailHtml,
          });
          totalSent++;
        } catch (err) {
          console.error(`Failed to send reminder to ${profile.email}:`, err);
        }
      }
    }

    return NextResponse.json({ success: true, sent: totalSent, events: events.length });

  } catch (error) {
    console.error('Event reminder error:', error);
    return NextResponse.json({ error: 'Failed to send reminders' }, { status: 500 });
  }
}
