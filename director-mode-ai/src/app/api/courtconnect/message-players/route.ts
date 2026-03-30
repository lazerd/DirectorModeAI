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
    const { eventId, subject, message } = await request.json();

    if (!eventId || !message) {
      return NextResponse.json({ error: 'Event ID and message required' }, { status: 400 });
    }

    // Get event
    const { data: event } = await supabase
      .from('cc_events')
      .select('*')
      .eq('id', eventId)
      .single();

    if (!event) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    // Get creator info
    const { data: creator } = await supabase
      .from('profiles')
      .select('full_name, email')
      .eq('id', event.created_by)
      .single();

    // Get accepted players' emails
    const { data: eventPlayers } = await supabase
      .from('cc_event_players')
      .select('*, player:cc_players(display_name, profile_id)')
      .eq('event_id', eventId)
      .eq('status', 'accepted');

    if (!eventPlayers || eventPlayers.length === 0) {
      return NextResponse.json({ success: true, sent: 0, message: 'No confirmed players to message' });
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://club.coachmode.ai';
    const eventUrl = `${baseUrl}/courtconnect/events/${eventId}`;
    const sportLabel = event.sport.replace('_', ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());

    let sent = 0;
    let failed = 0;

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

          <h1 style="color: #1e293b; text-align: center; font-size: 22px; margin-bottom: 8px;">
            Message from ${creator?.full_name || 'Event Organizer'}
          </h1>
          <p style="color: #64748b; text-align: center; font-size: 14px; margin-bottom: 24px;">
            About: <strong>${event.title}</strong> (${sportLabel})
          </p>

          <div style="background: #f8fafc; border-radius: 12px; padding: 24px; margin: 16px 0; border: 1px solid #e2e8f0;">
            <p style="margin: 0; color: #334155; font-size: 16px; line-height: 1.7; white-space: pre-wrap;">${message}</p>
          </div>

          <div style="text-align: center; margin: 32px 0;">
            <a href="${eventUrl}" style="display: inline-block; background: linear-gradient(135deg, #22c55e, #10b981); color: white; padding: 12px 28px; border-radius: 10px; text-decoration: none; font-weight: 600;">
              View Event
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
          replyTo: creator?.email,
          subject: subject || `Message about ${event.title}`,
          html: emailHtml,
        });
        sent++;
      } catch (err) {
        console.error(`Failed to message ${profile.email}:`, err);
        failed++;
      }
    }

    return NextResponse.json({ success: true, sent, failed });

  } catch (error) {
    console.error('Message players error:', error);
    return NextResponse.json({ error: 'Failed to send messages' }, { status: 500 });
  }
}
