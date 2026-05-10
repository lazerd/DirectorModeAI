/**
 * POST /api/leagues/[id]/send-reminders
 *
 * Director-only. Sends reminder emails to any player whose current pending
 * match is within 3 days of its deadline. Thin wrapper around the shared
 * sendMatchReminders helper in lib/leagueProgression — the same helper
 * is also called nightly from the /api/lessons/send-reminders cron in
 * 'cron' mode (narrower filter) so directors don't have to remember to
 * click this button.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { sendMatchReminders } from '@/lib/leagueProgression';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: leagueId } = await params;

    const userClient = await createClient();
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const admin = getSupabaseAdmin();
    const { data: league } = await admin
      .from('leagues')
      .select('id, director_id')
      .eq('id', leagueId)
      .maybeSingle();
    if (!league || (league as any).director_id !== user.id) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }

    const origin = new URL(request.url).origin;
    const summary = await sendMatchReminders([leagueId], origin, 'manual');

    return NextResponse.json({
      sent: summary.remindersSent,
      matches: summary.matchesConsidered,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal error' }, { status: 500 });
  }
}
