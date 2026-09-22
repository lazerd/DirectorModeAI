/**
 * CourtConnect — reads and writes. (Partner Finder = CourtConnect: it was built
 * under that name, hence lib/partnerFinder and the pf_* tables.)
 *
 * Everything here takes the ADMIN client and does its own club check, because
 * almost every question it answers is about somebody else's row: who is in
 * this game, what is their level, may this person claim that spot. A session
 * client would read nothing back (pf_* tables only expose a few columns to
 * sessions) and quietly decide wrong.
 *
 * The race-sensitive writes are Postgres functions — see
 * supabase/migrations/partner_finder.sql. This file never counts spots and
 * then inserts.
 */
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { normalizeTimeZone } from '@/lib/captain/clubTime';
import { pickPrimaryClub, type Membership } from '@/lib/clubRoles';
import { clubLevelScale } from '@/lib/clubLevels';
import { levelFact, type LevelScale } from '@/lib/levels';
import {
  FORMAT_LABEL,
  isFormat,
  ratingLabel,
  shortName,
  gameTitle,
  clockLabel,
  longDay,
  durationLabel,
  type GameStatus,
} from './format';

export type Db = ReturnType<typeof getSupabaseAdmin>;

export type Game = {
  id: string;
  club_id: string;
  posted_by: string;
  starts_at: string;
  duration_min: number;
  format: string;
  spots_needed: number;
  rating_min: number | null;
  rating_max: number | null;
  include_unrated: boolean;
  court: string | null;
  note: string | null;
  status: GameStatus;
  notified_count: number;
  filled_at: string | null;
  cancelled_at: string | null;
  reminder_sent_at: string | null;
  created_at: string;
};

/**
 * A club, with the scale its members read levels on. `levels` rides along on
 * the club because everything that shows a level already has one — the board,
 * the emails, the emailed-link page, the director's table — and threading a
 * scale through each of them separately is how one of them gets forgotten and
 * shows a pickleball club an NTRP decimal.
 */
export type Club = {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  owner_id: string;
  sports: string[];
  levels: LevelScale;
  /**
   * Where a member's reply should land. The club's own address when it has set
   * one, otherwise null — and never a made-up noreply, because a message no
   * human can answer is both rude and a filtering signal.
   */
  contactEmail: string | null;
};

export type RosterRow = {
  /**
   * WHO THIS IS. The PlayerVault row id — the person, not their login.
   *
   * CourtConnect used to key on the account, which meant a club member with no
   * account did not exist to it, and two people sharing an inbox could not
   * both exist (courtconnect_reads_people.sql). Everything CourtConnect
   * remembers about somebody hangs off this.
   */
  person_id: string;
  /** Their account, when they have one. Most club members never will. */
  user_id: string | null;
  email: string | null;
  full_name: string | null;
  role: string;
  ntrp: number | null;
  /** 'club' = the club's PlayerVault rating; 'self' = what they told us. */
  ntrp_source: 'club' | 'self' | 'director' | 'usta' | null;
  notify_games: boolean;
  share_phone: boolean;
  phone: string | null;
  stop_token: string | null;
  /** Pickleball's own rating, where a member has one. Shown, never matched on. */
  dupr_singles: number | null;
  dupr_doubles: number | null;
};

export const GAME_COLS =
  'id, club_id, posted_by, starts_at, duration_min, format, spots_needed, rating_min, rating_max, include_unrated, court, note, status, notified_count, filled_at, cancelled_at, reminder_sent_at, created_at';

const num = (v: unknown) => (v == null ? null : Number(v));

function toGame(row: Record<string, unknown>): Game {
  return {
    ...(row as unknown as Game),
    rating_min: num(row.rating_min),
    rating_max: num(row.rating_max),
    spots_needed: Number(row.spots_needed),
  };
}

