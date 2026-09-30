/**
 * POST /api/play/guest/[token] -- a poster's outside friend answering.
 *
 * { action: 'join' | 'decline' | 'leave' }
 *
 * The token names one game and one friend on the poster's own list. The friend
 * is not a club member and has no account; the token is all they have, and it
 * can only seat, decline or drop that one friend from that one game.
 */
import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { guestAct } from '@/lib/partnerFinder/actions';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: Request, { params }: { params: { token: string } }) {
  const body = (await req.json().catch(() => ({}))) as { action?: string };
  if (body.action !== 'join' && body.action !== 'decline' && body.action !== 'leave') {
    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  }
  return NextResponse.json(await guestAct(getSupabaseAdmin(), params.token, body.action));
}
