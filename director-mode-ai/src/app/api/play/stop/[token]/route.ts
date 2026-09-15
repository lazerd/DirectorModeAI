/**
 * POST /api/play/stop/[token] — { on: boolean }
 *
 * The "stop emails about games" link at the bottom of every invite. Only this
 * one preference at this one club; it is not an unsubscribe from all email.
 */
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: { token: string } }) {
  if (!/^[a-f0-9]{32,64}$/.test(params.token || '')) {
    return NextResponse.json({ error: 'This link is not recognized.' }, { status: 404 });
  }
  const body = (await req.json().catch(() => ({}))) as { on?: boolean };
  const { data, error } = await getSupabaseAdmin()
    .from('pf_member_prefs')
    .update({ notify_games: body.on === true, updated_at: new Date().toISOString() })
    .eq('stop_token', params.token)
    .select('notify_games');
  if (error) return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: 'This link is not recognized.' }, { status: 404 });
  return NextResponse.json({ ok: true, notify_games: (data[0] as { notify_games: boolean }).notify_games });
}
