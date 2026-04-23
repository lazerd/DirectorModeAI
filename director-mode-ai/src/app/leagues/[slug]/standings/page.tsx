import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Trophy, Calendar } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import {
  computeDivisionStandings,
  computePlayerRecords,
  type ClubStanding,
} from '@/lib/jtt';

export const dynamic = 'force-dynamic';

type League = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  start_date: string;
  end_date: string;
  status: string;
  format: 'individual' | 'team';
};

export default async function PublicStandingsPage({
  params,
}: {
  params: { slug: string };
}) {
  const supabase = await createClient();

  const { data: league } = await supabase
    .from('leagues')
    .select('id, name, slug, description, start_date, end_date, status, format')
    .eq('slug', params.slug)
    .single();

  if (!league) notFound();
  const leagueRow = league as League;

  if (leagueRow.format !== 'team') {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <p className="text-gray-600">
          This is an individual-format league.{' '}
          <Link href={`/leagues/${leagueRow.slug}`} className="text-orange-600 underline">
            Open the bracket view →
          </Link>
        </p>
      </div>
    );
  }

  const [clubsRes, divisionsRes, dcRes, matchupsRes, rostersRes] = await Promise.all([
    supabase.from('league_clubs').select('*').eq('league_id', leagueRow.id).order('sort_order'),
    supabase.from('league_divisions').select('*').eq('league_id', leagueRow.id).order('sort_order'),
    supabase.from('league_division_clubs').select('*'),
    supabase.from('league_team_matchups').select('*').order('match_date'),
    supabase.from('league_team_rosters').select('*'),
  ]);

  const clubs = (clubsRes.data as any[]) || [];
  const divisions = (divisionsRes.data as any[]) || [];
  const dcAll = (dcRes.data as any[]) || [];
  const matchupsAll = (matchupsRes.data as any[]) || [];
  const rostersAll = (rostersRes.data as any[]) || [];

  const divisionIds = new Set(divisions.map(d => d.id));
  const divisionClubs = dcAll.filter(dc => divisionIds.has(dc.division_id));
  const matchups = matchupsAll.filter(m => divisionIds.has(m.division_id));
  const rosters = rostersAll.filter(r => divisionIds.has(r.division_id));

  const { data: linesRes } = matchups.length
    ? await supabase
        .from('league_matchup_lines')
        .select('*')
        .in(
          'matchup_id',
          matchups.map(m => m.id)
        )
    : { data: [] as any[] };
  const lines = (linesRes as any[]) || [];

  const clubsById = new Map<string, any>();
  for (const c of clubs) clubsById.set(c.id, c);

  const perDivision = divisions.map(division => {
    const divisionClubList = divisionClubs
      .filter(dc => dc.division_id === division.id)
      .map(dc => clubsById.get(dc.club_id))
      .filter((c: any) => !!c);

    const divisionMatchups = matchups.filter(m => m.division_id === division.id);
    const standings = computeDivisionStandings(divisionClubList, divisionMatchups);

    const divisionLines = lines.filter(l => divisionMatchups.some(m => m.id === l.matchup_id));
    const divisionRosters = rosters.filter(r => r.division_id === division.id);
    const playerRecords = computePlayerRecords(divisionRosters, clubsById, divisionLines);

    return { division, standings, playerRecords };
  });

  const overall: ClubStanding[] = (() => {
    const map = new Map<string, ClubStanding>();
    for (const { standings } of perDivision) {
      for (const s of standings) {
        const existing = map.get(s.club_id);
        if (existing) {
          existing.matchups_played += s.matchups_played;
          existing.matchups_won += s.matchups_won;
          existing.matchups_lost += s.matchups_lost;
          existing.matchups_tied += s.matchups_tied;
          existing.lines_won += s.lines_won;
          existing.lines_lost += s.lines_lost;
          existing.points += s.points;
        } else {
          map.set(s.club_id, { ...s });
        }
      }
    }
    return Array.from(map.values()).sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      return b.lines_won - b.lines_lost - (a.lines_won - a.lines_lost);
    });
  })();

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto">
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
      </div>

      <section
        className="rounded-xl border overflow-hidden mb-6"
        style={{ backgroundColor: '#ffffff', borderColor: '#e5e7eb' }}
      >
        <header
          className="px-4 py-3 border-b flex items-center gap-2"
          style={{ backgroundColor: '#fff7ed', borderColor: '#fed7aa' }}
        >
          <Trophy size={16} style={{ color: '#ea580c' }} />
          <h2 className="font-semibold" style={{ color: '#000000' }}>
            League Standings
          </h2>
        </header>
        <StandingsTable standings={overall} showLineDiff />
      </section>

      {perDivision.map(({ division, standings, playerRecords }) => (
        <section
          key={division.id}
          className="rounded-xl border overflow-hidden mb-6"
          style={{ backgroundColor: '#ffffff', borderColor: '#e5e7eb' }}
        >
          <header
            className="px-4 py-3 border-b"
            style={{ backgroundColor: '#f9fafb', borderColor: '#e5e7eb' }}
          >
            <h2 className="font-semibold" style={{ color: '#000000' }}>
              {division.name}
            </h2>
          </header>
          <StandingsTable standings={standings} />

          {playerRecords.length > 0 && (
            <div className="border-t p-4" style={{ borderColor: '#e5e7eb' }}>
              <h3 className="text-sm font-medium mb-2" style={{ color: '#000000' }}>
                Individual Ladder
              </h3>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase border-b" style={{ borderColor: '#e5e7eb' }}>
                    <th className="py-2 pr-3" style={{ color: '#6b7280' }}>#</th>
                    <th className="py-2 pr-3" style={{ color: '#6b7280' }}>Player</th>
                    <th className="py-2 pr-3" style={{ color: '#6b7280' }}>Club</th>
                    <th className="py-2 pr-3 text-center" style={{ color: '#6b7280' }}>Singles</th>
                    <th className="py-2 pr-3 text-center" style={{ color: '#6b7280' }}>Doubles</th>
                    <th className="py-2 pr-3 text-center" style={{ color: '#6b7280' }}>Total</th>
                    <th className="py-2 pr-3 text-right" style={{ color: '#6b7280' }}>Win %</th>
                  </tr>
                </thead>
                <tbody>
                  {playerRecords.map((p, i) => (
                    <tr key={p.roster_id} className="border-b last:border-0" style={{ borderColor: '#f3f4f6' }}>
                      <td className="py-1.5 pr-3" style={{ color: '#9ca3af' }}>{i + 1}</td>
                      <td className="py-1.5 pr-3" style={{ color: '#000000' }}>{p.player_name}</td>
                      <td className="py-1.5 pr-3" style={{ color: '#374151' }}>{p.club_short}</td>
                      <td className="py-1.5 pr-3 text-center" style={{ color: '#000000' }}>
                        {p.singles_wins}–{p.singles_losses}
                      </td>
                      <td className="py-1.5 pr-3 text-center" style={{ color: '#000000' }}>
                        {p.doubles_wins}–{p.doubles_losses}
                      </td>
                      <td className="py-1.5 pr-3 text-center font-medium" style={{ color: '#000000' }}>
                        {p.total_wins}–{p.total_losses}
                      </td>
                      <td className="py-1.5 pr-3 text-right" style={{ color: '#000000' }}>
                        {p.total_wins + p.total_losses === 0
                          ? '—'
                          : `${Math.round(p.winPct * 100)}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

function StandingsTable({
  standings,
  showLineDiff,
}: {
  standings: ClubStanding[];
  showLineDiff?: boolean;
}) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs uppercase border-b" style={{ borderColor: '#e5e7eb' }}>
          <th className="py-2 pl-4 pr-3" style={{ color: '#6b7280' }}>#</th>
          <th className="py-2 pr-3" style={{ color: '#6b7280' }}>Club</th>
          <th className="py-2 pr-3 text-center" style={{ color: '#6b7280' }}>GP</th>
          <th className="py-2 pr-3 text-center" style={{ color: '#6b7280' }}>W</th>
          <th className="py-2 pr-3 text-center" style={{ color: '#6b7280' }}>L</th>
          <th className="py-2 pr-3 text-center" style={{ color: '#6b7280' }}>T</th>
          <th className="py-2 pr-3 text-center" style={{ color: '#6b7280' }}>Lines</th>
          {showLineDiff && <th className="py-2 pr-3 text-center" style={{ color: '#6b7280' }}>Diff</th>}
          <th className="py-2 pr-4 text-right" style={{ color: '#6b7280' }}>Pts</th>
        </tr>
      </thead>
      <tbody>
        {standings.map((s, i) => (
          <tr
            key={s.club_id}
            className="border-b last:border-0"
            style={{
              borderColor: '#f3f4f6',
              backgroundColor: i === 0 ? '#fefce8' : '#ffffff',
            }}
          >
            <td className="py-2 pl-4 pr-3" style={{ color: '#9ca3af' }}>{i + 1}</td>
            <td className="py-2 pr-3 font-medium" style={{ color: '#000000' }}>{s.club_name}</td>
            <td className="py-2 pr-3 text-center" style={{ color: '#000000' }}>{s.matchups_played}</td>
            <td className="py-2 pr-3 text-center" style={{ color: '#000000' }}>{s.matchups_won}</td>
            <td className="py-2 pr-3 text-center" style={{ color: '#000000' }}>{s.matchups_lost}</td>
            <td className="py-2 pr-3 text-center" style={{ color: '#000000' }}>{s.matchups_tied}</td>
            <td className="py-2 pr-3 text-center" style={{ color: '#000000' }}>
              {s.lines_won}–{s.lines_lost}
            </td>
            {showLineDiff && (
              <td className="py-2 pr-3 text-center" style={{ color: '#000000' }}>
                {s.lines_won - s.lines_lost > 0 ? '+' : ''}
                {s.lines_won - s.lines_lost}
              </td>
            )}
            <td className="py-2 pr-4 text-right font-semibold" style={{ color: '#000000' }}>
              {s.points}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
