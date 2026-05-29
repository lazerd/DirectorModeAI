'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  Loader2,
  AlertCircle,
  UserCheck,
  Zap,
  Trophy,
  ChevronLeft,
  ChevronRight,
  Check,
} from 'lucide-react';

type Club = { id: string; name: string; short_code: string; courts_available: number };
type Division = { id: string; name: string; short_code: string; start_time: string | null; end_time: string | null; line_format: string; sort_order: number };
type Matchup = { id: string; division_id: string; match_date: string; home_club_id: string; away_club_id: string; home_lines_won: number; away_lines_won: number; winner: string | null; status: string };
type Roster = { id: string; division_id: string; club_id: string; player_name: string; ladder_position: number | null; status: string };
type Line = { id: string; matchup_id: string; line_type: 'singles' | 'doubles'; line_number: number; home_player1_id: string | null; home_player2_id: string | null; away_player1_id: string | null; away_player2_id: string | null; score: string | null; winner: 'home' | 'away' | null; status: string };
type Checkin = { roster_id: string; matchup_id: string };

type FetchResult = {
  club: Club;
  targetDate: string;
  allDates: string[];
  matchups: Matchup[];
  divisions: Division[];
  clubs: Club[];
  rosters: Roster[];
  lines: Line[];
  checkins: Checkin[];
};

export default function MatchDayPage() {
  const params = useParams();
  const token = Array.isArray(params.token) ? params.token[0] : (params.token as string);

  const [data, setData] = useState<FetchResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dateOverride, setDateOverride] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const url = dateOverride
        ? `/api/leagues/roster/${token}/matchday?date=${dateOverride}`
        : `/api/leagues/roster/${token}/matchday`;
      const res = await fetch(url);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setData(await res.json());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [token, dateOverride]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const postAction = async (body: Record<string, any>) => {
    await fetch(`/api/leagues/roster/${token}/matchday`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    fetchData();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-orange-500" size={24} />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6 max-w-lg mx-auto">
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 flex items-start gap-2">
          <AlertCircle size={16} className="mt-0.5" />
          <div>
            <p className="font-medium">Couldn&apos;t load match day.</p>
            <p className="text-sm">{error || 'Unknown error'}</p>
          </div>
        </div>
      </div>
    );
  }

  const { club, targetDate, allDates, matchups, divisions, clubs, rosters, lines, checkins } = data;
  const checkedInIds = new Set(checkins.map(c => c.roster_id));

  const dateLabel = new Date(targetDate + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  const dateIdx = allDates.indexOf(targetDate);
  const prevDate = dateIdx > 0 ? allDates[dateIdx - 1] : null;
  const nextDate = dateIdx < allDates.length - 1 ? allDates[dateIdx + 1] : null;

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-1">
          <Link
            href={`/leagues/roster/${token}`}
            className="text-sm text-orange-600 hover:text-orange-700"
          >
            &larr; Back to roster
          </Link>
        </div>
        <h1 className="font-semibold text-2xl text-gray-900">{club.name} — Match Day</h1>
      </div>

      {/* Date Navigation */}
      <div className="flex items-center justify-between bg-white border border-gray-200 rounded-xl p-3 mb-6">
        <button
          onClick={() => prevDate && setDateOverride(prevDate)}
          disabled={!prevDate}
          className="p-1 text-gray-400 hover:text-orange-500 disabled:opacity-20"
        >
          <ChevronLeft size={20} />
        </button>
        <div className="text-center">
          <div className="font-semibold text-gray-900">{dateLabel}</div>
          <div className="text-xs text-gray-500">
            {matchups.length} matchup{matchups.length !== 1 ? 's' : ''} for {club.name}
          </div>
        </div>
        <button
          onClick={() => nextDate && setDateOverride(nextDate)}
          disabled={!nextDate}
          className="p-1 text-gray-400 hover:text-orange-500 disabled:opacity-20"
        >
          <ChevronRight size={20} />
        </button>
      </div>

      {/* One section per matchup (division) */}
      {matchups
        .sort((a, b) => {
          const divA = divisions.find(d => d.id === a.division_id);
          const divB = divisions.find(d => d.id === b.division_id);
          return (divA?.sort_order ?? 0) - (divB?.sort_order ?? 0);
        })
        .map(matchup => {
          const division = divisions.find(d => d.id === matchup.division_id);
          const homeClub = clubs.find(c => c.id === matchup.home_club_id);
          const awayClub = clubs.find(c => c.id === matchup.away_club_id);
          const opponent = matchup.home_club_id === club.id ? awayClub : homeClub;
          const isHome = matchup.home_club_id === club.id;
          const matchupLines = lines.filter(l => l.matchup_id === matchup.id);
          const matchupRosters = rosters.filter(r => r.division_id === matchup.division_id);
          const homeRosters = matchupRosters.filter(r => r.club_id === matchup.home_club_id && r.status === 'active');
          const awayRosters = matchupRosters.filter(r => r.club_id === matchup.away_club_id && r.status === 'active');
          const myRosters = isHome ? homeRosters : awayRosters;
          const matchupCheckins = checkins.filter(c => matchupLines.length === 0 || true).filter(c => myRosters.some(r => r.id === c.roster_id));

          if (!division || !homeClub || !awayClub) return null;

          return (
            <MatchupSection
              key={matchup.id}
              matchup={matchup}
              division={division}
              homeClub={homeClub}
              awayClub={awayClub}
              myClub={club}
              isHome={isHome}
              homeRosters={homeRosters}
              awayRosters={awayRosters}
              lines={matchupLines}
              checkedInIds={checkedInIds}
              postAction={postAction}
            />
          );
        })}

      <div className="text-center text-xs text-gray-400 mt-8">
        Powered by <a href="https://club.coachmode.ai" className="underline">CoachMode</a>
      </div>
    </div>
  );
}

