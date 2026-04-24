'use client';

import { useMemo, useState } from 'react';
import {
  UserPlus,
  Trash2,
  X,
  Save,
  ArrowUp,
  ArrowDown,
  Shuffle,
  Sparkles,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import type {
  JTTClub,
  JTTDivision,
  JTTDivisionClub,
  JTTRoster,
  JTTLine,
  JTTMatchup,
} from '@/app/mixer/leagues/[id]/jtt/page';
import { DAY_OF_WEEK_LABELS, recomputeLadder } from '@/lib/jtt';

type Props = {
  leagueId: string;
  clubs: JTTClub[];
  divisions: JTTDivision[];
  divisionClubs: JTTDivisionClub[];
  rosters: JTTRoster[];
  matchups?: JTTMatchup[];
  lines?: JTTLine[];
  onRefresh: () => void;
};

type AddingContext = { divisionId: string; clubId: string } | null;

export default function RostersTab({
  leagueId,
  clubs,
  divisions,
  divisionClubs,
  rosters,
  matchups = [],
  lines = [],
  onRefresh,
}: Props) {
  const [seedingFake, setSeedingFake] = useState(false);
  const [seedMsg, setSeedMsg] = useState<string | null>(null);

  const seedFakeRosters = async (overwrite: boolean) => {
    if (
      overwrite &&
      !confirm(
        'Wipe and replace ALL existing rosters with fake test data? This deletes everything currently in the rosters.'
      )
    )
      return;
    setSeedingFake(true);
    setSeedMsg(null);
    try {
      const res = await fetch(`/api/leagues/${leagueId}/seed-fake-rosters`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playersPerTeam: 8, overwrite }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setSeedMsg(
        body.inserted > 0
          ? `Added ${body.inserted} fake players across ${body.teamsSeeded} teams.`
          : body.note || 'Nothing inserted.'
      );
      onRefresh();
    } catch (e: any) {
      setSeedMsg(`Failed: ${e.message}`);
    } finally {
      setSeedingFake(false);
    }
  };
  const [adding, setAdding] = useState<AddingContext>(null);
  const [form, setForm] = useState({
    player_name: '',
    player_email: '',
    parent_name: '',
    parent_email: '',
    parent_phone: '',
    utr: '',
    ntrp: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clubsById = useMemo(() => {
    const m = new Map<string, JTTClub>();
    for (const c of clubs) m.set(c.id, c);
    return m;
  }, [clubs]);

  const clubsForDivision = (divisionId: string): JTTClub[] =>
    divisionClubs
      .filter(dc => dc.division_id === divisionId)
      .map(dc => clubsById.get(dc.club_id))
      .filter((c): c is JTTClub => !!c)
      .sort((a, b) => a.sort_order - b.sort_order);

  const rostersFor = (divisionId: string, clubId: string): JTTRoster[] =>
    rosters
      .filter(r => r.division_id === divisionId && r.club_id === clubId)
      .sort(
        (a, b) =>
          (a.ladder_position ?? 999) - (b.ladder_position ?? 999) ||
          a.player_name.localeCompare(b.player_name)
      );

  // Per-roster season W-L aggregated from completed lines (across singles + doubles)
  const recordsByRoster = useMemo(() => {
    const acc = new Map<string, { wins: number; losses: number }>();
    for (const line of lines) {
      if (line.status !== 'completed' || !line.winner) continue;
      const home = [line.home_player1_id, line.home_player2_id].filter(Boolean) as string[];
      const away = [line.away_player1_id, line.away_player2_id].filter(Boolean) as string[];
      const winners = line.winner === 'home' ? home : away;
      const losers = line.winner === 'home' ? away : home;
      for (const id of winners) {
        const r = acc.get(id) || { wins: 0, losses: 0 };
        r.wins += 1;
        acc.set(id, r);
      }
      for (const id of losers) {
        const r = acc.get(id) || { wins: 0, losses: 0 };
        r.losses += 1;
        acc.set(id, r);
      }
    }
    return acc;
  }, [lines]);

  const [reladdering, setReladdering] = useState<string | null>(null);

  const reladder = async (divisionId: string, clubId: string) => {
    const teamRosters = rostersFor(divisionId, clubId);
    if (teamRosters.length === 0) return;
    const divisionLines = lines.filter(l =>
      matchups.some(m => m.id === l.matchup_id && m.division_id === divisionId)
    );
    const updates = recomputeLadder(teamRosters, divisionLines);
    if (updates.length === 0) return;

    setReladdering(`${divisionId}:${clubId}`);
    const supabase = createClient();
    // Apply in parallel — positions are independent
    await Promise.all(
      updates.map(u =>
        supabase
          .from('league_team_rosters')
          .update({ ladder_position: u.newPosition })
          .eq('id', u.rosterId)
      )
    );
    setReladdering(null);
    onRefresh();
  };

  const openAdd = (divisionId: string, clubId: string) => {
    setAdding({ divisionId, clubId });
    setForm({
      player_name: '',
      player_email: '',
      parent_name: '',
      parent_email: '',
      parent_phone: '',
      utr: '',
      ntrp: '',
    });
    setError(null);
  };

  const submitAdd = async () => {
    if (!adding) return;
    if (!form.player_name.trim()) {
      setError('Player name is required.');
      return;
    }
    setSaving(true);
    setError(null);
    const supabase = createClient();
    const existing = rostersFor(adding.divisionId, adding.clubId);
    const nextLadder =
      (existing.reduce((max, r) => Math.max(max, r.ladder_position ?? 0), 0) || 0) + 1;

    const { error: insertErr } = await supabase.from('league_team_rosters').insert({
      division_id: adding.divisionId,
      club_id: adding.clubId,
      player_name: form.player_name.trim(),
      player_email: form.player_email.trim() || null,
      parent_name: form.parent_name.trim() || null,
      parent_email: form.parent_email.trim() || null,
      parent_phone: form.parent_phone.trim() || null,
      utr: form.utr ? parseFloat(form.utr) : null,
      ntrp: form.ntrp ? parseFloat(form.ntrp) : null,
      ladder_position: nextLadder,
    });

    setSaving(false);
    if (insertErr) {
      setError(insertErr.message);
      return;
    }
    setAdding(null);
    onRefresh();
  };

  const remove = async (rosterId: string) => {
    if (!confirm('Remove this player from the roster?')) return;
    const supabase = createClient();
    await supabase.from('league_team_rosters').delete().eq('id', rosterId);
    onRefresh();
  };

  const swapLadder = async (a: JTTRoster, b: JTTRoster) => {
    const supabase = createClient();
    await Promise.all([
      supabase
        .from('league_team_rosters')
        .update({ ladder_position: b.ladder_position })
        .eq('id', a.id),
      supabase
        .from('league_team_rosters')
        .update({ ladder_position: a.ladder_position })
        .eq('id', b.id),
    ]);
    onRefresh();
  };

  const move = (divisionId: string, clubId: string, rosterId: string, dir: -1 | 1) => {
    const list = rostersFor(divisionId, clubId);
    const idx = list.findIndex(r => r.id === rosterId);
    const other = list[idx + dir];
    if (!other) return;
    swapLadder(list[idx], other);
  };

  if (divisions.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6 text-gray-500 text-sm">
        No divisions set up yet. Use the seed endpoint or add divisions on the Settings tab.
      </div>
    );
  }

  const totalRosterCount = rosters.length;

  return (
    <div className="space-y-6">
      {/* Test-data helper — visible as long as rosters are sparse */}
      {totalRosterCount < 10 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <Sparkles size={18} className="text-amber-600 mt-0.5" />
            <div className="flex-1">
              <h4 className="font-semibold text-amber-900 text-sm">
                Need test data?
              </h4>
              <p className="text-xs text-amber-800 mb-2">
                Fill every team with 8 fake players so you can try check-in,
                auto-assign, and the line optimizer end-to-end before your real
                rosters land.
              </p>
              <div className="flex flex-wrap gap-2 mb-2">
                <button
                  onClick={() => seedFakeRosters(false)}
                  disabled={seedingFake}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 text-white rounded text-xs font-medium hover:bg-amber-700 disabled:opacity-50"
                >
                  <Sparkles size={12} />
                  {seedingFake ? 'Seeding...' : 'Seed fake rosters'}
                </button>
                <button
                  onClick={() => seedFakeRosters(true)}
                  disabled={seedingFake}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-amber-600 text-amber-700 rounded text-xs font-medium hover:bg-amber-100 disabled:opacity-50"
                >
                  Wipe &amp; reseed
                </button>
              </div>
              {seedMsg && (
                <p className="text-xs text-amber-900 mt-1">{seedMsg}</p>
              )}
            </div>
          </div>
        </div>
      )}

      {divisions.map(division => {
        const divisionClubList = clubsForDivision(division.id);
        return (
          <section key={division.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <header className="px-4 py-3 border-b border-gray-200 bg-gray-50">
              <div className="flex items-baseline gap-3">
                <h3 className="font-semibold text-gray-900">{division.name}</h3>
                <span className="text-xs text-gray-500">
                  {division.day_of_week !== null
                    ? `${DAY_OF_WEEK_LABELS[division.day_of_week]}s`
                    : ''}
                  {division.start_time
                    ? ` · ${division.start_time.slice(0, 5)}–${division.end_time?.slice(0, 5)}`
                    : ''}
                </span>
              </div>
            </header>

            <div className="divide-y divide-gray-100">
              {divisionClubList.map(club => {
                const teamRosters = rostersFor(division.id, club.id);
                const isAdding =
                  adding?.divisionId === division.id && adding?.clubId === club.id;
                return (
                  <div key={club.id} className="p-4">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-medium text-gray-800">
                        {club.name}{' '}
                        <span className="text-xs text-gray-400">
                          ({teamRosters.length} {teamRosters.length === 1 ? 'player' : 'players'})
                        </span>
                      </h4>
                      <div className="flex items-center gap-3">
                        {teamRosters.length > 1 && (
                          <button
                            onClick={() => reladder(division.id, club.id)}
                            disabled={reladdering === `${division.id}:${club.id}`}
                            className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800 disabled:opacity-50"
                            title="Reorder by current W-L"
                          >
                            <Shuffle size={13} />
                            {reladdering === `${division.id}:${club.id}`
                              ? 'Reordering...'
                              : 'Re-ladder by W-L'}
                          </button>
                        )}
                        <button
                          onClick={() => openAdd(division.id, club.id)}
                          className="inline-flex items-center gap-1 text-sm text-orange-600 hover:text-orange-700"
                        >
                          <UserPlus size={14} />
                          Add player
                        </button>
                      </div>
                    </div>

                    {teamRosters.length === 0 && !isAdding && (
                      <p className="text-xs text-gray-400 py-2">No roster yet.</p>
                    )}

                    {teamRosters.length > 0 && (
                      <ol className="divide-y divide-gray-100 border border-gray-100 rounded-md">
                        {teamRosters.map((r, i) => {
                          const rec = recordsByRoster.get(r.id);
                          return (
                          <li key={r.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                            <span className="w-6 text-right text-gray-400">{i + 1}.</span>
                            <span className="flex-1 text-gray-900">{r.player_name}</span>
                            {rec && (rec.wins + rec.losses > 0) && (
                              <span className="text-xs font-medium text-gray-700">
                                {rec.wins}–{rec.losses}
                              </span>
                            )}
                            {r.utr && (
                              <span className="text-xs text-gray-500">UTR {r.utr}</span>
                            )}
                            {r.ntrp && (
                              <span className="text-xs text-gray-500">NTRP {r.ntrp}</span>
                            )}
                            <button
                              onClick={() => move(division.id, club.id, r.id, -1)}
                              disabled={i === 0}
                              className="text-gray-400 hover:text-gray-700 disabled:opacity-30"
                              title="Move up"
                            >
                              <ArrowUp size={14} />
                            </button>
                            <button
                              onClick={() => move(division.id, club.id, r.id, 1)}
                              disabled={i === teamRosters.length - 1}
                              className="text-gray-400 hover:text-gray-700 disabled:opacity-30"
                              title="Move down"
                            >
                              <ArrowDown size={14} />
                            </button>
                            <button
                              onClick={() => remove(r.id)}
                              className="text-gray-400 hover:text-red-600"
                              title="Remove"
                            >
                              <Trash2 size={14} />
                            </button>
                          </li>
                          );
                        })}
                      </ol>
                    )}

                    {isAdding && (
                      <div className="mt-3 p-3 bg-orange-50 border border-orange-200 rounded-md space-y-2">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <input
                            placeholder="Player name *"
                            value={form.player_name}
                            onChange={e => setForm({ ...form, player_name: e.target.value })}
                            className="px-2 py-1 border border-gray-300 rounded text-sm text-gray-900"
                          />
                          <input
                            placeholder="Player email"
                            value={form.player_email}
                            onChange={e => setForm({ ...form, player_email: e.target.value })}
                            className="px-2 py-1 border border-gray-300 rounded text-sm text-gray-900"
                          />
                          <input
                            placeholder="Parent name"
                            value={form.parent_name}
                            onChange={e => setForm({ ...form, parent_name: e.target.value })}
                            className="px-2 py-1 border border-gray-300 rounded text-sm text-gray-900"
                          />
                          <input
                            placeholder="Parent email"
                            value={form.parent_email}
                            onChange={e => setForm({ ...form, parent_email: e.target.value })}
                            className="px-2 py-1 border border-gray-300 rounded text-sm text-gray-900"
                          />
                          <input
                            placeholder="Parent phone"
                            value={form.parent_phone}
                            onChange={e => setForm({ ...form, parent_phone: e.target.value })}
                            className="px-2 py-1 border border-gray-300 rounded text-sm text-gray-900"
                          />
                          <div className="flex gap-2">
                            <input
                              placeholder="UTR"
                              type="number"
                              step="0.01"
                              value={form.utr}
                              onChange={e => setForm({ ...form, utr: e.target.value })}
                              className="flex-1 px-2 py-1 border border-gray-300 rounded text-sm text-gray-900"
                            />
                            <input
                              placeholder="NTRP"
                              type="number"
                              step="0.5"
                              value={form.ntrp}
                              onChange={e => setForm({ ...form, ntrp: e.target.value })}
                              className="flex-1 px-2 py-1 border border-gray-300 rounded text-sm text-gray-900"
                            />
                          </div>
                        </div>
                        {error && (
                          <p className="text-xs text-red-600">{error}</p>
                        )}
                        <div className="flex items-center gap-2">
                          <button
                            onClick={submitAdd}
                            disabled={saving}
                            className="inline-flex items-center gap-1 px-3 py-1 bg-orange-500 text-white rounded text-sm hover:bg-orange-600 disabled:opacity-50"
                          >
                            <Save size={14} />
                            {saving ? 'Saving...' : 'Save'}
                          </button>
                          <button
                            onClick={() => setAdding(null)}
                            className="inline-flex items-center gap-1 px-3 py-1 border border-gray-300 rounded text-sm text-gray-700 hover:bg-gray-50"
                          >
                            <X size={14} />
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
