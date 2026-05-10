/**
 * POST /api/leagues/confirm-partner
 * Body: { token: string }
 *
 * Marks a doubles entry's partner as confirmed, based on the unique
 * partner_token generated at registration time.
 */

import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const token = typeof body?.token === 'string' ? body.token.trim() : '';
    if (!token) {
      return NextResponse.json({ error: 'Missing token' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { data: entry, error: lookupErr } = await supabase
      .from('league_entries')
      .select('id, partner_name, captain_name, partner_confirmed_at, entry_status')
      .eq('partner_token', token)
      .maybeSingle();

    if (lookupErr || !entry) {
      return NextResponse.json({ error: 'Invalid or expired link.' }, { status: 404 });
    }

    const e = entry as any;
    if (e.partner_confirmed_at) {
      return NextResponse.json({
        alreadyConfirmed: true,
        partnerName: e.partner_name,
        captainName: e.captain_name,
      });
    }

    const { error: updateErr } = await supabase
      .from('league_entries')
      .update({
        partner_confirmed_at: new Date().toISOString(),
        entry_status: 'active',
      })
      .eq('id', e.id);

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      partnerName: e.partner_name,
      captainName: e.captain_name,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Internal error' }, { status: 500 });
  }
}
