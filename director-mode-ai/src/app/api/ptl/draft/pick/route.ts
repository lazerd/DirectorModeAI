/**
 * A captain makes a pick.
 *
 * The team token is the credential — no account, because PTL captains come
 * from a dozen different clubs and half of them have never heard of us.
 *
 * This route deliberately does almost nothing. It resolves the token to a team
 * and hands the pick to ptl_make_pick(), which does the turn check, the
 * availability check and the insert inside one row lock. Any "is this player
 * still free?" logic up here would be a race waiting to happen — two captains
 * tapping the same name in the same second is how drafts actually behave.
 */

import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { getTeamByToken } from '@/lib/ptl/server';
import { checkRateLimit, clampText, clientIp, draftError } from '@/lib/ptl/guard';
import { notifyAfterPick, originFrom } from '@/lib/ptl/notify';

export async function POST(request: Request) {
  try {
    // Generous: a captain mashing the button on a laggy connection during a run
    // is normal, and the database is the thing enforcing correctness anyway.
    if (!checkRateLimit(`ptl-pick:${clientIp(request)}`, 60)) {
      return NextResponse.json({ error: 'Slow down a moment.' }, { status: 429 });
    }

    const body = await request.json().catch(() => ({}));
    const token = clampText(body.token, 128);
    const entryId = clampText(body.entryId, 64);
    if (!token || !entryId) {
      return NextResponse.json({ error: 'Missing token or player.' }, { status: 400 });
    }

    const resolved = await getTeamByToken(token);
    if (!resolved) return NextResponse.json({ error: 'That draft link is not valid.' }, { status: 404 });
    if (!resolved.draftId) {
      return NextResponse.json({ error: 'No draft has been set up for this season yet.' }, { status: 409 });
    }

    const db = getSupabaseAdmin();
    const { data, error } = await db.rpc('ptl_make_pick', {
      p_draft: resolved.draftId,
      p_team: resolved.team.id,
      p_entry: entryId,
      p_auto: false,
      p_actor: resolved.team.captain_name || 'captain',
    });

    if (error) {
      const mapped = draftError(error);
      return NextResponse.json({ error: mapped.message, code: mapped.code }, { status: mapped.status });
    }

    // Not awaited: the pick is committed, and the player who was just drafted
    // should not be able to fail it by having a full mailbox.
    void notifyAfterPick({
      state: data as any,
      entryId,
      teamId: resolved.team.id,
      origin: originFrom(request),
    });

    return NextResponse.json({ success: true, state: data });
  } catch (err: any) {
    const mapped = draftError(err);
    return NextResponse.json({ error: mapped.message, code: mapped.code }, { status: mapped.status });
  }
}
