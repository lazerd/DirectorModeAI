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
import { levelFits, loadGame, memberRow, personRow, resolvePlayingClub, type Club, type Db } from './server';

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
  waitlisted: "This game is full, so you're first in line if a spot opens. We'll email you the moment one does.",
  already_waiting: "You're already in line for this game. We'll email you if a spot opens.",
  off_waitlist: "Done — you're off the list for this game.",
  cancelled: 'This game was cancelled.',
  past: 'This game has already started.',
  not_found: "We couldn't find that game.",
  own_game: "This is your own game, so you're already playing.",
  not_member: 'Only members of this club can join its games.',
  need_level: 'Tell us your level first, then you can join.',
  wrong_level: "This game is for a different level than yours.",
  left: "Done. You're out of this game, and we've told the person who posted it.",
  declined: "No problem — we've noted you can't make this one. Tap “I'm in” above if that changes.",
  not_in: "You're not in this game.",
  game_cancelled: 'The game is cancelled. We emailed everyone who was playing.',
  not_poster: 'Only the person who posted a game can cancel it.',
  already_cancelled: 'This game was already cancelled.',
};

const say = (result: string) => MESSAGES[result] ?? 'Something went wrong. Please try again.';

/**
 * Every one of these takes a PERSON — a cc_vault_players id — not an account.
 * A club member who has never signed in taps "I'm in" from their email and it
 * works, which is the whole point of courtconnect_reads_people.sql.
 */
export async function joinGame(
  db: Db,
  gameId: string,
  personId: string,
  via: 'email' | 'board',
): Promise<ActionOutcome> {
  if (via === 'board') {
    // From the board, the level still has to fit. An emailed link was only
    // ever sent to someone who fit, so it is not asked twice.
    const game = await loadGame(db, gameId);
    if (!game) return { ok: false, result: 'not_found', message: say('not_found') };
    if (game.rating_min != null || game.rating_max != null) {
      const me = await personRow(db, game.club_id, personId);
      if (me && !levelFits(game, me.ntrp)) {
        const result = me.ntrp == null ? 'need_level' : 'wrong_level';
        return { ok: false, result, message: say(result) };
      }
    }
  }

  const { data, error } = await db.rpc('pf_claim_spot', { p_game: gameId, p_person: personId, p_via: via });
  if (error) return { ok: false, result: 'error', message: say('error') };
  const r = data as { result: string; now_full?: boolean; position?: number };

  /*
   * A full game takes the answer as a place in line rather than turning it
   * down (pf_claim_spot). It counts as a yes — ok: true — because the person
   * did say yes, and the page must show them they are on the list, not an
   * error. Their position is only worth saying past first.
   */
  if (r.result === 'waitlisted' || r.result === 'already_waiting') {
    const place = r.position && r.position > 1 ? ` You're number ${r.position} in line.` : '';
    return { ok: true, result: r.result, message: say(r.result) + place };
  }

  if (r.result !== 'joined') return { ok: r.result === 'already_in', result: r.result, message: say(r.result) };

  background('join emails', () => afterJoin(db, gameId, personId, !!r.now_full));
  return { ok: true, result: 'joined', message: say(r.now_full ? 'joined_full' : 'joined') };
}

export async function leaveGame(db: Db, gameId: string, personId: string): Promise<ActionOutcome> {
  const { data, error } = await db.rpc('pf_leave_spot', { p_game: gameId, p_person: personId });
  if (error) return { ok: false, result: 'error', message: say('error') };
  const r = data as { result: string; waiting?: number };
  // Stepping off the waitlist opens nothing and tells nobody.
  if (r.result === 'off_waitlist') return { ok: true, result: r.result, message: say(r.result) };
  if (r.result !== 'left') return { ok: false, result: r.result, message: say(r.result) };
  background('leave email', () => afterLeave(db, gameId, personId));
  return { ok: true, result: 'left', message: say('left') };
}

/**
 * "No, not this time." Nobody is emailed about it — see pf_decline_spot. They
 * can still tap "I'm in" from the same email afterwards.
 */
export async function declineGame(db: Db, gameId: string, personId: string): Promise<ActionOutcome> {
  const { data, error } = await db.rpc('pf_decline_spot', { p_game: gameId, p_person: personId });
  if (error) return { ok: false, result: 'error', message: say('error') };
  const r = data as { result: string };
  if (r.result !== 'declined') return { ok: false, result: r.result, message: say(r.result) };
  return { ok: true, result: 'declined', message: say('declined') };
}

export async function cancelGame(db: Db, gameId: string, personId: string): Promise<ActionOutcome> {
  const { data, error } = await db.rpc('pf_cancel_game', { p_game: gameId, p_person: personId });
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
  /**
   * The signed-in viewer as a PERSON — their PlayerVault row at this club.
   * Everything CourtConnect stores hangs off this rather than the login, so a
   * route that writes a preference or a seat needs it, not `user.id`.
   */
  personId: string | null;
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
  const me = await memberRow(db, found.club.id, user.id);
  return {
    db,
    user: {
      id: user.id,
      email: user.email ?? null,
      name: typeof meta.full_name === 'string' ? meta.full_name : null,
    },
    club: found.club,
    role: found.role,
    personId: me?.person_id ?? null,
  };
}

export function isCtxError(v: MemberCtx | { error: NextResponse }): v is { error: NextResponse } {
  return 'error' in v;
}
