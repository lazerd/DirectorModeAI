/**
 * GET /api/event-board/[eventCode]
 *
 * Public. The court board for a rotating-partner mixer (doubles, mixed
 * doubles, maximize-courts): rounds, courts, sit-outs and individual standings,
 * for the player phone view on /event/[eventCode]. 404 for any other format.
 * See lib/eventBoard for why this reads through the service role.
 */

import { NextResponse } from 'next/server';
import { loadEventBoard } from '@/lib/eventBoard';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ eventCode: string }> }) {
  const { eventCode } = await params;
  if (!/^[A-Za-z0-9]{4,12}$/.test(eventCode)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const board = await loadEventBoard(eventCode);
  if (!board) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(board, { headers: { 'Cache-Control': 'no-store' } });
}
