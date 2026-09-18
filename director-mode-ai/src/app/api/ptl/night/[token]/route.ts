/**
 * Match-night score entry.
 *
 * The night token is the credential — whoever is running the evening has the
 * link, and they are standing on a court, not logged into anything.
 *
 * Two actions, and the reason they're separate is the whole point of the
 * format: a `line` is a match that was played, a `shootout` is a tiebreak the
 * players were sent back out for because the meeting would not resolve. The
 * server decides which shootouts are needed and refuses any that aren't, so
 * nobody can invent a decider for a meeting that was already settled.
 */

import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import {
  applyLineScore,
  applyShootout,
  getNightByToken,
  refreshNightStatus,
} from '@/lib/ptl/scoring';
import type { ShootoutKind } from '@/lib/ptl/meeting';
import { checkRateLimit, clampNumber, clampText, clientIp } from '@/lib/ptl/guard';

const KINDS: ShootoutKind[] = ['tb7_singles', 'tb7_doubles', 'points23'];

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    if (!checkRateLimit(`ptl-night:${clientIp(request)}`, 90)) {
      return NextResponse.json({ error: 'Slow down a moment.' }, { status: 429 });
    }

    const { token } = await params;
    const night = await getNightByToken(token);
    if (!night) return NextResponse.json({ error: 'That link is not valid.' }, { status: 404 });

    const body = await request.json().catch(() => ({}));
    const action = clampText(body.action, 16);

    if (action === 'line') {
      const lineId = clampText(body.lineId, 64);
      // Empty string is meaningful here: it clears a mistyped score.
      const score = typeof body.score === 'string' ? body.score.slice(0, 64) : null;
      const reporter = clampText(body.reportedBy, 80);
      if (!lineId || score === null) {
        return NextResponse.json({ error: 'Missing line or score.' }, { status: 400 });
      }

      // The line must belong to THIS night, or one token would score the whole
      // season.
      const owns = night.meetings.some((m) => m.lines.some((l) => l.id === lineId));
      if (!owns) return NextResponse.json({ error: 'That line is not on this night.' }, { status: 403 });

      const res = await applyLineScore(lineId, score, reporter);
      if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });
      await refreshNightStatus(night.id);
      return NextResponse.json({ success: true, outcome: res.outcome });
    }

    if (action === 'shootout') {
      const meetingId = clampText(body.meetingId, 64);
      const kind = clampText(body.kind, 24) as ShootoutKind | null;
      const homePts = clampNumber(body.homePts, 0, 99);
      const awayPts = clampNumber(body.awayPts, 0, 99);

      if (!meetingId || !kind || !KINDS.includes(kind) || homePts == null || awayPts == null) {
        return NextResponse.json({ error: 'Missing or invalid tiebreak.' }, { status: 400 });
      }

      const meeting = night.meetings.find((m) => m.id === meetingId);
      if (!meeting) {
        return NextResponse.json({ error: 'That meeting is not on this night.' }, { status: 403 });
      }

      /*
       * Accept a tiebreak in exactly two cases:
       *
       *   the cascade is asking for it right now, or
       *   one of that kind is already recorded and is being corrected.
       *
       * The first stops someone inventing a decider for a meeting that was
       * settled on total games, which would leave the stored result disagreeing
       * with the scores underneath it. The second is the part the first draft
       * got wrong: once a meeting resolved at level 4 it was no longer
       * "awaiting" anything, so a mistyped tiebreak became permanent — while a
       * mistyped LINE stayed editable. Same score, entered on the same night,
       * by the same person, with opposite rules. A correction has to recompute
       * from scratch like every other write.
       */
      const askingForIt =
        meeting.outcome.state === 'awaiting_shootout' && meeting.outcome.needs.includes(kind);
      const correctingOne = meeting.shootouts.some((s) => s.kind === kind);
      if (!askingForIt && !correctingOne) {
        return NextResponse.json(
          { error: 'That meeting is not waiting on that tiebreak.' },
          { status: 409 },
        );
      }

      const res = await applyShootout(meetingId, kind, homePts, awayPts);
      if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });
      await refreshNightStatus(night.id);
      return NextResponse.json({ success: true, outcome: res.outcome });
    }

    if (action === 'court') {
      // Renaming a court mid-evening is the most common small edit there is.
      const lineId = clampText(body.lineId, 64);
      const label = clampText(body.courtLabel, 40);
      if (!lineId) return NextResponse.json({ error: 'Missing line.' }, { status: 400 });
      const owns = night.meetings.some((m) => m.lines.some((l) => l.id === lineId));
      if (!owns) return NextResponse.json({ error: 'That line is not on this night.' }, { status: 403 });
      await getSupabaseAdmin().from('ptl_lines').update({ court_label: label }).eq('id', lineId);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  } catch (err: any) {
    console.error('[ptl] night score error', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
