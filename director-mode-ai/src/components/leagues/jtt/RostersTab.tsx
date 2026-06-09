'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  UserPlus,
  Trash2,
  X,
  Save,
  Shuffle,
  Sparkles,
  GripVertical,
} from 'lucide-react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { createClient } from '@/lib/supabase/client';
import type {
  JTTClub,
  JTTDivision,
  JTTDivisionClub,
  JTTRoster,
  JTTLine,
  JTTMatchup,
} from '@/app/mixer/leagues/[id]/jtt/page';
import { DAY_OF_WEEK_LABELS } from '@/lib/jtt';

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
                      <button
                        onClick={() => openAdd(division.id, club.id)}
                        className="inline-flex items-center gap-1 text-sm text-orange-600 hover:text-orange-700"
                      >
                        <UserPlus size={14} />
                        Add player
                      </button>
                    </div>

                    {teamRosters.length === 0 && !isAdding && (
                      <p className="text-xs text-gray-400 py-2">No roster yet.</p>
                    )}

                    {teamRosters.length > 0 && (
                      <SortableTeamRoster
                        teamRosters={teamRosters}
                        records={recordsByRoster}
                        onRemove={remove}
                      />
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

type TeamRecord = { wins: number; losses: number };

/**
 * One club's roster in one division: drag-to-reorder tiles + a Save button.
 * Reordering is local (no DB write / no refetch) until "Save order" is clicked,
 * so the page never jumps. Resyncs from props only when the set of players
 * changes (add/remove), so an unsaved drag is never clobbered.
 */
function SortableTeamRoster({
  teamRosters,
  records,
  onRemove,
}: {
  teamRosters: JTTRoster[];
  records: Map<string, TeamRecord>;
  onRemove: (rosterId: string) => void;
}) {
  const [items, setItems] = useState<JTTRoster[]>(teamRosters);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // Resync from props only when the player set changes (add/remove). Identity
  // of teamRosters changes every render, so key off the sorted id list.
  const idSig = [...teamRosters].map(r => r.id).sort().join(',');
  useEffect(() => {
    setItems(teamRosters);
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idSig]);

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = items.findIndex(r => r.id === active.id);
    const newIndex = items.findIndex(r => r.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    setItems(arrayMove(items, oldIndex, newIndex));
    setDirty(true);
  };

  const sortByRecord = () => {
    const sorted = [...items].sort((a, b) => {
      const ra = records.get(a.id) || { wins: 0, losses: 0 };
      const rb = records.get(b.id) || { wins: 0, losses: 0 };
      const diff = rb.wins - rb.losses - (ra.wins - ra.losses);
      if (diff !== 0) return diff;
      return rb.wins - ra.wins;
    });
    setItems(sorted);
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    const supabase = createClient();
    const changed = items
      .map((r, i) => ({ r, pos: i + 1 }))
      .filter(({ r, pos }) => r.ladder_position !== pos);
    await Promise.all(
      changed.map(({ r, pos }) =>
        supabase.from('league_team_rosters').update({ ladder_position: pos }).eq('id', r.id)
      )
    );
    // Reflect saved positions locally so the dirty diff is clean afterward.
    setItems(prev => prev.map((r, i) => ({ ...r, ladder_position: i + 1 })));
    setSaving(false);
    setDirty(false);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        {items.length > 1 ? (
          <button
            onClick={sortByRecord}
            className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800"
            title="Reorder by current W-L (review, then Save)"
          >
            <Shuffle size={13} />
            Sort by W-L
          </button>
        ) : (
          <span />
        )}
        {dirty && (
          <button
            onClick={save}
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-3 py-1 bg-orange-500 text-white rounded-md text-xs font-medium hover:bg-orange-600 disabled:opacity-50"
          >
            <Save size={13} />
            {saving ? 'Saving…' : 'Save order'}
          </button>
        )}
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={items} strategy={verticalListSortingStrategy}>
          <div className="space-y-1.5">
            {items.map((r, i) => (
              <SortableRosterTile
                key={r.id}
                roster={r}
                index={i}
                record={records.get(r.id)}
                onRemove={() => onRemove(r.id)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}

function SortableRosterTile({
  roster,
  index,
  record,
  onRemove,
}: {
  roster: JTTRoster;
  index: number;
  record?: TeamRecord;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: roster.id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 px-2 py-2 text-sm bg-white border border-gray-200 rounded-lg"
    >
      <button
        type="button"
        {...listeners}
        {...attributes}
        className="cursor-grab active:cursor-grabbing touch-none p-1 text-gray-400 hover:text-gray-600"
        title="Drag to reorder"
      >
        <GripVertical size={16} />
      </button>
      <span className="w-6 text-right text-gray-400">{index + 1}.</span>
      <span className="flex-1 text-gray-900">{roster.player_name}</span>
      {record && record.wins + record.losses > 0 && (
        <span className="text-xs font-medium text-gray-700">
          {record.wins}–{record.losses}
        </span>
      )}
      {roster.utr && <span className="text-xs text-gray-500">UTR {roster.utr}</span>}
      {roster.ntrp && <span className="text-xs text-gray-500">NTRP {roster.ntrp}</span>}
      <button
        onClick={onRemove}
        className="text-gray-400 hover:text-red-600 p-1"
        title="Remove"
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}
