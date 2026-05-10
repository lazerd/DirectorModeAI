/**
 * POST /api/leagues/entries/[id]/payment-status
 *
 * Director-only. Flips an entry's payment_status between the allowed states
 * so the director can mark registrants as paid / pending / waived / refunded
 * inline on the league dashboard.
 *
 * Body: { status: 'paid' | 'pending' | 'waived' | 'refunded' }
 *
 * Only matches entries that belong to a league the caller owns. Does NOT
 * touch entry_status — if the entry is withdrawn or waitlisted we still
 * let the payment state move independently (e.g. director marks a
 * withdrawn entry as 'refunded' to close out an earlier refund_pending).
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

const ALLOWED = new Set(['paid', 'pending', 'waived', 'refunded']);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: entryId } = await params;

    const userClient = await createClient();
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const status = typeof body?.status === 'string' ? body.status : '';
    if (!ALLOWED.has(status)) {
      return NextResponse.json(
        { error: `Invalid status — must be one of ${Array.from(ALLOWED).join(', ')}` },
        { status: 400 }
      );
    }

    const admin = getSupabaseAdmin();

    const { data: entry } = await admin
      .from('league_entries')
      .select('id, league_id, payment_status')
      .eq('id', entryId)
      .maybeSingle();
    if (!entry) return NextResponse.json({ error: 'Entry not found' }, { status: 404 });

    const { data: league } = await admin
      .from('leagues')
      .select('director_id')
      .eq('id', (entry as any).league_id)
      .maybeSingle();
    if (!league || (league as any).director_id !== user.id) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }

    const { error: updateErr } = await admin
      .from('league_entries')
      .update({ payment_status: status })
      .eq('id', entryId);
    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, payment_status: status });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal error' }, { status: 500 });
  }
}
