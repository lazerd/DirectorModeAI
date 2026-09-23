import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowRight, Handshake } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { resolveActiveClub } from '@/lib/clubs/activeClub';
import { clubRoster, loadClub, GAME_COLS, type Game } from '@/lib/partnerFinder/server';
import { FORMAT_LABEL, gameTitle, isFormat, ratingLabel, shortName } from '@/lib/partnerFinder/format';
import NotifyAgain from './NotifyAgain';
import SendAgain from './SendAgain';

/**
 * CourtConnect — the director's view. (Built as "Partner Finder"; the old
 * /run/members/partner-finder URL redirects here, see next.config.mjs.)
 *
 * A few findings first (is it working, who is it missing), then every game at
 * the club. Staff only: resolveActiveClub lists owned, staff (is_club_team
 * roles) and platform clubs, and returns nothing for a plain member.
 */
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'CourtConnect — ClubMode AI' };

const WINDOW_DAYS = 90;

type Stats = {
  posted: number;
  cancelled: number;
  filled: number;
  open_now: number;
  expired: number;
  median_fill_minutes: number | null;
  players_joined: number;
};

function minutesLabel(m: number | null): string {
  if (m == null) return '—';
  if (m < 60) return `${Math.round(m)} min`;
  if (m < 60 * 48) return `${(m / 60).toFixed(m < 600 ? 1 : 0)} hr`;
  return `${Math.round(m / 1440)} days`;
}

const STATUS_STYLE: Record<string, string> = {
  open: 'bg-sky-400/15 text-sky-300',
  full: 'bg-emerald-400/15 text-emerald-300',
  cancelled: 'bg-white/10 text-white/50',
  expired: 'bg-amber-400/15 text-amber-300',
};

