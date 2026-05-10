'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { ExternalLink, Trophy } from 'lucide-react';
import type {
  JTTClub,
  JTTDivision,
  JTTDivisionClub,
  JTTMatchup,
  JTTLine,
  JTTRoster,
} from '@/app/mixer/leagues/[id]/jtt/page';
import {
  computeDivisionStandings,
  computePlayerRecords,
  type ClubStanding,
} from '@/lib/jtt';

type Props = {
  leagueSlug: string;
  clubs: JTTClub[];
  divisions: JTTDivision[];
  divisionClubs: JTTDivisionClub[];
  matchups: JTTMatchup[];
  lines: JTTLine[];
  rosters: JTTRoster[];
};

export default function StandingsTab({
  leagueSlug,
  clubs,
  divisions,
  divisionClubs,
  matchups,
  lines,
  rosters,
}: Props) {
  const clubsById = useMemo(() => {
    const m = new Map<string, JTTClub>();
    for (const c of clubs) m.set(c.id, c);
    return m;
  }, [clubs]);

  const perDivision = useMemo(() => {
    return divisions.map(division => {
      const divisionClubList = divisionClubs
        .filter(dc => dc.division_id === division.id)
        .map(dc => clubsById.get(dc.club_id))
        .filter((c): c is JTTClub => !!c);

      const divisionMatchups = matchups.filter(m => m.division_id === division.id);
      const standings = computeDivisionStandings(divisionClubList, divisionMatchups);

      const divisionLines = lines.filter(line =>
        divisionMatchups.some(m => m.id === line.matchup_id)
      );
      const divisionRosters = rosters.filter(r => r.division_id === division.id);
      const playerRecords = computePlayerRecords(divisionRosters, clubsById, divisionLines);

      return { division, standings, playerRecords };
    });
  }, [divisions, divisionClubs, clubsById, matchups, lines, rosters]);

  // Overall: sum points across all divisions for each club
  const overall = useMemo<ClubStanding[]>(() => {
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
      const aDiff = a.lines_won - a.lines_lost;
      const bDiff = b.lines_won - b.lines_lost;
      return bDiff - aDiff;
    });
  }, [perDivision]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end">
        <Link
          href={`/leagues/${leagueSlug}/standings`}
          target="_blank"
          className="inline-flex items-center gap-1.5 text-sm text-orange-600 hover:text-orange-700"
        >
          Public view
          <ExternalLink size={14} />
        </Link>
      </div>

      <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <header className="px-4 py-3 border-b border-gray-200 bg-orange-50 flex items-center gap-2">
          <Trophy size={16} className="text-orange-600" />
          <h3 className="font-semibold text-gray-900">League Standings (all divisions)</h3>
        </header>
        <StandingsTable standings={overall} showLineDiff />
      </section>

      {perDivision.map(({ division, standings, playerRecords }) => (
        <section
          key={division.id}
          className="bg-white rounded-xl border border-gray-200 overflow-hidden"
        >
          <header className="px-4 py-3 border-b border-gray-200 bg-gray-50">
            <h3 className="font-semibold text-gray-900">{division.name}</h3>
          </header>
          <StandingsTable standings={standings} />

          {playerRecords.length > 0 && (
            <div className="border-t border-gray-200 p-4">
              <h4 className="text-sm font-medium text-gray-700 mb-2">Individual Ladder</h4>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase text-gray-500 border-b border-gray-200">
                      <th className="py-2 pr-3">#</th>
                      <th className="py-2 pr-3">Player</th>
                      <th className="py-2 pr-3">Club</th>
                      <th className="py-2 pr-3 text-center">Singles</th>
                      <th className="py-2 pr-3 text-center">Doubles</th>
                      <th className="py-2 pr-3 text-center">Total</th>
                      <th className="py-2 pr-3 text-right">Win %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {playerRecords.map((p, i) => (
                      <tr key={p.roster_id} className="border-b border-gray-100 last:border-0">
                        <td className="py-1.5 pr-3 text-gray-400">{i + 1}</td>
                        <td className="py-1.5 pr-3 text-gray-900">{p.player_name}</td>
                        <td className="py-1.5 pr-3 text-gray-600">{p.club_short}</td>
                        <td className="py-1.5 pr-3 text-center text-gray-700">
                          {p.singles_wins}–{p.singles_losses}
                        </td>
                        <td className="py-1.5 pr-3 text-center text-gray-700">
                          {p.doubles_wins}–{p.doubles_losses}
                        </td>
                        <td className="py-1.5 pr-3 text-center font-medium text-gray-900">
                          {p.total_wins}–{p.total_losses}
                        </td>
                        <td className="py-1.5 pr-3 text-right text-gray-700">
                          {p.total_wins + p.total_losses === 0
                            ? '—'
                            : `${Math.round(p.winPct * 100)}%`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase text-gray-500 border-b border-gray-200">
            <th className="py-2 pl-4 pr-3">#</th>
            <th className="py-2 pr-3">Club</th>
            <th className="py-2 pr-3 text-center">GP</th>
            <th className="py-2 pr-3 text-center">W</th>
            <th className="py-2 pr-3 text-center">L</th>
            <th className="py-2 pr-3 text-center">T</th>
            <th className="py-2 pr-3 text-center">Lines</th>
            {showLineDiff && <th className="py-2 pr-3 text-center">Diff</th>}
            <th className="py-2 pr-4 text-right">Pts</th>
          </tr>
        </thead>
        <tbody>
          {standings.map((s, i) => (
            <tr
              key={s.club_id}
              className={`border-b border-gray-100 last:border-0 ${i === 0 ? 'bg-yellow-50' : ''}`}
            >
              <td className="py-2 pl-4 pr-3 text-gray-400">{i + 1}</td>
              <td className="py-2 pr-3 font-medium text-gray-900">{s.club_name}</td>
              <td className="py-2 pr-3 text-center text-gray-700">{s.matchups_played}</td>
              <td className="py-2 pr-3 text-center text-gray-700">{s.matchups_won}</td>
              <td className="py-2 pr-3 text-center text-gray-700">{s.matchups_lost}</td>
              <td className="py-2 pr-3 text-center text-gray-700">{s.matchups_tied}</td>
              <td className="py-2 pr-3 text-center text-gray-700">
                {s.lines_won}–{s.lines_lost}
              </td>
              {showLineDiff && (
                <td className="py-2 pr-3 text-center text-gray-700">
                  {s.lines_won - s.lines_lost > 0 ? '+' : ''}
                  {s.lines_won - s.lines_lost}
                </td>
              )}
              <td className="py-2 pr-4 text-right font-semibold text-gray-900">{s.points}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
