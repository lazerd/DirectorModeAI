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
    const { eventId, playerName, rsvpStatus } = await request.json();

    if (!eventId || !playerName || !rsvpStatus) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Get event details
    const { data: event } = await supabase
      .from('cc_events')
      .select('*')
      .eq('id', eventId)
      .single();

    if (!event) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    // Get creator email
    const { data: creator } = await supabase
      .from('profiles')
      .select('email, full_name')
      .eq('id', event.created_by)
      .single();

    if (!creator?.email) {
      return NextResponse.json({ error: 'Creator email not found' }, { status: 404 });
    }

    // Get current player counts
    const { count: acceptedCount } = await supabase
      .from('cc_event_players')
      .select('*', { count: 'exact', head: true })
      .eq('event_id', eventId)
      .eq('status', 'accepted');

    const { count: waitlistedCount } = await supabase
      .from('cc_event_players')
      .select('*', { count: 'exact', head: true })
      .eq('event_id', eventId)
      .eq('status', 'waitlisted');

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://club.coachmode.ai';
    const eventUrl = `${baseUrl}/courtconnect/events/${eventId}`;

    const statusEmoji = rsvpStatus === 'accepted' ? '✅' : rsvpStatus === 'waitlisted' ? '⏳' : '❌';
    const statusLabel = rsvpStatus.charAt(0).toUpperCase() + rsvpStatus.slice(1);
    const spotsLeft = event.max_players - (acceptedCount || 0);

    const emailHtml = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="text-align: center; margin-bottom: 24px;">
          <div style="display: inline-block; background: linear-gradient(135deg, #22c55e, #10b981); color: white; padding: 8px 20px; border-radius: 20px; font-size: 14px; font-weight: 600;">
            CourtConnect
          </div>
        </div>

        <h1 style="color: #1e293b; margin: 0 0 16px 0; font-size: 24px; text-align: center;">
          ${statusEmoji} RSVP Update
        </h1>

        <p style="color: #475569; font-size: 16px; line-height: 1.6; text-align: center;">
          <strong>${playerName}</strong> has <strong>${statusLabel.toLowerCase()}</strong> your event.
        </p>

        <div style="background: #f8fafc; border-radius: 12px; padding: 20px; margin: 24px 0; border: 1px solid #e2e8f0;">
          <h3 style="margin: 0 0 12px 0; color: #1e293b;">${event.title}</h3>
          <p style="margin: 0; color: #475569; font-size: 14px;">
            ${acceptedCount || 0}/${event.max_players} confirmed
            ${spotsLeft > 0 ? ` · ${spotsLeft} spot${spotsLeft !== 1 ? 's' : ''} left` : ' · Full'}
            ${(waitlistedCount || 0) > 0 ? ` · ${waitlistedCount} on waitlist` : ''}
          </p>
        </div>

        <div style="text-align: center; margin: 24px 0;">
          <a href="${eventUrl}" style="display: inline-block; background: linear-gradient(135deg, #22c55e, #10b981); color: white; padding: 12px 28px; border-radius: 10px; text-decoration: none; font-weight: 600;">
            View Event
          </a>
        </div>

        <p style="color: #94a3b8; font-size: 12px; text-align: center; margin-top: 32px;">
          Sent via CourtConnect by ClubMode AI
        </p>
      </div>
    `;

    await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL || 'CourtConnect <notifications@coachmode.ai>',
      to: creator.email,
      subject: `${statusEmoji} ${playerName} ${statusLabel.toLowerCase()} - ${event.title}`,
      html: emailHtml,
    });

    // Auto-close event if full
    if (event.auto_close && (acceptedCount || 0) >= event.max_players && event.status === 'open') {
      await supabase
        .from('cc_events')
        .update({ status: 'closed' })
        .eq('id', eventId);
    }

    // Waitlist promotion: if someone declined and there's a waitlisted player, promote them
    if (rsvpStatus === 'declined' && (acceptedCount || 0) < event.max_players) {
      const { data: nextWaitlisted } = await supabase
        .from('cc_event_players')
        .select('*, player:cc_players(display_name, profile_id)')
        .eq('event_id', eventId)
        .eq('status', 'waitlisted')
        .order('response_order', { ascending: true })
        .limit(1)
        .single();

      if (nextWaitlisted) {
        // Promote from waitlist
        await supabase
          .from('cc_event_players')
          .update({ status: 'accepted', responded_at: new Date().toISOString() })
          .eq('id', nextWaitlisted.id);

        // Notify promoted player
        if (nextWaitlisted.player?.profile_id) {
          const { data: promotedProfile } = await supabase
            .from('profiles')
            .select('email')
            .eq('id', nextWaitlisted.player.profile_id)
            .single();

          if (promotedProfile?.email) {
            await resend.emails.send({
              from: process.env.RESEND_FROM_EMAIL || 'CourtConnect <notifications@coachmode.ai>',
              to: promotedProfile.email,
              subject: `🎉 You're in! Spot opened for ${event.title}`,
              html: `
                <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                  <div style="text-align: center; margin-bottom: 24px;">
                    <div style="display: inline-block; background: linear-gradient(135deg, #22c55e, #10b981); color: white; padding: 8px 20px; border-radius: 20px; font-size: 14px; font-weight: 600;">
                      CourtConnect
                    </div>
                  </div>
                  <h1 style="color: #166534; text-align: center; font-size: 24px;">You've been promoted from the waitlist!</h1>
                  <p style="color: #475569; font-size: 16px; text-align: center; line-height: 1.6;">
                    A spot opened up in <strong>${event.title}</strong> and you're now confirmed!
                  </p>
                  <div style="text-align: center; margin: 32px 0;">
                    <a href="${eventUrl}" style="display: inline-block; background: linear-gradient(135deg, #22c55e, #10b981); color: white; padding: 14px 32px; border-radius: 10px; text-decoration: none; font-weight: 600; font-size: 16px;">
                      View Event Details
                    </a>
                  </div>
                  <p style="color: #94a3b8; font-size: 12px; text-align: center;">Sent via CourtConnect by ClubMode AI</p>
                </div>
              `,
            });
          }
        }
      }
    }

    return NextResponse.json({ success: true });

  } catch (error) {
    console.error('RSVP notify error:', error);
    return NextResponse.json({ error: 'Failed to send notification' }, { status: 500 });
  }
}
