import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { CalendarClock } from 'lucide-react';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { gateTeam } from '@/lib/captain/access';
import { playedCounts, pairRecords, rulesFor } from '@/lib/captain/server';
import { eligibilityReport, type RatingType } from '@/lib/captain/lineup';
import RosterPanel from '@/components/captain/RosterPanel';
import AddMatchForm from '@/components/captain/AddMatchForm';
import PartnershipsPanel from '@/components/captain/PartnershipsPanel';
import ImportPanel from '@/components/captain/ImportPanel';
import PreseasonPanel from '@/components/captain/PreseasonPanel';
import SeasonAvailabilityPanel from '@/components/captain/SeasonAvailabilityPanel';

export const dynamic = 'force-dynamic';

export default async function TeamHub({ params }: { params: { teamId: string } }) {
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
  };

  const [{ data: players }, { data: matches }, { data: prefs }, { data: never }] =
    await Promise.all([
      db
        .from('captain_players')
        .select(
          'id, name, email, rating, rating_type, gender, return_side, court_limit, court_note, is_sub, notes, intake_completed_at',
        )
        .eq('team_id', team.id)
        .eq('active', true)
        .order('is_sub')
        .order('name'),
      db.from('captain_matches').select('*').eq('team_id', team.id).order('match_at'),
      db
        .from('captain_partner_prefs')
        .select('player_id, preferred_player_id, rank')
        .eq('team_id', team.id),
      db.from('captain_never_pair').select('id, player_a_id, player_b_id').eq('team_id', team.id),
    ]);

  const roster = (players as Record<string, unknown>[]) || [];
  const allMatches = (matches as Record<string, unknown>[]) || [];
  const upcoming = allMatches.filter(
    (m) => m.status === 'scheduled' && new Date(m.match_at as string) >= new Date(),
  );

  const counts = await playedCounts(db, team.id);
  const partnerships = await pairRecords(db, team.id);
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
  const upcomingIds = new Set(upcoming.map((m) => m.id as string));
  if (allMatches.length) {
    const { data: avail } = await db
      .from('captain_availability')
      .select('match_id, status, player_id')
      .in(
        'match_id',
        allMatches.map((m) => m.id as string),
      );
    for (const a of (avail as { match_id: string; status: string; player_id: string }[]) || []) {
      if (a.status === 'yes') availByMatch[a.match_id] = (availByMatch[a.match_id] ?? 0) + 1;
      if (upcomingIds.has(a.match_id)) {
        answeredByPlayer[a.player_id] = (answeredByPlayer[a.player_id] ?? 0) + 1;
      }
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

      <Link
        href={`/captain/${team.id}/timeline`}
        className="mt-4 inline-flex items-center gap-2 rounded-xl border border-white/[0.08] bg-[#002838] px-4 py-2.5 text-sm text-white/80 hover:border-[#D3FB52]/40 hover:text-white transition-colors"
      >
        <CalendarClock size={16} className="text-[#D3FB52]" />
        Season email timeline
      </Link>

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
                  {new Intl.DateTimeFormat('en-US', {
                    weekday: 'short',
                    month: 'short',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
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
        <AddMatchForm teamId={team.id} />
      </section>

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

      <PartnershipsPanel
        partnerships={partnerships.map((r) => ({
          ...r,
          playerAName: (roster.find((p) => p.id === r.playerAId)?.name as string) ?? '—',
          playerBName: (roster.find((p) => p.id === r.playerBId)?.name as string) ?? '—',
        }))}
      />

      <ImportPanel teamId={team.id} />

      <PreseasonPanel teamId={team.id} players={roster as never} />

      <RosterPanel
        teamId={team.id}
        players={roster as never}
        partnerPrefs={(prefs as never) || []}
        neverPairs={(never as never) || []}
        eligibility={eligibility}
        leagueType={team.league_type}
        eligibilityEnabled={team.eligibility_enabled}
      />
    </div>
  );
}
