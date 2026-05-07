'use client';

import { useState } from 'react';
import { Plus, Trash2, Edit3, Loader2, Briefcase, Calendar } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { SwimJob, SwimMeet } from '@/app/swim/[id]/page';

export default function SwimJobsTab({
  seasonId,
  jobs,
  meets,
  onRefresh,
}: {
  seasonId: string;
  jobs: SwimJob[];
  meets: SwimMeet[];
  onRefresh: () => Promise<void> | void;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [presetMeet, setPresetMeet] = useState<string | ''>('');
  const [form, setForm] = useState({
    name: '',
    description: '',
    points: 1,
    job_date: '',
    slots: '' as string | number,
    meet_id: '' as string | '',
  });

  const reset = () => {
    setForm({
      name: '',
      description: '',
      points: 1,
      job_date: '',
      slots: '',
      meet_id: '',
    });
    setShowAdd(false);
    setEditing(null);
    setPresetMeet('');
  };

  const beginAddForMeet = (meetId: string) => {
    const meet = meets.find((m) => m.id === meetId);
    setForm({
      name: '',
      description: '',
      points: 1,
      job_date: meet?.meet_date ?? '',
      slots: '',
      meet_id: meetId,
    });
    setShowAdd(true);
    setEditing(null);
    setPresetMeet(meetId);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy('save');
    const payload = {
      season_id: seasonId,
      name: form.name.trim(),
      description: form.description.trim() || null,
      points: form.points,
      job_date: form.job_date || null,
      slots: form.slots === '' ? null : parseInt(String(form.slots), 10),
      meet_id: form.meet_id || null,
    };
    const { error: err } = editing
      ? await supabase.from('swim_jobs').update(payload).eq('id', editing)
      : await supabase.from('swim_jobs').insert(payload);
    if (err) {
      setError(err.message);
      setBusy(null);
      return;
    }
    reset();
    await onRefresh();
    setBusy(null);
  };

  const startEdit = (job: SwimJob) => {
    setEditing(job.id);
    setForm({
      name: job.name,
      description: job.description ?? '',
      points: job.points,
      job_date: job.job_date ?? '',
      slots: job.slots ?? '',
      meet_id: job.meet_id ?? '',
    });
    setShowAdd(true);
    setPresetMeet('');
  };

  const remove = async (id: string) => {
    if (!confirm('Delete this job? Existing assignments stay (snapshot points).')) return;
    setBusy(id);
    await supabase.from('swim_jobs').delete().eq('id', id);
    await onRefresh();
    setBusy(null);
  };

  const meetById = new Map(meets.map((m) => [m.id, m]));
  const sortedMeets = [...meets].sort((a, b) => {
    if (a.meet_date && b.meet_date) return a.meet_date.localeCompare(b.meet_date);
    if (a.meet_date) return -1;
    if (b.meet_date) return 1;
    return a.name.localeCompare(b.name);
  });

  const jobsByMeet = new Map<string, SwimJob[]>();
  const standalone: SwimJob[] = [];
  for (const j of jobs) {
    if (j.meet_id && meetById.has(j.meet_id)) {
      const arr = jobsByMeet.get(j.meet_id) ?? [];
      arr.push(j);
      jobsByMeet.set(j.meet_id, arr);
    } else {
      standalone.push(j);
    }
  }

  const renderJobRow = (job: SwimJob) => (
    <tr key={job.id} className="border-t border-gray-100">
      <td className="px-3 py-2">
        <div className="font-medium text-gray-900 flex items-center gap-2">
          <Briefcase size={14} className="text-cyan-500" />
          {job.name}
        </div>
        {job.description && (
          <div className="text-xs text-gray-500 mt-0.5">{job.description}</div>
        )}
      </td>
      <td className="px-3 py-2 font-bold text-cyan-700">{job.points}</td>
      <td className="px-3 py-2 text-xs text-gray-700">
        {job.job_date ? (
          <span className="inline-flex items-center gap-1">
            <Calendar size={11} />
            {job.job_date}
          </span>
        ) : (
          <span className="text-gray-400">—</span>
        )}
      </td>
      <td className="px-3 py-2 text-xs text-gray-700">
        {job.slots ?? <span className="text-gray-400">—</span>}
      </td>
      <td className="px-3 py-2 text-right">
        <div className="inline-flex items-center gap-1">
          <button
            onClick={() => startEdit(job)}
            className="p-1.5 hover:bg-cyan-50 text-cyan-600 rounded"
          >
            <Edit3 size={14} />
          </button>
          <button
            onClick={() => remove(job.id)}
            disabled={busy === job.id}
            className="p-1.5 hover:bg-red-50 text-red-500 rounded"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </td>
    </tr>
  );

  const tableShell = (rows: SwimJob[]) => (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-gray-600">
          <tr>
            <th className="text-left px-3 py-2">Job</th>
            <th className="text-left px-3 py-2 w-20">Points</th>
            <th className="text-left px-3 py-2 w-32">Date</th>
            <th className="text-left px-3 py-2 w-20">Slots</th>
            <th className="text-right px-3 py-2 w-24"></th>
          </tr>
        </thead>
        <tbody>{rows.map(renderJobRow)}</tbody>
      </table>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-lg text-gray-900">Jobs</h2>
          <p className="text-sm text-gray-600">
            Add jobs (optionally tied to a meet) and how many points each is worth.
          </p>
        </div>
        <button
          onClick={() => (showAdd ? reset() : setShowAdd(true))}
          className="inline-flex items-center gap-2 px-3 py-2 bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg text-sm font-semibold"
        >
          <Plus size={14} />
          {showAdd ? 'Cancel' : 'Add job'}
        </button>
      </div>

      {showAdd && (
        <form onSubmit={submit} className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
          <h3 className="font-semibold">{editing ? 'Edit job' : 'Add job'}</h3>
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-gray-700 mb-1">Job name *</label>
              <input
                type="text"
                required
                placeholder="e.g. Timer, Concession, Set-up Crew"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg text-gray-900 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Meet (optional)</label>
              <select
                value={form.meet_id}
                onChange={(e) => setForm({ ...form, meet_id: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg text-gray-900 text-sm"
              >
                <option value="">— Standalone (no meet) —</option>
                {sortedMeets.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                    {m.meet_date ? ` · ${m.meet_date}` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Points *</label>
              <input
                type="number"
                min={0}
                max={100}
                required
                value={form.points}
                onChange={(e) => setForm({ ...form, points: parseInt(e.target.value || '0', 10) })}
                className="w-full px-3 py-2 border rounded-lg text-gray-900 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Slots (capacity, optional)
              </label>
              <input
                type="number"
                min={1}
                value={form.slots}
                onChange={(e) => setForm({ ...form, slots: e.target.value })}
                placeholder="e.g. 4"
                className="w-full px-3 py-2 border rounded-lg text-gray-900 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Date (optional)</label>
              <input
                type="date"
                value={form.job_date}
                onChange={(e) => setForm({ ...form, job_date: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg text-gray-900 text-sm"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Description (optional)
              </label>
              <textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                rows={2}
                placeholder="What's involved? Any prep needed?"
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
            {editing ? 'Save changes' : 'Add job'}
          </button>
        </form>
      )}

      {jobs.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center text-sm text-gray-500">
          No jobs yet. Add the first one above.
        </div>
      ) : (
        <div className="space-y-6">
          {sortedMeets.map((m) => {
            const list = jobsByMeet.get(m.id) ?? [];
            return (
              <div key={m.id} className="space-y-2">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <h3 className="font-semibold text-gray-900 text-sm">
                      {m.name}
                      {m.meet_date && (
                        <span className="ml-2 text-xs font-normal text-gray-500">
                          · {m.meet_date}
                        </span>
                      )}
                    </h3>
                    <p className="text-xs text-gray-500">
                      {list.length} {list.length === 1 ? 'job' : 'jobs'}
                    </p>
                  </div>
                  <button
                    onClick={() => beginAddForMeet(m.id)}
                    className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium border border-cyan-300 text-cyan-700 hover:bg-cyan-50 rounded"
                  >
                    <Plus size={12} /> Add job to this meet
                  </button>
                </div>
                {list.length === 0 ? (
                  <div className="bg-white border border-dashed border-gray-200 rounded-xl p-4 text-center text-xs text-gray-400">
                    No jobs attached to this meet yet.
                  </div>
                ) : (
                  tableShell(list)
                )}
              </div>
            );
          })}
          {standalone.length > 0 && (
            <div className="space-y-2">
              <h3 className="font-semibold text-gray-900 text-sm">
                Standalone jobs
                <span className="ml-2 text-xs font-normal text-gray-500">
                  · not tied to a meet
                </span>
              </h3>
              {tableShell(standalone)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
