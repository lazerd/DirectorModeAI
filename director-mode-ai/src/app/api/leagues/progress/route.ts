/**
 * /api/leagues/progress
 *
 * 24-hour dispute-window sweep. Finds every 'reported' match whose report is
 * older than 24h, flips it to 'confirmed', then advances each one through
 * the bracket via progressMatchOnConfirm. Any next-round match that becomes
 * fully paired triggers a round-notification email.
 *
 * Two ways to invoke:
 *
 *   POST with a Supabase session cookie
 *        → Director-triggered via the "Lock in overdue reports" button.
 *          Scopes to ?leagueId=XXX if provided, otherwise all 'running'
 *          leagues owned by the authenticated director.
 *
 *   GET  with Authorization: Bearer ${CRON_SECRET}
 *        → Manual cron entry point. Vercel Hobby only allows 2 daily crons
 *          and we're already at that limit, so the actual daily sweep is
 *          invoked from /api/lessons/send-reminders which imports runSweep
 *          directly. This GET handler is kept so directors/ops can curl the
 *          endpoint manually if they need to force a sweep between crons.
 *
 * Both paths run the same sweep worker (from lib/leagueProgression) so
 * behavior is identical. Idempotent.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { runSweep, getAllRunningLeagueIds } from '@/lib/leagueProgression';

export async function GET(request: Request) {
  try {
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      if (process.env.CRON_SECRET && process.env.NODE_ENV === 'production') {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }

    const leagueIds = await getAllRunningLeagueIds();
    const origin = new URL(request.url).origin;
    const summary = await runSweep(leagueIds, origin);

    return NextResponse.json({
      success: true,
      scope: 'manual',
      leaguesScanned: leagueIds.length,
      summary,
    });
  } catch (err: any) {
    console.error('Manual progress error:', err);
    return NextResponse.json({ error: err?.message || 'Internal error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const userClient = await createClient();
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const url = new URL(request.url);
    const leagueId = url.searchParams.get('leagueId');
    const admin = getSupabaseAdmin();

    let leagueIds: string[] = [];
    if (leagueId) {
      const { data: lg } = await admin
        .from('leagues')
        .select('id, director_id')
        .eq('id', leagueId)
        .maybeSingle();
      if (!lg || (lg as any).director_id !== user.id) {
        return NextResponse.json({ error: 'Not found or not authorized' }, { status: 403 });
      }
      leagueIds = [leagueId];
    } else {
      const { data: ls } = await admin
        .from('leagues')
        .select('id')
        .eq('director_id', user.id)
        .eq('status', 'running');
      leagueIds = ((ls as any[]) || []).map(l => l.id);
    }

    const origin = new URL(request.url).origin;
    const summary = await runSweep(leagueIds, origin);

    return NextResponse.json({
      success: true,
      scope: 'director',
      leaguesScanned: leagueIds.length,
      summary,
    });
  } catch (err: any) {
    console.error('Progress error:', err);
    return NextResponse.json({ error: err?.message || 'Internal error' }, { status: 500 });
  }
}
