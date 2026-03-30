import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Generate a unique 6-char event code
function generateEventCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export async function POST(request: NextRequest) {
  try {
    const { ccEventId, userId } = await request.json();

    if (!ccEventId || !userId) {
      return NextResponse.json({ error: 'Missing eventId or userId' }, { status: 400 });
    }

    // Get CourtConnect event
    const { data: ccEvent } = await supabase
      .from('cc_events')
      .select('*')
      .eq('id', ccEventId)
      .single();

    if (!ccEvent) {
      return NextResponse.json({ error: 'CourtConnect event not found' }, { status: 404 });
    }

    // Get accepted players
    const { data: eventPlayers } = await supabase
      .from('cc_event_players')
      .select('*, player:cc_players(display_name, profile_id)')
      .eq('event_id', ccEventId)
      .eq('status', 'accepted');

    if (!eventPlayers || eventPlayers.length < 2) {
      return NextResponse.json({ error: 'Need at least 2 confirmed players' }, { status: 400 });
    }

    // Create MixerMode event
    const eventCode = generateEventCode();
    const { data: mixerEvent, error: eventError } = await supabase
      .from('mixer_events')
      .insert({
        user_id: userId,
        name: ccEvent.title,
        event_code: eventCode,
        event_date: ccEvent.event_date,
        start_time: ccEvent.start_time,
        num_courts: ccEvent.court_count || Math.ceil(eventPlayers.length / 4),
        match_format: ccEvent.event_type === 'singles' ? 'singles' : 'doubles',
        format_notes: `Created from CourtConnect event. Sport: ${ccEvent.sport}`,
      })
      .select()
      .single();

    if (eventError || !mixerEvent) {
      return NextResponse.json({ error: eventError?.message || 'Failed to create mixer event' }, { status: 500 });
    }

    // Add players to mixer event
    let addedPlayers = 0;
    for (let i = 0; i < eventPlayers.length; i++) {
      const ep = eventPlayers[i];
      const playerName = ep.player?.display_name || ep.guest_name || 'Unknown';

      const { data: mixerPlayer } = await supabase
        .from('mixer_players')
        .insert({
          event_id: mixerEvent.id,
          name: playerName,
          skill_level: 3, // default, can be adjusted
          strength_order: i,
        })
        .select()
        .single();

      if (mixerPlayer) addedPlayers++;
    }

    return NextResponse.json({
      success: true,
      mixerEventId: mixerEvent.id,
      eventCode,
      playersAdded: addedPlayers,
    });

  } catch (error) {
    console.error('Create mixer event error:', error);
    return NextResponse.json({ error: 'Failed to create mixer event' }, { status: 500 });
  }
}
