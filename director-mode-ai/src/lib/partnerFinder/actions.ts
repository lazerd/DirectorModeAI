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
import { afterCancel, afterJoin, afterLeave, inviteGuests, messageSignups } from './notify';
import { clubRoster, guestLinkByToken, genderFits, levelFits, loadClub, loadGame, personGender, memberRow, personRow, resolvePlayingClub, type Club, type Db } from './server';

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
  wrong_gender: "This game is for the other gender, so it isn't open to you.",
  left: "Done. You're out of this game, and we've told the person who posted it.",
  declined: "No problem — we've noted you can't make this one. Tap “I'm in” above if that changes.",
  not_in: "You're not in this game.",
  game_cancelled: 'The game is cancelled. We emailed everyone who was playing.',
  not_poster: 'Only the person who posted a game can cancel it.',
  already_cancelled: 'This game was already cancelled.',
  need_one: 'Pick a member or type a guest name.',
  already_in_game: 'They are already in this game.',
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
    if (game.gender && !genderFits(game, await personGender(db, personId))) {
      return { ok: false, result: 'wrong_gender', message: say('wrong_gender') };
    }
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

/**
 * The host seats someone themselves — a member who said yes in person, or a
 * guest who is not in the club at all.
 *
 * Asked for by Walden Browne (2026-09-22) after his first game: people tell you
 * yes on court, and a verbal yes had nowhere to go. Only the poster may do it,
 * and the seat is recorded as `via = 'host'` so it is never mistaken for
 * somebody having answered an email.
 */
export async function hostAddPlayer(
  db: Db,
  gameId: string,
  actorPersonId: string,
  who: { personId?: string | null; guestName?: string | null },
): Promise<ActionOutcome> {
  const guestName = (who.guestName ?? '').trim();
  const personId = who.personId || null;
  if (!personId && !guestName) return { ok: false, result: 'need_one', message: say('need_one') };

  const { data, error } = await db.rpc('pf_host_add', {
    p_game: gameId,
    p_actor: actorPersonId,
    p_person: personId,
    p_guest_name: personId ? null : guestName,
  });
  if (error) return { ok: false, result: 'error', message: say('error') };
  const r = data as { result: string; now_full?: boolean; is_guest?: boolean; name?: string };
  if (r.result !== 'added') return { ok: false, result: r.result, message: say(r.result) };

  background('host add emails', () =>
    afterJoin(db, gameId, personId, !!r.now_full, r.is_guest ? (r.name ?? guestName) : null),
  );
  const named = r.name ?? 'They';
  return {
    ok: true,
    result: 'added',
    message: r.now_full
      ? `${named} is in — that's everyone. We've emailed the group.`
      : `${named} is in.`,
  };
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

/**
 * The poster writing to everyone who signed up. Only the poster: the token
 * proves who is asking, and posted_by (an account) is matched to that person.
 * `send: false` is the preview: same recipients, same message, nothing sent.
 */
export async function messageGame(
  db: Db,
  gameId: string,
  personId: string,
  text: string,
  send: boolean,
): Promise<ActionOutcome & { recipients?: string[]; subject?: string; noEmail?: string[] }> {
  const message = text.trim().slice(0, 1000);
  if (!message) return { ok: false, result: 'empty', message: 'Type a message first.' };
  const game = await loadGame(db, gameId);
  const club = game ? await loadClub(db, game.club_id) : null;
  if (!game || !club) return { ok: false, result: 'error', message: say('error') };
  const roster = await clubRoster(db, club.id);
  if (roster.find((r) => r.user_id === game.posted_by)?.person_id !== personId) {
    return { ok: false, result: 'not_poster', message: 'Only the person who posted the game can message the players.' };
  }
  if (game.status === 'cancelled') return { ok: false, result: 'cancelled', message: say('cancelled') };
  const r = await messageSignups(db, game, club, message, send);
  if (!r.recipients.length) {
    return { ok: false, result: 'nobody', message: 'Nobody has signed up yet, so there is no one to message.', ...r };
  }
  if (!send) return { ok: true, result: 'preview', message: '', ...r };
  if (!r.sent) return { ok: false, result: 'error', message: 'That did not send. Please try again.', ...r };
  return {
    ok: true,
    result: 'messaged',
    message: `Sent to ${r.recipients.join(', ')}. Their replies come straight to your email.`,
    ...r,
  };
}

/* -------------------------------------------- the poster's outside friends */

/** Only the poster of a live game may touch its friend invites. */
async function posterGame(db: Db, gameId: string, personId: string) {
  const game = await loadGame(db, gameId);
  const club = game ? await loadClub(db, game.club_id) : null;
  if (!game || !club) return { error: { ok: false, result: 'error', message: say('error') } as ActionOutcome };
  const roster = await clubRoster(db, club.id);
  if (roster.find((r) => r.user_id === game.posted_by)?.person_id !== personId) {
    return { error: { ok: false, result: 'not_poster', message: 'Only the person who posted the game can invite friends to it.' } as ActionOutcome };
  }
  if (game.status === 'cancelled') return { error: { ok: false, result: 'cancelled', message: say('cancelled') } as ActionOutcome };
  if (new Date(game.starts_at).getTime() <= Date.now()) return { error: { ok: false, result: 'past', message: say('past') } as ActionOutcome };
  return { game, club };
}

/** Save a friend to the poster's own list. Never a PlayerVault row. */
export async function saveGuestContact(
  db: Db,
  gameId: string,
  personId: string,
  input: { name: string; email: string },
): Promise<ActionOutcome & { contact?: { id: string; name: string; email: string } }> {
  const ctx = await posterGame(db, gameId, personId);
  if ('error' in ctx) return ctx.error!;
  const name = input.name.trim().slice(0, 60);
  const email = input.email.trim().toLowerCase().slice(0, 200);
  if (!name) return { ok: false, result: 'need_name', message: 'Type their name.' };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, result: 'bad_email', message: 'That email address does not look right.' };
  const { data: existing } = await db
    .from('pf_guest_contacts')
    .select('id, name, email')
    .eq('owner_person_id', personId)
    .ilike('email', email)
    .maybeSingle();
  if (existing) return { ok: true, result: 'exists', message: `${(existing as { name: string }).name} is already on your list.`, contact: existing as never };
  const { data, error } = await db
    .from('pf_guest_contacts')
    .insert({ club_id: ctx.club.id, owner_person_id: personId, name, email })
    .select('id, name, email')
    .single();
  if (error) return { ok: false, result: 'error', message: say('error') };
  return { ok: true, result: 'saved', message: `Added ${name} to your list.`, contact: data as never };
}

