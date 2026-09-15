/**
 * CourtConnect — who hears about what.
 *
 *   post        → matching members get "a game needs players"
 *   join        → the poster hears; when that fills it, everyone gets the group
 *   leave       → the poster hears the game is open again
 *   cancel      → the players hear it is off
 *   morning-of  → the group gets a reminder (cron)
 *
 * Email only. deliver() is the one place a message leaves the building, so
 * texting — blocked today on A2P 10DLC registration — plugs in there, using
 * the `sms` line every message already carries.
 *
 * Sends are billed to the club owner, the same pool every other club email
 * draws from, and go through sendBilledEmails, which skips anyone who has
 * unsubscribed from all email and appends the unsubscribe footer.
 */
import { sendBilledEmails, CreditLimitError } from '@/lib/email';
import { MAX_RECIPIENTS, shortName, clubDate } from './format';
import {
  clubRoster,
  ensureLinks,
  gameGroup,
  loadClub,
  loadGame,
  GAME_COLS,
  type Club,
  type Db,
  type Game,
  type RosterRow,
} from './server';
import {
  gameCancelledEmail,
  gameFullEmail,
  inviteEmail,
  reminderEmail,
  someoneJoinedEmail,
  spotOpenedEmail,
  type GameMessage,
} from './emails';

async function deliver(billTo: string | null, messages: GameMessage[]): Promise<number> {
  const real = messages.filter((m) => !!m.to);
  if (!real.length) return 0;
  try {
    const results = await sendBilledEmails(
      billTo,
      real.map((m) => ({ to: m.to, subject: m.subject, html: m.html })),
    );
    return results.filter((r) => r.sent).length;
  } catch (err) {
    // A club over its email allowance still gets its game posted; it just
    // doesn't get the blast. Anything else is logged, never thrown at a member.
    if (err instanceof CreditLimitError) console.warn('[courtconnect] club over email limit');
    else console.error('[courtconnect] send failed', err);
    return 0;
  }
}

async function spotsLeft(db: Db, game: Game): Promise<number> {
  const { count } = await db
    .from('pf_game_players')
    .select('id', { count: 'exact', head: true })
    .eq('game_id', game.id)
    .eq('status', 'in');
  return Math.max(game.spots_needed - (count ?? 0), 0);
}

/** "A game needs players", to the members whose level fits. Returns how many were sent. */
export async function inviteMembers(db: Db, game: Game, club: Club): Promise<number> {
  const { data, error } = await db.rpc('pf_game_recipients', { p_game: game.id, p_limit: MAX_RECIPIENTS });
  if (error) {
    console.error('[courtconnect] recipients', error.message);
    return 0;
  }
  const recipients = (data as { user_id: string; email: string; full_name: string | null; stop_token: string | null }[]) ?? [];
  if (!recipients.length) return 0;

  // Everyone needs a stop link, including members who have never opened the board.
  const missingPrefs = recipients.filter((r) => !r.stop_token);
  if (missingPrefs.length) {
    await db.from('pf_member_prefs').upsert(
      missingPrefs.map((r) => ({ club_id: club.id, user_id: r.user_id })),
      { onConflict: 'club_id,user_id', ignoreDuplicates: true },
    );
    const { data: made } = await db
      .from('pf_member_prefs')
      .select('user_id, stop_token')
      .eq('club_id', club.id)
      .in('user_id', missingPrefs.map((r) => r.user_id));
    const tokens = new Map(((made as { user_id: string; stop_token: string }[] | null) ?? []).map((m) => [m.user_id, m.stop_token]));
    for (const r of missingPrefs) r.stop_token = tokens.get(r.user_id) ?? null;
  }

  const [links, posterRow, left] = await Promise.all([
    ensureLinks(db, game, recipients.map((r) => r.user_id)),
    clubRoster(db, club.id, game.posted_by),
    spotsLeft(db, game),
  ]);
  const poster = shortName(posterRow[0]?.full_name);

  const messages = recipients
    .filter((r) => links.has(r.user_id))
    .map((r) =>
      inviteEmail(game, club, {
        to: r.email,
        name: r.full_name,
        poster,
        token: links.get(r.user_id)!,
        stopToken: r.stop_token,
        spotsLeft: left,
      }),
    );

  const sent = await deliver(club.owner_id, messages);
  const now = new Date().toISOString();
  await Promise.all([
    db.from('pf_games').update({ notified_count: game.notified_count + sent, updated_at: now }).eq('id', game.id),
    db.from('pf_links').update({ emailed_at: now }).eq('game_id', game.id).in('user_id', recipients.map((r) => r.user_id)),
  ]);
  return sent;
}

