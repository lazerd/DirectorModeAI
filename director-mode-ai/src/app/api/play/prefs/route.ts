/**
 * POST /api/play/prefs — a member's own settings at one club.
 *
 * { club_id, notify_games?, share_phone?, phone?, ntrp? }
 *
 * The level is saved on the person (master_players), not on this club's row;
 * a club that has rated the member in PlayerVault keeps its rating.
 */
import { NextResponse } from 'next/server';
import { isCtxError, requireMember } from '@/lib/partnerFinder/actions';
import { ensurePrefs, saveSelfRating } from '@/lib/partnerFinder/server';
import { NTRP_LEVELS } from '@/lib/partnerFinder/format';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const ctx = await requireMember(typeof body.club_id === 'string' ? body.club_id : null);
  if (isCtxError(ctx)) return ctx.error;
  const { db, club, user } = ctx;

  await ensurePrefs(db, club.id, user.id);
  const patch: Record<string, unknown> = {};
  if (typeof body.notify_games === 'boolean') patch.notify_games = body.notify_games;
  if (typeof body.share_phone === 'boolean') patch.share_phone = body.share_phone;
  if (typeof body.phone === 'string') patch.phone = body.phone.trim().slice(0, 30) || null;
  if (Object.keys(patch).length) {
    patch.updated_at = new Date().toISOString();
    await db.from('pf_member_prefs').update(patch).eq('club_id', club.id).eq('user_id', user.id);
  }

  let rating: { saved: boolean; reason?: string } | null = null;
  if (body.ntrp !== undefined) {
    const n = Number(body.ntrp);
    if (!(NTRP_LEVELS as readonly number[]).includes(n)) {
      return NextResponse.json({ error: 'Please pick a level from the list.' }, { status: 400 });
    }
    rating = await saveSelfRating(db, { clubId: club.id, userId: user.id, email: user.email, fullName: user.name, ntrp: n });
  }

  return NextResponse.json({ ok: true, rating });
}
