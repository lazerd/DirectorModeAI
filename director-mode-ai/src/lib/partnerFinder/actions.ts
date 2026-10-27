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
import { afterCancel, afterEdit, afterJoin, afterLeave, changeAudience, inviteGuests, messageSignups, nudgeNonResponders } from './notify';
import { changeTellsPlayers, gameChanges, maxSpotsFor, type GameChange, type GameEdit } from './format';
import { zonedWallTimeToIso } from '@/lib/captain/clubTime';
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
  removed: 'The organizer took you off this game.',
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
 * The host taking someone off their own game: a member who cancelled on them,
 * or a guest they typed in. Asked for by Walden (2026-10-27) after Tony Chen
 * cancelled and there was no way to take him out. Only the poster, by seat;
 * a full game reopens and anyone in line hears about the spot.
 */
export async function hostRemovePlayer(db: Db, gameId: string, actorPersonId: string, seatId: string): Promise<ActionOutcome> {
  const { data, error } = await db.rpc('pf_host_remove', { p_game: gameId, p_actor: actorPersonId, p_seat: seatId });
  if (error) return { ok: false, result: 'error', message: say('error') };
  const r = data as { result: string; person_id?: string | null; name?: string | null };
  if (r.result === 'not_poster') {
    return { ok: false, result: r.result, message: 'Only the person who posted the game can take players off it.' };
  }
  if (r.result === 'not_in') return { ok: false, result: r.result, message: 'They are not in this game any more.' };
  if (r.result !== 'removed') return { ok: false, result: r.result, message: say(r.result) };
  // An invited friend's seat leads back to their link and email, so they hear too.
  const { data: fl } = r.person_id
    ? { data: null }
    : await db.from('pf_guest_links').select('pf_guest_contacts(email)').eq('seat_id', seatId).maybeSingle();
  const friendEmail = (fl as unknown as { pf_guest_contacts: { email: string } | null } | null)?.pf_guest_contacts?.email;
  const friend = friendEmail ? { email: friendEmail } : null;
  background('host remove emails', () =>
    afterLeave(db, gameId, r.person_id ?? null, r.name ?? undefined, { byHost: true, friend }),
  );
  return { ok: true, result: 'removed', message: `${r.name || 'They'} is off the game, and the spot is open again.` };
}

/* ------------------------------------------------- the club stepping in */

/*
 * The director's row actions on /run/members/courtconnect (QA #16). The route
 * has already checked the account is staff at this game's club
 * (resolveActiveClub); the Postgres functions check it again under the lock.
 * Each one is the host's own move, made as the poster, so the seats, the
 * reopening and the emails are the same whoever asked.
 */

export async function staffRemovePlayer(db: Db, gameId: string, staffUserId: string, seatId: string): Promise<ActionOutcome> {
  const { data, error } = await db.rpc('pf_staff_remove', { p_game: gameId, p_staff_user: staffUserId, p_seat: seatId });
  if (error) return { ok: false, result: 'error', message: say('error') };
  const r = data as { result: string; person_id?: string | null; name?: string | null };
  if (r.result === 'not_staff') return { ok: false, result: r.result, message: 'Only club staff can take players off a game.' };
  if (r.result === 'not_in') return { ok: false, result: r.result, message: 'They are not in this game any more.' };
  if (r.result !== 'removed') return { ok: false, result: r.result, message: say(r.result) };
  // Not byHost: the host didn't do this, so they get the usual "can't make it" email.
  background('staff remove emails', () => afterLeave(db, gameId, r.person_id ?? null, r.name ?? undefined));
  return { ok: true, result: 'removed', message: `${r.name || 'They'} is off the game. The host has been told, and the spot is open again.` };
}

