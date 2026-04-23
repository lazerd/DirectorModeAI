'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Loader2,
  AlertCircle,
  Save,
  Trash2,
  Zap,
  Copy,
  Check,
  UserCheck,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import {
  autoAssignByStrength,
  optimizeLines,
  buildLineSkeleton,
} from '@/lib/jtt';

type Club = {
  id: string;
  name: string;
  short_code: string;
  courts_available: number;
};
type Division = {
  id: string;
  name: string;
  short_code: string;
  line_format: string;
  start_time: string | null;
  end_time: string | null;
};
type Matchup = {
  id: string;
  division_id: string;
  match_date: string;
  start_time: string | null;
  home_club_id: string;
  away_club_id: string;
  home_lines_won: number;
  away_lines_won: number;
  winner: 'home' | 'away' | 'tie' | null;
  status: string;
  notes: string | null;
  courts_override: number | null;
};
type Roster = {
  id: string;
  division_id: string;
  club_id: string;
  player_name: string;
  ladder_position: number | null;
  status: string;
};
type Line = {
  id: string;
  matchup_id: string;
  line_type: 'singles' | 'doubles';
  line_number: number;
  home_player1_id: string | null;
  home_player2_id: string | null;
  away_player1_id: string | null;
  away_player2_id: string | null;
  score: string | null;
  winner: 'home' | 'away' | null;
  status: string;
  score_token: string | null;
};

