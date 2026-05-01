'use client';

import { useState } from 'react';
import { Loader2, Check, Edit3, Clock } from 'lucide-react';
import { formatTimeDisplay, isValidQuadScore } from '@/lib/quads';

type Match = {
  id: string;
  round: number;
  match_type: 'singles' | 'doubles';
  player1_id: string | null;
  player2_id: string | null;
  player3_id: string | null;
  player4_id: string | null;
  score: string | null;
  winner_side: 'a' | 'b' | null;
  status: string;
  score_token: string;
  scheduled_at: string | null;
  court: string | null;
};

type FlightEntry = { id: string; player_name: string; flight_seed: number | null };

export default function PlayerScoringList({
  entryId,
  entryName,
  matches,
  flightEntries,
}: {
  entryId: string;
  entryName: string;
  matches: Match[];
  flightEntries: FlightEntry[];
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const nameById = (id: string | null) =>
    (id && flightEntries.find((p) => p.id === id)?.player_name) || '?';

  return (
    <div className="space-y-3">
      {matches.map((m) => {
        const isDoubles = m.match_type === 'doubles';
        const sideA = isDoubles
          ? `${nameById(m.player1_id)} + ${nameById(m.player2_id)}`
          : nameById(m.player1_id);
        const sideB = isDoubles
          ? `${nameById(m.player3_id)} + ${nameById(m.player4_id)}`
          : nameById(m.player3_id);

        // Figure out which side this player is on (so we can highlight "you").
        const youOnA = m.player1_id === entryId || m.player2_id === entryId;
        const youOnB = m.player3_id === entryId || m.player4_id === entryId;

        const aLabel = youOnA ? `${sideA} (you)` : sideA;
        const bLabel = youOnB ? `${sideB} (you)` : sideB;

        const isCompleted = m.status === 'completed';
        const isOpen = editing === m.id;

        return (
          <div
            key={m.id}
            className="bg-white text-gray-900 rounded-xl p-4"
            style={{ color: '#000000' }}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs uppercase tracking-wide text-gray-500 font-semibold">
                {isDoubles ? 'Round 4 · Doubles' : `Round ${m.round} · Singles`}
              </div>
              {isCompleted ? (
                <div className="text-xs text-emerald-700 font-semibold flex items-center gap-1">
                  <Check size={12} /> Reported
                </div>
              ) : (
                <div className="text-xs text-amber-700 font-semibold">Pending</div>
              )}
            </div>
            {(m.scheduled_at || m.court) && (
              <div className="flex items-center gap-2 text-xs text-gray-700 mb-2 bg-gray-100 rounded px-2 py-1">
                <Clock size={12} />
                {m.scheduled_at && <span className="font-semibold">{formatTimeDisplay(m.scheduled_at)}</span>}
                {m.court && <span>· Court {m.court}</span>}
              </div>
            )}

            <div className="grid grid-cols-2 gap-2 text-sm mb-3">
              <div
                className={
                  m.winner_side === 'a' ? 'font-semibold text-emerald-700' : 'text-gray-900'
                }
                style={m.winner_side !== 'a' ? { color: '#000000' } : undefined}
              >
                {aLabel}
              </div>
              <div
                className={
                  m.winner_side === 'b' ? 'font-semibold text-emerald-700' : 'text-gray-900'
                }
                style={m.winner_side !== 'b' ? { color: '#000000' } : undefined}
              >
                {bLabel}
              </div>
            </div>

            {m.score && (
              <div className="text-xs text-gray-700 font-mono mb-2">Score: {m.score}</div>
            )}

            {isOpen ? (
              <ScoreEntry
                token={m.score_token}
                sideA={aLabel}
                sideB={bLabel}
                initialScore={m.score ?? ''}
                initialWinner={m.winner_side}
                reporterDefault={entryName}
                onClose={() => setEditing(null)}
              />
            ) : isCompleted ? (
              <button
                onClick={() => setEditing(m.id)}
                className="text-xs text-orange-600 hover:underline flex items-center gap-1"
              >
                <Edit3 size={12} /> Edit score
              </button>
            ) : (
              <button
                onClick={() => setEditing(m.id)}
                className="w-full py-2.5 bg-orange-500 hover:bg-orange-600 text-white rounded-lg font-semibold text-sm"
              >
                Enter Score
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ScoreEntry({
  token,
  sideA,
  sideB,
  initialScore,
  initialWinner,
  reporterDefault,
  onClose,
}: {
  token: string;
  sideA: string;
  sideB: string;
  initialScore: string;
  initialWinner: 'a' | 'b' | null;
  reporterDefault: string;
  onClose: () => void;
}) {
  const [score, setScore] = useState(initialScore);
  const [winner, setWinner] = useState<'' | 'a' | 'b'>(initialWinner ?? '');
  const [name, setName] = useState(reporterDefault);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/quads/match/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ winner_side: winner, score, reported_by_name: name }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to submit.');
        setSubmitting(false);
        return;
      }
      window.location.reload();
    } catch (err: any) {
      setError(err?.message || 'Network error');
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-3 pt-2 border-t border-gray-200">
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setWinner('a')}
          className={`px-3 py-2.5 rounded-lg text-xs font-semibold border-2 ${
            winner === 'a'
              ? 'bg-emerald-600 text-white border-emerald-600'
              : 'bg-white text-gray-900 border-gray-300 hover:border-emerald-400'
          }`}
        >
          {sideA} won
        </button>
        <button
          type="button"
          onClick={() => setWinner('b')}
          className={`px-3 py-2.5 rounded-lg text-xs font-semibold border-2 ${
            winner === 'b'
              ? 'bg-emerald-600 text-white border-emerald-600'
              : 'bg-white text-gray-900 border-gray-300 hover:border-emerald-400'
          }`}
        >
          {sideB} won
        </button>
      </div>

      <input
        type="text"
        value={score}
        onChange={(e) => setScore(e.target.value)}
        placeholder='Score (e.g. "6-3, 6-4" or "8-5")'
        className="w-full px-3 py-2 border rounded-lg text-gray-900 text-sm"
      />
      {score && !isValidQuadScore(score) ? (
        <div className="text-xs text-red-600 -mt-2">
          Format must be like <code>6-3</code> or <code>6-3, 6-4</code>.
        </div>
      ) : (
        <div className="text-xs text-gray-500 -mt-2">
          Format: <code>6-3</code>, <code>6-3, 6-4</code>, or <code>8-5</code>.
        </div>
      )}
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Your name (for the record)"
        className="w-full px-3 py-2 border rounded-lg text-gray-900 text-sm"
      />

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-2 text-xs">
          {error}
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={onClose}
          className="flex-1 py-2 text-sm border rounded-lg hover:bg-gray-50"
        >
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={submitting || !winner || !isValidQuadScore(score)}
          className="flex-1 py-2 text-sm bg-orange-500 hover:bg-orange-600 text-white rounded-lg font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {submitting && <Loader2 size={14} className="animate-spin" />}
          {submitting ? 'Saving…' : 'Submit'}
        </button>
      </div>
    </div>
  );
}
