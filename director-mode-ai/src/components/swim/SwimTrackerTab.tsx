'use client';

import { useState } from 'react';
import { Plus, Loader2, Check, Trash2, Download } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type {
  SwimSeason,
  SwimJob,
  SwimFamily,
  SwimAssignment,
} from '@/app/swim/[id]/page';

export default function SwimTrackerTab({
  season,
  jobs,
  families,
  assignments,
  familyProgress,
  onRefresh,
}: {
  season: SwimSeason;
  jobs: SwimJob[];
  families: SwimFamily[];
  assignments: SwimAssignment[];
  familyProgress: Map<string, { earned: number; required: number; percent: number }>;
  onRefresh: () => Promise<void> | void;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    family_id: '',
    job_id: '',
    points_override: '' as string | number,
    status: 'completed' as SwimAssignment['status'],
    completed_at: new Date().toISOString().slice(0, 10),
    notes: '',
  });

  const familyById = new Map(families.map((f) => [f.id, f]));
  const jobById = new Map(jobs.map((j) => [j.id, j]));

  const addAssignment = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy('add');
    const job = jobById.get(form.job_id);
    if (!job) {
      setError('Pick a job.');
      setBusy(null);
      return;
    }
    const pointsAwarded =
      form.points_override === '' ? job.points : parseInt(String(form.points_override), 10);
    const { error: err } = await supabase.from('swim_assignments').insert({
      family_id: form.family_id,
      job_id: form.job_id,
      points_awarded: pointsAwarded,
      status: form.status,
      completed_at: form.status === 'completed' ? form.completed_at : null,
      notes: form.notes.trim() || null,
    });
    if (err) {
      setError(err.message);
      setBusy(null);
      return;
    }
    setForm({
      family_id: '',
      job_id: '',
      points_override: '',
      status: 'completed',
      completed_at: new Date().toISOString().slice(0, 10),
      notes: '',
    });
    setShowAdd(false);
    await onRefresh();
    setBusy(null);
  };

  const setStatus = async (id: string, status: SwimAssignment['status']) => {
    setBusy(id);
    await supabase
      .from('swim_assignments')
      .update({
        status,
        completed_at: status === 'completed' ? new Date().toISOString() : null,
      })
      .eq('id', id);
    await onRefresh();
    setBusy(null);
  };

  const removeAssignment = async (id: string) => {
    if (!confirm('Remove this assignment?')) return;
    setBusy(id);
    await supabase.from('swim_assignments').delete().eq('id', id);
    await onRefresh();
    setBusy(null);
  };

  const exportCsv = () => {
    const rows = [['Family', 'Earned', 'Target', '% Complete', 'Status', 'Email', 'Phone']];
    for (const f of families) {
      const p = familyProgress.get(f.id);
      const earned = p?.earned ?? 0;
      const target = p?.required ?? season.default_points_required;
      const pct = p?.percent ?? 0;
      const status =
        pct >= 100 ? 'Complete' : pct >= 50 ? 'In progress' : 'Behind';
      rows.push([
        f.family_name,
        String(earned),
        String(target),
        `${pct}%`,
        status,
        f.primary_email ?? '',
        f.primary_phone ?? '',
      ]);
    }
    const csv = rows
      .map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${season.name.replace(/[^a-z0-9]+/gi, '-')}-volunteer-points.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const sortedFamilies = [...families].sort((a, b) => {
    const pa = familyProgress.get(a.id)?.percent ?? 0;
    const pb = familyProgress.get(b.id)?.percent ?? 0;
    return pa - pb; // behind families first
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="font-semibold text-lg text-gray-900">Tracker</h2>
          <p className="text-sm text-gray-600">
            Award points as families volunteer. Behind families show first.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={exportCsv}
            disabled={families.length === 0}
            className="inline-flex items-center gap-2 px-3 py-2 border border-gray-300 hover:bg-gray-50 rounded-lg text-sm font-medium disabled:opacity-50"
          >
            <Download size={14} /> Export CSV
          </button>
          <button
            onClick={() => setShowAdd((s) => !s)}
            disabled={jobs.length === 0 || families.length === 0}
            className="inline-flex items-center gap-2 px-3 py-2 bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg text-sm font-semibold disabled:opacity-50"
          >
            <Plus size={14} />
            {showAdd ? 'Cancel' : 'Award points'}
          </button>
        </div>
      </div>

      {(jobs.length === 0 || families.length === 0) && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-3 text-sm">
          {jobs.length === 0 && families.length === 0
            ? 'Add at least one job and one family to start awarding points.'
            : jobs.length === 0
              ? 'Add at least one job (in the Jobs tab) before awarding points.'
              : 'Add at least one family (in the Families tab) before awarding points.'}
        </div>
      )}

      {showAdd && (
        <form
          onSubmit={addAssignment}
          className="bg-white rounded-xl border border-gray-200 p-4 space-y-3"
        >
          <h3 className="font-semibold">Award points</h3>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Family *</label>
              <select
                required
                value={form.family_id}
                onChange={(e) => setForm({ ...form, family_id: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg text-gray-900 text-sm"
              >
                <option value="">— pick family —</option>
                {[...families]
                  .sort((a, b) => a.family_name.localeCompare(b.family_name))
                  .map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.family_name}
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Job *</label>
              <select
                required
                value={form.job_id}
                onChange={(e) => setForm({ ...form, job_id: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg text-gray-900 text-sm"
              >
                <option value="">— pick job —</option>
                {jobs.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.name} ({j.points} pts)
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Points (override)
              </label>
              <input
                type="number"
                min={0}
                placeholder={
                  form.job_id
                    ? `Default ${jobById.get(form.job_id)?.points ?? '?'}`
                    : 'Default'
                }
                value={form.points_override}
                onChange={(e) => setForm({ ...form, points_override: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg text-gray-900 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Status</label>
              <select
                value={form.status}
                onChange={(e) =>
                  setForm({ ...form, status: e.target.value as SwimAssignment['status'] })
                }
                className="w-full px-3 py-2 border rounded-lg text-gray-900 text-sm"
              >
                <option value="completed">Completed (count points)</option>
                <option value="signed_up">Signed up (no points yet)</option>
                <option value="no_show">No show</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
            {form.status === 'completed' && (
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Completed on
                </label>
                <input
                  type="date"
                  value={form.completed_at}
                  onChange={(e) => setForm({ ...form, completed_at: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg text-gray-900 text-sm"
                />
              </div>
            )}
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-gray-700 mb-1">Notes</label>
              <input
                type="text"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
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
            disabled={busy === 'add' || !form.family_id || !form.job_id}
            className="px-4 py-2 bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg text-sm font-medium disabled:opacity-50 inline-flex items-center gap-2"
          >
            {busy === 'add' && <Loader2 size={14} className="animate-spin" />}
            Award
          </button>
        </form>
      )}

      {/* Family progress cards */}
      <div className="space-y-3">
        {sortedFamilies.map((f) => {
          const p = familyProgress.get(f.id) || {
            earned: 0,
            required: season.default_points_required,
            percent: 0,
          };
          const fAssignments = assignments
            .filter((a) => a.family_id === f.id)
            .sort((a, b) =>
              (b.completed_at ?? b.id).localeCompare(a.completed_at ?? a.id)
            );
          const pctClamped = Math.min(100, p.percent);
          const barColor =
            p.percent >= 100
              ? 'bg-emerald-500'
              : p.percent >= 50
                ? 'bg-amber-400'
                : 'bg-red-400';

          return (
            <div key={f.id} className="bg-white border border-gray-200 rounded-xl p-4">
              <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
                <div>
                  <h3 className="font-semibold text-gray-900">{f.family_name}</h3>
                  <p className="text-xs text-gray-500">
                    {p.earned} / {p.required} pts ·{' '}
                    {p.percent >= 100
                      ? 'Complete ✓'
                      : p.percent >= 50
                        ? 'In progress'
                        : 'Behind'}
                  </p>
                </div>
                <div className="text-2xl font-bold text-gray-900">
                  {p.percent}
                  <span className="text-sm text-gray-500">%</span>
                </div>
              </div>
              <div className="h-2 bg-gray-100 rounded-full overflow-hidden mb-3">
                <div
                  className={`h-full ${barColor} transition-all`}
                  style={{ width: `${pctClamped}%` }}
                />
              </div>
              {fAssignments.length === 0 ? (
                <p className="text-xs text-gray-500 italic">No volunteer history yet.</p>
              ) : (
                <ul className="space-y-1">
                  {fAssignments.map((a) => {
                    const job = jobById.get(a.job_id);
                    const statusColor =
                      a.status === 'completed'
                        ? 'bg-emerald-100 text-emerald-700'
                        : a.status === 'signed_up'
                          ? 'bg-blue-100 text-blue-700'
                          : 'bg-gray-100 text-gray-700';
                    return (
                      <li
                        key={a.id}
                        className="flex items-center gap-2 text-sm py-1.5 px-2 -mx-2 hover:bg-gray-50 rounded"
                      >
                        <span className="flex-1 truncate">
                          <span className="font-medium text-gray-900">
                            {job?.name ?? '(deleted job)'}
                          </span>
                          {job?.job_date && (
                            <span className="text-xs text-gray-500 ml-2">
                              {job.job_date}
                            </span>
                          )}
                          {a.notes && (
                            <span className="text-xs text-gray-500 ml-2">· {a.notes}</span>
                          )}
                        </span>
                        <span
                          className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${statusColor}`}
                        >
                          {a.status.replace('_', ' ')}
                        </span>
                        <span className="font-bold text-cyan-700 w-12 text-right">
                          {a.status === 'completed' ? `+${a.points_awarded}` : '—'}
                        </span>
                        {a.status !== 'completed' && (
                          <button
                            onClick={() => setStatus(a.id, 'completed')}
                            disabled={busy === a.id}
                            title="Mark complete"
                            className="p-1 hover:bg-emerald-50 text-emerald-600 rounded"
                          >
                            <Check size={14} />
                          </button>
                        )}
                        <button
                          onClick={() => removeAssignment(a.id)}
                          disabled={busy === a.id}
                          className="p-1 hover:bg-red-50 text-red-500 rounded"
                        >
                          <Trash2 size={14} />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      {families.length === 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center text-sm text-gray-500">
          Add families to start tracking points.
        </div>
      )}
    </div>
  );
}
