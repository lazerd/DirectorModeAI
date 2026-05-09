import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { eventCanUsePremium } from '@/lib/billing';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const { playerId, eventId, songUrl, songTitle, songArtist, startSeconds } = await request.json();
    if (!playerId || !eventId) {
      return NextResponse.json({ error: 'playerId_and_eventId_required' }, { status: 400 });
    }

    const allowed = await eventCanUsePremium(user.id, eventId, 'dj_console');
    if (!allowed) {
      return NextResponse.json(
        { error: 'feature_locked', feature: 'dj_console', upgradeUrl: '/pricing' },
        { status: 402 }
      );
    }

    const service = await createServiceClient();
    await service
      .from('mixer_players')
      .update({
        walkout_song_url: songUrl || null,
        walkout_song_title: songTitle || null,
        walkout_song_artist: songArtist || null,
        walkout_song_start_seconds: Number(startSeconds) || 0,
        // Reset announcer cache so next /dj/announcer call regenerates with the right player name
        walkout_announcer_audio_url: null,
      })
      .eq('id', playerId);

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('[dj/save-walkout]', err);
    return NextResponse.json({ error: 'save_failed', message: err?.message }, { status: 500 });
  }
}
