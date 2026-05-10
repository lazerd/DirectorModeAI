import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { eventCanUsePremium, consumeTtsChars, claimFreeDjIfNeeded, getPlanContext, eventHasDayPass } from '@/lib/billing';
import { generateAnnouncerMp3, buildAnnouncementText } from '@/lib/elevenlabs';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const { playerId, eventId, courtNumber, force } = await request.json();
    if (!playerId || !eventId) {
      return NextResponse.json({ error: 'playerId_and_eventId_required' }, { status: 400 });
    }

    const allowed = await eventCanUsePremium(user.id, eventId, 'dj_console');
    if (!allowed) {
      return NextResponse.json(
        {
          error: 'feature_locked',
          feature: 'dj_console',
          message: 'DJ Console requires Pro, or a $9 Day Pass for this event.',
          upgradeUrl: '/pricing',
          eventId,
        },
        { status: 402 }
      );
    }

    // If the user is on free and this isn't a Day-Pass event, claim it as their lifetime free event
    const ctx = await getPlanContext(user.id);
    if (ctx.effectiveTier === 'free') {
      const dayPass = await eventHasDayPass(eventId);
      if (!dayPass) {
        const claim = await claimFreeDjIfNeeded(user.id, eventId);
        if (!claim.ok) {
          return NextResponse.json(
            {
              error: 'free_event_used',
              message: 'You already used your free DJ event. Upgrade to Pro or buy a $9 Day Pass.',
              upgradeUrl: '/pricing',
              eventId,
            },
            { status: 402 }
          );
        }
      }
    }

    const service = await createServiceClient();
    const { data: player } = await service
      .from('mixer_players')
      .select('id, name, walkout_announcer_audio_url')
      .eq('id', playerId)
      .single();
    if (!player) return NextResponse.json({ error: 'player_not_found' }, { status: 404 });

    if (player.walkout_announcer_audio_url && !force) {
      return NextResponse.json({ url: player.walkout_announcer_audio_url, cached: true });
    }

    const text = buildAnnouncementText(player.name, courtNumber);
    const mp3 = await generateAnnouncerMp3(text);

    // Upload to Supabase storage (bucket: dj-audio)
    const path = `${user.id}/${eventId}/${player.id}.mp3`;
    const { error: uploadErr } = await service.storage
      .from('dj-audio')
      .upload(path, mp3, { contentType: 'audio/mpeg', upsert: true });
    if (uploadErr) {
      console.error('[dj/announcer] upload failed', uploadErr);
      return NextResponse.json(
        { error: 'storage_failed', message: uploadErr.message + ' (Did you create the dj-audio bucket?)' },
        { status: 500 }
      );
    }
    const {
      data: { publicUrl },
    } = service.storage.from('dj-audio').getPublicUrl(path);

    await service
      .from('mixer_players')
      .update({ walkout_announcer_audio_url: publicUrl })
      .eq('id', playerId);

    await consumeTtsChars(user.id, text.length);

    return NextResponse.json({ url: publicUrl, cached: false, text });
  } catch (err: any) {
    console.error('[dj/announcer]', err);
    return NextResponse.json({ error: 'tts_failed', message: err?.message }, { status: 500 });
  }
}