export async function staffCancelGame(db: Db, gameId: string, staffUserId: string): Promise<ActionOutcome> {
  const { data, error } = await db.rpc('pf_staff_cancel_game', { p_game: gameId, p_staff_user: staffUserId });
  if (error) return { ok: false, result: 'error', message: say('error') };
  const r = data as { result: string };
  if (r.result === 'not_staff') return { ok: false, result: r.result, message: 'Only club staff can cancel a game.' };
  if (r.result !== 'cancelled') return { ok: false, result: r.result, message: say(r.result) };
  background('staff cancel emails', () => afterCancel(db, gameId, { byClub: true }));
  return { ok: true, result: 'game_cancelled', message: 'The game is cancelled. We emailed the host and everyone who was playing.' };
}

/* ------------------------------------------------------- editing a game */

/** Who is making the change: the host by their person, or a staff account. */
export type EditActor = { personId: string } | { staffUserId: string };

const EDIT_REFUSED: Record<string, string> = {
  not_poster: 'Only the person who posted the game can change it.',
  not_staff: 'Only club staff can change this game.',
  cancelled: 'This game was cancelled, so it cannot be changed.',
  past: 'This game has already started, so it cannot be changed.',
  in_past: 'That time has already passed. Pick a time later than now.',
  too_far: 'Games can be up to 60 days ahead.',
  bad_duration: 'Please pick how long you want to play.',
  bad_spots: 'Please pick how many players the game needs.',
  not_found: "We couldn't find that game.",
};

const seatedWords = (n: number) => `${n} ${n === 1 ? 'player is' : 'players are'} already in`;

/**
 * Change a posted game's day/time, length, court, note or players needed
 * (QA #15). `save: false` is the preview: what changes, old -> new, and who
 * will be emailed about it, from the same list the send uses. Nothing is
 * written until `save: true`, and then pf_edit_game decides.
 *
 * Only a new time or court emails anyone (changeTellsPlayers), and only the
 * people who are in. Players needed never goes below the number seated.
 */