export async function loadClub(db: Db, clubId: string): Promise<Club | null> {
  const { data } = await db
    .from('cc_clubs')
    .select('id, name, slug, timezone, owner_id, sports, email')
    .eq('id', clubId)
    .maybeSingle();
  if (!data) return null;
  const row = data as Omit<Club, 'levels' | 'contactEmail'> & { email: string | null };
  const { email, ...c } = row;
  const sports = c.sports ?? ['tennis'];
  return {
    ...c,
    contactEmail: email?.trim() ? email.trim() : null,
    sports,
    timezone: normalizeTimeZone(c.timezone),
    levels: await clubLevelScale(db, { id: c.id, sports }),
  };
}

export async function loadGame(db: Db, gameId: string): Promise<Game | null> {
  const { data } = await db.from('pf_games').select(GAME_COLS).eq('id', gameId).maybeSingle();
  return data ? toGame(data as Record<string, unknown>) : null;
}

/**
 * The club a signed-in person plays at.
 *
 * A requested club is honoured only if they are a playing member there; else
 * the same primary-club rule /member uses, so the board and the clubhouse
 * never disagree about which club they are looking at. The maintenance crew is
 * not a playing member.
 */
export async function resolvePlayingClub(
  db: Db,
  userId: string,
  requestedClubId?: string | null,
): Promise<{ club: Club; role: string } | null> {
  const { data } = await db
    .from('cc_club_members')
    .select('club_id, role, created_at')
    .eq('user_id', userId)
    .neq('role', 'maintenance');
  const rows = (data as Membership[] | null) ?? [];
  if (!rows.length) return null;

  const pick =
    (requestedClubId && rows.find((r) => r.club_id === requestedClubId)?.club_id) ||
    pickPrimaryClub(rows, null);
  if (!pick) return null;
  const club = await loadClub(db, pick);
  if (!club) return null;
  return { club, role: rows.find((r) => r.club_id === pick)?.role || 'member' };
}

export async function clubRoster(
  db: Db,
  clubId: string,
  userId?: string,
  personId?: string,
): Promise<RosterRow[]> {
  const { data, error } = await db.rpc('pf_member_roster', {
    p_club: clubId,
    p_user: userId ?? null,
    p_person: personId ?? null,
  });
  if (error) throw new Error(`pf_member_roster: ${error.message}`);
  return ((data as RosterRow[] | null) ?? []).map((r) => ({
    ...r,
    ntrp: num(r.ntrp),
    dupr_singles: num(r.dupr_singles),
    dupr_doubles: num(r.dupr_doubles),
  }));
}

export async function memberRow(db: Db, clubId: string, userId: string): Promise<RosterRow | null> {
  return (await clubRoster(db, clubId, userId))[0] ?? null;
}

/** The same row, found by the person rather than by a session. */
export async function personRow(db: Db, clubId: string, personId: string): Promise<RosterRow | null> {
  return (await clubRoster(db, clubId, undefined, personId))[0] ?? null;
}

/** Does this level fit the game? Unrated fits only when the poster allowed it. */
export function levelFits(
  g: Pick<Game, 'rating_min' | 'rating_max' | 'include_unrated'>,
  ntrp: number | null,
): boolean {
  if (g.rating_min == null && g.rating_max == null) return true;
  if (ntrp == null) return g.include_unrated;
  return ntrp >= (g.rating_min ?? 1) && ntrp <= (g.rating_max ?? 7);
}

/**
 * Save the level a member told us.
 *
 * Written to master_players — the person, not this tool — so every part of
 * ClubMode sees the same number. A club that has already rated the member in
 * PlayerVault keeps its rating; a self-rating never overwrites the club's word.
 */
export async function saveSelfRating(
  db: Db,
  opts: { clubId: string; personId: string; email: string | null; fullName: string | null; ntrp: number },
): Promise<{ saved: boolean; reason?: 'club_rated' | 'no_email' }> {
  const current = await personRow(db, opts.clubId, opts.personId);
  if (current?.ntrp_source === 'club') return { saved: false, reason: 'club_rated' };
  const email = (opts.email || '').trim().toLowerCase();
  if (!email) return { saved: false, reason: 'no_email' };

  const patch = { ntrp: opts.ntrp, ntrp_source: 'self', ntrp_updated_at: new Date().toISOString() };
  const { data: updated } = await db
    .from('master_players')
    .update(patch)
    .eq('email_normalized', email)
    .select('id');
  if (!updated || updated.length === 0) {
    await db.from('master_players').insert({
      email,
      full_name: opts.fullName || email.split('@')[0],
      primary_club_id: opts.clubId,
      ...patch,
    });
  }
  return { saved: true };
}