function MatchupSection({
  matchup,
  division,
  homeClub,
  awayClub,
  myClub,
  isHome,
  homeRosters,
  awayRosters,
  lines,
  checkedInIds,
  postAction,
}: {
  matchup: Matchup;
  division: Division;
  homeClub: Club;
  awayClub: Club;
  myClub: Club;
  isHome: boolean;
  homeRosters: Roster[];
  awayRosters: Roster[];
  lines: Line[];
  checkedInIds: Set<string>;
  postAction: (body: Record<string, any>) => Promise<void>;
}) {
  const myRosters = isHome ? homeRosters : awayRosters;
  const myCheckedIn = myRosters.filter(r => checkedInIds.has(r.id));
  const allCompleted = lines.length > 0 && lines.every(l => l.status === 'completed');

  return (
    <div className="mb-8">
      {/* Division Header */}
      <div className="bg-gray-900 text-white rounded-t-xl px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-lg">{division.name}</h2>
            <p className="text-gray-400 text-sm">
              {awayClub.short_code} @ {homeClub.short_code}
              {division.start_time && ` · ${division.start_time.slice(0, 5)}`}
            </p>
          </div>
          <div className="text-center">
            <div className="text-3xl font-bold">
              {matchup.away_lines_won} – {matchup.home_lines_won}
            </div>
            <div className="text-xs text-gray-400">
              {awayClub.short_code} — {homeClub.short_code}
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white border border-t-0 border-gray-200 rounded-b-xl">
        {/* Check-in Section */}
        <div className="p-4 border-b border-gray-100">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-medium text-gray-900 flex items-center gap-2">
              <UserCheck size={16} className="text-orange-500" />
              Check in your players
            </h3>
            <span className="text-xs text-gray-500">
              {myCheckedIn.length}/{myRosters.length} checked in
            </span>
          </div>

          {myRosters.length === 0 ? (
            <p className="text-sm text-gray-400 italic">No players on your roster for this division yet.</p>
          ) : (
            <>
              <div className="border border-gray-200 rounded-md divide-y divide-gray-100 mb-2">
                {myRosters
                  .sort((a, b) => (a.ladder_position ?? 9999) - (b.ladder_position ?? 9999))
                  .map(r => {
                    const checked = checkedInIds.has(r.id);
                    return (
                      <label
                        key={r.id}
                        className={`flex items-center gap-2 px-3 py-2 text-sm cursor-pointer ${checked ? 'bg-green-50' : ''}`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            postAction({
                              action: checked ? 'checkout' : 'checkin',
                              matchup_id: matchup.id,
                              roster_id: r.id,
                            })
                          }
                          className="w-4 h-4 accent-orange-500"
                        />
                        <span className="w-5 text-right text-gray-400 text-xs font-mono">
                          {r.ladder_position ? `#${r.ladder_position}` : '—'}
                        </span>
                        <span className="flex-1 text-gray-900">{r.player_name}</span>
                        {checked && <Check size={14} className="text-green-500" />}
                      </label>
                    );
                  })}
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => postAction({ action: 'checkinAll', matchup_id: matchup.id, division_id: division.id })}
                  className="text-xs text-orange-600 hover:text-orange-700 font-medium"
                >
                  Check in all
                </button>
                <button
                  onClick={() => postAction({ action: 'clearCheckins', matchup_id: matchup.id, division_id: division.id })}
                  className="text-xs text-gray-500 hover:text-gray-700"
                >
                  Clear
                </button>
              </div>
            </>
          )}
        </div>

        {/* Auto-assign button */}
        <div className="px-4 py-3 border-b border-gray-100">
          <button
            onClick={() => postAction({ action: 'autoAssign', matchup_id: matchup.id })}
            className="inline-flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-md text-sm font-semibold hover:bg-orange-600 w-full justify-center"
          >
            <Zap size={14} />
            Auto-assign lines by strength
          </button>
          <p className="text-xs text-gray-500 mt-1 text-center">
            Assigns strongest checked-in players to lines automatically
          </p>
        </div>

        {/* Lines / Score Entry */}
        <div className="divide-y divide-gray-100">
          {lines.length === 0 ? (
            <div className="p-4 text-sm text-gray-400 italic text-center">
              No lines set up yet. Check in players and auto-assign to create lines.
            </div>
          ) : (
            lines.map(line => (
              <LineScoreEntry
                key={line.id}
                line={line}
                homeClub={homeClub}
                awayClub={awayClub}
                homeRosters={homeRosters}
                awayRosters={awayRosters}
                postAction={postAction}
              />
            ))
          )}
        </div>

        {/* Match complete indicator */}
        {allCompleted && (
          <div className="p-4 bg-green-50 text-green-700 text-sm font-medium text-center rounded-b-xl flex items-center justify-center gap-2">
            <Trophy size={16} />
            All lines complete — standings updated!
          </div>
        )}
      </div>
    </div>
  );
}

