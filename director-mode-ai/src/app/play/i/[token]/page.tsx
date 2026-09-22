import type { Metadata } from 'next';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import {
  clubRoster,
  gameGroup,
  levelFits,
  linkByToken,
  loadClub,
  loadGame,
} from '@/lib/partnerFinder/server';
import {
  FORMAT_LABEL,
  clockLabel,
  durationLabel,
  firstName,
  isFormat,
  longDay,
  ratingLabel,
} from '@/lib/partnerFinder/format';
import LinkClient from './LinkClient';

/**
 * The page behind every CourtConnect email button. No login: the token in
 * the URL names one game and one person.
 *
 * Opening it never changes anything. The "I'm in" tap is a button on this
 * page, because mail scanners follow links, and a scanner must not take a spot
 * on somebody's behalf.
 */
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'CourtConnect', robots: { index: false, follow: false } };

function Shell({ title, body }: { title: string; body: string }) {
  return (
    <main className="min-h-screen bg-slate-50 px-5 py-12 text-slate-900">
      <div className="mx-auto max-w-xl">
        <h1 className="text-3xl font-bold">{title}</h1>
        <p className="mt-3 text-lg text-slate-600">{body}</p>
      </div>
    </main>
  );
}

export default async function GameLinkPage({ params }: { params: { token: string } }) {
  const db = getSupabaseAdmin();
  const link = await linkByToken(db, params.token);
  if (!link) return <Shell title="Link not recognized" body="This link may be mistyped. Open CourtConnect in your club's app to see what's on." />;

  const [game, club] = await Promise.all([loadGame(db, link.game_id), loadClub(db, link.club_id)]);
  if (!game || !club) return <Shell title="Game not found" body="This game is no longer on the board." />;

  const roster = await clubRoster(db, club.id);
  const me = roster.find((r) => r.person_id === link.person_id) ?? null;
  if (!me) return <Shell title="Members only" body={`This game is for members of ${club.name}.`} />;

  const group = await gameGroup(db, game, roster);
  // posted_by is an account; compare people to people.
  const isPoster = roster.find((r) => r.user_id === game.posted_by)?.person_id === link.person_id;
  const imIn = group.some((m) => !m.isPoster && m.personId === link.person_id);
  const spotsLeft = Math.max(game.spots_needed - (group.length - 1), 0);

  // A full game still takes answers — they go in line (pf_claim_spot).
  const { data: waitRows } = await db
    .from('pf_game_players')
    .select('person_id, joined_at')
    .eq('game_id', game.id)
    .eq('status', 'wait')
    .order('joined_at');
  const waiting = (waitRows as { person_id: string }[] | null) ?? [];
  const myWaitPlace = waiting.findIndex((w) => w.person_id === link.person_id) + 1; // 0 = not waiting
  const tz = club.timezone;
  const started = new Date(game.starts_at).getTime() <= Date.now();

  /*
   * Who the host can seat by hand. Anyone already in, in line, or the host
   * themselves is off the list; the level filter is the same one the emails
   * used, so the host is not offered somebody the game was never for. Only
   * ever built for the host — nobody else needs the club's roster.
   */
  const inGame = new Set(group.map((m) => m.personId));
  const inLine = new Set(waiting.map((w) => w.person_id));
  const addable = isPoster
    ? roster
        .filter((r) => !inGame.has(r.person_id) && !inLine.has(r.person_id))
        .filter((r) => levelFits(game, r.ntrp))
        .map((r) => ({ id: r.person_id, name: r.full_name || 'A member' }))
        .sort((a, b) => a.name.localeCompare(b.name))
    : [];

  const level = ratingLabel(game.rating_min, game.rating_max, club.levels);
  const rows: [string, string][] = [
    ['When', `${longDay(game.starts_at, tz)}, ${clockLabel(game.starts_at, tz)}`],
    ['How long', durationLabel(game.duration_min)],
    ['Game', isFormat(game.format) ? FORMAT_LABEL[game.format] : game.format],
    ...(level ? ([['Level', level]] as [string, string][]) : []),
    ['Court', game.court || 'To be decided'],
    ['Posted by', group[0]?.short || 'A member'],
  ];

  return (
    <LinkClient
      token={link.token}
      clubName={club.name}
      clubSlug={club.slug}
      myFirstName={firstName(me.full_name)}
      title={`${longDay(game.starts_at, tz).split(',')[0]} ${clockLabel(game.starts_at, tz)} ${isFormat(game.format) ? FORMAT_LABEL[game.format] : game.format}`}
      rows={rows}
      note={game.note}
      status={started && game.status !== 'cancelled' ? 'past' : game.status}
      spotsLeft={spotsLeft}
      isPoster={isPoster}
      imIn={imIn}
      myWaitPlace={myWaitPlace}
      waitingCount={waiting.length}
      /*
       * Everyone invited sees WHO is playing — that is what turns "a game needs
       * players" into a reason to say yes. Phone numbers are the line that does
       * not move: they reach only the people actually in the game, and only
       * from members who chose to share them.
       */
      group={group.map((m) => ({
        name: m.short,
        note: m.isPoster ? 'posted the game' : null,
        phone: isPoster || imIn ? m.phone : null,
      }))}
      addable={addable}
      myLevel={me.ntrp}
      scale={club.levels}
    />
  );
}