export async function ensurePrefs(db: Db, clubId: string, personId: string) {
  await db
    .from('pf_member_prefs')
    .upsert({ club_id: clubId, person_id: personId }, { onConflict: 'club_id,person_id', ignoreDuplicates: true });
  const { data } = await db
    .from('pf_member_prefs')
    .select('notify_games, share_phone, phone, stop_token')
    .eq('club_id', clubId)
    .eq('person_id', personId)
    .single();
  return data as { notify_games: boolean; share_phone: boolean; phone: string | null; stop_token: string };
}

/** One secret link per (game, person), created on first need. */
export async function ensureLinks(
  db: Db,
  game: Pick<Game, 'id' | 'club_id'>,
  personIds: string[],
): Promise<Map<string, string>> {
  const ids = [...new Set(personIds)];
  if (!ids.length) return new Map();
  await db.from('pf_links').upsert(
    ids.map((person_id) => ({ game_id: game.id, club_id: game.club_id, person_id })),
    { onConflict: 'game_id,person_id', ignoreDuplicates: true },
  );
  const { data } = await db
    .from('pf_links')
    .select('person_id, token')
    .eq('game_id', game.id)
    .in('person_id', ids);
  return new Map(((data as { person_id: string; token: string }[] | null) ?? []).map((l) => [l.person_id, l.token]));
}

export async function linkByToken(db: Db, token: string) {
  if (!/^[a-f0-9]{32,64}$/.test(token || '')) return null;
  const { data } = await db
    .from('pf_links')
    .select('token, game_id, club_id, person_id')
    .eq('token', token)
    .maybeSingle();
  return (data as { token: string; game_id: string; club_id: string; person_id: string } | null) ?? null;
}

export type GroupMember = {
  personId: string;
  name: string;
  short: string;
  email: string | null;
  /** Only when they chose to share it. */
  phone: string | null;
  isPoster: boolean;
  /**
   * Seated by the host and not a member of anything — `personId` is the seat,
   * not a person. No email, no token link, no PlayerVault row, ever.
   */
  isGuest: boolean;
};

/** The poster plus everyone currently in, poster first. */
export async function gameGroup(db: Db, game: Game, roster?: RosterRow[]): Promise<GroupMember[]> {
  const { data } = await db
    .from('pf_game_players')
    .select('id, person_id, guest_name, joined_at')
    .eq('game_id', game.id)
    .eq('status', 'in')
    .order('joined_at');
  const rows = (data as { id: string; person_id: string | null; guest_name: string | null }[] | null) ?? [];
  const people = roster ?? (await clubRoster(db, game.club_id));
  const byId = new Map(people.map((r) => [r.person_id, r]));
  // posted_by is an ACCOUNT — a game is always posted by someone signed in —
  // so it has to be translated to that person before it can index this map.
  const posterPersonId = people.find((r) => r.user_id === game.posted_by)?.person_id ?? game.posted_by;
  const poster = byId.get(posterPersonId);

  const members: GroupMember[] = [
    {
      personId: posterPersonId,
      name: poster?.full_name || 'A member',
      short: shortName(poster?.full_name),
      email: poster?.email ?? null,
      phone: poster?.share_phone && poster.phone ? poster.phone : null,
      isPoster: true,
      isGuest: false,
    },
  ];

  for (const row of rows) {
    /*
     * A guest the host seated has no person anywhere — that is the point, they
     * are not a member (pf_host_add.sql). They belong in the line-up so the
     * group knows who is coming, but they are keyed by the seat rather than by
     * a person, have no email, and must never be handed a token link.
     */
    if (!row.person_id) {
      members.push({
        personId: row.id,
        name: row.guest_name || 'Guest',
        short: row.guest_name || 'Guest',
        email: null,
        phone: null,
        isPoster: false,
        isGuest: true,
      });
      continue;
    }
    const r = byId.get(row.person_id);
    members.push({
      personId: row.person_id,
      name: r?.full_name || 'A member',
      short: shortName(r?.full_name),
      email: r?.email ?? null,
      phone: r?.share_phone && r.phone ? r.phone : null,
      isPoster: false,
      isGuest: false,
    });
  }
  return members;
}

