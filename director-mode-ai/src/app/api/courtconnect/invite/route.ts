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
    const { eventId, playerIds, skillFilter } = await request.json();

    if (!eventId) {
      return NextResponse.json({ error: 'Event ID required' }, { status: 400 });
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

    // Get creator profile
    const { data: creator } = await supabase
      .from('profiles')
      .select('full_name, email')
      .eq('id', event.created_by)
      .single();

    // Determine which players to invite
    let playersToInvite: { id: string; email: string; display_name: string }[] = [];

    if (playerIds && playerIds.length > 0) {
      // Invite specific players
      const { data: players } = await supabase
        .from('cc_players')
        .select('id, display_name, profile_id')
        .in('id', playerIds);

      if (players) {
        for (const player of players) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('email')
            .eq('id', player.profile_id)
            .single();
          if (profile?.email) {
            playersToInvite.push({
              id: player.id,
              email: profile.email,
              display_name: player.display_name,
            });
          }
        }
      }
    } else if (skillFilter) {
      // Find players matching skill criteria for the event's sport
      let sportQuery = supabase
        .from('cc_player_sports')
        .select('player_id, ntrp_rating')
        .eq('sport', event.sport);

      if (skillFilter.min) {
        sportQuery = sportQuery.gte('ntrp_rating', skillFilter.min);
      }
      if (skillFilter.max) {
        sportQuery = sportQuery.lte('ntrp_rating', skillFilter.max);
      }

      const { data: matchingSports } = await sportQuery;

      if (matchingSports) {
        const matchingPlayerIds = matchingSports.map(s => s.player_id);

        // Exclude players already invited/accepted
        const { data: existingEntries } = await supabase
          .from('cc_event_players')
          .select('player_id')
          .eq('event_id', eventId)
          .in('player_id', matchingPlayerIds);

        const alreadyInvited = new Set(existingEntries?.map(e => e.player_id) || []);
        const newPlayerIds = matchingPlayerIds.filter(id => !alreadyInvited.has(id));

        if (newPlayerIds.length > 0) {
          const { data: players } = await supabase
            .from('cc_players')
            .select('id, display_name, profile_id')
            .in('id', newPlayerIds);

          if (players) {
            for (const player of players) {
              // Don't invite the event creator
              if (player.profile_id === event.created_by) continue;

              const { data: profile } = await supabase
                .from('profiles')
                .select('email')
                .eq('id', player.profile_id)
                .single();
              if (profile?.email) {
                playersToInvite.push({
                  id: player.id,
                  email: profile.email,
                  display_name: player.display_name,
                });
              }
            }
          }
        }
      }
    }

    if (playersToInvite.length === 0) {
      return NextResponse.json({ success: true, sent: 0, message: 'No matching players found' });
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://director-mode-ai.vercel.app';
    const eventUrl = `${baseUrl}/courtconnect/events/${eventId}`;

    const sportLabel = event.sport.replace('_', ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
    const typeLabel = event.event_type.replace('_', ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());

    const eventDate = new Date(event.event_date).toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      timeZone: event.timezone || 'America/New_York',
    });

    // Send emails and create invite records
    let successCount = 0;
    let failCount = 0;

    for (const player of playersToInvite) {
      const emailHtml = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="text-align: center; margin-bottom: 24px;">
            <div style="display: inline-block; background: linear-gradient(135deg, #22c55e, #10b981); color: white; padding: 8px 20px; border-radius: 20px; font-size: 14px; font-weight: 600;">
              CourtConnect
            </div>
          </div>

          <h1 style="color: #1e293b; margin: 0 0 8px 0; font-size: 24px; text-align: center;">
            You're Invited!
          </h1>

          <p style="color: #475569; font-size: 16px; line-height: 1.6; text-align: center;">
            ${creator?.full_name || 'Someone'} invited you to a ${sportLabel.toLowerCase()} event.
          </p>

          <div style="background: #f0fdf4; border-radius: 12px; padding: 24px; margin: 24px 0; border: 1px solid #bbf7d0;">
            <h2 style="margin: 0 0 16px 0; color: #166534; font-size: 20px;">${event.title}</h2>
            ${event.description ? `<p style="margin: 0 0 16px 0; color: #475569;">${event.description}</p>` : ''}
            <table style="width: 100%; font-size: 15px; color: #334155;">
              <tr><td style="padding: 4px 0; font-weight: 600;">Sport:</td><td>${sportLabel}</td></tr>
              <tr><td style="padding: 4px 0; font-weight: 600;">Type:</td><td>${typeLabel}</td></tr>
              <tr><td style="padding: 4px 0; font-weight: 600;">Date:</td><td>${eventDate}</td></tr>
              <tr><td style="padding: 4px 0; font-weight: 600;">Time:</td><td>${event.start_time.slice(0, 5)}${event.end_time ? ' - ' + event.end_time.slice(0, 5) : ''}</td></tr>
              ${event.location ? `<tr><td style="padding: 4px 0; font-weight: 600;">Location:</td><td>${event.location}</td></tr>` : ''}
              <tr><td style="padding: 4px 0; font-weight: 600;">Spots:</td><td>${event.max_players} players max</td></tr>
              ${event.skill_min || event.skill_max ? `<tr><td style="padding: 4px 0; font-weight: 600;">Level:</td><td>NTRP ${event.skill_min || '1.0'} - ${event.skill_max || '7.0'}</td></tr>` : ''}
            </table>
          </div>

          <div style="text-align: center; margin: 32px 0;">
            <a href="${eventUrl}" style="display: inline-block; background: linear-gradient(135deg, #22c55e, #10b981); color: white; padding: 14px 32px; border-radius: 10px; text-decoration: none; font-weight: 600; font-size: 16px;">
              View Event & RSVP
            </a>
          </div>

          <p style="color: #94a3b8; font-size: 12px; text-align: center; margin-top: 32px;">
            Sent via CourtConnect by ClubMode AI
          </p>
        </div>
      `;

      try {
        await resend.emails.send({
          from: process.env.RESEND_FROM_EMAIL || 'CourtConnect <notifications@mixermodeai.com>',
          to: player.email,
          replyTo: creator?.email,
          subject: `You're invited: ${event.title} - ${sportLabel} ${typeLabel}`,
          html: emailHtml,
        });

        // Create event_player entry as 'invited'
        await supabase
          .from('cc_event_players')
          .upsert({
            event_id: eventId,
            player_id: player.id,
            status: 'invited',
            invited_at: new Date().toISOString(),
          }, { onConflict: 'event_id,player_id' });

        // Track the invitation
        await supabase
          .from('cc_invitations')
          .insert({
            event_id: eventId,
            player_id: player.id,
            email: player.email,
            status: 'sent',
          });

        successCount++;
      } catch (err) {
        console.error(`Failed to send invite to ${player.email}:`, err);
        failCount++;
      }
    }

    return NextResponse.json({
      success: true,
      sent: successCount,
      failed: failCount,
      total: playersToInvite.length,
    });

  } catch (error) {
    console.error('Invite error:', error);
    return NextResponse.json({ error: 'Failed to send invites' }, { status: 500 });
  }
}
