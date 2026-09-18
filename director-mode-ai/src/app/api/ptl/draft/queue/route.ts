/**
 * A captain's private draft queue — their wishlist, in their order.
 *
 * This is what makes the clock survivable. A captain who has to take a call,
 * drive home, or simply isn't looking still drafts sensibly, because when their
 * clock expires ptl_tick() takes the top name on this list that is still
 * available. Empty queue falls back to best available by composite rating, so
 * even a captain who never opens the page ends up with a defensible roster.
 *
 * ptl_draft_queue is service-role only and deliberately NOT in the realtime
 * publication. The other captains must never see this.
 */

import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { getQueue, getTeamByToken } from '@/lib/ptl/server';
import { checkRateLimit, clampText, clientIp } from '@/lib/ptl/guard';

/** Read back the current queue. */
export async function GET(request: Request) {
  const token = clampText(new URL(request.url).searchParams.get('token'), 128);
  if (!token) return NextResponse.json({ error: 'Missing token.' }, { status: 400 });

  const resolved = await getTeamByToken(token);
  if (!resolved?.draftId) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  return NextResponse.json({ entryIds: await getQueue(resolved.draftId, resolved.team.id) });
}

/**
 * Replace the whole queue in one shot.
 *
 * Replace rather than patch because the client owns the ordering — the captain
 * drags names around and we store the result. Sending the whole list makes a
 * dropped request harmless: the next save is still correct, where a stream of
 * incremental moves applied out of order would not be.
 */
export async function POST(request: Request) {
  try {
    if (!checkRateLimit(`ptl-queue:${clientIp(request)}`, 60)) {
      return NextResponse.json({ error: 'Slow down a moment.' }, { status: 429 });
    }

    const body = await request.json().catch(() => ({}));
    const token = clampText(body.token, 128);
    const raw = Array.isArray(body.entryIds) ? body.entryIds : null;
    if (!token || !raw) return NextResponse.json({ error: 'Missing token or list.' }, { status: 400 });

    // A queue longer than the pool is meaningless; cap it rather than trusting
    // whatever the client sent.
    const entryIds: string[] = (raw as unknown[])
      .map((v) => clampText(v, 64))
      .filter((v): v is string => !!v)
      .slice(0, 200);

    const resolved = await getTeamByToken(token);
    if (!resolved?.draftId) return NextResponse.json({ error: 'That draft link is not valid.' }, { status: 404 });

    const db = getSupabaseAdmin();
    await db
      .from('ptl_draft_queue')
      .delete()
      .eq('draft_id', resolved.draftId)
      .eq('team_id', resolved.team.id);

    if (entryIds.length) {
      const { error } = await db.from('ptl_draft_queue').insert(
        entryIds.map((entryId, i) => ({
          draft_id: resolved.draftId,
          team_id: resolved.team.id,
          entry_id: entryId,
          rank: i + 1,
        })),
      );
      if (error) {
        console.error('[ptl] queue save failed', error.message);
        return NextResponse.json({ error: 'Could not save your queue.' }, { status: 500 });
      }
    }

    return NextResponse.json({ success: true, count: entryIds.length });
  } catch (err: any) {
    console.error('[ptl] queue error', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
