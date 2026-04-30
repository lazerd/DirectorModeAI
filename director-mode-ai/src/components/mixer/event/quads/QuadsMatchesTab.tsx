'use client';

import { useState } from 'react';
import { Copy, Check, Edit3, Loader2, Trophy } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import {
  computeFlightStandings,
  buildQuadDoublesRound,
  QUAD_SCORING_FORMATS,
} from '@/lib/quads';
import type { QuadEvent, QuadEntry, QuadFlight, QuadMatch } from '../QuadsAdminDashboard';

const SCORING_LABELS = Object.fromEntries(
  QUAD_SCORING_FORMATS.map((s) => [s.id, s.label])
);

export default function QuadsMatchesTab({
  event,
  entries,
  flights,
  matches,
  onRefresh,
}: {
  event: QuadEvent;
  entries: QuadEntry[];
  flights: QuadFlight[];
  matches: QuadMatch[];
  onRefresh: () => void | Promise<void>;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [scoreInput, setScoreInput] = useState({ score: '', winner_side: '' as '' | 'a' | 'b' });
  const [busy, setBusy] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const supabase = createClient();

  const entryById = new Map(entries.map((e) => [e.id, e]));

  const openEdit = (m: QuadMatch) => {
    setEditing(m.id);
    setScoreInput({ score: m.score ?? '', winner_side: m.winner_side ?? '' });
  };

  const saveScore = async (m: QuadMatch) => {
    if (!scoreInput.winner_side) return;
    setBusy(m.id);
    await supabase
      .from('quad_matches')
      .update({
        score: scoreInput.score,
        winner_side: scoreInput.winner_side,
        status: 'completed',
        reported_at: new Date().toISOString(),
        reported_by_name: 'Director',
      })
      .eq('id', m.id);

    // After saving, check if the flight's R1-R3 (singles) are all complete
    // and there's no R4 yet → auto-create the doubles match.
    await maybeCreateDoublesRound(m.flight_id);

    setEditing(null);
    setBusy(null);
    await onRefresh();
  };

  const maybeCreateDoublesRound = async (flightId: string) => {
    const flightMatches = matches
      .map((mm) => (mm.id === editing ? { ...mm, status: 'completed' } : mm))
      .filter((mm) => mm.flight_id === flightId);
    const singles = flightMatches.filter((mm) => mm.match_type === 'singles');
    const doubles = flightMatches.find((mm) => mm.match_type === 'doubles');
    if (singles.length !== 6) return;
    if (singles.some((mm) => mm.status !== 'completed')) return;
    if (doubles) return;

    const flightEntries = entries
      .filter((e) => e.flight_id === flightId)
      .map((e) => ({ id: e.id, flight_seed: e.flight_seed }));
    const standings = computeFlightStandings(flightEntries, singles as any);
    const doublesMatch = buildQuadDoublesRound(standings);
    if (!doublesMatch) return;

    await supabase.from('quad_matches').insert({
      flight_id: flightId,
      round: 4,
      match_type: 'doubles',
      player1_id: doublesMatch.player1_id,
      player2_id: doublesMatch.player2_id,
      player3_id: doublesMatch.player3_id,
      player4_id: doublesMatch.player4_id,
    });
  };

  const copyMagicLink = async (token: string) => {
    try {
      const url = `${window.location.origin}/quads/match/${token}`;
      await navigator.clipboard.writeText(url);
      setCopiedToken(token);
      setTimeout(() => setCopiedToken(null), 1500);
    } catch {
      /* swallow */
    }
  };

  if (flights.length === 0) {
    return (
      <div className="bg-gray-50 border border-gray-200 rounded-xl p-8 text-center text-sm text-gray-500">
        Generate flights first (Flights tab) to schedule matches.
      </div>
    );
  }

  const playerName = (id: string | null) => (id && entryById.get(id)?.player_name) || '—';

  return (
    <div className="space-y-4">
      <div className="text-sm text-gray-600">
        Scoring: {SCORING_LABELS[event.event_scoring_format] ?? event.event_scoring_format}
      </div>

      {flights.map((flight) => {
        const fm = matches
          .filter((m) => m.flight_id === flight.id)
          .sort((a, b) => a.round - b.round || a.id.localeCompare(b.id));
        const singles = fm.filter((m) => m.match_type === 'singles');
        const doubles = fm.find((m) => m.match_type === 'doubles');
        const allSinglesDone =
          singles.length === 6 && singles.every((m) => m.status === 'completed');

        return (
          <div key={flight.id} className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <Trophy size={16} className="text-orange-500" />
              <h3 className="font-semibold">{flight.name}</h3>
              {flight.tier_label && <span className="text-xs text-gray-500">· {flight.tier_label}</span>}
            </div>

            {[1, 2, 3].map((round) => {
              const roundMatches = singles.filter((m) => m.round === round);
              return (
                <div key={round} className="mb-3">
                  <div className="text-xs text-gray-500 mb-1.5 uppercase tracking-wide">
                    Singles · Round {round}
                  </div>
                  <div className="space-y-2">
                    {roundMatches.map((m) => (
                      <MatchRow
                        key={m.id}
                        match={m}
                        playerName={playerName}
                        editing={editing === m.id}
                        scoreInput={scoreInput}
                        setScoreInput={setScoreInput}
                        onEdit={() => openEdit(m)}
                        onCancel={() => setEditing(null)}
                        onSave={() => saveScore(m)}
                        busy={busy === m.id}
                        onCopyLink={() => copyMagicLink(m.score_token)}
                        copied={copiedToken === m.score_token}
                      />
                    ))}
                  </div>
                </div>
              );
            })}

            <div className="mt-3">
              <div className="text-xs text-gray-500 mb-1.5 uppercase tracking-wide">
                Round 4 · Doubles (1+4 vs 2+3)
              </div>
              {!allSinglesDone && !doubles ? (
                <div className="text-xs text-gray-500 italic px-2 py-2">
                  Pairs once R1–R3 singles are all complete.
                </div>
              ) : doubles ? (
                <DoublesRow
                  match={doubles}
                  playerName={playerName}
                  editing={editing === doubles.id}
                  scoreInput={scoreInput}
                  setScoreInput={setScoreInput}
                  onEdit={() => openEdit(doubles)}
                  onCancel={() => setEditing(null)}
                  onSave={() => saveScore(doubles)}
                  busy={busy === doubles.id}
                  onCopyLink={() => copyMagicLink(doubles.score_token)}
                  copied={copiedToken === doubles.score_token}
                />
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function MatchRow({
  match,
  playerName,
  editing,
  scoreInput,
  setScoreInput,
  onEdit,
  onCancel,
  onSave,
  busy,
  onCopyLink,
  copied,
}: {
  match: QuadMatch;
  playerName: (id: string | null) => string;
  editing: boolean;
  scoreInput: { score: string; winner_side: '' | 'a' | 'b' };
  setScoreInput: (v: { score: string; winner_side: '' | 'a' | 'b' }) => void;
  onEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
  busy: boolean;
  onCopyLink: () => void;
  copied: boolean;
}) {
  const a = playerName(match.player1_id);
  const b = playerName(match.player3_id);
  const aWon = match.winner_side === 'a';
  const bWon = match.winner_side === 'b';

  if (editing) {
    return (
      <div className="border border-orange-200 bg-orange-50 rounded-lg p-3 space-y-2">
        <div className="flex items-center gap-2 text-sm">
          <button
            onClick={() => setScoreInput({ ...scoreInput, winner_side: 'a' })}
            className={`flex-1 px-2 py-1 rounded ${scoreInput.winner_side === 'a' ? 'bg-emerald-600 text-white' : 'bg-white border'}`}
          >
            {a} won
          </button>
          <span className="text-gray-500">vs</span>
          <button
            onClick={() => setScoreInput({ ...scoreInput, winner_side: 'b' })}
            className={`flex-1 px-2 py-1 rounded ${scoreInput.winner_side === 'b' ? 'bg-emerald-600 text-white' : 'bg-white border'}`}
          >
            {b} won
          </button>
        </div>
        <input
          type="text"
          placeholder='Score (e.g. "6-3, 6-4" or "8-5")'
          value={scoreInput.score}
          onChange={(e) => setScoreInput({ ...scoreInput, score: e.target.value })}
          className="w-full px-2 py-1.5 border rounded-lg text-sm text-gray-900"
        />
        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="flex-1 px-2 py-1 text-sm border rounded hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={onSave}
            disabled={busy || !scoreInput.winner_side}
            className="flex-1 px-2 py-1 text-sm bg-orange-500 text-white rounded hover:bg-orange-600 disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="border border-gray-200 rounded-lg p-2 flex items-center gap-2 text-sm">
      <div className="flex-1 grid grid-cols-2 gap-1">
        <div className={`truncate ${aWon ? 'font-semibold text-emerald-700' : ''}`}>{a}</div>
        <div className={`truncate ${bWon ? 'font-semibold text-emerald-700' : ''}`}>{b}</div>
      </div>
      <div className="text-gray-700 text-xs font-mono w-24 text-right truncate">
        {match.score || (match.status === 'completed' ? '—' : 'pending')}
      </div>
      <button
        onClick={onCopyLink}
        title="Copy magic-link scoring URL"
        className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded"
      >
        {copied ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
      </button>
      <button
        onClick={onEdit}
        className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded"
      >
        <Edit3 size={14} />
      </button>
    </div>
  );
}

function DoublesRow({
  match,
  playerName,
  editing,
  scoreInput,
  setScoreInput,
  onEdit,
  onCancel,
  onSave,
  busy,
  onCopyLink,
  copied,
}: {
  match: QuadMatch;
  playerName: (id: string | null) => string;
  editing: boolean;
  scoreInput: { score: string; winner_side: '' | 'a' | 'b' };
  setScoreInput: (v: { score: string; winner_side: '' | 'a' | 'b' }) => void;
  onEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
  busy: boolean;
  onCopyLink: () => void;
  copied: boolean;
}) {
  const a1 = playerName(match.player1_id);
  const a2 = playerName(match.player2_id);
  const b1 = playerName(match.player3_id);
  const b2 = playerName(match.player4_id);
  const aWon = match.winner_side === 'a';
  const bWon = match.winner_side === 'b';

  if (editing) {
    return (
      <div className="border border-orange-200 bg-orange-50 rounded-lg p-3 space-y-2">
        <div className="flex items-center gap-2 text-sm">
          <button
            onClick={() => setScoreInput({ ...scoreInput, winner_side: 'a' })}
            className={`flex-1 px-2 py-1 rounded text-xs ${scoreInput.winner_side === 'a' ? 'bg-emerald-600 text-white' : 'bg-white border'}`}
          >
            {a1} + {a2}
          </button>
          <span className="text-gray-500">vs</span>
          <button
            onClick={() => setScoreInput({ ...scoreInput, winner_side: 'b' })}
            className={`flex-1 px-2 py-1 rounded text-xs ${scoreInput.winner_side === 'b' ? 'bg-emerald-600 text-white' : 'bg-white border'}`}
          >
            {b1} + {b2}
          </button>
        </div>
        <input
          type="text"
          placeholder="Score"
          value={scoreInput.score}
          onChange={(e) => setScoreInput({ ...scoreInput, score: e.target.value })}
          className="w-full px-2 py-1.5 border rounded-lg text-sm text-gray-900"
        />
        <div className="flex gap-2">
          <button onClick={onCancel} className="flex-1 px-2 py-1 text-sm border rounded hover:bg-gray-50">
            Cancel
          </button>
          <button
            onClick={onSave}
            disabled={busy || !scoreInput.winner_side}
            className="flex-1 px-2 py-1 text-sm bg-orange-500 text-white rounded hover:bg-orange-600 disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="border border-gray-200 rounded-lg p-2 flex items-center gap-2 text-sm">
      <div className="flex-1 grid grid-cols-2 gap-1">
        <div className={`truncate text-xs ${aWon ? 'font-semibold text-emerald-700' : ''}`}>
          {a1} + {a2}
        </div>
        <div className={`truncate text-xs ${bWon ? 'font-semibold text-emerald-700' : ''}`}>
          {b1} + {b2}
        </div>
      </div>
      <div className="text-gray-700 text-xs font-mono w-24 text-right truncate">
        {match.score || (match.status === 'completed' ? '—' : 'pending')}
      </div>
      <button
        onClick={onCopyLink}
        title="Copy magic-link scoring URL"
        className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded"
      >
        {copied ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
      </button>
      <button onClick={onEdit} className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded">
        <Edit3 size={14} />
      </button>
    </div>
  );
}