/** Take a friend off the poster's own list. */
export async function forgetGuestContact(db: Db, personId: string, contactId: string): Promise<ActionOutcome> {
  await db.from('pf_guest_contacts').delete().eq('id', contactId).eq('owner_person_id', personId);
  return { ok: true, result: 'removed', message: 'Removed from your list.' };
}

export async function inviteGuestContacts(
  db: Db,
  gameId: string,
  personId: string,
  contactIds: string[],
  send: boolean,
): Promise<ActionOutcome & { recipients?: string[]; subject?: string; skipped?: string[] }> {
  const ctx = await posterGame(db, gameId, personId);
  if ('error' in ctx) return ctx.error!;
  if (!contactIds.length) return { ok: false, result: 'none', message: 'Tick at least one friend.' };
  const r = await inviteGuests(db, ctx.game, ctx.club, contactIds, send);
  if (!r.recipients.length) {
    return { ok: false, result: 'nobody', message: 'Everyone you ticked has already answered this game.', ...r };
  }
  if (!send) return { ok: true, result: 'preview', message: '', ...r };
  if (!r.sent) return { ok: false, result: 'error', message: 'That did not send. Please try again.', ...r };
  return { ok: true, result: 'invited', message: `Invited ${r.recipients.join(', ')}. First to tap gets the spot.`, ...r };
}

/** The friend's own taps, from /play/g/[token]. */
export async function guestAct(db: Db, token: string, action: 'join' | 'decline' | 'leave'): Promise<ActionOutcome> {
  const link = await guestLinkByToken(db, token);
  if (!link) return { ok: false, result: 'not_found', message: say('not_found') };
  if (action === 'join') {
    const { data, error } = await db.rpc('pf_guest_claim', { p_token: token });
    if (error) return { ok: false, result: 'error', message: say('error') };
    const r = data as { result: string; now_full?: boolean; name?: string };
    if (r.result === 'full') return { ok: false, result: 'full', message: 'Sorry, this game just filled up.' };
    if (r.result !== 'joined') return { ok: r.result === 'already_in', result: r.result, message: say(r.result) };
    background('guest join emails', () => afterJoin(db, link.game_id, null, !!r.now_full, link.name));
    return {
      ok: true,
      result: 'joined',
      message: r.now_full ? "You're in, and that fills the game. Everyone's getting the line-up by email." : "You're in! We've let them know.",
    };
  }
  const { data, error } = await db.rpc('pf_guest_answer', { p_token: token, p_answer: action === 'decline' ? 'no' : 'leave' });
  if (error) return { ok: false, result: 'error', message: say('error') };
  const r = data as { result: string };
  if (r.result === 'declined') return { ok: true, result: 'declined', message: "No problem. Thanks for letting them know." };
  if (r.result !== 'left') return { ok: false, result: r.result, message: say(r.result) };
  background('guest leave emails', () => afterLeave(db, link.game_id, null, link.name));
  return { ok: true, result: 'left', message: "Done. You're out, and we've told them." };
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
