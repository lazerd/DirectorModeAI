import { NextResponse } from 'next/server';
import { PlayError } from '@/lib/play/server';
import { currentUser, groupAction, listGroups } from '@/lib/play/groupsServer';

export const dynamic = 'force-dynamic';

/** A host's saved groups. Signed-out callers get { user: null } (Racquets IRL stays login-free). */
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ user: null, groups: [] }, { headers: { 'Cache-Control': 'no-store' } });
  const r = await listGroups(user);
  return NextResponse.json({ user: { email: user.email }, ...r }, { headers: { 'Cache-Control': 'no-store' } });
}

/** create | rename | delete | add_member | remove_member | save_from_event (needs the game's host key). */
export async function POST(req: Request) {
  try {
    const user = await currentUser();
    if (!user) throw new PlayError('SIGN_IN', 401);
    const body = (await req.json()) as Record<string, unknown>;
    const out = await groupAction(user, body, req.headers.get('x-play-key'));
    return NextResponse.json(out);
  } catch (e) {
    const err = e instanceof PlayError ? e : new PlayError('Something went wrong', 500);
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
}
