/**
 * POST /api/play/games/[id]/staff — the club stepping in on a member's game,
 * from the director's CourtConnect table (QA #16).
 *
 *   { action: 'remove', seatId }            take a player off (any seat, guests too)
 *   { action: 'cancel' }                    call the game off; everyone, host included, is emailed
 *   { action: 'edit', date, time, duration, court, note, spots, save? }
 *                                           change the game; preview unless save: true
 *
 * When a member calls the office ("take me out", "it's raining, cancel it"),
 * the director could see the game and do nothing about it. Each action is the
 * host's own move made by the club, so the seats, the reopening and the
 * emails are the same whoever asked.
 *
 * Staff only, decided the same way as /notify: resolveActiveClub returns only
 * clubs this account owns, staffs, or reaches as the platform, and the game
 * must be at that club. The Postgres functions check staff again
 * (pf_is_club_staff, pf_edit_game.sql).
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { resolveActiveClub } from '@/lib/clubs/activeClub';
import { loadGame } from '@/lib/partnerFinder/server';
import { editGame, staffCancelGame, staffRemovePlayer } from '@/lib/partnerFinder/actions';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const userClient = await createClient();
  const {
    data: { user },
  } = await userClient.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = getSupabaseAdmin();
  const game = await loadGame(db, params.id);
  if (!game) return NextResponse.json({ error: 'We could not find that game.' }, { status: 404 });

  const { active } = await resolveActiveClub(user.id, user.email);
  if (!active || active.id !== game.club_id) {
    return NextResponse.json({ error: 'Only club staff can change this game.' }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (body.action === 'remove' && typeof body.seatId === 'string') {
    return NextResponse.json(await staffRemovePlayer(db, game.id, user.id, body.seatId));
  }
  if (body.action === 'cancel') {
    return NextResponse.json(await staffCancelGame(db, game.id, user.id));
  }
  if (body.action === 'edit') {
    return NextResponse.json(await editGame(db, game.id, { staffUserId: user.id }, body, body.save === true));
  }
  return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
}