function LineScoreEntry({
  line,
  homeClub,
  awayClub,
  homeRosters,
  awayRosters,
  postAction,
}: {
  line: Line;
  homeClub: Club;
  awayClub: Club;
  homeRosters: Roster[];
  awayRosters: Roster[];
  postAction: (body: Record<string, any>) => Promise<void>;
}) {
  const [score, setScore] = useState(line.score || '');
  const [winner, setWinner] = useState<'home' | 'away' | null>(line.winner);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(line.status === 'completed');

  const isDoubles = line.line_type === 'doubles';

  const findPlayer = (id: string | null) => {
    if (!id) return null;
    return [...homeRosters, ...awayRosters].find(r => r.id === id);
  };

  const homeP1 = findPlayer(line.home_player1_id);
  const homeP2 = findPlayer(line.home_player2_id);
  const awayP1 = findPlayer(line.away_player1_id);
  const awayP2 = findPlayer(line.away_player2_id);

  const submitScore = async () => {
    if (!winner) return;
    if (!score.trim()) return;
    setSubmitting(true);
    await postAction({
      action: 'submitScore',
      line_id: line.id,
      winner,
      score: score.trim(),
    });
    setSubmitted(true);
    setSubmitting(false);
  };

  return (
    <div className={`p-4 ${submitted ? 'bg-green-50' : ''}`}>
      <div className="flex items-center justify-between mb-2">
        <h4 className="font-medium text-gray-900">
          Line {line.line_number} · {isDoubles ? 'Doubles' : 'Singles'}
        </h4>
        {submitted && (
          <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
            Completed
          </span>
        )}
      </div>

      {/* Players assigned */}
      <div className="grid grid-cols-2 gap-3 mb-3 text-sm">
        <div>
          <div className="text-xs text-gray-500 uppercase mb-0.5">{awayClub.short_code}</div>
          <div className="text-gray-900">
            {awayP1 ? awayP1.player_name : <span className="text-gray-400 italic">TBD</span>}
          </div>
          {isDoubles && (
            <div className="text-gray-900">
              {awayP2 ? awayP2.player_name : <span className="text-gray-400 italic">TBD</span>}
            </div>
          )}
        </div>
        <div>
          <div className="text-xs text-gray-500 uppercase mb-0.5">{homeClub.short_code}</div>
          <div className="text-gray-900">
            {homeP1 ? homeP1.player_name : <span className="text-gray-400 italic">TBD</span>}
          </div>
          {isDoubles && (
            <div className="text-gray-900">
              {homeP2 ? homeP2.player_name : <span className="text-gray-400 italic">TBD</span>}
            </div>
          )}
        </div>
      </div>

      {/* Score entry (only if not already completed, or allow editing) */}
      {!submitted ? (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setWinner('away')}
              className={`px-3 py-2 rounded-md text-sm font-medium border ${
                winner === 'away'
                  ? 'bg-orange-500 text-white border-orange-500'
                  : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
              }`}
            >
              {awayClub.short_code} won
            </button>
            <button
              onClick={() => setWinner('home')}
              className={`px-3 py-2 rounded-md text-sm font-medium border ${
                winner === 'home'
                  ? 'bg-orange-500 text-white border-orange-500'
                  : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
              }`}
            >
              {homeClub.short_code} won
            </button>
          </div>
          <input
            value={score}
            onChange={e => setScore(e.target.value)}
            placeholder="Score, e.g. 6-3, 6-4"
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
          />
          <button
            onClick={submitScore}
            disabled={!winner || !score.trim() || submitting}
            className="w-full py-2 bg-gray-900 text-white rounded-md text-sm font-semibold hover:bg-gray-800 disabled:opacity-40 inline-flex items-center justify-center gap-2"
          >
            <Trophy size={14} />
            {submitting ? 'Submitting...' : 'Submit score'}
          </button>
        </div>
      ) : (
        <div className="text-sm text-gray-600">
          <span className="font-medium">{line.winner === 'home' ? homeClub.short_code : awayClub.short_code} won</span>
          {' · '}{line.score || score}
        </div>
      )}
    </div>
  );
}
