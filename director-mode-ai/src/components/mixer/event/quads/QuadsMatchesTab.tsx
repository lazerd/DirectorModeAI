'use client';

import { useState } from 'react';
import { Edit3, Loader2, Trophy, Mail, Wand2, Calendar } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import {
  computeFlightStandings,
  buildQuadDoublesRound,
  quadScoringLabel,
  autoScheduleQuads,
  formatTimeDisplay,
} from '@/lib/quads';
import type { QuadEvent, QuadEntry, QuadFlight, QuadMatch } from '../QuadsAdminDashboard';

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
  const [emailing, setEmailing] = useState<'scoring' | 'schedule' | null>(null);
  const [emailResult, setEmailResult] = useState<
    { kind: 'scoring' | 'schedule'; sent: number; total: number } | null
  >(null);
  const [scheduling, setScheduling] = useState(false);
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

  const emailScoringLinks = async () => {
    if (!confirm(
      `Email a personal scoring link to every confirmed player? Each player will get a link they can use to enter scores for all their matches.`
    )) return;
    setEmailing('scoring');
    setEmailResult(null);
    try {
      const res = await fetch(`/api/quads/events/${event.id}/email-scoring-links`, {
        method: 'POST',
      });
      const data = await res.json();
      setEmailResult({ kind: 'scoring', sent: data.sent, total: data.total });
    } catch {
      /* swallow */
    }
    setEmailing(null);
  };

  const emailSchedules = async () => {
    if (!confirm(
      `Email each confirmed player their personal match schedule (court + start time per match)?`
    )) return;
    setEmailing('schedule');
    setEmailResult(null);
    try {
      const res = await fetch(`/api/quads/events/${event.id}/email-schedules`, {
        method: 'POST',
      });
      const data = await res.json();
      setEmailResult({ kind: 'schedule', sent: data.sent, total: data.total });
    } catch {
      /* swallow */
    }
    setEmailing(null);
  };

  const autoSchedule = async () => {
    if (
      flights.length > 0 &&
      matches.some((m) => m.scheduled_at) &&
      !confirm('Auto-schedule will overwrite any existing court + time assignments. Continue?')
    ) {
      return;
    }
    setScheduling(true);
    const startTime = (event.start_time || '09:00').slice(0, 5);
    const result = autoScheduleQuads({
      startTime,
      roundDurationMinutes: event.round_duration_minutes ?? 45,
      numCourts: event.num_courts ?? 2,
      flights: flights.map((f) => ({
        id: f.id,
        sort_order: f.sort_order,
        matches: matches
          .filter((m) => m.flight_id === f.id)
          .map((m) => ({ id: m.id, round: m.round })),
      })),
    });
    for (const [matchId, { scheduled_at, court }] of result) {
      await supabase
        .from('quad_matches')
        .update({ scheduled_at, court })
        .eq('id', matchId);
    }
    await onRefresh();
    setScheduling(false);
  };

  const updateMatchSchedule = async (
    matchId: string,
    field: 'scheduled_at' | 'court',
    value: string
  ) => {
    setBusy(matchId);
    await supabase
      .from('quad_matches')
      .update({ [field]: value || null })
      .eq('id', matchId);
    await onRefresh();
    setBusy(null);
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
      {/* Schedule + email actions */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
        <h3 className="font-semibold">Schedule + notify players</h3>
        <p className="text-sm text-gray-600">
          Auto-schedule assigns each match a court + start time based on your event start time
          ({(event.start_time || '09:00').slice(0, 5)}) and round duration
          ({event.round_duration_minutes ?? 45} min). You can edit any match individually
          afterwards. Then email each player their personal schedule and/or scoring link.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={autoSchedule}
            disabled={scheduling || flights.length === 0}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-orange-500 hover:bg-orange-600 text-white rounded-lg font-semibold text-sm disabled:opacity-50"
          >
            {scheduling ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
            {scheduling ? 'Scheduling…' : 'Auto-schedule matches'}
          </button>
          <button
            onClick={emailSchedules}
            disabled={emailing !== null || matches.every((m) => !m.scheduled_at)}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold text-sm disabled:opacity-50"
          >
            {emailing === 'schedule' ? <Loader2 size={14} className="animate-spin" /> : <Calendar size={14} />}
            {emailing === 'schedule' ? 'Sending…' : 'Email schedules'}
          </button>
          <button
            onClick={emailScoringLinks}
            disabled={emailing !== null}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold text-sm disabled:opacity-50"
          >
            {emailing === 'scoring' ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />}
            {emailing === 'scoring' ? 'Sending…' : 'Email scoring links'}
          </button>
        </div>
        {emailResult && (
          <p className="text-sm text-emerald-700 font-medium">
            ✓ Sent {emailResult.sent} of {emailResult.total}{' '}
            {emailResult.kind === 'schedule' ? 'schedule' : 'scoring-link'} emails.
          </p>
        )}
      </div>

      <div className="text-sm text-gray-600">
        Scoring: {quadScoringLabel(event.event_scoring_format)}
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
                        onUpdateSchedule={(field, value) => updateMatchSchedule(m.id, field, value)}
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
                  onUpdateSchedule={(field, value) =>
                    updateMatchSchedule(doubles.id, field, value)
                  }
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
  onUpdateSchedule,
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
  onUpdateSchedule: (field: 'scheduled_at' | 'court', value: string) => void | Promise<void>;
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

  const isPending = match.status !== 'completed';
  return (
    <div className="border border-gray-200 rounded-lg p-2 text-sm space-y-2">
      {/* Top row: player names + score + button */}
      <div
        onClick={isPending ? onEdit : undefined}
        className={`flex items-center gap-2 ${isPending ? 'cursor-pointer' : ''}`}
      >
        <div className="flex-1 grid grid-cols-2 gap-1">
          <div className={`truncate ${aWon ? 'font-semibold text-emerald-700' : 'text-gray-900'}`} style={!aWon ? { color: '#000000' } : undefined}>{a}</div>
          <div className={`truncate ${bWon ? 'font-semibold text-emerald-700' : 'text-gray-900'}`} style={!bWon ? { color: '#000000' } : undefined}>{b}</div>
        </div>
        <div className="text-gray-900 text-xs font-mono w-20 text-right truncate" style={{ color: '#000000' }}>
          {match.score || ''}
        </div>
        {isPending ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
            className="px-3 py-1.5 bg-orange-500 hover:bg-orange-600 text-white rounded font-medium text-xs whitespace-nowrap"
          >
            Enter Score
          </button>
        ) : (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
            className="px-2 py-1 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded text-xs flex items-center gap-1"
          >
            <Edit3 size={12} /> Edit
          </button>
        )}
      </div>
      {/* Bottom row: court + start time inline editors */}
      <div className="flex items-center gap-2 text-xs text-gray-600 pl-1">
        <span>Court</span>
        <input
          type="text"
          defaultValue={match.court ?? ''}
          onBlur={(e) => {
            const v = e.target.value.trim();
            if ((match.court ?? '') !== v) onUpdateSchedule('court', v);
          }}
          placeholder="—"
          className="w-12 px-1.5 py-0.5 border rounded text-gray-900"
          style={{ color: '#000000' }}
          disabled={busy}
        />
        <span className="ml-2">Start</span>
        <input
          type="time"
          defaultValue={match.scheduled_at?.slice(0, 5) ?? ''}
          onBlur={(e) => {
            const v = e.target.value;
            const current = match.scheduled_at?.slice(0, 5) ?? '';
            if (current !== v) onUpdateSchedule('scheduled_at', v);
          }}
          className="px-1.5 py-0.5 border rounded text-gray-900"
          style={{ color: '#000000' }}
          disabled={busy}
        />
        {match.scheduled_at && (
          <span className="text-gray-400">{formatTimeDisplay(match.scheduled_at)}</span>
        )}
      </div>
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
  onUpdateSchedule,
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
  onUpdateSchedule: (field: 'scheduled_at' | 'court', value: string) => void | Promise<void>;
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

  const isPending = match.status !== 'completed';
  return (
    <div className="border border-gray-200 rounded-lg p-2 text-sm space-y-2">
      <div
        onClick={isPending ? onEdit : undefined}
        className={`flex items-center gap-2 ${isPending ? 'cursor-pointer' : ''}`}
      >
        <div className="flex-1 grid grid-cols-2 gap-1">
          <div
            className={`truncate text-xs ${aWon ? 'font-semibold text-emerald-700' : 'text-gray-900'}`}
            style={!aWon ? { color: '#000000' } : undefined}
          >
            {a1} + {a2}
          </div>
          <div
            className={`truncate text-xs ${bWon ? 'font-semibold text-emerald-700' : 'text-gray-900'}`}
            style={!bWon ? { color: '#000000' } : undefined}
          >
            {b1} + {b2}
          </div>
        </div>
        <div className="text-gray-900 text-xs font-mono w-20 text-right truncate" style={{ color: '#000000' }}>
          {match.score || ''}
        </div>
        {isPending ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
            className="px-3 py-1.5 bg-orange-500 hover:bg-orange-600 text-white rounded font-medium text-xs whitespace-nowrap"
          >
            Enter Score
          </button>
        ) : (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
            className="px-2 py-1 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded text-xs flex items-center gap-1"
          >
            <Edit3 size={12} /> Edit
          </button>
        )}
      </div>
      <div className="flex items-center gap-2 text-xs text-gray-600 pl-1">
        <span>Court</span>
        <input
          type="text"
          defaultValue={match.court ?? ''}
          onBlur={(e) => {
            const v = e.target.value.trim();
            if ((match.court ?? '') !== v) onUpdateSchedule('court', v);
          }}
          placeholder="—"
          className="w-12 px-1.5 py-0.5 border rounded text-gray-900"
          style={{ color: '#000000' }}
          disabled={busy}
        />
        <span className="ml-2">Start</span>
        <input
          type="time"
          defaultValue={match.scheduled_at?.slice(0, 5) ?? ''}
          onBlur={(e) => {
            const v = e.target.value;
            const current = match.scheduled_at?.slice(0, 5) ?? '';
            if (current !== v) onUpdateSchedule('scheduled_at', v);
          }}
          className="px-1.5 py-0.5 border rounded text-gray-900"
          style={{ color: '#000000' }}
          disabled={busy}
        />
        {match.scheduled_at && (
          <span className="text-gray-400">{formatTimeDisplay(match.scheduled_at)}</span>
        )}
      </div>
    </div>
  );
}
