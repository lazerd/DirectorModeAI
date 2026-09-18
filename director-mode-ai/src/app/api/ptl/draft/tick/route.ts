/**
 * The pick clock running out.
 *
 * Deliberately unauthenticated and safe to call from anywhere. Vercel Hobby
 * allows one cron a day, so a 90-second clock has to be driven by the people
 * already watching it: whichever browser's countdown reaches zero first POSTs
 * here.
 *
 * That sounds alarming and isn't, because ptl_tick() re-reads the deadline
 * inside the draft's row lock. A tick that arrives early does nothing. Five
 * browsers ticking the same expiry produce exactly one auto-pick. A stranger
 * POSTing this URL all day achieves nothing at all unless a clock has genuinely
 * expired — in which case they've done the commissioner a favour.
 *
 * The board view is always open on the commissioner's screen, so there is
 * always at least one ticker even if every captain has closed their laptop.
 */

import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { checkRateLimit, clampText, clientIp, draftError } from '@/lib/ptl/guard';
import { notifyAfterPick, originFrom } from '@/lib/ptl/notify';

export async function POST(request: Request) {
  try {
    if (!checkRateLimit(`ptl-tick:${clientIp(request)}`, 120)) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const body = await request.json().catch(() => ({}));
    const draftId = clampText(body.draftId, 64);
    if (!draftId) return NextResponse.json({ error: 'Missing draft.' }, { status: 400 });

    const db = getSupabaseAdmin();

    const { count: picksBefore } = await db
      .from('ptl_draft_picks')
      .select('id', { count: 'exact', head: true })
      .eq('draft_id', draftId);

    const { data, error } = await db.rpc('ptl_tick', { p_draft: draftId });

    if (error) {
      const mapped = draftError(error);
      return NextResponse.json({ error: mapped.message, code: mapped.code }, { status: mapped.status });
    }

    /*
     * A tick that changed nothing (the clock had not really expired) must not
     * email anyone. ptl_tick returns the same state in that case, so compare
     * the pick count before deciding there was a pick to announce.
     */
    const state = data as any;
    if (state && state.picks_made > (picksBefore ?? 0)) {
      const { data: last } = await db
        .from('ptl_draft_picks')
        .select('entry_id, team_id')
        .eq('draft_id', draftId)
        .order('pick_no', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (last) {
        void notifyAfterPick({
          state,
          entryId: (last as any).entry_id,
          teamId: (last as any).team_id,
          origin: originFrom(request),
        });
      }
    }

    return NextResponse.json({ success: true, state: data });
  } catch (err: any) {
    const mapped = draftError(err);
    return NextResponse.json({ error: mapped.message, code: mapped.code }, { status: mapped.status });
  }
}
