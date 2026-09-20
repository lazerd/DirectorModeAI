import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { CalendarClock } from 'lucide-react';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import OpponentDirectory, {
  type OpponentContact,
  type OpponentPerson,
} from '@/components/captain/OpponentDirectory';
import { gateTeam } from '@/lib/captain/access';
import { playedCounts, pairRecords, rulesFor } from '@/lib/captain/server';
import { eligibilityReport, type RatingType } from '@/lib/captain/lineup';
import RosterPanel from '@/components/captain/RosterPanel';
import RosterContactsPanel from '@/components/captain/RosterContactsPanel';
import TeamContactsPanel, { type TeamContact } from '@/components/captain/TeamContactsPanel';
import AddMatchForm from '@/components/captain/AddMatchForm';
import PartnershipsPanel from '@/components/captain/PartnershipsPanel';
import ImportPanel from '@/components/captain/ImportPanel';
import PreseasonPanel from '@/components/captain/PreseasonPanel';
import TeamSettingsPanel from '@/components/captain/TeamSettingsPanel';
import StrengthOrderPanel from '@/components/captain/StrengthOrderPanel';
import FormOrderPanel from '@/components/captain/FormOrderPanel';
import NeverPairPanel from '@/components/captain/NeverPairPanel';
import SeasonAvailabilityPanel from '@/components/captain/SeasonAvailabilityPanel';
import TeamHostNotes from '@/components/captain/TeamHostNotes';
import { resolveClubTimeZone } from '@/lib/captain/clubTime';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { defaultCourts, leagueSpec } from '@/lib/captain/leagues';

export const dynamic = 'force-dynamic';

/**
 * The team page is FIVE PAGES, not one scroll.
 *
 * It used to render sixteen panels at once — roster, contacts, opponents,
 * import, intake, availability, partnerships, strength, form, never-pair, host
 * notes, settings, schedule — and fetch everything all of them needed on every
 * visit. Artem Melnik's first hour with it: "when you select a team then this
 * page is too crowded. I would rather have more menu items / sub-pages."
 *
 * Each tab is the same route with ?view=, so every link a captain already has
 * still opens the team, and each view fetches only what it draws. Schedule is
 * the default because that is what match week is about.
 */
const VIEWS = ['schedule', 'roster', 'availability', 'opponents', 'setup'] as const;
type View = (typeof VIEWS)[number];
const VIEW_LABEL: Record<View, string> = {
  schedule: 'Schedule',
  roster: 'Roster',
  availability: 'Availability',
  opponents: 'Opponents',
  setup: 'Setup',
};

