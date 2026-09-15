/**
 * /api/checkin/g/[token] — one group's own page.
 *
 * The group token was handed to the phone that checked in (and is in the
 * offer email). It authorises exactly this group's buttons: "We're done",
 * "Add a player", "Leave the list", "Start playing" on an offered court.
 *
 *   GET   the timer or the place in line, polled every few seconds
 *   POST  { action: 'done' | 'add_player' | 'leave' | 'claim', name? }
 */

import { NextResponse } from 'next/server';
import { groupAction, type GroupAction } from '@/lib/checkin/actions';
import { clamp, deviceHash, rateLimit } from '@/lib/checkin/http';
import { groupByToken, reconcileClub } from '@/lib/checkin/server';
import { groupView } from '@/lib/checkin/views';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const ACTIONS: GroupAction[] = ['done', 'add_player', 'leave', 'claim'];
const notFound = () => NextResponse.json({ error: 'We could not find this check-in.' }, { status: 404 });

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const limited = rateLimit(req, 'read');
  if (limited) return limited;
  const { token } = await params;
  const first = await groupByToken(token);
  if (!first) return notFound();
  const state = await reconcileClub(first.club);
  // Re-read: reconciling may just have offered this group a court, or ended it.
  const group = (await groupByToken(token))!;
  return NextResponse.json(groupView(state, group.session, group.wait), { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const limited = rateLimit(req, 'write');
  if (limited) return limited;
  try {
    const { token } = await params;
    const group = await groupByToken(token);
    if (!group) return notFound();
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = ACTIONS.find((a) => a === body.action);
    if (!action) return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });

    const result = await groupAction({
      club: group.club,
      session: group.session,
      wait: group.wait,
      action,
      name: clamp(body.name, 60),
      device: deviceHash(req),
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error, code: result.code, until: result.until }, { status: result.status });
    }
    return NextResponse.json({ ok: true, group_token: result.groupToken });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Something went wrong.' }, { status: 500 });
  }
}
