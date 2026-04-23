'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Loader2, AlertCircle, Check, Trophy } from 'lucide-react';

type Club = { id: string; name: string; short_code: string };
type Division = { id: string; name: string; league_id: string };
type Matchup = {
  id: string;
  match_date: string;
  start_time: string | null;
  home_club_id: string;
  away_club_id: string;
};
type Roster = {
  id: string;
  club_id: string;
  player_name: string;
  ladder_position: number | null;
};
type Line = {
  id: string;
  line_type: 'singles' | 'doubles';
  line_number: number;
  home_player1_id: string | null;
  home_player2_id: string | null;
  away_player1_id: string | null;
  away_player2_id: string | null;
  score: string | null;
  winner: 'home' | 'away' | null;
  status: string;
};

type FetchResult = {
  line: Line;
  matchup: Matchup;
  homeClub: Club;
  awayClub: Club;
  division: Division;
  homeRosters: Roster[];
  awayRosters: Roster[];
};

export default function MagicLinkScorePage() {
  const params = useParams();
  const token = Array.isArray(params.token) ? params.token[0] : (params.token as string);

  const [data, setData] = useState<FetchResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [winner, setWinner] = useState<'home' | 'away' | null>(null);
  const [score, setScore] = useState('');
  const [reporter, setReporter] = useState('');
  const [home1, setHome1] = useState<string>('');
  const [home2, setHome2] = useState<string>('');
  const [away1, setAway1] = useState<string>('');
  const [away2, setAway2] = useState<string>('');

  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const fetchLine = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/leagues/line/${token}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const json = (await res.json()) as FetchResult;
      setData(json);

      setWinner(json.line.winner);
      setScore(json.line.score || '');
      setHome1(json.line.home_player1_id || '');
      setHome2(json.line.home_player2_id || '');
      setAway1(json.line.away_player1_id || '');
      setAway2(json.line.away_player2_id || '');
      setLoading(false);
    } catch (e: any) {
      setError(e.message);
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchLine();
  }, [fetchLine]);

  const submit = async () => {
    if (!winner) {
      setSubmitError('Pick the winning team.');
      return;
    }
    if (!score.trim()) {
      setSubmitError('Enter the match score.');
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch(`/api/leagues/line/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          winner,
          score: score.trim(),
          reported_by_name: reporter.trim() || null,
          home_player1_id: home1 || null,
          home_player2_id: data?.line.line_type === 'doubles' ? (home2 || null) : null,
          away_player1_id: away1 || null,
          away_player2_id: data?.line.line_type === 'doubles' ? (away2 || null) : null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setSubmitted(true);
    } catch (e: any) {
      setSubmitError(e.message);
    } finally {
      setSubmitting(false);
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
            <p className="font-medium">Couldn&apos;t load this scoring link.</p>
            <p className="text-sm">{error || 'Unknown error'}</p>
          </div>
        </div>
      </div>
    );
  }

  const { line, matchup, homeClub, awayClub, division, homeRosters, awayRosters } = data;
  const isDoubles = line.line_type === 'doubles';

  if (submitted) {
    return (
      <div className="p-6 max-w-lg mx-auto">
        <div className="bg-green-50 border border-green-200 text-green-800 rounded-lg p-5 flex items-start gap-3">
          <Check size={20} className="mt-0.5 text-green-600" />
          <div>
            <p className="font-semibold text-lg">Score submitted!</p>
            <p className="text-sm mt-1">
              {winner === 'home' ? homeClub.name : awayClub.name} won: {score}
            </p>
            <p className="text-xs mt-3 text-green-700">
              Thanks — the standings will update automatically.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const dateLabel = new Date(matchup.match_date + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  return (
    <div className="p-4 sm:p-6 max-w-xl mx-auto">
      <div className="mb-6">
        <h1 className="font-semibold text-2xl text-gray-900">
          {awayClub.name} <span className="text-gray-400">@</span> {homeClub.name}
        </h1>
        <p className="text-gray-500 text-sm">
          {division.name} · Line {line.line_number} · {isDoubles ? 'Doubles' : 'Singles'}
        </p>
        <p className="text-gray-400 text-xs">{dateLabel}</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6 space-y-4">
        {/* Players */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <div className="text-xs font-medium text-gray-500 uppercase mb-1">
              Away · {awayClub.name}
            </div>
            <PlayerSelect
              rosters={awayRosters}
              value={away1}
              onChange={setAway1}
              label={isDoubles ? 'Player 1' : 'Player'}
            />
            {isDoubles && (
              <div className="mt-2">
                <PlayerSelect
                  rosters={awayRosters}
                  value={away2}
                  onChange={setAway2}
                  label="Player 2"
                />
              </div>
            )}
          </div>

          <div>
            <div className="text-xs font-medium text-gray-500 uppercase mb-1">
              Home · {homeClub.name}
            </div>
            <PlayerSelect
              rosters={homeRosters}
              value={home1}
              onChange={setHome1}
              label={isDoubles ? 'Player 1' : 'Player'}
            />
            {isDoubles && (
              <div className="mt-2">
                <PlayerSelect
                  rosters={homeRosters}
                  value={home2}
                  onChange={setHome2}
                  label="Player 2"
                />
              </div>
            )}
          </div>
        </div>

        {/* Winner */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Who won?</label>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setWinner('away')}
              className={`px-3 py-2 rounded-md font-medium border ${
                winner === 'away'
                  ? 'bg-orange-500 text-white border-orange-500'
                  : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
              }`}
            >
              {awayClub.name}
            </button>
            <button
              onClick={() => setWinner('home')}
              className={`px-3 py-2 rounded-md font-medium border ${
                winner === 'home'
                  ? 'bg-orange-500 text-white border-orange-500'
                  : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
              }`}
            >
              {homeClub.name}
            </button>
          </div>
        </div>

        {/* Score */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Score</label>
          <input
            value={score}
            onChange={e => setScore(e.target.value)}
            placeholder="e.g. 6-3, 6-4"
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
          />
        </div>

        {/* Reporter name */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Your name <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <input
            value={reporter}
            onChange={e => setReporter(e.target.value)}
            placeholder="Coach name, parent, etc."
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
          />
        </div>

        {submitError && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-md p-3 text-sm flex items-start gap-2">
            <AlertCircle size={14} className="mt-0.5" />
            {submitError}
          </div>
        )}

        <button
          onClick={submit}
          disabled={submitting}
          className="w-full py-3 bg-orange-500 text-white rounded-md font-semibold hover:bg-orange-600 disabled:opacity-50 inline-flex items-center justify-center gap-2"
        >
          <Trophy size={16} />
          {submitting ? 'Submitting...' : 'Submit score'}
        </button>
      </div>
    </div>
  );
}

function PlayerSelect({
  rosters,
  value,
  onChange,
  label,
}: {
  rosters: Roster[];
  value: string;
  onChange: (v: string) => void;
  label: string;
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="w-full px-2 py-1.5 border border-gray-300 rounded-md text-sm text-gray-900"
    >
      <option value="">{label} — choose —</option>
      {rosters.map(r => (
        <option key={r.id} value={r.id}>
          {r.ladder_position ? `#${r.ladder_position} ` : ''}
          {r.player_name}
        </option>
      ))}
    </select>
  );
}
