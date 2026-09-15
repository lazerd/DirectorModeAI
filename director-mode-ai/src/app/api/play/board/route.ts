/**
 * GET /api/play/board?club=<id> — the signed-in member's CourtConnect board:
 * open games at their club, games they posted, games they're in, and their
 * own level and email preference.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isCtxError, requireMember } from '@/lib/partnerFinder/actions';
import { loadBoard } from '@/lib/partnerFinder/server';
import { DAILY_POST_LIMIT } from '@/lib/partnerFinder/format';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const ctx = await requireMember(req.nextUrl.searchParams.get('club'));
  if (isCtxError(ctx)) return ctx.error;
  const board = await loadBoard(ctx.db, ctx.club, ctx.user.id, DAILY_POST_LIMIT);
  return NextResponse.json(board, { headers: { 'Cache-Control': 'no-store' } });
}
