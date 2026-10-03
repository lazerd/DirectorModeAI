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
  gameGuestLinks,
  type RosterRow,
} from './server';
import {
  gameCancelledEmail,
  gameFullEmail,
  guestInviteEmail,
  guestUrl,
  hostMessageEmail,
  linkUrl,
  inviteEmail,
  reminderEmail,
  someoneJoinedEmail,
  spotOpenedEmail,
  waitlistSpotEmail,
  type GameMessage,
} from './emails';

/**
 * Every builder links to the member page (/play/i/). An outside friend has no
 * member page, so their copy is pointed at /play/g/ instead.
 */
function forGuest(m: GameMessage, token: string): GameMessage {
  return { ...m, html: m.html.split(linkUrl(token)).join(guestUrl(token)) };
}

async function deliver(club: Club, messages: GameMessage[], replyTo?: string | null): Promise<number> {
  const real = messages.filter((m) => !!m.to);
  if (!real.length) return 0;
  try {
    /*
     * In the CLUB's name, answerable at the club's address. A member has no
     * relationship with "ClubMode" and every reason to distrust it; the name in
     * the inbox and a working Reply-To are two of the four things that decided
     * whether Sleepy Hollow's first blast was read or filtered (see
     * lib/emailText.ts for the other two).
     */
    const results = await sendBilledEmails(
      club.owner_id,
      real.map((m) => ({
        to: m.to,
        subject: m.subject,
        html: m.html,
        fromName: club.name,
        // A poster's own note is answered by the poster, not the club office.
        ...(replyTo || club.contactEmail ? { replyTo: (replyTo || club.contactEmail)! } : {}),
        // clubId lets a demo club's blast be held back (lib/demo/emailGuard.ts).
        clubId: club.id,
      })),
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

/**
 * "A game needs players", to the members whose level fits. Returns how many
 * were sent.
 *
 * `onlyNew` is for a second run over a game that is still open: it skips
 * everyone this game has already emailed, so a director who has just added
 * members can reach them without mailing the club twice about one game.
 */
export async function inviteMembers(
  db: Db,
  game: Game,
  club: Club,
  opts: { onlyNew?: boolean; only?: string[] } = {},
): Promise<number> {
  const { data, error } = await db.rpc('pf_game_recipients', { p_game: game.id, p_limit: MAX_RECIPIENTS });
  if (error) {
    console.error('[courtconnect] recipients', error.message);
    return 0;
  }
  let recipients = (data as { person_id: string; email: string; full_name: string | null; stop_token: string | null }[]) ?? [];

  /*
   * `only` is a deliberate re-send to named people — the ones who were emailed
   * and have not answered. It is filtered through pf_game_recipients like
   * everything else, so it cannot reach somebody who has since said no, joined,
   * or muted game email: the director picks a name, not an address.
   */
  if (opts.only?.length) {
    const wanted = new Set(opts.only);
    recipients = recipients.filter((r) => wanted.has(r.person_id));
  }

  if (opts.onlyNew && recipients.length) {
    const { data: already } = await db
      .from('pf_links')
      .select('person_id')
      .eq('game_id', game.id)
      .not('emailed_at', 'is', null);
    const sent = new Set(((already as { person_id: string }[] | null) ?? []).map((l) => l.person_id));
    recipients = recipients.filter((r) => !sent.has(r.person_id));
  }

  if (!recipients.length) return 0;

  // Everyone needs a stop link, including members who have never opened the board.
  const missingPrefs = recipients.filter((r) => !r.stop_token);
  if (missingPrefs.length) {
    await db.from('pf_member_prefs').upsert(
      missingPrefs.map((r) => ({ club_id: club.id, person_id: r.person_id })),
      { onConflict: 'club_id,person_id', ignoreDuplicates: true },
    );
    const { data: made } = await db
      .from('pf_member_prefs')
      .select('person_id, stop_token')
      .eq('club_id', club.id)
      .in('person_id', missingPrefs.map((r) => r.person_id));
    const tokens = new Map(((made as { person_id: string; stop_token: string }[] | null) ?? []).map((m) => [m.person_id, m.stop_token]));
    for (const r of missingPrefs) r.stop_token = tokens.get(r.person_id) ?? null;
  }

  const [links, fullRoster, left] = await Promise.all([
    ensureLinks(db, game, recipients.map((r) => r.person_id)),
    clubRoster(db, club.id),
    spotsLeft(db, game),
  ]);
  // Who is already in, poster first. An invitation that can say "Walden B. and
  // Gabe F. are playing" is a different message from "a game needs players".
  const group = await gameGroup(db, game, fullRoster);
  const poster = group[0]?.short ?? shortName(fullRoster.find((r) => r.user_id === game.posted_by)?.full_name);
  const playing = group.map((m) => m.short);

  const messages = recipients
    .filter((r) => links.has(r.person_id))
    .map((r) =>
      inviteEmail(game, club, {
        to: r.email,
        name: r.full_name,
        poster,
        token: links.get(r.person_id)!,
        stopToken: r.stop_token,
        spotsLeft: left,
        playing,
      }),
    );

  const sent = await deliver(club, messages);
  const now = new Date().toISOString();
  // A re-send reaches somebody already counted, so it must not inflate the
  // "Emailed" figure the director reads answers against.
  const newlyReached = opts.only?.length ? 0 : sent;
  await Promise.all([
    db.from('pf_games').update({ notified_count: game.notified_count + newlyReached, updated_at: now }).eq('id', game.id),
    db.from('pf_links').update({ emailed_at: now }).eq('game_id', game.id).in('person_id', recipients.map((r) => r.person_id)),
  ]);
  return sent;
}

/** Everyone in the group gets the full line-up, each with their own link. */
async function sendToGroup(
  db: Db,
  game: Game,
  club: Club,
  build: (m: {
    to: string;
    name: string;
    token: string;
    isPoster: boolean;
    group: Awaited<ReturnType<typeof gameGroup>>;
  }) => GameMessage,
  roster?: RosterRow[],
): Promise<number> {
  const group = await gameGroup(db, game, roster);
  // A guest has no person to hang a link on, and no email to send it to. They
  // appear in everyone else's line-up and are written to nothing.
  const links = await ensureLinks(db, game, group.filter((m) => !m.isGuest).map((m) => m.personId));
  const messages = group
    .filter((m) => !m.isGuest && m.email && links.has(m.personId))
    .map((m) =>
      build({ to: m.email!, name: m.name, token: links.get(m.personId)!, isPoster: m.isPoster, group }),
    );
  // A friend the poster invited gets the same news, pointed at their own page.
  for (const m of group) {
    if (m.isGuest && m.email && m.guestToken) {
      messages.push(forGuest(build({ to: m.email, name: m.name, token: m.guestToken, isPoster: false, group }), m.guestToken));
    }
  }
  return deliver(club, messages);
}

/**
 * @param joinerId  The person who just took a spot, or null for a guest the
 *                  host seated — a guest has no person anywhere, so their name
 *                  arrives in `guestName` instead.
 */
export async function afterJoin(
  db: Db,
  gameId: string,
  joinerId: string | null,
  nowFull: boolean,
  guestName?: string | null,
): Promise<void> {
  const game = await loadGame(db, gameId);
  if (!game) return;
  const club = await loadClub(db, game.club_id);
  if (!club) return;
  const roster = await clubRoster(db, club.id);

  const lastIn = joinerId
    ? shortName(roster.find((r) => r.person_id === joinerId)?.full_name)
    : (guestName ?? 'A guest');

  if (nowFull) {
    // The poster's copy says who completed the game; everyone else gets the
    // plain line-up.
    await sendToGroup(db, game, club, (m) => gameFullEmail(game, club, { ...m, joiner: lastIn }), roster);
    return;
  }

  const poster = roster.find((r) => r.user_id === game.posted_by);
  if (!poster?.email) return;
  // posted_by is the account that posted; the link belongs to the person.
  const links = await ensureLinks(db, game, [poster.person_id]);
  await deliver(club, [
    someoneJoinedEmail(game, club, {
      to: poster.email,
      joiner: lastIn,
      spotsLeft: await spotsLeft(db, game),
      token: links.get(poster.person_id)!,
    }),
  ]);
}

export async function afterLeave(db: Db, gameId: string, leaverId: string | null, leaverName?: string): Promise<void> {
  const game = await loadGame(db, gameId);
  if (!game) return;
  const club = await loadClub(db, game.club_id);
  if (!club) return;
  const roster = await clubRoster(db, club.id);
  const poster = roster.find((r) => r.user_id === game.posted_by);
  const leaver = roster.find((r) => r.person_id === leaverId);
  const left = await spotsLeft(db, game);

  // Everyone in line hears first, in the order they answered, and the first to
  // tap takes it — see pf_claim_spot. Nobody is promoted behind their back.
  const { data: waitingRows } = await db
    .from('pf_game_players')
    .select('person_id')
    .eq('game_id', game.id)
    .eq('status', 'wait')
    .order('joined_at');
  const waiting = ((waitingRows as { person_id: string }[] | null) ?? [])
    .map((w) => roster.find((r) => r.person_id === w.person_id))
    .filter((r): r is RosterRow => !!r?.email);

  if (waiting.length) {
    const playingNow = (await gameGroup(db, game, roster)).map((m) => m.short);
    const waitLinks = await ensureLinks(db, game, waiting.map((w) => w.person_id));
    await deliver(
      club,
      waiting
        .filter((w) => waitLinks.has(w.person_id))
        .map((w) =>
          waitlistSpotEmail(game, club, {
            to: w.email!,
            name: w.full_name,
            token: waitLinks.get(w.person_id)!,
            poster: shortName(poster?.full_name),
            playing: playingNow,
          }),
        ),
    );
  }

  if (!poster?.email) return;
  const links = await ensureLinks(db, game, [game.posted_by]);
  await deliver(club, [
    spotOpenedEmail(game, club, {
      to: poster.email,
      leaver: leaver ? shortName(leaver.full_name) : leaverName || 'A player',
      spotsLeft: left,
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
    club,
    group
      .filter((m) => !m.isPoster && m.email)
      .map((m) => gameCancelledEmail(game, club, { to: m.email!, name: m.name, poster: poster?.short || 'The poster' })),
    poster?.email,
  );
  await cancelPendingInvites(db, game, club, poster?.short || 'The poster', poster?.email);
}

/**
 * Outside friends the poster invited who hadn't answered yet. They aren't in the
 * group, so the cancel above misses them — but the poster asked them personally,
 * and they may be planning on it (Walden, 10/2/26).
 */
export async function cancelPendingInvites(db: Db, game: Game, club: Club, poster: string, replyTo?: string | null): Promise<number> {
  const { data } = await db
    .from('pf_guest_links')
    .select('pf_guest_contacts(name, email)')
    .eq('game_id', game.id)
    .eq('status', 'invited');
  const friends = ((data as unknown as { pf_guest_contacts: { name: string; email: string } | null }[] | null) ?? [])
    .map((r) => r.pf_guest_contacts)
    .filter((c): c is { name: string; email: string } => !!c?.email);
  return deliver(club, friends.map((c) => gameCancelledEmail(game, club, { to: c.email, name: c.name, poster })), replyTo);
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

/**
 * The poster's note to everyone who signed up: those in, then those in line.
 * `send: false` builds the exact same list and messages and returns them
 * unsent. That is the preview the host confirms before anything goes out.
 */
export async function messageSignups(
  db: Db,
  game: Game,
  club: Club,
  message: string,
  send: boolean,
): Promise<{ recipients: string[]; subject: string; sent: number; noEmail: string[] }> {
  const roster = await clubRoster(db, club.id);
  const group = await gameGroup(db, game, roster);
  const poster = group.find((m) => m.isPoster);
  const { data: waitRows } = await db
    .from('pf_game_players')
    .select('person_id')
    .eq('game_id', game.id)
    .eq('status', 'wait')
    .order('joined_at');
  const byId = new Map(roster.map((r) => [r.person_id, r]));
  const people = [
    ...group
      .filter((m) => !m.isPoster && !m.isGuest)
      .map((m) => ({ id: m.personId, name: m.name, email: m.email, waiting: false })),
    ...((waitRows as { person_id: string }[] | null) ?? [])
      .map((w) => byId.get(w.person_id))
      .filter((r): r is RosterRow => !!r)
      .map((r) => ({ id: r.person_id, name: r.full_name || 'A member', email: r.email, waiting: true })),
  ];
  const reachable = people.filter((p) => !!p.email);
  const noEmail = people.filter((p) => !p.email).map((p) => shortName(p.name));
  const posterShort = poster?.short || 'The organizer';
  const links = await ensureLinks(db, game, reachable.map((p) => p.id));
  const sendable = reachable.filter((p) => links.has(p.id));
  const messages = sendable.map((p) =>
    hostMessageEmail(game, club, {
      to: p.email!,
      name: p.name,
      poster: posterShort,
      message,
      token: links.get(p.id)!,
      waiting: p.waiting,
    }),
  );
  // Outside friends who are in hear it too, at their own page.
  const friends = group.filter((m) => m.isGuest && m.email && m.guestToken);
  for (const f of friends) {
    messages.push(
      forGuest(
        hostMessageEmail(game, club, { to: f.email!, name: f.name, poster: posterShort, message, token: f.guestToken!, waiting: false }),
        f.guestToken!,
      ),
    );
  }
  const subject = messages[0]?.subject ?? '';
  const recipients = [
    ...sendable.map((p) => `${shortName(p.name)}${p.waiting ? ' (in line)' : ''}`),
    ...friends.map((f) => `${f.name} (your guest)`),
  ];
  if (!send) return { recipients, subject, sent: 0, noEmail };
  const sent = await deliver(club, messages, poster?.email);
  return { recipients, subject, sent, noEmail };
}

/**
 * The poster's own friends from outside the club, by contact id from THEIR
 * list. `send: false` returns who would get it, built by the same code.
 * Someone already in, or who already said no, is not asked again.
 */
export async function inviteGuests(
  db: Db,
  game: Game,
  club: Club,
  contactIds: string[],
  send: boolean,
): Promise<{ recipients: string[]; subject: string; sent: number; skipped: string[] }> {
  const roster = await clubRoster(db, club.id);
  const group = await gameGroup(db, game, roster);
  const poster = group.find((m) => m.isPoster);
  const posterPerson = poster?.personId;
  const { data: contacts } = await db
    .from('pf_guest_contacts')
    .select('id, name, email')
    .eq('owner_person_id', posterPerson ?? '')
    .in('id', contactIds.length ? contactIds : ['00000000-0000-0000-0000-000000000000']);
  const mine = (contacts as { id: string; name: string; email: string }[] | null) ?? [];
  const existing = new Map((await gameGuestLinks(db, game.id)).map((l) => [l.contact_id, l]));
  const skipped = mine.filter((c) => ['in', 'no'].includes(existing.get(c.id)?.status ?? '')).map((c) => c.name);
  const targets = mine.filter((c) => !['in', 'no'].includes(existing.get(c.id)?.status ?? ''));
  const recipients = targets.map((c) => c.name);
  const left = await spotsLeft(db, game);
  const playing = group.map((m) => m.short);
  const posterShort = poster?.short || 'A member';
  const sample = targets[0]
    ? guestInviteEmail(game, club, { to: targets[0].email, name: targets[0].name, poster: posterShort, token: 'x', spotsLeft: left, playing })
    : null;
  if (!send || !targets.length) return { recipients, subject: sample?.subject ?? '', sent: 0, skipped };

  await db.from('pf_guest_links').upsert(
    targets.map((c) => ({ game_id: game.id, club_id: game.club_id, contact_id: c.id })),
    { onConflict: 'game_id,contact_id', ignoreDuplicates: true },
  );
  const links = new Map((await gameGuestLinks(db, game.id)).map((l) => [l.contact_id, l.token]));
  const messages = targets
    .filter((c) => links.has(c.id))
    .map((c) =>
      guestInviteEmail(game, club, { to: c.email, name: c.name, poster: posterShort, token: links.get(c.id)!, spotsLeft: left, playing }),
    );
  const sent = await deliver(club, messages, poster?.email);
  await db
    .from('pf_guest_links')
    .update({ emailed_at: new Date().toISOString(), status: 'invited' })
    .eq('game_id', game.id)
    .in('contact_id', targets.map((c) => c.id))
    .in('status', ['invited', 'left']);
  return { recipients, subject: sample?.subject ?? '', sent, skipped };
}
