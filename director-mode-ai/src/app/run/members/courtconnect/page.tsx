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

  const [{ data: statsRaw }, { data: gameRows }, roster, { data: unreachableVault }] = await Promise.all([
    db.rpc('pf_club_stats', { p_club: club.id, p_since: since }),
    db
      .from('pf_games')
      .select(GAME_COLS)
      .eq('club_id', club.id)
      .or(`created_at.gte.${since},starts_at.gte.${new Date().toISOString()}`)
      .order('starts_at', { ascending: false })
      .limit(200),
    clubRoster(db, club.id),
    // Roster rows with a rating but NO email. These are the reason a member can
    // be "unrated" while the club has in fact rated them: pf_member_roster
    // folds the vault over the account BY EMAIL, so a nameless-to-us row never
    // reaches the person it describes.
    db
      .from('cc_vault_players')
      .select('full_name, usta_rating')
      .eq('director_id', club.owner_id)
      .is('email', null)
      .not('usta_rating', 'is', null),
  ]);
  const stats = (statsRaw as Stats | null) ?? {
    posted: 0, cancelled: 0, filled: 0, open_now: 0, expired: 0, median_fill_minutes: null, players_joined: 0,
  };
  const games = (gameRows as Game[] | null) ?? [];

  const { data: playerRows } = games.length
    ? await db
        .from('pf_game_players')
        .select('game_id, user_id')
        .in('game_id', games.map((g) => g.id))
        .eq('status', 'in')
    : { data: [] };
  const names = new Map(roster.map((r) => [r.user_id, shortName(r.full_name)]));
  const playersBy = new Map<string, string[]>();
  for (const p of (playerRows as { game_id: string; user_id: string }[] | null) ?? []) {
    playersBy.set(p.game_id, [...(playersBy.get(p.game_id) ?? []), names.get(p.user_id) ?? 'A member']);
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
    // Name them. A count sends the director to PlayerVault to hunt for people
    // the page already knows — and the vault is sorted by name, not by who is
    // missing a rating, so the hunt is the whole job.
    const NAMED = 12;
    const key = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
    const ratedNoEmail = new Map(
      ((unreachableVault as { full_name: string; usta_rating: number }[] | null) ?? []).map((v) => [
        key(v.full_name || ''),
        Number(v.usta_rating),
      ]),
    );
    const named = unratedPeople
      .map((r) => {
        const name = r.full_name?.trim() || r.email || 'Unnamed member';
        const onRoster = ratedNoEmail.get(key(name));
        // The fix for these two is different — and much smaller — than typing
        // a rating in: their roster entry just needs their email address.
        return onRoster != null ? `${name} (on your roster at ${onRoster}, but that entry has no email)` : name;
      })
      .sort((a, b) => a.localeCompare(b));
    const list = named.slice(0, NAMED).join('; ');
    const more = named.length > NAMED ? ` and ${named.length - NAMED} more` : '';
    findings.push({
      title: `${unrated} of ${roster.length} members have no level on file`,
      detail:
        `${list}${more}. They only hear about games that allow unrated players. Add their ` +
        `${club.levels.inline} in PlayerVault — or, where it says a roster entry has no email, ` +
        `put their email on it, which is what links the rating to the person.`,
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

        <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
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
          <div className="mt-4 overflow-x-auto rounded-2xl border border-white/[0.08]">
            <table className="w-full min-w-[720px] text-left text-[13.5px]">
              <thead className="text-white/40">
                <tr>
                  <th className="px-4 py-3 font-medium">Game</th>
                  <th className="px-4 py-3 font-medium">Level</th>
                  <th className="px-4 py-3 font-medium">Posted by</th>
                  <th className="px-4 py-3 font-medium">Players</th>
                  <th className="px-4 py-3 font-medium">Emailed</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {games.map((g) => {
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
                        {players.length}/{g.spots_needed}
                        {players.length > 0 && <span className="block text-white/45">{players.join(', ')}</span>}
                      </td>
                      <td className="px-4 py-3 text-white/70">{g.notified_count}</td>
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
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