export default async function TeamHub({
  params,
  searchParams,
}: {
  params: { teamId: string };
  searchParams?: { view?: string };
}) {
  const view: View = (VIEWS as readonly string[]).includes(searchParams?.view || '')
    ? (searchParams!.view as View)
    : 'schedule';
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?redirect=/captain/${params.teamId}`);

  const gate = await gateTeam(user.id, params.teamId);
  if (gate === 'not_member') notFound();
  if (gate === 'needs_subscription') redirect('/captain/subscribe');

  const db = await createServiceClient();
  const { data: teamRow } = await db
    .from('captain_teams')
    .select('*')
    .eq('id', params.teamId)
    .maybeSingle();
  if (!teamRow) notFound();
  const team = teamRow as {
    id: string;
    name: string;
    level: string | null;
    league_type: string;
    eligibility_enabled: boolean;
    min_matches_default: number;
    min_matches_self_rated: number;
    captaining_style: string | null;
    poll_lead_days: number | null;
    lineup_lead_days: number | null;
    default_singles_courts: number | null;
    default_doubles_courts: number | null;
    source_site: string | null;
    source_team_id: string | null;
    court_format: number | null;
  };

  // What a new match starts with. The team's own numbers if it has them,
  // otherwise the shape of its league.
  const courts = defaultCourts(team);

  /*
   * ONE ROUND TRIP, NOT TEN.
   *
   * Every read below used to be its own `await` in sequence. The functions run
   * in a different AWS region from the database, so each one cost a full
   * cross-country round trip and the page took ~3s to send its first byte
   * (Artem Melnik, 2026-09-19: "a bit slow response"). Nothing here depends on
   * anything else here, so they all go at once. Only the two reads that need
   * ids from this batch — opponent captains, availability — wait, and they then
   * run as a pair.
   */
  /*
   * What this view actually needs. A tab that draws no roster does not pay for
   * one: `false` skips the round trip entirely rather than fetching and
   * discarding. Roster is the widest — eligibility, strength and partnerships
   * are all read off it — and the schedule needs it too, for the playoff
   * eligibility warning.
   */
  const needRoster = view !== 'opponents';
  const needMatches = view === 'schedule' || view === 'availability' || view === 'roster';
  const needPrefs = view === 'roster';
  const needOpponents = view === 'opponents';
  const needContacts = view === 'roster';
  const needPartnerships = view === 'roster';
  const none = Promise.resolve({ data: [] as Record<string, unknown>[] });

  const [
    timeZone,
    { data: players },
    { data: matches },
    { data: prefs },
    { data: never },
    { data: opponentRows },
    { data: teamContactRows },
    counts,
    partnerships,
  ] = await Promise.all([
      // The club's zone — the schedule and new-match entry are both club-local.
      resolveClubTimeZone(getSupabaseAdmin(), (teamRow as { club_id?: string | null }).club_id),
      needRoster
        ? db
            // select('*') so a newly added column (sort_order, court_note) can't
            // 400 the whole team hub if the migration hasn't been run yet.
            .from('captain_players')
            .select('*')
            .eq('team_id', team.id)
            .eq('active', true)
            .order('is_sub')
            .order('name')
        : none,
      needMatches
        ? db.from('captain_matches').select('*').eq('team_id', team.id).order('match_at')
        : none,
      needPrefs
        ? db
            .from('captain_partner_prefs')
            .select('player_id, preferred_player_id, rank')
            .eq('team_id', team.id)
        : none,
      needPrefs
        ? db
            .from('captain_never_pair')
            .select('id, player_a_id, player_b_id')
            .eq('team_id', team.id)
        : none,
      needOpponents
        ? db
            .from('captain_opponents')
            .select('id, opponent, division, court_format, home_club, club_phone')
            .eq('team_id', team.id)
            .order('opponent')
        : none,
      needContacts
        ? db
            .from('captain_team_contacts')
            .select('id, name, role, email, phone, on_emails')
            .eq('team_id', team.id)
            .order('sort_order')
            .order('name')
        : none,
      needRoster ? playedCounts(db, team.id) : Promise.resolve({} as Record<string, number>),
      needPartnerships ? pairRecords(db, team.id) : Promise.resolve([]),
    ]);

  /*
   * League contacts. Pasted in once a season from the section's captain
   * contact sheet, so match morning isn't three logins deep on a phone.
   *
   * The people live on captain_opponent_captains — the junior sections list up
   * to five captains per team, which the old captain_/cocaptain_ pair could not
   * hold.
   */
  const teamContacts = (teamContactRows as TeamContact[] | null) ?? [];

  const opponentIds = ((opponentRows as { id: string }[]) || []).map((o) => o.id);
  // Availability counts are only drawn on the schedule and availability tabs.
  const matchIds =
    view === 'schedule' || view === 'availability'
      ? ((matches as { id: string }[]) || []).map((m) => m.id)
      : [];
  // Both need ids from the batch above, so they wait — but only for each other.
  const [{ data: contactRows }, { data: avail }] = await Promise.all([
    opponentIds.length
      ? db
          .from('captain_opponent_captains')
          .select('opponent_id, name, usta_number, safe_play_expires, email, phone, sort_order')
          .in('opponent_id', opponentIds)
          .order('sort_order')
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    matchIds.length
      ? db.from('captain_availability').select('match_id, status, player_id').in('match_id', matchIds)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
  ]);
  const peopleByOpponent = new Map<string, OpponentPerson[]>();
  for (const row of (contactRows as (OpponentPerson & { opponent_id: string })[]) || []) {
    const list = peopleByOpponent.get(row.opponent_id) ?? [];
    list.push(row);
    peopleByOpponent.set(row.opponent_id, list);
  }
  const opponentContacts: OpponentContact[] = (
    (opponentRows as {
      id: string;
      opponent: string;
      division: string | null;
      court_format: number | null;
      home_club: string | null;
      club_phone: string | null;
    }[]) || []
  ).map((o) => ({
    id: o.id,
    opponent: o.opponent,
    division: o.division,
    court_format: o.court_format,
    home_club: o.home_club,
    club_phone: o.club_phone,
    captains: peopleByOpponent.get(o.id) ?? [],
  }));

  const roster = (players as Record<string, unknown>[]) || [];
  const allMatches = (matches as Record<string, unknown>[]) || [];
  const upcoming = allMatches.filter(
    (m) => m.status === 'scheduled' && new Date(m.match_at as string) >= new Date(),
  );

  const eligibility = eligibilityReport({
    players: roster
      .filter((p) => !p.is_sub)
      .map((p) => ({
        id: p.id as string,
        name: p.name as string,
        ratingType: (p.rating_type as RatingType) ?? 'computer',
      })),
    playedByPlayer: counts,
    rules: rulesFor(team),
    matchesRemaining: upcoming.length,
  });

  const availByMatch: Record<string, number> = {};
  // How many of the UPCOMING dates each player has answered either way — the
  // season panel chases gaps, which is a different question from "who said yes".
  const answeredByPlayer: Record<string, number> = {};
  /**
   * Played and past matches, newest first.
   *
   * The schedule rendered `upcoming` only, so a match disappeared the moment
   * its start time passed — taking score entry and the post-match recap with
   * it, at exactly the moment a captain reaches for them. They stay listed now,
   * visually stepped back so the next match is still the obvious one.
   *
   * `upcoming` itself is untouched: it drives matchesRemaining and the
   * playoff-eligibility warnings, which must only ever count matches still to
   * be played.
   */
  const past = allMatches
    .filter((m) => !upcoming.some((u) => u.id === m.id))
    .sort(
      (a, b) =>
        new Date(b.match_at as string).getTime() - new Date(a.match_at as string).getTime(),
    );

  const upcomingIds = new Set(upcoming.map((m) => m.id as string));
  for (const a of (avail as unknown as { match_id: string; status: string; player_id: string }[]) ||
    []) {
    if (a.status === 'yes') availByMatch[a.match_id] = (availByMatch[a.match_id] ?? 0) + 1;
    if (upcomingIds.has(a.match_id)) {
      answeredByPlayer[a.player_id] = (answeredByPlayer[a.player_id] ?? 0) + 1;
    }
  }

  const atRisk = eligibility.filter((e) => !e.eligible);

  return (
    <div className="p-6 md:p-10 max-w-5xl">
      <Link href="/captain" className="text-white/40 text-sm hover:text-white">
        ← My Teams
      </Link>
      <h1 className="text-3xl font-display text-white mt-2">{team.name}</h1>
      <p className="text-white/50 mt-1">
        {team.level ? `${team.level} · ` : ''}
        {roster.filter((p) => !p.is_sub).length} on roster ·{' '}
        {roster.filter((p) => p.is_sub).length} subs
      </p>

      {/* A JTT captain is asked for this number all season — a parent registers
          on TennisLink with the Team ID, their USTA number and the fee. */}
      {team.source_team_id && (
        <p className="text-white/40 text-sm mt-1">
          {team.source_site === 'tennislink' ? 'TennisLink Team ID' : 'Team ID'}{' '}
          <span className="text-white/70 font-mono">{team.source_team_id}</span>
          {team.source_site === 'tennislink' && (
            <>
              {' · '}
              <a
                href="https://tennislink.usta.com/TeamTennis/Main/RegisterPlayers.aspx"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#D3FB52]/80 hover:text-[#D3FB52] underline"
              >
                player registration
              </a>
            </>
          )}
        </p>
      )}

      {/* The five sub-pages. Plain links, so each one is a real URL a captain
          can bookmark or be sent. */}
      <nav className="mt-5 flex flex-wrap items-center gap-1.5 border-b border-white/[0.08] pb-px">
        {VIEWS.map((v) => (
          <Link
            key={v}
            href={v === 'schedule' ? `/captain/${team.id}` : `/captain/${team.id}?view=${v}`}
            className={`rounded-t-xl px-4 py-2.5 text-sm transition-colors ${
              view === v
                ? 'border-b-2 border-[#D3FB52] font-semibold text-white'
                : 'border-b-2 border-transparent text-white/50 hover:text-white'
            }`}
          >
            {VIEW_LABEL[v]}
          </Link>
        ))}
        <Link
          href={`/captain/${team.id}/timeline`}
          className="ml-auto inline-flex items-center gap-2 rounded-xl border border-white/[0.08] bg-[#002838] px-4 py-2 text-sm text-white/80 transition-colors hover:border-[#D3FB52]/40 hover:text-white"
        >
          <CalendarClock size={16} className="text-[#D3FB52]" />
          Season emails
        </Link>
      </nav>

      {/*
        The roster leads the page.
        It used to be last, under eight other panels, with the email and mobile
        gaps in two further places — so the first thing a captain must do was the
        hardest thing to find. Everything about who is on the team, and how to
        reach them, is now one section at the top.
      */}
      {view === 'roster' && (
      <>
      <section className="mt-8">
        <h2 className="text-xl font-display text-white">Your team</h2>
      <RosterPanel
        teamId={team.id}
        players={roster as never}
        partnerPrefs={(prefs as never) || []}
        neverPairs={(never as never) || []}
        eligibility={eligibility}
        leagueType={team.league_type}
        eligibilityEnabled={team.eligibility_enabled}
      />

        <RosterContactsPanel
          teamId={team.id}
          players={roster as never}
          juniors={!!leagueSpec(team.league_type).multiLine}
        />

        <TeamContactsPanel teamId={team.id} contacts={teamContacts} />
      </section>

      <PartnershipsPanel
        partnerships={partnerships.map((r) => ({
          ...r,
          playerAName: (roster.find((p) => p.id === r.playerAId)?.name as string) ?? '—',
          playerBName: (roster.find((p) => p.id === r.playerBId)?.name as string) ?? '—',
        }))}
      />

      <StrengthOrderPanel teamId={team.id} players={roster as never} />

      {/* What played lines say the order should be — proposals only. */}
      <FormOrderPanel teamId={team.id} />

      <NeverPairPanel
        teamId={team.id}
        players={roster as never}
        neverPairs={(never as never) || []}
      />
      </>
      )}

      {view === 'opponents' && (
        <OpponentDirectory contacts={opponentContacts} teamId={team.id} division={team.level} />
      )}

      {view === 'schedule' && (
      <>
      {/* Host clubs' emails, forwarded to the team's address or pasted on a match. */}
      <TeamHostNotes teamId={team.id} timeZone={timeZone} />

      {atRisk.length > 0 && (
        <div className="mt-6 rounded-2xl border border-amber-400/30 bg-amber-400/[0.07] p-4">
          <div className="text-amber-200 font-medium">Playoff eligibility</div>
          <ul className="mt-2 space-y-1 text-sm text-amber-100/80">
            {atRisk.map((e) => (
              <li key={e.playerId}>
                {e.name} needs {e.short} more {e.short === 1 ? 'match' : 'matches'} (
                {e.played}/{e.required}
                {e.ratingType !== 'computer' ? `, ${e.ratingType}-rated` : ''})
                {e.atRisk
                  ? ` — only ${upcoming.length} left, so they need nearly all of them`
                  : ''}
              </li>
            ))}
          </ul>
        </div>
      )}

      <section className="mt-8">
        <h2 className="text-xl font-display text-white mb-3">Schedule</h2>
        {upcoming.length === 0 && (
          <p className="text-white/40 text-sm mb-3">No upcoming matches yet.</p>
        )}
        <div className="space-y-2">
          {upcoming.map((m) => (
            <Link
              key={m.id as string}
              href={`/captain/${team.id}/match/${m.id}`}
              className="flex items-center justify-between gap-4 rounded-xl border border-white/[0.08] bg-[#002838] p-4 hover:border-[#D3FB52]/40 transition-colors"
            >
              <div>
                <div className="text-white font-medium">
                  {/* Vercel runs UTC. Without an explicit zone a 9:30am match
                      renders as 4:30 PM. */}
                  {new Intl.DateTimeFormat('en-US', {
                    weekday: 'short',
                    month: 'short',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                    timeZone,
                  }).format(new Date(m.match_at as string))}
                </div>
                <div className="text-white/40 text-sm">
                  {(m.opponent as string) || 'TBD'} · {m.is_home ? 'Home' : 'Away'}
                </div>
              </div>
              <div className="text-right text-sm">
                <div className="text-[#D3FB52] font-medium">
                  {availByMatch[m.id as string] ?? 0} available
                </div>
                <div className="text-white/30">
                  {m.lineup_email_sent_at ? 'lineup sent' : 'no lineup sent'}
                </div>
              </div>
            </Link>
          ))}
        </div>

        {past.length > 0 && (
          <div className="mt-6">
            <h3 className="text-white/35 text-xs font-semibold uppercase tracking-[0.14em] mb-2">
              Played
            </h3>
            <div className="space-y-2">
              {past.map((m) => {
                const scored = (m.status as string) === 'played';
                return (
                  <Link
                    key={m.id as string}
                    href={`/captain/${team.id}/match/${m.id}`}
                    className="flex items-center justify-between gap-4 rounded-xl border border-white/[0.05] bg-[#002838]/40 p-4 opacity-60 hover:opacity-100 hover:border-white/20 transition-all"
                  >
                    <div>
                      <div className="text-white/70 font-medium">
                        {new Intl.DateTimeFormat('en-US', {
                          weekday: 'short',
                          month: 'short',
                          day: 'numeric',
                          hour: 'numeric',
                          minute: '2-digit',
                          timeZone,
                        }).format(new Date(m.match_at as string))}
                      </div>
                      <div className="text-white/30 text-sm">
                        {(m.opponent as string) || 'TBD'} · {m.is_home ? 'Home' : 'Away'}
                      </div>
                    </div>
                    <div className="text-right text-sm">
                      {/* The one thing a captain is looking for here is whether
                          they still owe this match a score. */}
                      <div className={scored ? 'text-white/40' : 'text-[#D3FB52] font-medium'}>
                        {scored ? 'recorded' : 'scores needed'}
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        )}
        <AddMatchForm
          teamId={team.id}
          singlesCourts={courts.singles}
          doublesCourts={courts.doubles}
          timeZone={timeZone}
        />
      </section>
      </>
      )}

      {view === 'availability' && (
      <>
      <SeasonAvailabilityPanel
        teamId={team.id}
        totalMatches={upcoming.length}
        players={roster
          .filter((p) => !p.is_sub)
          .map((p) => ({
            id: p.id as string,
            name: p.name as string,
            email: (p.email as string) || null,
            answered: answeredByPlayer[p.id as string] ?? 0,
          }))}
      />

      {/*
        No pre-season questionnaire for juniors.
        It asks for ranked partner preferences and a preferred return side —
        questions you cannot put to an eight-year-old by email, and that mean
        little in a format where one child can play three doubles lines with
        three different partners in the same afternoon. The lineup for a junior
        team is the coach's call, off the strength order.
      */}
      {!leagueSpec(team.league_type).multiLine && (
        <PreseasonPanel teamId={team.id} players={roster as never} />
      )}
      </>
      )}

      {view === 'setup' && (
      <>
      <ImportPanel teamId={team.id} teamIsEmpty={roster.length === 0} />

      <TeamSettingsPanel
        teamId={team.id}
        captainingStyle={team.captaining_style ?? null}
        pollLeadDays={team.poll_lead_days ?? null}
        lineupLeadDays={team.lineup_lead_days ?? null}
        singlesCourts={courts.singles}
        doublesCourts={courts.doubles}
        courtFormat={team.court_format}
        showCourtFormat={!!leagueSpec(team.league_type).multiLine}
        matchScoring={(team as unknown as { match_scoring?: string | null }).match_scoring ?? null}
        showMatchScoring={!leagueSpec(team.league_type).multiLine}
        maxPlayers={(team as unknown as { max_players?: number | null }).max_players ?? null}
        teamName={team.name}
        level={team.level}
        levelLabel={leagueSpec(team.league_type).levelLabel}
        sourceTeamId={team.source_team_id}
      />
      </>
      )}

    </div>
  );
}
