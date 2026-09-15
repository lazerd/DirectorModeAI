/**
 * CourtConnect — join, leave, cancel.
 *
 * Shared by the signed-in board (/api/play/games/[id]) and the no-login
 * link pages (/api/play/link/[token]), so a tap from an email and a tap on
 * the board can never behave differently. The deciding write is always one of
 * the Postgres functions; the emails go out after the response, once it has
 * committed (see background.ts).
 */
import { background } from './background';
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { afterCancel, afterJoin, afterLeave } from './notify';
import { levelFits, loadGame, memberRow, resolvePlayingClub, type Club, type Db } from './server';

export type ActionOutcome = {
  ok: boolean;
  result: string;
  /** Plain words for the person who tapped. */
  message: string;
};

const MESSAGES: Record<string, string> = {
  joined: "You're in! We've let the group know.",
  joined_full: "You're in, and that fills the game. Everyone's getting an email with the group.",
  already_in: "You're already in this game.",
  full: "This game just filled. We'll tell you about the next one.",
  cancelled: 'This game was cancelled.',
  past: 'This game has already started.',
  not_found: "We couldn't find that game.",
  own_game: "This is your own game, so you're already playing.",
  not_member: 'Only members of this club can join its games.',
  need_level: 'Tell us your level first, then you can join.',
  wrong_level: "This game is for a different level than yours.",
  left: "Done. You're out of this game, and we've told the person who posted it.",
  not_in: "You're not in this game.",
  game_cancelled: 'The game is cancelled. We emailed everyone who was playing.',
  not_poster: 'Only the person who posted a game can cancel it.',
  already_cancelled: 'This game was already cancelled.',
};

const say = (result: string) => MESSAGES[result] ?? 'Something went wrong. Please try again.';

export async function joinGame(
  db: Db,
  gameId: string,
  userId: string,
  via: 'email' | 'board',
): Promise<ActionOutcome> {
  if (via === 'board') {
    // From the board, the level still has to fit. An emailed link was only
    // ever sent to someone who fit, so it is not asked twice.
    const game = await loadGame(db, gameId);
    if (!game) return { ok: false, result: 'not_found', message: say('not_found') };
    if (game.posted_by !== userId && (game.rating_min != null || game.rating_max != null)) {
      const me = await memberRow(db, game.club_id, userId);
      if (!levelFits(game, me?.ntrp ?? null)) {
        const result = me?.ntrp == null ? 'need_level' : 'wrong_level';
        return { ok: false, result, message: say(result) };
      }
    }
  }

  const { data, error } = await db.rpc('pf_claim_spot', { p_game: gameId, p_user: userId, p_via: via });
  if (error) return { ok: false, result: 'error', message: say('error') };
  const r = data as { result: string; now_full?: boolean };
  if (r.result !== 'joined') return { ok: r.result === 'already_in', result: r.result, message: say(r.result) };

  background('join emails', () => afterJoin(db, gameId, userId, !!r.now_full));
  return { ok: true, result: 'joined', message: say(r.now_full ? 'joined_full' : 'joined') };
}

export async function leaveGame(db: Db, gameId: string, userId: string): Promise<ActionOutcome> {
  const { data, error } = await db.rpc('pf_leave_spot', { p_game: gameId, p_user: userId });
  if (error) return { ok: false, result: 'error', message: say('error') };
  const r = data as { result: string };
  if (r.result !== 'left') return { ok: false, result: r.result, message: say(r.result) };
  background('leave email', () => afterLeave(db, gameId, userId));
  return { ok: true, result: 'left', message: say('left') };
}

export async function cancelGame(db: Db, gameId: string, userId: string): Promise<ActionOutcome> {
  const { data, error } = await db.rpc('pf_cancel_game', { p_game: gameId, p_user: userId });
  if (error) return { ok: false, result: 'error', message: say('error') };
  const r = data as { result: string };
  if (r.result !== 'cancelled') return { ok: false, result: r.result, message: say(r.result) };
  background('cancel emails', () => afterCancel(db, gameId));
  return { ok: true, result: 'game_cancelled', message: say('game_cancelled') };
}

export type MemberCtx = {
  db: Db;
  user: { id: string; email: string | null; name: string | null };
  club: Club;
  role: string;
};

/** A signed-in playing member of the requested (or their primary) club. */
export async function requireMember(clubId?: string | null): Promise<MemberCtx | { error: NextResponse }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: 'Please sign in.' }, { status: 401 }) };

  const db = getSupabaseAdmin();
  const found = await resolvePlayingClub(db, user.id, clubId);
  if (!found || (clubId && found.club.id !== clubId)) {
    return { error: NextResponse.json({ error: 'Only members of this club can do that.' }, { status: 403 }) };
  }
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  return {
    db,
    user: {
      id: user.id,
      email: user.email ?? null,
      name: typeof meta.full_name === 'string' ? meta.full_name : null,
    },
    club: found.club,
    role: found.role,
  };
}

export function isCtxError(v: MemberCtx | { error: NextResponse }): v is { error: NextResponse } {
  return 'error' in v;
}