/* ------------------------------------------------------------------ board */

export type BoardGame = {
  id: string;
  title: string;
  day: string;
  clock: string;
  format: string;
  formatLabel: string;
  duration: string;
  spotsNeeded: number;
  spotsLeft: number;
  /** The level as a member says it: "3.0–3.5" or "Intermediate". "" = any level. */
  rating: string;
  /** The same thing as a fact on a card: "Level 3.0–3.5", or just "Intermediate". */
  ratingFact: string;
  includeUnrated: boolean;
  court: string | null;
  note: string | null;
  status: GameStatus;
  poster: string;
  isMine: boolean;
  imIn: boolean;
  /** Names of who is in — only for the poster and the players themselves. */
  players: string[];
  fitsMe: boolean;
};

export type Board = {
  club: { id: string; name: string; slug: string; timezone: string };
  /** What this club calls a level, and the tiers if it plays by name. */
  levels: LevelScale;
  me: {
    id: string;
    name: string | null;
    /** The number everything matches on. */
    ntrp: number | null;
    ntrpSource: RosterRow['ntrp_source'];
    /** Pickleball's rating, where they have one — what the board SHOWS instead. */
    duprSingles: number | null;
    duprDoubles: number | null;
    notifyGames: boolean;
    sharePhone: boolean;
    phone: string | null;
  };
  open: BoardGame[];
  mine: BoardGame[];
  joined: BoardGame[];
  postsLeftToday: number;
};