export async function editGame(
  db: Db,
  gameId: string,
  actor: EditActor,
  input: Record<string, unknown>,
  save: boolean,
): Promise<ActionOutcome & { changes?: GameChange[]; tell?: string[]; noEmail?: string[] }> {
  const game = await loadGame(db, gameId);
  const club = game ? await loadClub(db, game.club_id) : null;
  if (!game || !club) return { ok: false, result: 'not_found', message: say('not_found') };
  const byClub = 'staffUserId' in actor;
  const roster = await clubRoster(db, club.id);
  if (!byClub && roster.find((r) => r.user_id === game.posted_by)?.person_id !== actor.personId) {
    return { ok: false, result: 'not_poster', message: EDIT_REFUSED.not_poster };
  }
  if (game.status === 'cancelled') return { ok: false, result: 'cancelled', message: EDIT_REFUSED.cancelled };
  if (game.status === 'expired' || new Date(game.starts_at).getTime() <= Date.now()) {
    return { ok: false, result: 'past', message: EDIT_REFUSED.past };
  }

  // The same rules as posting a game (api/play/games), in the club's zone.
  const date = String(input.date ?? '');
  const time = String(input.time ?? '');
  const startsAt =
    /^\d{4}-\d{2}-\d{2}$/.test(date) && /^\d{2}:\d{2}$/.test(time) ? zonedWallTimeToIso(`${date}T${time}`, club.timezone) : null;
  if (!startsAt) return { ok: false, result: 'bad_input', message: 'Please pick a day and a time.' };
  if (new Date(startsAt).getTime() <= Date.now()) return { ok: false, result: 'in_past', message: EDIT_REFUSED.in_past };
  const duration = Number(input.duration);
  if (!Number.isInteger(duration) || duration < 30 || duration > 240) {
    return { ok: false, result: 'bad_duration', message: EDIT_REFUSED.bad_duration };
  }
  const spots = Number(input.spots);
  const most = maxSpotsFor(game.format);
  if (!Number.isInteger(spots) || spots < 1 || spots > most) {
    return { ok: false, result: 'bad_spots', message: `Pick 1 to ${most} ${most === 1 ? 'player' : 'players'} besides the host.` };
  }
  const court = typeof input.court === 'string' ? input.court.trim().slice(0, 60) : '';
  const note = typeof input.note === 'string' ? input.note.trim().slice(0, 500) : '';
  const after: GameEdit = { starts_at: startsAt, duration_min: duration, court: court || null, note: note || null, spots_needed: spots };

  const changes = gameChanges(game, after, club.timezone);
  if (!changes.length) return { ok: false, result: 'no_change', message: 'Nothing has changed yet.' };

  const { count: seatedCount } = await db
    .from('pf_game_players')
    .select('id', { count: 'exact', head: true })
    .eq('game_id', game.id)
    .eq('status', 'in');
  const seated = seatedCount ?? 0;
  if (spots < seated) {
    return { ok: false, result: 'below_seated', message: `${seatedWords(seated)}, so the game needs room for at least ${seated}. Take someone off first.` };
  }

  const tellPlayers = changeTellsPlayers(changes);
  const audience = tellPlayers ? await changeAudience(db, game, { byClub, roster }) : null;
  const tell = audience?.names ?? [];
  if (!save) return { ok: true, result: 'preview', message: '', changes, tell, noEmail: audience?.noEmail ?? [] };

  const { data, error } = await db.rpc('pf_edit_game', {
    p_game: gameId,
    p_actor: byClub ? null : actor.personId,
    p_starts_at: startsAt,
    p_duration: duration,
    p_court: court,
    p_note: note,
    p_spots: spots,
    p_staff_user: byClub ? actor.staffUserId : null,
  });
  if (error) return { ok: false, result: 'error', message: say('error') };
  const r = data as { result: string; seated?: number; became_full?: boolean; reopened?: boolean; waiting?: number; old?: GameEdit };
  if (r.result === 'below_seated') {
    return { ok: false, result: r.result, message: `${seatedWords(r.seated ?? 0)}. Take someone off first.` };
  }
  if (r.result !== 'edited' || !r.old) return { ok: false, result: r.result, message: EDIT_REFUSED[r.result] ?? say(r.result) };

  background('edit emails', () =>
    afterEdit(db, gameId, {
      old: r.old!,
      byClub,
      tellPlayers,
      becameFull: !!r.became_full,
      reopened: !!r.reopened && (r.waiting ?? 0) > 0,
    }),
  );
  const told = tell.length ? ` We're emailing ${tell.join(', ')} about the change.` : '';
  const full = r.became_full ? ' That fills the game, so everyone gets the line-up.' : '';
  return { ok: true, result: 'edited', message: `Saved.${told}${full}`, changes, tell };
}

/**
 * The host's nudge: one more invitation to everyone who never answered.
 * Once per game, because a second blast to the whole list is how a club earns
 * a mute. `send: false` is the preview.
 */
export async function nudgeGame(
  db: Db,
  gameId: string,
  personId: string,
  send: boolean,
): Promise<ActionOutcome & { members?: string[]; friends?: string[] }> {
  const ctx = await posterGame(db, gameId, personId);
  if ('error' in ctx) return ctx.error!;
  if (ctx.game.status !== 'open') return { ok: false, result: 'full', message: 'Your game is full, so nobody needs a nudge.' };
  if (ctx.game.nudged_at) {
    return { ok: false, result: 'already_nudged', message: 'You already sent the reminder for this game. You can still message the players or invite friends.' };
  }
  const r = await nudgeNonResponders(db, ctx.game, ctx.club, send);
  if (!r.members.length && !r.friends.length) {
    return { ok: false, result: 'nobody', message: 'Everyone who got the invitation has already answered.', ...r };
  }
  if (!send) return { ok: true, result: 'preview', message: '', ...r };
  return {
    ok: true,
    result: 'nudged',
    message: `Sent again to ${r.members.length + r.friends.length} ${r.members.length + r.friends.length === 1 ? 'person' : 'people'} who hadn't answered.`,
    ...r,
  };
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
