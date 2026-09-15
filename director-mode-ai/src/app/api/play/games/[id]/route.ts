/**
 * POST /api/play/games/[id] — { action: 'join' | 'leave' | 'cancel' } from the
 * signed-in board. The club comes from the game itself, and the member must
 * belong to it.
 */
import { NextResponse } from 'next/server';
import { cancelGame, isCtxError, joinGame, leaveGame, requireMember } from '@/lib/partnerFinder/actions';
import { loadGame } from '@/lib/partnerFinder/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const body = (await req.json().catch(() => ({}))) as { action?: string };
  const game = await loadGame(getSupabaseAdmin(), params.id);
  if (!game) return NextResponse.json({ error: "We couldn't find that game." }, { status: 404 });

  const ctx = await requireMember(game.club_id);
  if (isCtxError(ctx)) return ctx.error;

  const outcome =
    body.action === 'join'
      ? await joinGame(ctx.db, game.id, ctx.user.id, 'board')
      : body.action === 'leave'
        ? await leaveGame(ctx.db, game.id, ctx.user.id)
        : body.action === 'cancel'
          ? await cancelGame(ctx.db, game.id, ctx.user.id)
          : null;
  if (!outcome) return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  return NextResponse.json(outcome);
}