export default async function CourtConnectDirectorPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?redirect=/run/members/courtconnect');

  const { active } = await resolveActiveClub(user.id, user.email);
  if (!active) redirect('/member');

  const db = getSupabaseAdmin();
  const club = await loadClub(db, active.id);
  if (!club) redirect('/');
  const tz = club.timezone;
  const since = new Date(Date.now() - WINDOW_DAYS * 864e5).toISOString();

  const [{ data: statsRaw }, { data: gameRows }, roster] = await Promise.all([
    db.rpc('pf_club_stats', { p_club: club.id, p_since: since }),
    db
      .from('pf_games')
      .select(GAME_COLS)
      .eq('club_id', club.id)
      .or(`created_at.gte.${since},starts_at.gte.${new Date().toISOString()}`)
      .order('starts_at', { ascending: false })
      .limit(200),
    clubRoster(db, club.id),
  ]);
  const stats = (statsRaw as Stats | null) ?? {
    posted: 0, cancelled: 0, filled: 0, open_now: 0, expired: 0, median_fill_minutes: null, players_joined: 0,
  };
  const games = (gameRows as Game[] | null) ?? [];

  const { data: playerRows } = games.length
    ? await db
        .from('pf_game_players')
        .select('game_id, user_id, status')
        .in('game_id', games.map((g) => g.id))
        .in('status', ['in', 'wait', 'no', 'out'])
        .order('joined_at')
    : { data: [] };
  /*
   * Who was actually written to. An answer is a reply to an invitation, so the
   * Answers column counts only people this game emailed: Gabe Fett was put in
   * the game by the director and never got the blast, and counting him as a
   * "yes" made it look as though a member had tapped when none had.
   */
  const { data: linkRows } = games.length
    ? await db
        .from('pf_links')
        .select('game_id, user_id, emailed_at')
        .in('game_id', games.map((g) => g.id))
        .not('emailed_at', 'is', null)
    : { data: [] };
  const emailedOn = new Map<string, Set<string>>();
  for (const l of (linkRows as { game_id: string; user_id: string }[] | null) ?? []) {
    emailedOn.set(l.game_id, (emailedOn.get(l.game_id) ?? new Set<string>()).add(l.user_id));
  }

  const names = new Map(roster.map((r) => [r.user_id, shortName(r.full_name)]));
  const playersBy = new Map<string, string[]>();
  const waitingBy = new Map<string, string[]>();
  /*
   * Who has said no, and who joined and then dropped out. Both used to be
   * status 'out' and neither was shown, so on the morning of a game a director
   * could see that sixteen people were emailed and nothing else — no way to
   * tell sixteen people ignoring it from sixteen people who had answered.
   */
  const declinedBy = new Map<string, string[]>();
  const droppedBy = new Map<string, string[]>();
  const bucket: Record<string, Map<string, string[]>> = {
    in: playersBy, wait: waitingBy, no: declinedBy, out: droppedBy,
  };
  /** Players who got the email and then tapped "I'm in" — a real yes. */
  const saidYesBy = new Map<string, string[]>();
  /** Anyone who has answered in any way, so the remainder is silence. */
  const answered = new Map<string, Set<string>>();
  for (const p of (playerRows as { game_id: string; user_id: string; status: string }[] | null) ?? []) {
    const into = bucket[p.status];
    if (!into) continue;
    const who = names.get(p.user_id) ?? 'A member';
    into.set(p.game_id, [...(into.get(p.game_id) ?? []), who]);
    answered.set(p.game_id, (answered.get(p.game_id) ?? new Set<string>()).add(p.user_id));
    if (p.status === 'in' && emailedOn.get(p.game_id)?.has(p.user_id)) {
      saidYesBy.set(p.game_id, [...(saidYesBy.get(p.game_id) ?? []), who]);
    }
  }

  // ---- findings
  const decided = stats.posted - stats.cancelled;
  const fillRate = decided > 0 ? Math.round((stats.filled / decided) * 100) : null;
  const unratedPeople = roster.filter((r) => r.ntrp == null);
  const unrated = unratedPeople.length;
  const muted = roster.filter((r) => !r.notify_games).length;
  const expiredByFormat = new Map<string, number>();
  for (const g of games.filter((x) => x.status === 'expired')) {
    expiredByFormat.set(g.format, (expiredByFormat.get(g.format) ?? 0) + 1);
  }
  const worstFormat = [...expiredByFormat.entries()].sort((a, b) => b[1] - a[1])[0];

  /*
   * A game that has been played is a record, not a to-do. Split on start time
   * so the table leads with what still needs players and the rest collapses.
   */
  const nowMs = Date.now();
  const upcoming = games
    .filter((g) => new Date(g.starts_at).getTime() >= nowMs)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const past = games.filter((g) => new Date(g.starts_at).getTime() < nowMs);

  const findings: { title: string; detail: string; href?: string; cta?: string }[] = [];
  if (decided >= 3 && fillRate != null) {
    findings.push({
      title: `${stats.filled} of ${decided} games filled (${fillRate}%)`,
      detail:
        stats.median_fill_minutes != null
          ? `A typical game fills ${minutesLabel(Number(stats.median_fill_minutes))} after it's posted. ${stats.players_joined} spots were taken in the last ${WINDOW_DAYS} days.`
          : `${stats.players_joined} spots were taken in the last ${WINDOW_DAYS} days.`,
    });
  }
  if (roster.length > 0 && unrated > 0) {
    /*
     * Name them. A count sends the director to PlayerVault to hunt for people
     * the page already knows, and the vault is sorted by name rather than by
     * who is missing a rating, so the hunt is the whole job.
     *
     * There used to be three kinds of unrated person here — no rating, a
     * rating the email could not be attached to, and somebody not in
     * PlayerVault at all. Two of those were artefacts of matching people by
     * email address and of CourtConnect starting from accounts instead of the
     * roster. The roster IS PlayerVault now, so there is one case left and one
     * thing to do about it.
     */
    const NAMED = 12;
    const named = unratedPeople
      .map((r) => r.full_name?.trim() || r.email || 'Unnamed member')
      .sort((a, b) => a.localeCompare(b));
    const list = named.slice(0, NAMED).join('; ');
    const more = named.length > NAMED ? ` and ${named.length - NAMED} more` : '';
    findings.push({
      title: `${unrated} of ${roster.length} people have no level on file`,
      detail:
        `${list}${more}. They only hear about games that allow unrated players. ` +
        `Add their ${club.levels.inline} in PlayerVault.`,
      href: '/courtconnect/vault',
      cta: 'Open PlayerVault',
    });
  }

  /*
   * Separately: people the club cannot write to at all. Being on the roster is
   * enough to be in CourtConnect now, but an invitation still needs somewhere
   * to go.
   */
  const noEmail = roster.filter((r) => !r.email);
  if (noEmail.length > 0) {
    const names = noEmail.map((r) => r.full_name?.trim() || 'Unnamed').sort((a, b) => a.localeCompare(b));
    findings.push({
      title: `${noEmail.length} ${noEmail.length === 1 ? 'person has' : 'people have'} no email address`,
      detail:
        `${names.slice(0, 12).join('; ')}${names.length > 12 ? ` and ${names.length - 12} more` : ''}. ` +
        `They are on the roster and count as members, but nothing can reach them until ` +
        `PlayerVault has an address for them.`,
      href: '/courtconnect/vault',
      cta: 'Open PlayerVault',
    });
  }

  if (worstFormat && worstFormat[1] >= 3) {
    const label = isFormat(worstFormat[0]) ? FORMAT_LABEL[worstFormat[0]] : worstFormat[0];
    findings.push({
      title: `${worstFormat[1]} ${label} games went unfilled`,
      detail: `More ${label} games expire than any other kind. A standing ${label} session on the court sheet may serve those members better.`,
    });
  }
  if (muted >= 3) {
    findings.push({
      title: `${muted} members turned game emails off`,
      detail: 'They can still use the board. If this number keeps climbing, members are getting more game emails than they want.',
    });
  }

  const tiles: [string, string][] = [
    ['Games posted', String(stats.posted)],
    ['Filled', String(stats.filled)],
    ['Fill rate', fillRate == null ? '—' : `${fillRate}%`],
    ['Median time to fill', minutesLabel(stats.median_fill_minutes == null ? null : Number(stats.median_fill_minutes))],
  ];

  const gameRow = (g: Game) => {
    const players = playersBy.get(g.id) ?? [];
    const fillMin = g.filled_at
      ? (new Date(g.filled_at).getTime() - new Date(g.created_at).getTime()) / 60000
      : null;
    return (
      <tr key={g.id} className="border-t border-white/[0.06] align-top">
        <td className="px-4 py-3 font-medium">{gameTitle(g, tz)}</td>
        <td className="px-4 py-3 text-white/70">{ratingLabel(g.rating_min, g.rating_max, club.levels) || 'Any'}</td>
        <td className="px-4 py-3 text-white/70">{names.get(g.posted_by) ?? 'A member'}</td>
        <td className="px-4 py-3 text-white/70">
          {/*
            Court terms, not database terms. spots_needed counts
            the players wanted BESIDES the poster, so a doubles
            game posted by one member wanting three more is
            stored as 3 — and a director reading "1/3" has to do
            arithmetic to find out whether his court is full. The
            poster is playing: 2 of 4.
          */}
          {players.length + 1}/{g.spots_needed + 1}
          <span className="block text-white/45">
            {[names.get(g.posted_by) ?? 'A member', ...players].join(', ')}
          </span>
          {(waitingBy.get(g.id)?.length ?? 0) > 0 && (
            <span className="block text-amber-300/70">
              waiting: {waitingBy.get(g.id)!.join(', ')}
            </span>
          )}
        </td>
        <td className="px-4 py-3 text-white/70">{g.notified_count}</td>
        <td className="px-4 py-3 text-white/70">
          {(() => {
            const yes = saidYesBy.get(g.id) ?? [];
            const no = declinedBy.get(g.id) ?? [];
            const dropped = droppedBy.get(g.id) ?? [];
            const waiting = waitingBy.get(g.id) ?? [];
            const asked = emailedOn.get(g.id)?.size ?? g.notified_count;
            const quiet = [...(emailedOn.get(g.id) ?? [])]
              .filter((id) => !(answered.get(g.id)?.has(id)))
              .map((id) => ({ id, name: names.get(id) ?? 'A member' }));
            if (!asked) return <span className="text-white/35">—</span>;
            return (
              <>
                <span className={yes.length ? 'text-emerald-300' : 'text-white/50'}>{yes.length} yes</span>
                {' · '}
                <span className={no.length ? 'text-rose-300' : 'text-white/50'}>{no.length} no</span>
                {waiting.length > 0 && <span className="text-amber-300">{` · ${waiting.length} in line`}</span>}
                {quiet.length > 0 && <span className="text-white/35">{` · ${quiet.length} no reply`}</span>}
                {yes.length > 0 && (
                  <span className="mt-0.5 block text-xs text-emerald-300/70">said yes: {yes.join(', ')}</span>
                )}
                {no.length > 0 && (
                  <span className="mt-0.5 block text-xs text-rose-300/70">said no: {no.join(', ')}</span>
                )}
                {dropped.length > 0 && (
                  <span className="mt-0.5 block text-xs text-amber-300/70">dropped out: {dropped.join(', ')}</span>
                )}
                {/* One tap per person, for the copies that are sitting in spam. */}
                {g.status === 'open' && new Date(g.starts_at) > new Date() && (
                  <SendAgain gameId={g.id} people={quiet} />
                )}
                {/* Anyone the director put in the game themselves is on the court but never answered anything. */}
                {(playersBy.get(g.id) ?? []).length > yes.length && (
                  <span className="mt-0.5 block text-xs text-white/35">
                    added by staff:{' '}
                    {(playersBy.get(g.id) ?? []).filter((n) => !yes.includes(n)).join(', ')}
                  </span>
                )}
              </>
            );
          })()}
        </td>
        <td className="px-4 py-3">
          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_STYLE[g.status] ?? ''}`}>
            {g.status}
          </span>
          {fillMin != null && g.status === 'full' && (
            <span className="mt-1 block text-xs text-white/40">filled in {minutesLabel(fillMin)}</span>
          )}
          {/* Members added since it was posted have never heard about it. */}
          {g.status === 'open' && new Date(g.starts_at) > new Date() && (
            <NotifyAgain gameId={g.id} levelWord={club.levels.inline} />
          )}
        </td>
      </tr>
    );
  };

  const gamesTable = (list: Game[], nested = false) => (
    <div className={`overflow-x-auto ${nested ? '' : 'mt-4 rounded-2xl border border-white/[0.08]'}`}>
      <table className="w-full min-w-[720px] text-left text-[13.5px]">
        <thead className="text-white/40">
          <tr>
            <th className="px-4 py-3 font-medium">Game</th>
            <th className="px-4 py-3 font-medium">Level</th>
            <th className="px-4 py-3 font-medium">Posted by</th>
            <th className="px-4 py-3 font-medium">Playing</th>
            <th className="px-4 py-3 font-medium">Emailed</th>
            <th className="px-4 py-3 font-medium">Answers</th>
            <th className="px-4 py-3 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>{list.map(gameRow)}</tbody>
      </table>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#001016] text-white" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
      <div className="mx-auto max-w-5xl px-5 py-12 sm:px-8 sm:py-16">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/30">Run the club · Members</p>
        <div className="mt-3 flex items-start gap-4">
          <span className="mt-0.5 flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#34d399]/15">
            <Handshake size={24} className="text-[#34d399]" />
          </span>
          <div>
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">CourtConnect</h1>
            <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-white/50">
              {club.name} members post games that need players; members at the right level get an email and join in
              one tap. Members find CourtConnect in their clubhouse, on the court sheet and on your club site.
            </p>
            <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm font-medium">
              <Link href={`/c/${club.slug}/play`} className="inline-flex items-center gap-1.5 text-[#D3FB52]">
                Open the member board <ArrowRight size={14} />
              </Link>
              <span className="text-white/40">
                Member link: <span className="text-white/70">/c/{club.slug}/play</span>
              </span>
            </div>
          </div>
        </div>

        {findings.length > 0 && (
          <div className="mt-10 space-y-3">
            {findings.map((f) => (
              <div key={f.title} className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-5">
                <h2 className="text-lg font-semibold">{f.title}</h2>
                <p className="mt-1 text-[14.5px] leading-relaxed text-white/60">{f.detail}</p>
                {f.href && (
                  <Link href={f.href} className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-[#D3FB52]">
                    {f.cta} <ArrowRight size={14} />
                  </Link>
                )}
              </div>
            ))}
          </div>
        )}

        <p className="mt-8 text-[14.5px] leading-relaxed text-white/60">
          CourtConnect can reach <strong className="text-white">{roster.length}</strong>{' '}
          {roster.length === 1 ? 'person' : 'people'} — the members with a ClubMode account at {club.name}. Everyone
          else on your roster is in PlayerVault only, and cannot be emailed about a game until you add them there
          (&ldquo;Add&rdquo; needs no email; &ldquo;Invite&rdquo; sends one).{' '}
          <Link href="/courtconnect/vault?access=roster" className="font-medium text-[#D3FB52]">
            See who is not in yet
          </Link>
        </p>

        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {tiles.map(([k, v]) => (
            <div key={k} className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4">
              <div className="text-2xl font-bold">{v}</div>
              <div className="mt-1 text-[12.5px] text-white/45">{k}</div>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[12.5px] text-white/35">
          Last {WINDOW_DAYS} days. Cancelled games are left out of the fill rate.
        </p>

        <h2 className="mt-12 text-lg font-semibold">Every game</h2>
        {games.length === 0 ? (
          <p className="mt-3 text-[14.5px] text-white/50">
            No games posted yet. Share the member link: <span className="text-white/80">/c/{club.slug}/play</span>
          </p>
        ) : (
          <>
            {upcoming.length > 0 ? (
              gamesTable(upcoming)
            ) : (
              <p className="mt-3 text-[14.5px] text-white/50">
                Nothing on the books right now.
              </p>
            )}
            {/* Played games are history: they stay one click away rather than on top of what is still coming. */}
            {past.length > 0 && (
              <details className="mt-4 overflow-hidden rounded-2xl border border-white/[0.08]">
                <summary className="cursor-pointer px-4 py-3 text-[14.5px] font-medium text-white/60 hover:text-white/80">
                  Previous games ({past.length})
                </summary>
                <div className="border-t border-white/[0.06]">{gamesTable(past, true)}</div>
              </details>
            )}
          </>
        )}
      </div>
    </div>
  );
}
