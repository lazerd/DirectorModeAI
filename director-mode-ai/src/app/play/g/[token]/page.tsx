import type { Metadata } from 'next';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { clubRoster, gameGroup, guestLinkByToken, loadClub, loadGame } from '@/lib/partnerFinder/server';
import { clockLabel, durationLabel, firstName, gameKind, longDay, ratingLabel } from '@/lib/partnerFinder/format';
import GuestClient from './GuestClient';

/**
 * The page behind a poster's invite to a friend from OUTSIDE the club
 * (pf_guest_invites.sql). No login and no membership: the token names one
 * game and one friend on the poster's own list. Opening it never acts.
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

export default async function GuestLinkPage({ params }: { params: { token: string } }) {
  const db = getSupabaseAdmin();
  const link = await guestLinkByToken(db, params.token);
  if (!link) return <Shell title="Link not recognized" body="This invite link may be mistyped. Ask the person who invited you to send it again." />;
  const [game, club] = await Promise.all([loadGame(db, link.game_id), loadClub(db, link.club_id)]);
  if (!game || !club) return <Shell title="Game not found" body="This game is no longer on." />;

  const roster = await clubRoster(db, club.id);
  const group = await gameGroup(db, game, roster);
  const poster = group.find((m) => m.isPoster);
  const imIn = link.status === 'in';
  const spotsLeft = Math.max(game.spots_needed - (group.length - 1), 0);
  const tz = club.timezone;
  const started = new Date(game.starts_at).getTime() <= Date.now();
  const level = ratingLabel(game.rating_min, game.rating_max, club.levels);
  const rows: [string, string][] = [
    ['When', `${longDay(game.starts_at, tz)}, ${clockLabel(game.starts_at, tz)}`],
    ['Where', club.name],
    ['How long', durationLabel(game.duration_min)],
    ['Game', gameKind(game.format, game.gender)],
    ...(level ? ([['Level', level]] as [string, string][]) : []),
    ['Court', game.court || 'To be decided'],
    ['Invited by', poster?.short || 'A member'],
  ];

  return (
    <GuestClient
      token={link.token}
      clubName={club.name}
      myFirstName={firstName(link.name)}
      poster={poster?.short || 'A member'}
      title={`${longDay(game.starts_at, tz).split(',')[0]} ${clockLabel(game.starts_at, tz)} ${gameKind(game.format, game.gender)}`}
      rows={rows}
      note={game.note}
      status={started && game.status !== 'cancelled' ? 'past' : game.status}
      spotsLeft={spotsLeft}
      imIn={imIn}
      saidNo={link.status === 'no'}
      /* Names only. Members' phone numbers stay with members. */
      group={group.map((m) => ({ name: m.short, note: m.isPoster ? 'invited you' : null }))}
    />
  );
}