export default function MatchupFacilitatorPage() {
  const params = useParams();
  const id = Array.isArray(params.id) ? params.id[0] : (params.id as string);
  const matchupId = Array.isArray(params.matchupId)
    ? params.matchupId[0]
    : (params.matchupId as string);

  const [matchup, setMatchup] = useState<Matchup | null>(null);
  const [division, setDivision] = useState<Division | null>(null);
  const [homeClub, setHomeClub] = useState<Club | null>(null);
  const [awayClub, setAwayClub] = useState<Club | null>(null);
  const [homeRosters, setHomeRosters] = useState<Roster[]>([]);
  const [awayRosters, setAwayRosters] = useState<Roster[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [checkedInIds, setCheckedInIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    const { data: m, error: mErr } = await supabase
      .from('league_team_matchups')
      .select('*')
      .eq('id', matchupId)
      .single();
    if (mErr || !m) {
      setError(mErr?.message || 'Matchup not found');
      setLoading(false);
      return;
    }
    const matchupRow = m as Matchup;
    setMatchup(matchupRow);

    const [dRes, cRes, rRes, lRes, ciRes] = await Promise.all([
      supabase.from('league_divisions').select('*').eq('id', matchupRow.division_id).single(),
      supabase
        .from('league_clubs')
        .select('*')
        .in('id', [matchupRow.home_club_id, matchupRow.away_club_id]),
      supabase
        .from('league_team_rosters')
        .select('id, division_id, club_id, player_name, ladder_position, status')
        .eq('division_id', matchupRow.division_id)
        .in('club_id', [matchupRow.home_club_id, matchupRow.away_club_id])
        .order('ladder_position', { nullsFirst: false }),
      supabase
        .from('league_matchup_lines')
        .select('*')
        .eq('matchup_id', matchupId)
        .order('line_number'),
      supabase
        .from('league_matchup_checkins')
        .select('roster_id')
        .eq('matchup_id', matchupId),
    ]);

    setDivision((dRes.data as Division) || null);
    const clubsList = (cRes.data as Club[]) || [];
    setHomeClub(clubsList.find(c => c.id === matchupRow.home_club_id) || null);
    setAwayClub(clubsList.find(c => c.id === matchupRow.away_club_id) || null);

    const rostersList = (rRes.data as Roster[]) || [];
    setHomeRosters(rostersList.filter(r => r.club_id === matchupRow.home_club_id));
    setAwayRosters(rostersList.filter(r => r.club_id === matchupRow.away_club_id));
    setLines((lRes.data as Line[]) || []);

    const ciList = ((ciRes.data as { roster_id: string }[]) || []).map(x => x.roster_id);
    setCheckedInIds(new Set(ciList));

    setLoading(false);
  }, [matchupId]);

  // Which rosters count as "available" for today:
  // - If any check-ins exist for this matchup, use only checked-in active players
  // - If none, fall back to all active roster players
  const activeHome = useMemo(
    () => homeRosters.filter(r => r.status === 'active'),
    [homeRosters]
  );
  const activeAway = useMemo(
    () => awayRosters.filter(r => r.status === 'active'),
    [awayRosters]
  );
  const hasCheckins = checkedInIds.size > 0;
  const availableHome = hasCheckins
    ? activeHome.filter(r => checkedInIds.has(r.id))
    : activeHome;
  const availableAway = hasCheckins
    ? activeAway.filter(r => checkedInIds.has(r.id))
    : activeAway;

  const courtsForThisMatchup =
    matchup?.courts_override ?? homeClub?.courts_available ?? 0;

  const optimizer = useMemo(
    () =>
      optimizeLines(courtsForThisMatchup, availableHome.length, availableAway.length),
    [courtsForThisMatchup, availableHome.length, availableAway.length]
  );

  const runAutoAssign = async () => {
    const patches = autoAssignByStrength(lines, availableHome, availableAway);
    if (patches.length === 0) {
      alert('All lines are already assigned — clear players first to re-auto-assign.');
      return;
    }
    const supabase = createClient();
    await Promise.all(
      patches.map(p =>
        supabase
          .from('league_matchup_lines')
          .update({
            home_player1_id: p.home_player1_id,
            home_player2_id: p.home_player2_id,
            away_player1_id: p.away_player1_id,
            away_player2_id: p.away_player2_id,
          })
          .eq('id', p.id)
      )
    );
    fetchAll();
  };

  const toggleCheckin = async (rosterId: string) => {
    const supabase = createClient();
    if (checkedInIds.has(rosterId)) {
      await supabase
        .from('league_matchup_checkins')
        .delete()
        .eq('matchup_id', matchupId)
        .eq('roster_id', rosterId);
      setCheckedInIds(prev => {
        const next = new Set(prev);
        next.delete(rosterId);
        return next;
      });
    } else {
      await supabase
        .from('league_matchup_checkins')
        .insert({ matchup_id: matchupId, roster_id: rosterId });
      setCheckedInIds(prev => new Set(prev).add(rosterId));
    }
  };

  const checkInAllActive = async (clubId: string) => {
    const roster = clubId === matchup?.home_club_id ? activeHome : activeAway;
    const missing = roster.filter(r => !checkedInIds.has(r.id));
    if (missing.length === 0) return;
    const supabase = createClient();
    await supabase.from('league_matchup_checkins').insert(
      missing.map(r => ({ matchup_id: matchupId, roster_id: r.id }))
    );
    setCheckedInIds(prev => {
      const next = new Set(prev);
      for (const r of missing) next.add(r.id);
      return next;
    });
  };

  const clearCheckins = async (clubId: string) => {
    const roster = clubId === matchup?.home_club_id ? activeHome : activeAway;
    const toClear = roster.filter(r => checkedInIds.has(r.id));
    if (toClear.length === 0) return;
    const supabase = createClient();
    await supabase
      .from('league_matchup_checkins')
      .delete()
      .eq('matchup_id', matchupId)
      .in(
        'roster_id',
        toClear.map(r => r.id)
      );
    setCheckedInIds(prev => {
      const next = new Set(prev);
      for (const r of toClear) next.delete(r.id);
      return next;
    });
  };

  const regenerateLines = async () => {
    const completed = lines.filter(l => l.status === 'completed');
    if (completed.length > 0) {
      if (
        !confirm(
          `${completed.length} line${completed.length === 1 ? '' : 's'} already scored. Regenerating will delete those results. Continue?`
        )
      )
        return;
    } else if (lines.some(l => l.home_player1_id || l.away_player1_id)) {
      if (!confirm('This will replace the current line layout. Continue?')) return;
    }
    const { singles, doubles } = optimizer;
    if (singles === 0 && doubles === 0) {
      alert(
        `Can't generate lines: ${
          optimizer.warning || 'No courts or no players checked in.'
        }`
      );
      return;
    }
    const skel = buildLineSkeleton(singles, doubles);
    const supabase = createClient();
    // Wipe existing lines, then insert the new skeleton. ON DELETE CASCADE
    // on the lines table takes the checkins' references with it — nope,
    // checkins reference rosters, not lines. Safe to just delete lines.
    await supabase.from('league_matchup_lines').delete().eq('matchup_id', matchupId);
    await supabase.from('league_matchup_lines').insert(
      skel.map(l => ({
        matchup_id: matchupId,
        line_type: l.line_type,
        line_number: l.line_number,
      }))
    );
    fetchAll();
  };

  const clearAllAssignments = async () => {
    if (!confirm('Clear all player assignments for this matchup?')) return;
    const supabase = createClient();
    await Promise.all(
      lines.map(l =>
        supabase
          .from('league_matchup_lines')
          .update({
            home_player1_id: null,
            home_player2_id: null,
            away_player1_id: null,
            away_player2_id: null,
          })
          .eq('id', l.id)
      )
    );
    fetchAll();
  };

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const updateLine = async (lineId: string, patch: Partial<Line>) => {
    setSaving(lineId);
    const supabase = createClient();
    const { error: updErr } = await supabase
      .from('league_matchup_lines')
      .update(patch)
      .eq('id', lineId);
    setSaving(null);
    if (updErr) {
      alert(`Failed: ${updErr.message}`);
      return;
    }
    fetchAll();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-orange-500" size={24} />
      </div>
    );
  }

  if (error || !matchup || !division || !homeClub || !awayClub) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 flex items-start gap-2">
          <AlertCircle size={16} className="mt-0.5" />
          <span>{error || 'Could not load matchup.'}</span>
        </div>
      </div>
    );
  }

  const dateLabel = new Date(matchup.match_date + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-4">
        <Link href={`/mixer/leagues/${id}/jtt`} className="p-2 hover:bg-gray-100 rounded-lg">
          <ArrowLeft size={20} />
        </Link>
        <div>
          <h1 className="font-semibold text-2xl text-gray-900">
            {awayClub.name} <span className="text-gray-400">@</span> {homeClub.name}
          </h1>
          <p className="text-gray-500 text-sm">
            {division.name} · {dateLabel}
            {division.start_time && ` · ${division.start_time.slice(0, 5)}`}
          </p>
        </div>
      </div>

      {/* Aggregate score */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-6 flex items-center justify-center gap-8">
        <TeamScore clubName={awayClub.name} side="Away" score={matchup.away_lines_won} isWinner={matchup.winner === 'away'} />
        <span className="text-gray-300 text-2xl">—</span>
        <TeamScore clubName={homeClub.name} side="Home" score={matchup.home_lines_won} isWinner={matchup.winner === 'home'} />
      </div>

      {/* Attendance / check-in */}
      <section className="bg-white border border-gray-200 rounded-xl p-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-gray-900 flex items-center gap-2">
            <UserCheck size={16} className="text-orange-500" />
            Today&apos;s attendance
          </h2>
          <span className="text-xs text-gray-500">
            {hasCheckins
              ? `${checkedInIds.size} checked in`
              : 'No check-ins yet (using full active roster)'}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <AttendanceColumn
            label={`Away · ${awayClub.name}`}
            rosters={activeAway}
            checkedInIds={checkedInIds}
            onToggle={toggleCheckin}
            onCheckAll={() => checkInAllActive(awayClub.id)}
            onClearAll={() => clearCheckins(awayClub.id)}
          />
          <AttendanceColumn
            label={`Home · ${homeClub.name}`}
            rosters={activeHome}
            checkedInIds={checkedInIds}
            onToggle={toggleCheckin}
            onCheckAll={() => checkInAllActive(homeClub.id)}
            onClearAll={() => clearCheckins(homeClub.id)}
          />
        </div>
      </section>

      {/* Courts + line optimizer summary */}
      <section className="bg-white border border-gray-200 rounded-xl p-4 mb-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="text-sm text-gray-600 mb-1">
              <span className="font-medium text-gray-900">{courtsForThisMatchup}</span>{' '}
              courts at {homeClub.name}
              {matchup.courts_override !== null && (
                <span className="text-xs text-orange-600 ml-2">(override for today)</span>
              )}
            </div>
            <div className="text-sm text-gray-600">
              Playing today:{' '}
              <span className="font-medium text-gray-900">{availableAway.length}</span> away
              vs{' '}
              <span className="font-medium text-gray-900">{availableHome.length}</span> home
            </div>
            <div className="mt-2 text-sm">
              Recommended:{' '}
              <span className="font-semibold text-gray-900">
                {optimizer.singles} singles + {optimizer.doubles} doubles
              </span>
              {optimizer.benchedHome + optimizer.benchedAway > 0 && (
                <span className="text-xs text-gray-500 ml-2">
                  ({optimizer.benchedHome + optimizer.benchedAway} sitting)
                </span>
              )}
            </div>
            {optimizer.warning && (
              <p className="mt-1 text-xs text-orange-700">{optimizer.warning}</p>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <button
              onClick={regenerateLines}
              disabled={optimizer.singles === 0 && optimizer.doubles === 0}
              className="inline-flex items-center gap-2 px-3 py-1.5 bg-gray-900 text-white rounded-md text-sm font-medium hover:bg-gray-800 disabled:opacity-50"
            >
              Regenerate lines from attendance
            </button>
            <CourtsOverrideInput
              value={matchup.courts_override}
              onSet={async v => {
                const supabase = createClient();
                await supabase
                  .from('league_team_matchups')
                  .update({ courts_override: v })
                  .eq('id', matchupId);
                fetchAll();
              }}
              defaultCourts={homeClub.courts_available}
            />
          </div>
        </div>
      </section>

      {/* Assignment controls */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <button
          onClick={runAutoAssign}
          className="inline-flex items-center gap-2 px-3 py-1.5 bg-orange-500 text-white rounded-md text-sm font-medium hover:bg-orange-600"
        >
          <Zap size={14} />
          Auto-assign by strength
        </button>
        <button
          onClick={clearAllAssignments}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 rounded-md text-sm text-gray-700 hover:bg-gray-50"
        >
          Clear all
        </button>
        <p className="text-xs text-gray-500">
          Pulls top-ranked players from the checked-in pool (or full active roster
          if nobody is checked in yet). Singles lines get #1, doubles get the next
          pair. Manual overrides stick.
        </p>
      </div>

      {/* Lines */}
      <div className="space-y-4">
        {lines.map(line => (
          <LineEditor
            key={line.id}
            line={line}
            homeRosters={homeRosters}
            awayRosters={awayRosters}
            homeClub={homeClub}
            awayClub={awayClub}
            onUpdate={patch => updateLine(line.id, patch)}
            saving={saving === line.id}
          />
        ))}
      </div>
    </div>
  );
}

function TeamScore({
  clubName,
  side,
  score,
  isWinner,
}: {
  clubName: string;
  side: string;
  score: number;
  isWinner: boolean;
}) {
  return (
    <div className="text-center">
      <div className="text-xs uppercase text-gray-400">{side}</div>
      <div className={`text-4xl font-bold ${isWinner ? 'text-green-600' : 'text-gray-900'}`}>
        {score}
      </div>
      <div className="text-sm text-gray-700 font-medium">{clubName}</div>
    </div>
  );
}

function LineEditor({
  line,
  homeRosters,
  awayRosters,
  homeClub,
  awayClub,
  onUpdate,
  saving,
}: {
  line: Line;
  homeRosters: Roster[];
  awayRosters: Roster[];
  homeClub: Club;
  awayClub: Club;
  onUpdate: (patch: Partial<Line>) => void;
  saving: boolean;
}) {
  const [score, setScore] = useState(line.score || '');
  const [status, setStatus] = useState(line.status);

  const isDoubles = line.line_type === 'doubles';

  const submit = () => {
    onUpdate({
      score: score.trim() || null,
      status,
    });
  };

  const setWinner = (winner: 'home' | 'away' | null) => {
    onUpdate({
      winner,
      status: winner ? 'completed' : 'pending',
    });
  };

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="font-semibold text-gray-900">
            Line {line.line_number} · {isDoubles ? 'Doubles' : 'Singles'}
          </h3>
        </div>
        <div className="flex items-center gap-2">
          <CopyScoringLink token={line.score_token} />
          <span
            className={`px-2 py-0.5 rounded-full text-xs font-medium ${
              line.status === 'completed'
                ? 'bg-green-100 text-green-700'
                : line.status === 'in_progress'
                ? 'bg-blue-100 text-blue-700'
                : 'bg-gray-100 text-gray-600'
            }`}
          >
            {line.status.replace('_', ' ')}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-3">
        <div>
          <div className="text-xs font-medium text-gray-500 uppercase mb-1">
            Away · {awayClub.name}
          </div>
          <PlayerPicker
            rosters={awayRosters}
            value={line.away_player1_id}
            onChange={v => onUpdate({ away_player1_id: v })}
            placeholder={isDoubles ? 'Player 1' : 'Player'}
          />
          {isDoubles && (
            <div className="mt-2">
              <PlayerPicker
                rosters={awayRosters}
                value={line.away_player2_id}
                onChange={v => onUpdate({ away_player2_id: v })}
                placeholder="Player 2"
              />
            </div>
          )}
        </div>

        <div>
          <div className="text-xs font-medium text-gray-500 uppercase mb-1">
            Home · {homeClub.name}
          </div>
          <PlayerPicker
            rosters={homeRosters}
            value={line.home_player1_id}
            onChange={v => onUpdate({ home_player1_id: v })}
            placeholder={isDoubles ? 'Player 1' : 'Player'}
          />
          {isDoubles && (
            <div className="mt-2">
              <PlayerPicker
                rosters={homeRosters}
                value={line.home_player2_id}
                onChange={v => onUpdate({ home_player2_id: v })}
                placeholder="Player 2"
              />
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-2 items-center">
        <input
          value={score}
          onChange={e => setScore(e.target.value)}
          onBlur={submit}
          placeholder="Score, e.g. 6-3, 6-4"
          className="px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-900"
        />
        <div className="flex gap-1">
          <button
            onClick={() => setWinner('away')}
            disabled={saving}
            className={`px-3 py-2 rounded-md text-sm font-medium ${
              line.winner === 'away'
                ? 'bg-orange-500 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {awayClub.short_code} won
          </button>
          <button
            onClick={() => setWinner('home')}
            disabled={saving}
            className={`px-3 py-2 rounded-md text-sm font-medium ${
              line.winner === 'home'
                ? 'bg-orange-500 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {homeClub.short_code} won
          </button>
        </div>
        {line.winner && (
          <button
            onClick={() => setWinner(null)}
            className="text-gray-400 hover:text-red-600 p-2"
            title="Clear result"
          >
            <Trash2 size={16} />
          </button>
        )}
      </div>
    </div>
  );
}

function AttendanceColumn({
  label,
  rosters,
  checkedInIds,
  onToggle,
  onCheckAll,
  onClearAll,
}: {
  label: string;
  rosters: Roster[];
  checkedInIds: Set<string>;
  onToggle: (rosterId: string) => void;
  onCheckAll: () => void;
  onClearAll: () => void;
}) {
  const here = rosters.filter(r => checkedInIds.has(r.id)).length;
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <div className="text-xs font-medium text-gray-500 uppercase">{label}</div>
        <div className="text-xs text-gray-400">
          {here}/{rosters.length} here
        </div>
      </div>
      {rosters.length === 0 ? (
        <p className="text-xs text-gray-400 italic">No active roster.</p>
      ) : (
        <>
          <div className="border border-gray-200 rounded-md divide-y divide-gray-100 mb-2">
            {rosters
              .sort((a, b) => (a.ladder_position ?? 9999) - (b.ladder_position ?? 9999))
              .map(r => {
                const checked = checkedInIds.has(r.id);
                return (
                  <label
                    key={r.id}
                    className={`flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer ${
                      checked ? 'bg-green-50' : ''
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => onToggle(r.id)}
                      className="w-4 h-4"
                    />
                    <span className="w-5 text-right text-gray-400 text-xs">
                      {r.ladder_position ? `#${r.ladder_position}` : '—'}
                    </span>
                    <span className="flex-1 text-gray-900">{r.player_name}</span>
                  </label>
                );
              })}
          </div>
          <div className="flex gap-2">
            <button
              onClick={onCheckAll}
              className="text-xs text-orange-600 hover:text-orange-700"
            >
              Check all
            </button>
            <span className="text-gray-300">·</span>
            <button
              onClick={onClearAll}
              className="text-xs text-gray-500 hover:text-gray-800"
            >
              Clear
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function CourtsOverrideInput({
  value,
  onSet,
  defaultCourts,
}: {
  value: number | null;
  onSet: (v: number | null) => void;
  defaultCourts: number;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>(value?.toString() ?? '');

  if (!editing) {
    return (
      <button
        onClick={() => {
          setDraft(value?.toString() ?? '');
          setEditing(true);
        }}
        className="text-xs text-gray-500 hover:text-gray-800 underline"
      >
        {value === null ? `Override courts (default ${defaultCourts})` : 'Edit court override'}
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        min={0}
        max={20}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        placeholder={`${defaultCourts}`}
        className="w-16 px-2 py-1 text-sm border border-gray-300 rounded text-gray-900"
      />
      <button
        onClick={() => {
          const parsed = draft === '' ? null : parseInt(draft, 10);
          onSet(Number.isNaN(parsed) ? null : parsed);
          setEditing(false);
        }}
        className="text-xs px-2 py-1 bg-gray-900 text-white rounded"
      >
        Set
      </button>
      <button
        onClick={() => {
          onSet(null);
          setEditing(false);
        }}
        className="text-xs text-gray-500"
      >
        Reset
      </button>
    </div>
  );
}

function CopyScoringLink({ token }: { token: string | null }) {
  const [copied, setCopied] = useState(false);
  if (!token) return null;
  const url =
    typeof window !== 'undefined'
      ? `${window.location.origin}/leagues/line/${token}`
      : `/leagues/line/${token}`;
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          prompt('Copy this scoring link:', url);
        }
      }}
      title="Copy magic-link for this line"
      className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800"
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
      {copied ? 'Copied!' : 'Score link'}
    </button>
  );
}

function PlayerPicker({
  rosters,
  value,
  onChange,
  placeholder,
}: {
  rosters: Roster[];
  value: string | null;
  onChange: (v: string | null) => void;
  placeholder: string;
}) {
  return (
    <select
      value={value || ''}
      onChange={e => onChange(e.target.value || null)}
      className="w-full px-2 py-1.5 border border-gray-300 rounded-md text-sm text-gray-900"
    >
      <option value="">{placeholder} — choose —</option>
      {rosters.map(r => (
        <option key={r.id} value={r.id}>
          {r.ladder_position ? `#${r.ladder_position} ` : ''}
          {r.player_name}
        </option>
      ))}
    </select>
  );
}
