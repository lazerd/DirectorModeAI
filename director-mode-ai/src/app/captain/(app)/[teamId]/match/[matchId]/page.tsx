import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { gateTeam } from '@/lib/captain/access';
import { committedCounts, playedCounts, singlesCounts } from '@/lib/captain/server';
import MatchWorkspace, { type MatchPlayer } from '@/components/captain/MatchWorkspace';
import HostEmailPanel from '@/components/captain/HostEmailPanel';
import HostNotePanel from '@/components/captain/HostNotePanel';
import MatchCoachPicker, { type CoachOption } from '@/components/captain/MatchCoachPicker';
import { resolveClubTimeZone } from '@/lib/captain/clubTime';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { DEFAULT_JTT_COURT_FORMAT, leagueSpec } from '@/lib/captain/leagues';
import { pickOpponentRow } from '@/lib/captain/opponentMatch';
import { formatPhone, normalizePhone } from '@/lib/captain/phone';

export const dynamic = 'force-dynamic';

export default async function MatchPage({
  params,
}: {
  params: { teamId: string; matchId: string };
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?redirect=/captain/${params.teamId}/match/${params.matchId}`);

  const gate = await gateTeam(user.id, params.teamId);
  if (gate === 'not_member') notFound();
  if (gate === 'needs_subscription') redirect('/captain/subscribe');

  const db = await createServiceClient();
  const [{ data: teamRow }, { data: matchRow }] = await Promise.all([
    db.from('captain_teams').select('*').eq('id', params.teamId).maybeSingle(),
    db
      .from('captain_matches')
      .select('*')
      .eq('id', params.matchId)
      .eq('team_id', params.teamId)
      .maybeSingle(),
  ]);
  if (!teamRow || !matchRow) notFound();

  const team = teamRow as { id: string; name: string; level: string | null };
  const match = matchRow as Record<string, unknown>;
  const timeZone = await resolveClubTimeZone(
    getSupabaseAdmin(),
    (teamRow as { club_id?: string | null }).club_id,
  );

  const [{ data: players }, { data: avail }, { data: lineups }, { data: results }] =
    await Promise.all([
    db
      .from('captain_players')
      .select('id, name, email, phone, rating, wtn, wtn_doubles, gender, return_side, court_limit, is_sub')
      .eq('team_id', params.teamId)
      .eq('active', true)
      .order('name'),
    db
      .from('captain_availability')
      // `note` is the player's own qualifier — "doubles only", "call last".
      // Stored beside the status precisely so the captain sees it while
      // building the lineup, which means it has to travel this far.
      .select('player_id, status, note')
      .eq('match_id', params.matchId),
    db
      .from('captain_lineups')
      .select(
        'id, court_number, court_type, player1_id, player2_id, player1_confirmed_at, player2_confirmed_at, player1_confirmed_source, player2_confirmed_source, player1_declined_at, player2_declined_at, player1_decline_note, player2_decline_note',
      )
      .eq('match_id', params.matchId)
      .order('court_number'),
    db
      .from('captain_results')
      .select('court_number, score, won, defaulted, default_by, opponent_names')
      .eq('match_id', params.matchId),
  ]);

  /**
   * Equal play needs TWO numbers, and they answer different questions.
   *
   * `played` is history — matches that have actually happened. `committed` is
   * the promise: every saved lineup, which is the number the generator plans
   * against. Mid-season they diverge sharply, because a captain builds match 5
   * before match 3 is played. Showing only "played" would tell a captain the
   * roster is level while four people are already booked into the next three
   * sheets.
   *
   * `committed` deliberately EXCLUDES this match: the workspace adds whoever is
   * on screen right now, so the count moves as courts are swapped, before
   * anything is saved.
   */
  const [played, committed, singlesBefore] = await Promise.all([
    playedCounts(db, params.teamId),
    committedCounts(db, params.teamId, params.matchId),
    singlesCounts(db, params.teamId, params.matchId),
  ]);

  const answers = (avail as { player_id: string; status: string; note: string | null }[]) || [];
  const statusOf = (id: string) => answers.find((a) => a.player_id === id)?.status ?? null;
  const noteOf = (id: string) => answers.find((a) => a.player_id === id)?.note ?? null;

  const roster: MatchPlayer[] = ((players as Record<string, unknown>[]) || []).map((p) => ({
    id: p.id as string,
    name: p.name as string,
    rating: p.rating == null ? null : Number(p.rating),
    // WTN runs the other way to NTRP — lower is stronger — and orders courts.
    wtn: p.wtn == null ? null : Number(p.wtn),
    wtnDoubles: p.wtn_doubles == null ? null : Number(p.wtn_doubles),
    isSub: p.is_sub as boolean,
    hasEmail: !!p.email,
    // The contact panel needs the real address and number, not just a flag:
    // reaching one player who never tapped Confirm is the whole point of it.
    email: (p.email as string) || null,
    phone: (p.phone as string) || null,
    availability: statusOf(p.id as string) as MatchPlayer['availability'],
    availabilityNote: noteOf(p.id as string),
    played: played[p.id as string] ?? 0,
    committedElsewhere: committed[p.id as string] ?? 0,
    singlesBefore: singlesBefore[p.id as string] ?? 0,
  }));

  // Withdrawals are per-slot in the DB but per-player everywhere the captain
  // looks, because a bail follows the person through any swap.
  const withdrawals = ((lineups as Record<string, unknown>[]) || []).flatMap((l) =>
    ([1, 2] as const)
      .filter((slot) => !!l[`player${slot}_declined_at`] && !!l[`player${slot}_id`])
      .map((slot) => ({
        playerId: l[`player${slot}_id`] as string,
        at: l[`player${slot}_declined_at`] as string,
        note: (l[`player${slot}_decline_note`] as string) || null,
      })),
  );

  // JTT only: how many courts this match is played on at once — the match's own
  // setting (the host decides), else the team's. Null for adult leagues.
  const teamRec = teamRow as Record<string, unknown>;
  const jttCourtFormat = leagueSpec(teamRec.league_type as string).multiLine
    ? ((match.court_format as number | null) ??
      (teamRec.court_format as number | null) ??
      DEFAULT_JTT_COURT_FORMAT)
    : null;

  /*
   * The opposing captain (and co-captain), for the header. What is typed on
   * the match wins field by field; the league-contacts directory fills the
   * rest, matched the same way the host email matches it.
   */
  const { data: oppRows } = await getSupabaseAdmin()
    .from('captain_opponents')
    .select('opponent, captain_name, captain_email, captain_phone, cocaptain_name, cocaptain_email, cocaptain_phone')
    .eq('team_id', params.teamId);
  const dir = pickOpponentRow(
    (match.opponent as string) || null,
    (oppRows as {
      opponent: string | null;
      captain_name: string | null;
      captain_email: string | null;
      captain_phone: string | null;
      cocaptain_name: string | null;
      cocaptain_email: string | null;
      cocaptain_phone: string | null;
    }[]) || [],
  );
  // Our side: the team's COACHES, for the "coach at this match" picker. Team
  // parents are contacts too, but they can't coach a match (Darrin, 9/18).
  const { data: contactRows } = await getSupabaseAdmin()
    .from('captain_team_contacts')
    .select('id, name, role, email, phone')
    .eq('team_id', params.teamId)
    .in('role', ['coach', 'captain'])
    .order('name');
  const coachOptions: CoachOption[] = ((contactRows as CoachOption[]) || []).map((c) => ({
    ...c,
    phone: c.phone ? formatPhone(normalizePhone(c.phone)) || c.phone : null,
  }));
  // The captain themself is always a choice, even before they're a contact —
  // picking "you" creates the contact (see PATCH /api/captain/matches).
  const myEmail = (user.email || '').toLowerCase();
  if (myEmail && !coachOptions.some((c) => (c.email || '').toLowerCase() === myEmail)) {
    const { data: prof } = await getSupabaseAdmin()
      .from('profiles')
      .select('full_name')
      .eq('id', user.id)
      .maybeSingle();
    const me = (prof as { full_name: string | null } | null)?.full_name?.trim() || user.email!.split('@')[0];
    coachOptions.unshift({ id: 'self', name: `${me} (you)`, role: 'coach', email: user.email ?? null, phone: null });
  }

  const oppContacts = [
    {
      role: 'Their captain',
      name: (match.opposing_captain_name as string | null) || dir?.captain_name || null,
      email: (match.opposing_captain_email as string | null) || dir?.captain_email || null,
      phone: (match.opposing_captain_phone as string | null) || dir?.captain_phone || null,
    },
    {
      role: 'Co-captain',
      name: dir?.cocaptain_name || null,
      email: dir?.cocaptain_email || null,
      phone: dir?.cocaptain_phone || null,
    },
  ].filter((c) => c.name || c.email || c.phone);

  return (
    <div className="p-6 md:p-10 max-w-5xl">
      <Link href={`/captain/${team.id}`} className="text-white/40 text-sm hover:text-white">
        ← {team.name}
      </Link>
      <h1 className="text-3xl font-display text-white mt-2">
        {/* Vercel runs UTC. Without an explicit zone a 9:30am match renders
            as 4:30 PM — which is exactly what this page did. */}
        {new Intl.DateTimeFormat('en-US', {
          weekday: 'long',
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          timeZone,
        }).format(new Date(match.match_at as string))}
      </h1>
      <p className="text-white/50 mt-1">
        {(match.opponent as string) || 'TBD'} · {match.is_home ? 'Home' : 'Away'}
        {match.location ? ` · ${match.location}` : ''}
      </p>

      {/* Who to call on match day — ours and theirs — in reach without
          opening the email panel. */}
      <div className="mt-3 flex flex-wrap gap-2">
        <MatchCoachPicker
          teamId={team.id}
          matchId={params.matchId}
          options={coachOptions}
          initialId={(match.match_coach_id as string | null) ?? null}
        />
          {oppContacts.map((c) => {
            const e164 = normalizePhone(c.phone);
            return (
              <div
                key={c.role}
                className="rounded-xl border border-white/[0.08] bg-[#002838] px-4 py-2.5 text-sm"
              >
                <div className="text-white/40 text-[11px] uppercase tracking-wide">{c.role}</div>
                <div className="text-white font-medium">{c.name || '—'}</div>
                <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-1">
                  {c.email && (
                    <a href={`mailto:${c.email}`} className="text-[#D3FB52]/90 hover:text-[#D3FB52] break-all">
                      {c.email}
                    </a>
                  )}
                  {c.phone &&
                    (e164 ? (
                      <>
                        <a href={`tel:${e164}`} className="text-[#D3FB52]/90 hover:text-[#D3FB52]">
                          {formatPhone(e164)}
                        </a>
                        <a href={`sms:${e164}`} className="text-white/60 hover:text-white underline">
                          text
                        </a>
                      </>
                    ) : (
                      <span className="text-white/70">{c.phone}</span>
                    ))}
                </div>
              </div>
            );
          })}
      </div>


      <MatchWorkspace
        teamId={team.id}
        matchId={params.matchId}
        players={roster}
        initialLineup={
          ((lineups as Record<string, unknown>[]) || []).map((l) => ({
            id: l.id as string,
            courtNumber: l.court_number as number,
            courtType: l.court_type as 'singles' | 'doubles',
            player1Id: (l.player1_id as string) ?? null,
            player2Id: (l.player2_id as string) ?? null,
            player1ConfirmedAt: (l.player1_confirmed_at as string) ?? null,
            player2ConfirmedAt: (l.player2_confirmed_at as string) ?? null,
            player1ConfirmedSource: (l.player1_confirmed_source as string) ?? null,
            player2ConfirmedSource: (l.player2_confirmed_source as string) ?? null,
          })) as never
        }
        singlesCourts={match.singles_courts as number}
        doublesCourts={match.doubles_courts as number}
        lineupSent={!!match.lineup_email_sent_at}
        matchAt={match.match_at as string}
        status={match.status as string}
        initialResults={((results as Record<string, unknown>[]) || []).map((r) => ({
          courtNumber: r.court_number as number,
          score: (r.score as string) ?? null,
          won: (r.won as boolean) ?? null,
          defaulted: (r.defaulted as boolean) ?? false,
          default_by: (r.default_by as 'us' | 'them' | null) ?? null,
          opponentNames: (r.opponent_names as string[] | null) ?? null,
        }))}
        recapSentAt={(match.recap_sent_at as string) ?? null}
        topdogMatchId={(match.source_match_id as string) || null}
        withdrawals={withdrawals}
        teamName={team.name}
        opponent={(match.opponent as string) || null}
        isHome={!!match.is_home}
        coachName={coachOptions.find((c) => c.id === match.match_coach_id)?.name ?? null}
        location={(match.location as string) || null}
        arrivalNote={(match.arrival_note as string) || null}
        jttCourtFormat={jttCourtFormat}
        captainingStyle={(teamRec.captaining_style as string) ?? null}
        timeZone={timeZone}
      />

      {/*
        The other club, in one place, BELOW the team's own work.
        Both panels read and write the same opposing-captain fields, and on an
        away match the first tappable thing on the page used to be an email to
        another club — a once-per-match errand sitting above the lineup.
      */}
      <details className="mt-8 rounded-2xl border border-white/[0.08] bg-[#002838] p-4">
        <summary className="cursor-pointer list-none">
          <span className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-white font-medium">
              {match.is_home ? 'Hosting ' : ''}
              {(match.opponent as string) || 'the other club'}
            </span>
            <span className="text-xs text-white/40">
              {[
                match.opposing_captain_name ? (match.opposing_captain_name as string) : null,
                match.host_email_sent_at ? 'emailed' : 'not emailed yet',
                !match.is_home && match.arrival_note ? 'details received' : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </span>
        </summary>

        <div className="mt-4 space-y-4">
          <HostEmailPanel
            matchId={params.matchId}
            isHome={!!match.is_home}
            opponent={(match.opponent as string) || null}
            sentAt={(match.host_email_sent_at as string) || null}
            timeZone={timeZone}
          />

          {/* Away: the host club's own details (warm-up, check-in, parking),
              pasted or forwarded, applied to the fields players' emails print. */}
          {!match.is_home && (
            <HostNotePanel
              teamId={team.id}
              matchId={params.matchId}
              opponent={(match.opponent as string) || null}
              lineupSent={!!match.lineup_email_sent_at}
              detailsOnMatch={!!(match.arrival_note as string | null)}
              hostUpdateSentAt={(match.host_update_sent_at as string) || null}
              timeZone={timeZone}
            />
          )}
        </div>
      </details>
    </div>
  );
}
