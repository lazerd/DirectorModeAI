'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Calendar, ChevronRight, ChevronDown } from 'lucide-react';
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

// Mashup matchups tag their participating clubs in notes as MASHUP[SH|MCC|MDW].
function parseMashupShorts(notes: string | null | undefined): string[] | null {
  const m = notes?.match(/MASHUP\[([^\]]+)\]/i);
  if (!m) return null;
  const shorts = m[1].split('|').map(s => s.trim()).filter(Boolean);
  return shorts.length ? shorts : null;
}

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

  // Local "today" as YYYY-MM-DD so we can land on the right match on refresh
  // instead of dumping the user at the first match of the season.
  const todayStr = useMemo(() => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
  }, []);

  // The date to focus: today's match if there is one, else the next upcoming
  // date, else (whole season is in the past) the most recent date.
  const focusDate = useMemo(() => {
    if (!groups.length) return null;
    const upcoming = groups.find(g => g.date >= todayStr);
    return (upcoming ?? groups[groups.length - 1]).date;
  }, [groups, todayStr]);

  // Accordion: every date collapses; only the focus date opens by default.
  const [openDates, setOpenDates] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (focusDate) setOpenDates(new Set([focusDate]));
  }, [focusDate]);

  const toggleDate = (date: string) =>
    setOpenDates(prev => {
      const next = new Set(prev);
      next.has(date) ? next.delete(date) : next.add(date);
      return next;
    });

  // Scroll the focus date into view on load so a refresh lands on it.
  const focusRef = useRef<HTMLElement | null>(null);
  const didScroll = useRef(false);
  useEffect(() => {
    if (focusDate && focusRef.current && !didScroll.current) {
      didScroll.current = true;
      focusRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [focusDate]);

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
        const isOpen = openDates.has(g.date);
        const isFocus = g.date === focusDate;
        const allM = Array.from(g.byDivision.values()).flat();
        const doneCount = allM.filter(m => m.status === 'completed').length;
        const pill =
          g.date === todayStr ? { text: 'Today', cls: 'bg-orange-100 text-orange-700' }
          : isFocus ? { text: 'Up next', cls: 'bg-blue-100 text-blue-700' }
          : null;
        return (
          <section
            key={g.date}
            ref={isFocus ? focusRef : undefined}
            className={`bg-white rounded-xl border overflow-hidden scroll-mt-4 ${isFocus ? 'border-orange-300 ring-1 ring-orange-200' : 'border-gray-200'}`}
          >
            <button
              type="button"
              onClick={() => toggleDate(g.date)}
              aria-expanded={isOpen}
              className="w-full px-4 py-3 border-b border-gray-200 bg-gray-50 hover:bg-gray-100 flex items-center gap-2 text-left transition-colors"
            >
              <Calendar size={16} className="text-gray-400 shrink-0" />
              <h3 className="font-semibold text-gray-900">{label}</h3>
              <span className="hidden sm:inline text-xs text-gray-500">({g.date})</span>
              {pill && (
                <span className={`text-[11px] font-semibold rounded-full px-2 py-0.5 ${pill.cls}`}>{pill.text}</span>
              )}
              <span className="ml-auto flex items-center gap-3">
                <span className="text-xs text-gray-500">
                  {allM.length} {allM.length === 1 ? 'match' : 'matches'}
                  {doneCount > 0 && <span className="text-green-600"> · {doneCount} done</span>}
                </span>
                <ChevronDown
                  size={18}
                  className={`text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                />
              </span>
            </button>

            <div className={`divide-y divide-gray-100 ${isOpen ? '' : 'hidden'}`}>
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
                        const mashupShorts = parseMashupShorts(m.notes);
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
                                <div className="font-medium text-gray-900 flex items-center gap-2 flex-wrap">
                                  {mashupShorts ? (
                                    <>
                                      <span>{mashupShorts.join(' · ')} Mashup</span>
                                      <span className="text-[11px] font-medium text-purple-700 bg-purple-50 border border-purple-200 rounded-full px-2 py-0.5">
                                        Mish-mash · {home?.name ?? 'host'}
                                      </span>
                                    </>
                                  ) : (
                                    <span>
                                      {away?.name ?? '???'}{' '}
                                      <span className="text-gray-400">@</span>{' '}
                                      {home?.name ?? '???'}
                                    </span>
                                  )}
                                </div>
                                <div className="text-xs text-gray-500">
                                  {completedLines}/{matchLines.length} lines scored
                                </div>
                              </div>
                              {m.status === 'completed' && !mashupShorts && (
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
