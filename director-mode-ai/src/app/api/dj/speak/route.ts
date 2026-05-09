import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { eventCanUsePremium, claimFreeDjIfNeeded, getPlanContext, consumeTtsChars, eventHasDayPass } from '@/lib/billing';
import { generateAnnouncerMp3 } from '@/lib/elevenlabs';

export const runtime = 'nodejs';

/**
 * Generates an announcer MP3 from arbitrary text (openings, court intros, closings).
 * Streams the audio back directly — not cached in storage, since these are
 * usually one-offs per show.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const { text, eventId } = await request.json();
    if (!text || !eventId) {
      return NextResponse.json({ error: 'text_and_eventId_required' }, { status: 400 });
    }
    if (text.length > 600) {
      return NextResponse.json({ error: 'text_too_long', message: 'Keep cue text under 600 characters.' }, { status: 400 });
    }

    // Gate access
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

    // Claim free DJ event if user is on free and not yet claimed
    const ctx = await getPlanContext(user.id);
    if (ctx.effectiveTier === 'free') {
      const dayPass = await eventHasDayPass(eventId);
      if (!dayPass) {
        const claim = await claimFreeDjIfNeeded(user.id, eventId);
        if (!claim.ok) {
          return NextResponse.json(
            {
              error: 'free_event_used',
              message: 'You already used your free DJ event. Upgrade to Pro or buy a $9 Day Pass to use it on this event.',
              upgradeUrl: '/pricing',
              eventId,
            },
            { status: 402 }
          );
        }
      }
    }

    const mp3 = await generateAnnouncerMp3(text);
    await consumeTtsChars(user.id, text.length);

    return new Response(new Uint8Array(mp3), {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'private, max-age=300',
      },
    });
  } catch (err: any) {
    console.error('[dj/speak]', err);
    return NextResponse.json({ error: 'tts_failed', message: err?.message }, { status: 500 });
  }
}