export async function loadBoard(db: Db, club: Club, userId: string, dailyLimit: number): Promise<Board> {
  const nowIso = new Date().toISOString();
  const tz = club.timezone;

  /*
   * The signed-in viewer, as a PERSON. Everything CourtConnect stores about
   * them — their preferences, the games they are in — now hangs off the
   * PlayerVault row rather than the login, so the session has to be resolved
   * to one before anything else is read.
   */
  const me = await memberRow(db, club.id, userId);
  const myPersonId = me?.person_id ?? null;

  const [roster, prefs, { data: openRows }, { data: mineRows }, { data: inRows }, { count: recent }] =
    await Promise.all([
      clubRoster(db, club.id),
      myPersonId
        ? ensurePrefs(db, club.id, myPersonId)
        : Promise.resolve({ notify_games: true, share_phone: false, phone: null, stop_token: '' }),
      db
        .from('pf_games')
        .select(GAME_COLS)
        .eq('club_id', club.id)
        .eq('status', 'open')
        .gt('starts_at', nowIso)
        .order('starts_at')
        .limit(60),
      db
        .from('pf_games')
        .select(GAME_COLS)
        .eq('club_id', club.id)
        .eq('posted_by', userId)
        .in('status', ['open', 'full'])
        .gt('starts_at', nowIso)
        .order('starts_at'),
      myPersonId
        ? db
            .from('pf_game_players')
            .select('game_id')
            .eq('club_id', club.id)
            .eq('person_id', myPersonId)
            .eq('status', 'in')
        : Promise.resolve({ data: [] as { game_id: string }[] }),
      db
        .from('pf_games')
        .select('id', { count: 'exact', head: true })
        .eq('club_id', club.id)
        .eq('posted_by', userId)
        .gt('created_at', new Date(Date.now() - 864e5).toISOString()),
    ]);

  const inIds = ((inRows as { game_id: string }[] | null) ?? []).map((r) => r.game_id);
  const { data: joinedRows } = inIds.length
    ? await db
        .from('pf_games')
        .select(GAME_COLS)
        .in('id', inIds)
        .in('status', ['open', 'full'])
        .gt('starts_at', nowIso)
        .order('starts_at')
    : { data: [] };

  const all = new Map<string, Game>();
  for (const r of [...(openRows ?? []), ...(mineRows ?? []), ...(joinedRows ?? [])] as Record<string, unknown>[]) {
    const g = toGame(r);
    all.set(g.id, g);
  }

  const { data: playerRows } = all.size
    ? await db
        .from('pf_game_players')
        .select('game_id, person_id, joined_at')
        .in('game_id', [...all.keys()])
        .eq('status', 'in')
        .order('joined_at')
    : { data: [] };
  const playersByGame = new Map<string, string[]>();
  for (const p of (playerRows as { game_id: string; person_id: string }[] | null) ?? []) {
    playersByGame.set(p.game_id, [...(playersByGame.get(p.game_id) ?? []), p.person_id]);
  }

  const byId = new Map(roster.map((r) => [r.person_id, r]));
  const myNtrp = me?.ntrp ?? null;

  const view = (g: Game): BoardGame => {
    const ids = playersByGame.get(g.id) ?? [];
    const isMine = g.posted_by === userId;
    const imIn = !!myPersonId && ids.includes(myPersonId);
    return {
      id: g.id,
      title: gameTitle(g, tz),
      day: longDay(g.starts_at, tz),
      clock: clockLabel(g.starts_at, tz),
      format: g.format,
      formatLabel: isFormat(g.format) ? FORMAT_LABEL[g.format] : g.format,
      duration: durationLabel(g.duration_min),
      spotsNeeded: g.spots_needed,
      spotsLeft: Math.max(g.spots_needed - ids.length, 0),
      rating: ratingLabel(g.rating_min, g.rating_max, club.levels),
      ratingFact: levelFact(club.levels, g.rating_min, g.rating_max),
      includeUnrated: g.include_unrated,
      court: g.court,
      note: g.note,
      status: g.status,
      poster: shortName(byId.get(g.posted_by)?.full_name),
      isMine,
      imIn,
      players: isMine || imIn ? ids.map((id) => shortName(byId.get(id)?.full_name)) : [],
      fitsMe: levelFits(g, myNtrp),
    };
  };

  const games = [...all.values()];
  return {
    club: { id: club.id, name: club.name, slug: club.slug, timezone: tz },
    levels: club.levels,
    me: {
      id: userId,
      name: me?.full_name ?? null,
      ntrp: myNtrp,
      ntrpSource: me?.ntrp_source ?? null,
      duprSingles: me?.dupr_singles ?? null,
      duprDoubles: me?.dupr_doubles ?? null,
      notifyGames: prefs?.notify_games ?? true,
      sharePhone: prefs?.share_phone ?? false,
      phone: prefs?.phone ?? null,
    },
    open: games
      .filter((g) => g.status === 'open' && g.posted_by !== userId && !(playersByGame.get(g.id) ?? []).includes(userId))
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
      .map(view),
    mine: games
      .filter((g) => g.posted_by === userId)
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
      .map(view),
    joined: games
      .filter((g) => inIds.includes(g.id))
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
      .map(view),
    postsLeftToday: Math.max(dailyLimit - (recent ?? 0), 0),
  };
}

/**
 * What a signed-out visitor to the club site may see: when, what, how many,
 * what level. No names, no note, no court.
 */
export async function publicOpenGames(db: Db, clubId: string) {
  const { data } = await db
    .from('pf_games')
    .select('id, starts_at, format, spots_needed, rating_min, rating_max')
    .eq('club_id', clubId)
    .eq('status', 'open')
    .gt('starts_at', new Date().toISOString())
    .order('starts_at')
    .limit(20);
  const games = (data as { id: string; starts_at: string; format: string; spots_needed: number; rating_min: number | null; rating_max: number | null }[] | null) ?? [];
  if (!games.length) return [];
  const { data: players } = await db
    .from('pf_game_players')
    .select('game_id')
    .in('game_id', games.map((g) => g.id))
    .eq('status', 'in');
  const taken = new Map<string, number>();
  for (const p of (players as { game_id: string }[] | null) ?? []) taken.set(p.game_id, (taken.get(p.game_id) ?? 0) + 1);
  return games.map((g) => ({ ...g, spots_left: Math.max(Number(g.spots_needed) - (taken.get(g.id) ?? 0), 0) }));
}
