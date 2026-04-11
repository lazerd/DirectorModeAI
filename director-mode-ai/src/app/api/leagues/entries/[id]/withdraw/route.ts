/**
 * POST /api/leagues/entries/[id]/withdraw
 *
 * Director-only. Withdraws an entry from a league. If the league is still
 * 'open' (draws not generated), this just flips entry_status to 'withdrawn'
 * and flags payment_status as 'refund_pending' if they'd paid. If the
 * league is already 'running', withdrawing is a no-op on the bracket
 * (existing matches stand) but still marks the entry for refund tracking.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: entryId } = await params;

    const userClient = await createClient();
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const admin = getSupabaseAdmin();

    const { data: entry } = await admin
      .from('league_entries')
      .select('id, league_id, payment_status')
      .eq('id', entryId)
      .maybeSingle();
    if (!entry) return NextResponse.json({ error: 'Entry not found' }, { status: 404 });

    // Must be the director of this league
    const { data: league } = await admin
      .from('leagues')
      .select('director_id')
      .eq('id', (entry as any).league_id)
      .maybeSingle();
    if (!league || (league as any).director_id !== user.id) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }

    const patch: Record<string, string> = { entry_status: 'withdrawn' };
    if ((entry as any).payment_status === 'paid') {
      patch.payment_status = 'refund_pending';
    }

    const { error: updateErr } = await admin
      .from('league_entries')
      .update(patch)
      .eq('id', entryId);
    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, patched: patch });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal error' }, { status: 500 });
  }
}
