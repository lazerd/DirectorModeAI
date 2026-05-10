import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { sendSmsBatch } from '@/lib/twilio';
import { getPlanContext, eventHasDayPass, CreditLimitError } from '@/lib/billing';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    const { eventId, roundId } = await request.json();
    if (!eventId || !roundId) {
      return NextResponse.json({ error: 'eventId_and_roundId_required' }, { status: 400 });
    }

    // Gate: paid plan, OR event has Day Pass purchased
    const ctx = await getPlanContext(user.id);
    if (ctx.effectiveTier === 'free') {
      const dayPass = await eventHasDayPass(eventId);
      if (!dayPass) {
        return NextResponse.json(
          {
            error: 'sms_locked',
            message: 'SMS notifications require Pro, or a $9 Day Pass for this event.',
            upgradeUrl: '/pricing',
            eventId,
          },
          { status: 402 }
        );
      }
    }

    const service = await createServiceClient();
    const { data: round } = await service
      .from('mixer_rounds')
      .select('round_number, event_id')
      .eq('id', roundId)
      .single();
    if (!round || round.event_id !== eventId) {
      return NextResponse.json({ error: 'round_not_found' }, { status: 404 });
    }

    const { data: matches } = await service
      .from('mixer_matches')
      .select('court_number, player1_id, player2_id, player3_id, player4_id')
      .eq('round_id', roundId);

    const courtByPlayer = new Map<string, number>();
    for (const m of matches || []) {
      [m.player1_id, m.player2_id, m.player3_id, m.player4_id]
        .filter(Boolean)
        .forEach((pid: string) => courtByPlayer.set(pid, m.court_number));
    }
    const playerIds = Array.from(courtByPlayer.keys());
    if (playerIds.length === 0) {
      return NextResponse.json({ sent: 0, skipped: 0, failed: 0 });
    }

    const { data: players } = await service
      .from('mixer_players')
      .select('id, name, phone, sms_opt_in')
      .in('id', playerIds);

    const recipients = (players || [])
      .filter((p: any) => p.sms_opt_in && p.phone)
      .map((p: any) => ({
        phone: p.phone,
        body: `🎾 You're up! ${p.name}, head to Court ${courtByPlayer.get(p.id)} for Round ${round.round_number}.`,
      }));

    if (recipients.length === 0) {
      return NextResponse.json({
        sent: 0,
        skipped: 0,
        failed: 0,
        message: 'No players have SMS enabled. Edit a player to add a phone and enable SMS.',
      });
    }

    const result = await sendSmsBatch(user.id, recipients);
    return NextResponse.json(result);
  } catch (err: any) {
    if (err instanceof CreditLimitError) {
      return NextResponse.json(
        {
          error: 'credit_limit',
          kind: err.kind,
          tier: err.tier,
          limit: err.limit,
          message: err.message,
          upgradeUrl: '/pricing',
        },
        { status: 402 }
      );
    }
    console.error('[sms/match-time]', err);
    return NextResponse.json({ error: 'sms_failed', message: err?.message }, { status: 500 });
  }
}
