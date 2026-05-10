'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { Calendar, ChevronRight } from 'lucide-react';
import type {
  JTTClub,
  JTTDivision,
  JTTMatchup,
  JTTLine,
} from '@/app/mixer/leagues/[id]/jtt/page';

type Props = {
  leagueId: string;
  clubs: JTTClub[];
  divisions: JTTDivision[];
  matchups: JTTMatchup[];
  lines: JTTLine[];
  onRefresh: () => void;
};

type DateGroup = {
  date: string;
  byDivision: Map<string, JTTMatchup[]>;
};

export default function MatchupsTab({
  leagueId,
  clubs,
  divisions,
  matchups,
  lines,
}: Props) {
  const clubsById = useMemo(() => {
    const m = new Map<string, JTTClub>();
    for (const c of clubs) m.set(c.id, c);
    return m;
  }, [clubs]);

  const divisionsById = useMemo(() => {
    const m = new Map<string, JTTDivision>();
    for (const d of divisions) m.set(d.id, d);
    return m;
  }, [divisions]);

  const linesByMatchup = useMemo(() => {
    const m = new Map<string, JTTLine[]>();
    for (const line of lines) {
      const arr = m.get(line.matchup_id) || [];
      arr.push(line);
      m.set(line.matchup_id, arr);
    }
    return m;
  }, [lines]);

  const groups = useMemo<DateGroup[]>(() => {
    const byDate = new Map<string, DateGroup>();
    for (const m of matchups) {
      let g = byDate.get(m.match_date);
      if (!g) {
        g = { date: m.match_date, byDivision: new Map() };
        byDate.set(m.match_date, g);
      }
      const arr = g.byDivision.get(m.division_id) || [];
      arr.push(m);
      g.byDivision.set(m.division_id, arr);
    }
    return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [matchups]);

  if (matchups.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6 text-gray-500 text-sm">
        No matchups scheduled yet. Seed the Lamorinda schedule from the
        <code className="mx-1 px-1 bg-gray-100 rounded text-xs">/api/leagues/seed-lamorinda-jtt</code>
        endpoint, or build a scheduler here.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {groups.map(g => {
        const d = new Date(g.date + 'T00:00:00');
        const label = d.toLocaleDateString('en-US', {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
        });
        return (
          <section key={g.date} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <header className="px-4 py-3 border-b border-gray-200 bg-gray-50 flex items-center gap-2">
              <Calendar size={16} className="text-gray-400" />
              <h3 className="font-semibold text-gray-900">{label}</h3>
              <span className="text-xs text-gray-500">({g.date})</span>
            </header>

            <div className="divide-y divide-gray-100">
              {Array.from(g.byDivision.entries())
                .map(([divId, list]) => ({ divId, division: divisionsById.get(divId), list }))
                .filter((x): x is { divId: string; division: JTTDivision; list: JTTMatchup[] } => !!x.division)
                .sort((a, b) => a.division.sort_order - b.division.sort_order)
                .map(({ divId, division, list }) => (
                  <div key={divId} className="p-4">
                    <h4 className="text-sm font-medium text-gray-800 mb-2">
                      {division.name}
                      {division.start_time && (
                        <span className="ml-2 text-xs text-gray-500">
                          {division.start_time.slice(0, 5)}–{division.end_time?.slice(0, 5)}
                        </span>
                      )}
                    </h4>

                    <ul className="space-y-2">
                      {list.map(m => {
                        const home = clubsById.get(m.home_club_id);
                        const away = clubsById.get(m.away_club_id);
                        const matchLines = linesByMatchup.get(m.id) || [];
                        const completedLines = matchLines.filter(l => l.status === 'completed').length;
                        const statusClass =
                          m.status === 'completed'
                            ? 'bg-green-100 text-green-700'
                            : m.status === 'in_progress'
                            ? 'bg-blue-100 text-blue-700'
                            : 'bg-gray-100 text-gray-600';

                        return (
                          <li key={m.id}>
                            <Link
                              href={`/mixer/leagues/${leagueId}/jtt/matchup/${m.id}`}
                              className="flex items-center gap-3 p-3 rounded-md border border-gray-200 hover:border-orange-300 hover:bg-orange-50/40 transition-colors"
                            >
                              <div className="flex-1 min-w-0">
                                <div className="font-medium text-gray-900">
                                  {away?.name ?? '???'}{' '}
                                  <span className="text-gray-400">@</span>{' '}
                                  {home?.name ?? '???'}
                                </div>
                                <div className="text-xs text-gray-500">
                                  {completedLines}/{matchLines.length} lines scored
                                </div>
                              </div>
                              {m.status === 'completed' && (
                                <div className="text-sm font-semibold text-gray-900">
                                  {m.away_lines_won}–{m.home_lines_won}
                                </div>
                              )}
                              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusClass}`}>
                                {m.status.replace('_', ' ')}
                              </span>
                              <ChevronRight size={16} className="text-gray-400" />
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
