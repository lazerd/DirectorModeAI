import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Users, Calendar } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { DAY_OF_WEEK_LABELS } from '@/lib/jtt';

export const dynamic = 'force-dynamic';

type League = {
  id: string;
  name: string;
  slug: string;
  start_date: string;
  end_date: string;
  status: string;
  format: 'individual' | 'team';
};

export default async function PublicRostersPage({
  params,
}: {
  params: { slug: string };
}) {
  const supabase = await createClient();

  const { data: league } = await supabase
    .from('leagues')
    .select('id, name, slug, start_date, end_date, status, format')
    .eq('slug', params.slug)
    .single();
  if (!league) notFound();
  const leagueRow = league as League;

  if (leagueRow.format !== 'team') {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <p className="text-gray-600">
          This league doesn&apos;t have team rosters.{' '}
          <Link href={`/leagues/${leagueRow.slug}`} className="text-orange-600 underline">
            Open the league →
          </Link>
        </p>
      </div>
    );
  }

  const [clubsRes, divisionsRes, dcRes, rostersRes, matchupsRes] = await Promise.all([
    supabase.from('league_clubs').select('*').eq('league_id', leagueRow.id).order('sort_order'),
    supabase.from('league_divisions').select('*').eq('league_id', leagueRow.id).order('sort_order'),
    supabase.from('league_division_clubs').select('*'),
    supabase.from('league_team_rosters').select('*'),
    supabase.from('league_team_matchups').select('id, division_id'),
  ]);

  const clubs = (clubsRes.data as any[]) || [];
  const divisions = (divisionsRes.data as any[]) || [];
  const dcAll = (dcRes.data as any[]) || [];
  const rostersAll = (rostersRes.data as any[]) || [];
  const matchupsAll = (matchupsRes.data as any[]) || [];

  const divisionIds = new Set(divisions.map(d => d.id));
  const divisionClubs = dcAll.filter(dc => divisionIds.has(dc.division_id));
  const rosters = rostersAll.filter(r => divisionIds.has(r.division_id));
  const matchups = matchupsAll.filter(m => divisionIds.has(m.division_id));

  const { data: linesRes } = matchups.length
    ? await supabase
        .from('league_matchup_lines')
        .select(
          'matchup_id, line_type, home_player1_id, home_player2_id, away_player1_id, away_player2_id, winner, status'
        )
        .in(
          'matchup_id',
          matchups.map(m => m.id)
        )
    : { data: [] as any[] };
  const lines = (linesRes as any[]) || [];

  // Roster-level records from completed lines
  const recordsByRoster = new Map<string, { wins: number; losses: number }>();
  for (const line of lines) {
    if (line.status !== 'completed' || !line.winner) continue;
    const home = [line.home_player1_id, line.home_player2_id].filter(Boolean);
    const away = [line.away_player1_id, line.away_player2_id].filter(Boolean);
    const winners = line.winner === 'home' ? home : away;
    const losers = line.winner === 'home' ? away : home;
    for (const id of winners) {
      const rec = recordsByRoster.get(id) || { wins: 0, losses: 0 };
      rec.wins += 1;
      recordsByRoster.set(id, rec);
    }
    for (const id of losers) {
      const rec = recordsByRoster.get(id) || { wins: 0, losses: 0 };
      rec.losses += 1;
      recordsByRoster.set(id, rec);
    }
  }

  const clubsById = new Map<string, any>();
  for (const c of clubs) clubsById.set(c.id, c);

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Link href={`/leagues/${leagueRow.slug}`} className="p-2 hover:bg-gray-100 rounded-lg">
          <ArrowLeft size={20} />
        </Link>
        <div>
          <h1 className="font-semibold text-2xl text-gray-900">{leagueRow.name}</h1>
          <p className="text-gray-500 text-sm flex items-center gap-1">
            <Calendar size={14} />
            {leagueRow.start_date} → {leagueRow.end_date}
          </p>
        </div>
        <div className="ml-auto flex gap-2">
          <Link
            href={`/leagues/${leagueRow.slug}/standings`}
            className="text-sm text-orange-600 hover:text-orange-700 underline"
          >
            Standings →
          </Link>
        </div>
      </div>

      <h2 className="font-semibold text-lg mb-4 flex items-center gap-2">
        <Users size={18} className="text-orange-500" />
        Team Rosters
      </h2>

      <div className="space-y-6">
        {divisions.map(division => {
          const divisionClubList = divisionClubs
            .filter(dc => dc.division_id === division.id)
            .map(dc => clubsById.get(dc.club_id))
            .filter(Boolean);

          return (
            <section
              key={division.id}
              className="bg-white rounded-xl border border-gray-200 overflow-hidden"
            >
              <header className="px-4 py-3 border-b border-gray-200 bg-gray-50">
                <h3 className="font-semibold text-gray-900">{division.name}</h3>
                <p className="text-xs text-gray-500">
                  {division.day_of_week !== null
                    ? `${DAY_OF_WEEK_LABELS[division.day_of_week]}s`
                    : ''}
                  {division.start_time
                    ? ` · ${division.start_time.slice(0, 5)}–${division.end_time?.slice(0, 5)}`
                    : ''}
                </p>
              </header>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-px bg-gray-100">
                {divisionClubList.map((club: any) => {
                  const teamRosters = rosters
                    .filter(r => r.division_id === division.id && r.club_id === club.id)
                    .sort(
                      (a, b) =>
                        (a.ladder_position ?? 9999) - (b.ladder_position ?? 9999) ||
                        a.player_name.localeCompare(b.player_name)
                    );
                  return (
                    <div key={club.id} className="bg-white p-4">
                      <h4 className="font-medium text-gray-900 mb-2">{club.name}</h4>
                      {teamRosters.length === 0 ? (
                        <p className="text-xs text-gray-400 italic">Roster TBD</p>
                      ) : (
                        <ol className="text-sm divide-y divide-gray-100 border border-gray-100 rounded-md">
                          {teamRosters.map((r, i) => {
                            const rec = recordsByRoster.get(r.id);
                            return (
                              <li
                                key={r.id}
                                className="flex items-center gap-2 px-3 py-1.5"
                              >
                                <span className="w-6 text-right text-gray-400">
                                  {i + 1}.
                                </span>
                                <span className="flex-1 text-gray-900 truncate">
                                  {r.player_name}
                                </span>
                                {rec && rec.wins + rec.losses > 0 && (
                                  <span className="text-xs font-medium text-gray-700">
                                    {rec.wins}–{rec.losses}
                                  </span>
                                )}
                              </li>
                            );
                          })}
                        </ol>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
