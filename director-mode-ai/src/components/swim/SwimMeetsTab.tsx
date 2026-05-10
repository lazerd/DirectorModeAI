'use client';

import { useState } from 'react';
import { Plus, Trash2, Edit3, Loader2, Calendar, MapPin } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { SwimMeet, SwimJob } from '@/app/swim/[id]/page';

export default function SwimMeetsTab({
  seasonId,
  meets,
  jobs,
  onRefresh,
}: {
  seasonId: string;
  meets: SwimMeet[];
  jobs: SwimJob[];
  onRefresh: () => Promise<void> | void;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '',
    meet_date: '',
    location: '',
    opponent: '',
    notes: '',
  });

  const reset = () => {
    setForm({ name: '', meet_date: '', location: '', opponent: '', notes: '' });
    setShowAdd(false);
    setEditing(null);
    setError(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy('save');
    const payload = {
      season_id: seasonId,
      name: form.name.trim(),
      meet_date: form.meet_date || null,
      location: form.location.trim() || null,
      opponent: form.opponent.trim() || null,
      notes: form.notes.trim() || null,
    };
    const { error: err } = editing
      ? await supabase.from('swim_meets').update(payload).eq('id', editing)
      : await supabase.from('swim_meets').insert(payload);
    if (err) {
      setError(err.message);
      setBusy(null);
      return;
    }
    reset();
    await onRefresh();
    setBusy(null);
  };

  const startEdit = (m: SwimMeet) => {
    setEditing(m.id);
    setForm({
      name: m.name,
      meet_date: m.meet_date ?? '',
      location: m.location ?? '',
      opponent: m.opponent ?? '',
      notes: m.notes ?? '',
    });
    setShowAdd(true);
  };

  const remove = async (id: string) => {
    if (!confirm('Delete this meet? Jobs assigned to it become standalone.')) return;
    setBusy(id);
    await supabase.from('swim_meets').delete().eq('id', id);
    await onRefresh();
    setBusy(null);
  };

  const sorted = [...meets].sort((a, b) => {
    if (a.meet_date && b.meet_date) return a.meet_date.localeCompare(b.meet_date);
    if (a.meet_date) return -1;
    if (b.meet_date) return 1;
    return a.name.localeCompare(b.name);
  });

  const jobCountByMeet = new Map<string, number>();
  for (const j of jobs) {
    if (j.meet_id) {
      jobCountByMeet.set(j.meet_id, (jobCountByMeet.get(j.meet_id) ?? 0) + 1);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-lg text-gray-900">Meets</h2>
          <p className="text-sm text-gray-600">
            Create a meet, then add jobs to it (in the Jobs tab) so families can sign up.
          </p>
        </div>
        <button
          onClick={() => (showAdd ? reset() : setShowAdd(true))}
          className="inline-flex items-center gap-2 px-3 py-2 bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg text-sm font-semibold"
        >
          <Plus size={14} />
          {showAdd ? 'Cancel' : 'Add meet'}
        </button>
      </div>

      {showAdd && (
        <form onSubmit={submit} className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
          <h3 className="font-semibold">{editing ? 'Edit meet' : 'Add meet'}</h3>
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-gray-700 mb-1">Meet name *</label>
              <input
                type="text"
                required
                placeholder='e.g. "Home vs Lamorinda" or "League Championships"'
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg text-gray-900 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Date</label>
              <input
                type="date"
                value={form.meet_date}
                onChange={(e) => setForm({ ...form, meet_date: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg text-gray-900 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Opponent</label>
              <input
                type="text"
                value={form.opponent}
                onChange={(e) => setForm({ ...form, opponent: e.target.value })}
                placeholder="e.g. Lamorinda Sharks"
                className="w-full px-3 py-2 border rounded-lg text-gray-900 text-sm"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-gray-700 mb-1">Location</label>
              <input
                type="text"
                value={form.location}
                onChange={(e) => setForm({ ...form, location: e.target.value })}
                placeholder="Pool name / address"
                className="w-full px-3 py-2 border rounded-lg text-gray-900 text-sm"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-gray-700 mb-1">Notes</label>
              <textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                rows={2}
                className="w-full px-3 py-2 border rounded-lg text-gray-900 text-sm"
              />
            </div>
          </div>
          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-2">
              {error}
            </div>
          )}
          <button
            type="submit"
            disabled={busy === 'save' || !form.name.trim()}
            className="px-4 py-2 bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg text-sm font-medium disabled:opacity-50 inline-flex items-center gap-2"
          >
            {busy === 'save' && <Loader2 size={14} className="animate-spin" />}
            {editing ? 'Save changes' : 'Add meet'}
          </button>
        </form>
      )}

      {sorted.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center text-sm text-gray-500">
          No meets yet. Add the first one above.
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 gap-3">
          {sorted.map((m) => {
            const count = jobCountByMeet.get(m.id) ?? 0;
            return (
              <div key={m.id} className="bg-white border border-gray-200 rounded-xl p-4">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-gray-900 truncate">{m.name}</h3>
                    {m.opponent && (
                      <p className="text-xs text-gray-600">vs {m.opponent}</p>
                    )}
                  </div>
                  <div className="flex gap-1">
                    <button
                      onClick={() => startEdit(m)}
                      className="p-1.5 hover:bg-cyan-50 text-cyan-600 rounded"
                    >
                      <Edit3 size={14} />
                    </button>
                    <button
                      onClick={() => remove(m.id)}
                      disabled={busy === m.id}
                      className="p-1.5 hover:bg-red-50 text-red-500 rounded"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                <div className="space-y-1 text-xs text-gray-600">
                  {m.meet_date && (
                    <div className="flex items-center gap-1.5">
                      <Calendar size={11} className="text-cyan-500" /> {m.meet_date}
                    </div>
                  )}
                  {m.location && (
                    <div className="flex items-center gap-1.5">
                      <MapPin size={11} className="text-cyan-500" /> {m.location}
                    </div>
                  )}
                  <div className="text-cyan-700 font-medium pt-1">
                    {count} {count === 1 ? 'job' : 'jobs'} attached
                  </div>
                </div>
                {m.notes && (
                  <p className="text-xs text-gray-500 mt-2 italic">{m.notes}</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
