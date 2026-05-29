'use client';

import { useCallback, useEffect, useState } from 'react';
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
  Plus,
  Trash2,
  Lightbulb,
} from 'lucide-react';

type Club = { id: string; name: string; short_code: string; courts_available: number };
type Division = { id: string; name: string; short_code: string; start_time: string | null; end_time: string | null; sort_order: number };
type Matchup = { id: string; division_id: string; match_date: string; home_club_id: string; away_club_id: string; home_lines_won: number; away_lines_won: number; winner: string | null; status: string; courts_override: number | null };
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

function computeSuggestion(courts: number, playersPerSide: number) {
  if (courts <= 0 || playersPerSide <= 0) return { singles: 0, doubles: 0, benched: 0 };
  const doublesNeeded = Math.max(0, playersPerSide - courts);
  const singles = Math.min(courts - doublesNeeded, playersPerSide);
  if (singles < 0) {
    // More players than 2x courts — all doubles, some bench
    const maxDoubles = courts;
    const canPlay = maxDoubles * 2;
    return { singles: 0, doubles: maxDoubles, benched: Math.max(0, playersPerSide - canPlay) };
  }
  return { singles, doubles: doublesNeeded, benched: 0 };
}

export default function MatchDayPage() {
  const params = useParams();
  const token = Array.isArray(params.token) ? params.token[0] : (params.token as string);

  const [data, setData] = useState<FetchResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dateOverride, setDateOverride] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const showToast = (type: 'ok' | 'err', text: string) => {
    setToast({ type, text });
    setTimeout(() => setToast(null), 4000);
  };

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
    try {
      const res = await fetch(`/api/leagues/roster/${token}/matchday`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        showToast('err', err.error || `Failed (${res.status})`);
        return;
      }
      fetchData();
    } catch (e: any) {
      showToast('err', e.message || 'Network error');
    }
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
      <div className="mb-4">
        <Link
          href={`/leagues/roster/${token}`}
          className="text-sm text-orange-600 hover:text-orange-700"
        >
          &larr; Back to roster
        </Link>
        <h1 className="font-semibold text-2xl text-gray-900 mt-1">{club.name} — Match Day</h1>
      </div>

      {/* Error/Success Toast */}
      {toast && (
        <div className={`mb-4 rounded-lg p-3 text-sm flex items-start gap-2 ${
          toast.type === 'err'
            ? 'bg-red-50 border border-red-200 text-red-700'
            : 'bg-green-50 border border-green-200 text-green-700'
        }`}>
          {toast.type === 'err' ? <AlertCircle size={14} className="mt-0.5" /> : <Check size={14} className="mt-0.5" />}
          {toast.text}
        </div>
      )}

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
            {matchups.length} matchup{matchups.length !== 1 ? 's' : ''}
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
          if (!division || !homeClub || !awayClub) return null;

          return (
            <MatchupSection
              key={matchup.id}
              matchup={matchup}
              division={division}
              homeClub={homeClub}
              awayClub={awayClub}
              myClub={club}
              rosters={rosters}
              lines={lines.filter(l => l.matchup_id === matchup.id)}
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
  rosters,
  lines,
  checkedInIds,
  postAction,
}: {
  matchup: Matchup;
  division: Division;
  homeClub: Club;
  awayClub: Club;
  myClub: Club;
  rosters: Roster[];
  lines: Line[];
  checkedInIds: Set<string>;
  postAction: (body: Record<string, any>) => Promise<void>;
}) {
  const isHome = matchup.home_club_id === myClub.id;
  const matchupRosters = rosters.filter(r => r.division_id === matchup.division_id);
  const homeRosters = matchupRosters.filter(r => r.club_id === matchup.home_club_id && r.status === 'active');
  const awayRosters = matchupRosters.filter(r => r.club_id === matchup.away_club_id && r.status === 'active');
  const myRosters = isHome ? homeRosters : awayRosters;
  const myCheckedIn = myRosters.filter(r => checkedInIds.has(r.id));

  // Courts: override > home club default
  const courts = matchup.courts_override ?? homeClub.courts_available ?? 0;
  const [courtsInput, setCourtsInput] = useState(courts.toString());

  // Sync courtsInput when data refreshes
  useEffect(() => {
    setCourtsInput(courts.toString());
  }, [courts]);

  // Suggestion based on check-ins and courts
  const homeCheckedIn = homeRosters.filter(r => checkedInIds.has(r.id));
  const awayCheckedIn = awayRosters.filter(r => checkedInIds.has(r.id));
  const hasCheckins = homeCheckedIn.length > 0 || awayCheckedIn.length > 0;
  const playersPerSide = hasCheckins
    ? Math.min(homeCheckedIn.length, awayCheckedIn.length)
    : Math.min(homeRosters.length, awayRosters.length);
  const suggestion = computeSuggestion(courts, playersPerSide);

  const allCompleted = lines.length > 0 && lines.every(l => l.status === 'completed');

  return (
    <div className="mb-8">
      {/* Division Header + Score */}
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
        {/* Check-in */}
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
            <p className="text-sm text-gray-400 italic">No players on your roster for this division.</p>
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
                          #{r.ladder_position || '—'}
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

        {/* Courts Input */}
        <div className="p-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium text-gray-900">Courts available today:</label>
            <input
              type="number"
              min={1}
              max={50}
              value={courtsInput}
              onChange={e => setCourtsInput(e.target.value)}
              className="w-16 px-2 py-1.5 border border-gray-300 rounded-md text-sm text-gray-900 text-center"
            />
            {parseInt(courtsInput) !== courts && (
              <button
                onClick={() => postAction({ action: 'setCourts', matchup_id: matchup.id, courts: courtsInput })}
                className="px-3 py-1.5 bg-gray-900 text-white rounded-md text-xs font-medium hover:bg-gray-800"
              >
                Update
              </button>
            )}
          </div>
        </div>

        {/* Suggestion */}
        {playersPerSide > 0 && courts > 0 && lines.length === 0 && (
          <div className="p-4 border-b border-gray-100 bg-amber-50">
            <div className="flex items-start gap-2">
              <Lightbulb size={16} className="text-amber-600 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <p className="text-sm text-amber-900">
                  <span className="font-medium">{courts} courts, {playersPerSide} players per side.</span>
                  {' '}Suggested:{' '}
                  <span className="font-semibold">
                    {suggestion.singles} singles + {suggestion.doubles} doubles
                  </span>
                  {suggestion.singles + suggestion.doubles > 0 && (
                    <span className="text-amber-700">
                      {' '}({suggestion.singles + suggestion.doubles * 2} players each side
                      {suggestion.benched > 0 ? `, ${suggestion.benched} sitting` : ', everyone plays'})
                    </span>
                  )}
                </p>
                <button
                  onClick={() => postAction({
                    action: 'useSuggestion',
                    matchup_id: matchup.id,
                    singles: suggestion.singles,
                    doubles: suggestion.doubles,
                  })}
                  className="mt-2 inline-flex items-center gap-1 px-3 py-1.5 bg-amber-600 text-white rounded-md text-xs font-semibold hover:bg-amber-700"
                >
                  <Zap size={12} />
                  Use this
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Build Scorecard - Add Lines */}
        <div className="p-4 border-b border-gray-100">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-medium text-gray-900">Scorecard</h3>
            <span className="text-xs text-gray-500">{lines.length} line{lines.length !== 1 ? 's' : ''}</span>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => postAction({ action: 'addLine', matchup_id: matchup.id, line_type: 'singles' })}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 border-2 border-dashed border-gray-300 rounded-lg text-sm font-medium text-gray-600 hover:border-orange-400 hover:text-orange-600 transition-colors"
            >
              <Plus size={14} />
              Add Singles
            </button>
            <button
              onClick={() => postAction({ action: 'addLine', matchup_id: matchup.id, line_type: 'doubles' })}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 border-2 border-dashed border-gray-300 rounded-lg text-sm font-medium text-gray-600 hover:border-orange-400 hover:text-orange-600 transition-colors"
            >
              <Plus size={14} />
              Add Doubles
            </button>
          </div>
          {lines.length > 0 && (
            <button
              onClick={() => {
                if (confirm('Clear all unscored lines from this matchup?')) {
                  postAction({ action: 'clearLines', matchup_id: matchup.id });
                }
              }}
              className="mt-2 text-xs text-gray-500 hover:text-red-500"
            >
              Clear scorecard
            </button>
          )}
        </div>

        {/* Auto-assign button (only when lines exist) */}
        {lines.length > 0 && (
          <div className="px-4 py-3 border-b border-gray-100">
            <button
              onClick={() => postAction({ action: 'autoAssign', matchup_id: matchup.id })}
              className="inline-flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-md text-sm font-semibold hover:bg-orange-600 w-full justify-center"
            >
              <Zap size={14} />
              Auto-fill players by strength
            </button>
          </div>
        )}

        {/* Line Cards */}
        <div className="divide-y divide-gray-100">
          {lines
            .sort((a, b) => a.line_number - b.line_number)
            .map(line => (
              <LineCard
                key={line.id}
                line={line}
                homeClub={homeClub}
                awayClub={awayClub}
                homeRosters={homeRosters}
                awayRosters={awayRosters}
                postAction={postAction}
              />
            ))}
        </div>

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

function LineCard({
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
  const completed = line.status === 'completed';
  const isDoubles = line.line_type === 'doubles';

  const submitScore = async () => {
    if (!winner || !score.trim()) return;
    setSubmitting(true);
    await postAction({ action: 'submitScore', line_id: line.id, winner, score: score.trim() });
    setSubmitting(false);
  };

  const removeLine = async () => {
    if (completed) {
      if (!confirm('This line has a score. Delete it? The matchup score will update.')) return;
    }
    await postAction({ action: 'removeLine', line_id: line.id });
  };

  return (
    <div className={`p-4 ${completed ? 'bg-green-50' : ''}`}>
      <div className="flex items-center justify-between mb-2">
        <h4 className="font-medium text-gray-900">
          Line {line.line_number} · {isDoubles ? 'Doubles' : 'Singles'}
        </h4>
        <div className="flex items-center gap-2">
          {completed && (
            <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
              Done
            </span>
          )}
          <button
            onClick={removeLine}
            className="p-1 text-gray-300 hover:text-red-500 transition-colors"
            title="Remove this line"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* Players */}
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <div className="text-xs text-gray-500 uppercase mb-1">{awayClub.short_code}</div>
          <PlayerPicker
            rosters={awayRosters}
            value={line.away_player1_id}
            onChange={v => postAction({ action: 'assignPlayer', line_id: line.id, slot: 'away_player1_id', roster_id: v })}
            label={isDoubles ? 'Player 1' : 'Player'}
            disabled={completed}
          />
          {isDoubles && (
            <div className="mt-1">
              <PlayerPicker
                rosters={awayRosters}
                value={line.away_player2_id}
                onChange={v => postAction({ action: 'assignPlayer', line_id: line.id, slot: 'away_player2_id', roster_id: v })}
                label="Player 2"
                disabled={completed}
              />
            </div>
          )}
        </div>
        <div>
          <div className="text-xs text-gray-500 uppercase mb-1">{homeClub.short_code}</div>
          <PlayerPicker
            rosters={homeRosters}
            value={line.home_player1_id}
            onChange={v => postAction({ action: 'assignPlayer', line_id: line.id, slot: 'home_player1_id', roster_id: v })}
            label={isDoubles ? 'Player 1' : 'Player'}
            disabled={completed}
          />
          {isDoubles && (
            <div className="mt-1">
              <PlayerPicker
                rosters={homeRosters}
                value={line.home_player2_id}
                onChange={v => postAction({ action: 'assignPlayer', line_id: line.id, slot: 'home_player2_id', roster_id: v })}
                label="Player 2"
                disabled={completed}
              />
            </div>
          )}
        </div>
      </div>

      {/* Score Entry */}
      {!completed ? (
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
        <div className="flex items-center justify-between">
          <div className="text-sm text-gray-600">
            <span className="font-medium">{line.winner === 'home' ? homeClub.short_code : awayClub.short_code} won</span>
            {' · '}{line.score || score}
          </div>
          <button
            onClick={() => {
              if (confirm('Revise this score? It will unlock the line for editing.')) {
                postAction({ action: 'reviseScore', line_id: line.id });
              }
            }}
            className="text-xs text-orange-600 hover:text-orange-700 font-medium"
          >
            Revise
          </button>
        </div>
      )}
    </div>
  );
}

function PlayerPicker({
  rosters,
  value,
  onChange,
  label,
  disabled,
}: {
  rosters: Roster[];
  value: string | null;
  onChange: (v: string | null) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <select
      value={value || ''}
      onChange={e => onChange(e.target.value || null)}
      disabled={disabled}
      className="w-full px-2 py-1.5 border border-gray-300 rounded-md text-sm text-gray-900 disabled:bg-gray-50 disabled:text-gray-500"
    >
      <option value="">{label} — choose —</option>
      {rosters
        .sort((a, b) => (a.ladder_position ?? 9999) - (b.ladder_position ?? 9999))
        .map(r => (
          <option key={r.id} value={r.id}>
            {r.ladder_position ? `#${r.ladder_position} ` : ''}{r.player_name}
          </option>
        ))}
    </select>
  );
}
