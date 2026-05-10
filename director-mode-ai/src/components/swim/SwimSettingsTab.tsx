'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Save, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { SwimSeason } from '@/app/swim/[id]/page';

export default function SwimSettingsTab({
  season,
  onRefresh,
}: {
  season: SwimSeason;
  onRefresh: () => Promise<void> | void;
}) {
  const router = useRouter();
  const [form, setForm] = useState({
    name: season.name,
    start_date: season.start_date ?? '',
    end_date: season.end_date ?? '',
    default_points_required: season.default_points_required,
    status: season.status,
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const save = async () => {
    setBusy('save');
    setError(null);
    const { error: err } = await supabase
      .from('swim_seasons')
      .update({
        name: form.name.trim(),
        start_date: form.start_date || null,
        end_date: form.end_date || null,
        default_points_required: form.default_points_required,
        status: form.status,
      })
      .eq('id', season.id);
    if (err) {
      setError(err.message);
      setBusy(null);
      return;
    }
    setSavedAt(Date.now());
    setBusy(null);
    await onRefresh();
  };

  const deleteSeason = async () => {
    if (
      !confirm(
        'Delete this season? Removes all jobs, families, and assignments. This cannot be undone.'
      )
    )
      return;
    setBusy('delete');
    await supabase.from('swim_seasons').delete().eq('id', season.id);
    router.push('/swim');
  };

  return (
    <div className="max-w-2xl space-y-4">
      <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
        <h2 className="font-semibold text-lg text-gray-900">Season settings</h2>

        <div>
          <label className="block text-sm font-medium mb-1">Season name</label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="w-full px-3 py-2 border rounded-lg text-gray-900 text-sm"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium mb-1">Start date</label>
            <input
              type="date"
              value={form.start_date}
              onChange={(e) => setForm({ ...form, start_date: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg text-gray-900 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">End date</label>
            <input
              type="date"
              value={form.end_date}
              onChange={(e) => setForm({ ...form, end_date: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg text-gray-900 text-sm"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">
            Default points required per family
          </label>
          <input
            type="number"
            min={0}
            max={1000}
            value={form.default_points_required}
            onChange={(e) =>
              setForm({
                ...form,
                default_points_required: parseInt(e.target.value || '0', 10),
              })
            }
            className="w-full px-3 py-2 border rounded-lg text-gray-900 text-sm"
          />
          <p className="text-xs text-gray-500 mt-1">
            Used for any family without a per-family override.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Status</label>
          <select
            value={form.status}
            onChange={(e) =>
              setForm({ ...form, status: e.target.value as SwimSeason['status'] })
            }
            className="w-full px-3 py-2 border rounded-lg text-gray-900 text-sm"
          >
            <option value="active">Active</option>
            <option value="archived">Archived (read-only)</option>
          </select>
        </div>

        {error && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-2">
            {error}
          </div>
        )}

        <div className="flex items-center gap-3">
          <button
            onClick={save}
            disabled={busy === 'save'}
            className="px-4 py-2 bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg text-sm font-medium disabled:opacity-50 inline-flex items-center gap-2"
          >
            {busy === 'save' ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Save size={14} />
            )}
            Save
          </button>
          {savedAt && <span className="text-sm text-emerald-600">Saved.</span>}
        </div>
      </div>

      <div className="bg-white border border-red-200 rounded-xl p-5 space-y-3">
        <h2 className="font-semibold text-base text-red-700">Danger zone</h2>
        <p className="text-sm text-gray-600">
          Deleting this season removes all jobs, families, and assignments associated with it.
        </p>
        <button
          onClick={deleteSeason}
          disabled={busy === 'delete'}
          className="px-4 py-2 border border-red-300 text-red-700 hover:bg-red-50 rounded-lg text-sm font-medium disabled:opacity-50 inline-flex items-center gap-2"
        >
          {busy === 'delete' ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Trash2 size={14} />
          )}
          Delete season
        </button>
      </div>
    </div>
  );
}