/** Everyone in the group gets the full line-up, each with their own link. */
async function sendToGroup(
  db: Db,
  game: Game,
  club: Club,
  build: (m: { to: string; name: string; token: string; group: Awaited<ReturnType<typeof gameGroup>> }) => GameMessage,
  roster?: RosterRow[],
): Promise<number> {
  const group = await gameGroup(db, game, roster);
  const links = await ensureLinks(db, game, group.map((m) => m.userId));
  const messages = group
    .filter((m) => m.email && links.has(m.userId))
    .map((m) => build({ to: m.email!, name: m.name, token: links.get(m.userId)!, group }));
  return deliver(club.owner_id, messages);
}

export async function afterJoin(db: Db, gameId: string, joinerId: string, nowFull: boolean): Promise<void> {
  const game = await loadGame(db, gameId);
  if (!game) return;
  const club = await loadClub(db, game.club_id);
  if (!club) return;
  const roster = await clubRoster(db, club.id);

  if (nowFull) {
    await sendToGroup(db, game, club, (m) => gameFullEmail(game, club, m), roster);
    return;
  }

  const poster = roster.find((r) => r.user_id === game.posted_by);
  const joiner = roster.find((r) => r.user_id === joinerId);
  if (!poster?.email) return;
  const links = await ensureLinks(db, game, [game.posted_by]);
  await deliver(club.owner_id, [
    someoneJoinedEmail(game, club, {
      to: poster.email,
      joiner: shortName(joiner?.full_name),
      spotsLeft: await spotsLeft(db, game),
      token: links.get(game.posted_by)!,
    }),
  ]);
}

export async function afterLeave(db: Db, gameId: string, leaverId: string): Promise<void> {
  const game = await loadGame(db, gameId);
  if (!game) return;
  const club = await loadClub(db, game.club_id);
  if (!club) return;
  const roster = await clubRoster(db, club.id);
  const poster = roster.find((r) => r.user_id === game.posted_by);
  const leaver = roster.find((r) => r.user_id === leaverId);
  if (!poster?.email) return;
  const links = await ensureLinks(db, game, [game.posted_by]);
  await deliver(club.owner_id, [
    spotOpenedEmail(game, club, {
      to: poster.email,
      leaver: shortName(leaver?.full_name),
      spotsLeft: await spotsLeft(db, game),
      token: links.get(game.posted_by)!,
    }),
  ]);
}

export async function afterCancel(db: Db, gameId: string): Promise<void> {
  const game = await loadGame(db, gameId);
  if (!game) return;
  const club = await loadClub(db, game.club_id);
  if (!club) return;
  const group = await gameGroup(db, game);
  const poster = group.find((m) => m.isPoster);
  await deliver(
    club.owner_id,
    group
      .filter((m) => !m.isPoster && m.email)
      .map((m) => gameCancelledEmail(game, club, { to: m.email!, name: m.name, poster: poster?.short || 'The poster' })),
  );
}

/**
 * The daily cron: close out past games that never filled, and remind today's
 * groups. A game gets one reminder, on the morning of, in the club's own date.
 */
export async function runHousekeeping(db: Db): Promise<{ expired: number; reminded: number; emails: number }> {
  const { data: expired } = await db.rpc('pf_expire_games');

  const now = new Date();
  const { data: rows } = await db
    .from('pf_games')
    .select(GAME_COLS)
    .in('status', ['open', 'full'])
    .is('reminder_sent_at', null)
    .gt('starts_at', now.toISOString())
    .lt('starts_at', new Date(now.getTime() + 864e5).toISOString());

  let reminded = 0;
  let emails = 0;
  const clubs = new Map<string, Club | null>();
  for (const raw of (rows as Record<string, unknown>[] | null) ?? []) {
    const game = (await loadGame(db, raw.id as string))!;
    if (!clubs.has(game.club_id)) clubs.set(game.club_id, await loadClub(db, game.club_id));
    const club = clubs.get(game.club_id);
    if (!club) continue;
    // Today at the club, not today in UTC.
    if (clubDate(game.starts_at, club.timezone) !== clubDate(now, club.timezone)) continue;
    // A game nobody joined has no group to remind.
    if ((await spotsLeft(db, game)) === game.spots_needed) continue;

    // Claim the reminder first so an overlapping run cannot send it twice.
    const { data: claimed } = await db
      .from('pf_games')
      .update({ reminder_sent_at: new Date().toISOString() })
      .eq('id', game.id)
      .is('reminder_sent_at', null)
      .select('id');
    if (!claimed?.length) continue;

    emails += await sendToGroup(db, game, club, (m) => reminderEmail(game, club, m));
    reminded++;
  }
  return { expired: (expired as number) ?? 0, reminded, emails };
}
