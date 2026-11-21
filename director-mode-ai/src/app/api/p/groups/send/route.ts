import { NextResponse } from 'next/server';
import { PlayError } from '@/lib/play/server';
import { blastGroup, currentUser } from '@/lib/play/groupsServer';

export const dynamic = 'force-dynamic';
// Sends are paced ~2/sec (Resend's limit), so a big group takes a while.
export const maxDuration = 300;

/** Email a game's link to one of the host's groups. Needs the sign-in AND the game's host key. */
export async function POST(req: Request) {
  try {
    const user = await currentUser();
    if (!user) throw new PlayError('SIGN_IN', 401);
    const b = (await req.json()) as { groupId?: string; code?: string; hostId?: string; clubCode?: string; again?: boolean };
    const hostId = typeof b.hostId === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(b.hostId) ? b.hostId : null;
    const clubCode = typeof b.clubCode === 'string' && /^[a-z0-9]{4,20}$/.test(b.clubCode) ? b.clubCode : null;
    const r = await blastGroup(user, { groupId: b.groupId, code: b.code, hostKey: req.headers.get('x-play-key'), hostId, clubCode, again: b.again === true });
    return NextResponse.json(r);
  } catch (e) {
    const err = e instanceof PlayError ? e : new PlayError('Something went wrong', 500);
    if (err.status === 402) return NextResponse.json({ error: 'PASS_NEEDED', upgrade: '/play/pass' }, { status: 402 });
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
}
