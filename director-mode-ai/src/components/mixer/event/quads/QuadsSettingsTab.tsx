'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Save, Loader2 } from 'lucide-react';
import { GENDER_RESTRICTIONS, QUAD_SCORING_FORMATS } from '@/lib/quads';
import type { QuadEvent } from '../QuadsAdminDashboard';

const STATUS_OPTIONS = [
  { id: 'draft', label: 'Draft (hidden)' },
  { id: 'open', label: 'Open (accepting entries)' },
  { id: 'closed', label: 'Closed (registration ended)' },
  { id: 'running', label: 'Running (matches in progress)' },
  { id: 'completed', label: 'Completed' },
  { id: 'cancelled', label: 'Cancelled' },
];

export default function QuadsSettingsTab({
  event,
  onRefresh,
}: {
  event: QuadEvent;
  onRefresh: () => void | Promise<void>;
}) {
  // If the stored value isn't one of the preset ids, treat it as a custom string.
  const isPreset = QUAD_SCORING_FORMATS.some(
    (f) => f.id === event.event_scoring_format && f.id !== 'custom'
  );
  const [form, setForm] = useState({
    name: event.name,
    age_max: event.age_max ?? '',
    gender_restriction: event.gender_restriction ?? 'coed',
    event_scoring_format: isPreset ? event.event_scoring_format : 'custom',
    custom_scoring: isPreset ? '' : event.event_scoring_format ?? '',
    entry_fee_dollars: (event.entry_fee_cents ?? 0) / 100,
    max_players: event.max_players ?? '',
    public_status: event.public_status,
    registration_closes_at: event.registration_closes_at
      ? new Date(event.registration_closes_at).toISOString().slice(0, 16)
      : '',
    round_duration_minutes: event.round_duration_minutes ?? 45,
    court_names: (event.court_names ?? []).join(', '),
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const supabase = createClient();

  const save = async () => {
    setSaving(true);
    setError(null);
    const { error: err } = await supabase
      .from('events')
      .update({
        name: form.name.trim(),
        age_max: form.age_max === '' ? null : parseInt(String(form.age_max), 10),
        gender_restriction: form.gender_restriction,
        event_scoring_format:
          form.event_scoring_format === 'custom'
            ? form.custom_scoring.trim() || 'Custom format'
            : form.event_scoring_format,
        entry_fee_cents: Math.round((form.entry_fee_dollars || 0) * 100),
        max_players:
          form.max_players === '' ? null : parseInt(String(form.max_players), 10),
        public_status: form.public_status,
        registration_closes_at: form.registration_closes_at
          ? new Date(form.registration_closes_at).toISOString()
          : null,
        round_duration_minutes: form.round_duration_minutes,
        court_names: form.court_names
          .split(',')
          .map((c) => c.trim())
          .filter(Boolean),
      })
      .eq('id', event.id);
    if (err) {
      setError(err.message);
      setSaving(false);
      return;
    }
    setSavedAt(Date.now());
    setSaving(false);
    await onRefresh();
  };

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4 max-w-2xl">
      <h3 className="font-semibold">Tournament settings</h3>

      <div>
        <label className="block text-sm font-medium mb-1 text-gray-700">Name</label>
        <input
          type="text"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className="w-full px-3 py-2 border rounded-lg text-gray-900 text-sm"
        />
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1 text-gray-700">Status</label>
          <select
            value={form.public_status}
            onChange={(e) =>
              setForm({ ...form, public_status: e.target.value as QuadEvent['public_status'] })
            }
            className="w-full px-3 py-2 border rounded-lg text-gray-900 text-sm"
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1 text-gray-700">Registration closes</label>
          <input
            type="datetime-local"
            value={form.registration_closes_at}
            onChange={(e) => setForm({ ...form, registration_closes_at: e.target.value })}
            className="w-full px-3 py-2 border rounded-lg text-gray-900 text-sm"
          />
        </div>
      </div>

      <div className="grid sm:grid-cols-3 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1 text-gray-700">Age cap</label>
          <input
            type="number"
            min={5}
            max={99}
            value={form.age_max}
            onChange={(e) =>
              setForm({
                ...form,
                age_max: e.target.value === '' ? '' : parseInt(e.target.value, 10),
              })
            }
            className="w-full px-3 py-2 border rounded-lg text-gray-900 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1 text-gray-700">Gender</label>
          <select
            value={form.gender_restriction}
            onChange={(e) =>
              setForm({ ...form, gender_restriction: e.target.value as 'boys' | 'girls' | 'coed' })
            }
            className="w-full px-3 py-2 border rounded-lg text-gray-900 text-sm"
          >
            {GENDER_RESTRICTIONS.map((g) => (
              <option key={g.id} value={g.id}>
                {g.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1 text-gray-700">Max players</label>
          <input
            type="number"
            step={4}
            min={4}
            max={64}
            value={form.max_players}
            onChange={(e) =>
              setForm({
                ...form,
                max_players: e.target.value === '' ? '' : parseInt(e.target.value, 10),
              })
            }
            className="w-full px-3 py-2 border rounded-lg text-gray-900 text-sm"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1 text-gray-700">Match scoring format</label>
        <select
          value={form.event_scoring_format}
          onChange={(e) => setForm({ ...form, event_scoring_format: e.target.value })}
          className="w-full px-3 py-2 border rounded-lg text-gray-900 text-sm"
        >
          {QUAD_SCORING_FORMATS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
        {form.event_scoring_format === 'custom' && (
          <input
            type="text"
            value={form.custom_scoring}
            onChange={(e) => setForm({ ...form, custom_scoring: e.target.value })}
            placeholder='e.g. "First to 4 games, no-ad scoring"'
            maxLength={120}
            className="w-full mt-2 px-3 py-2 border border-orange-300 rounded-lg text-gray-900 text-sm"
          />
        )}
      </div>

      <div>
        <label className="block text-sm font-medium mb-1 text-gray-700">
          Available courts
        </label>
        <input
          type="text"
          value={form.court_names}
          onChange={(e) => setForm({ ...form, court_names: e.target.value })}
          placeholder="1, 2, 3, 5"
          className="w-full px-3 py-2 border rounded-lg text-gray-900 text-sm"
        />
        <p className="text-xs text-gray-500 mt-1">
          Comma-separated. Use any labels — numbers ("1, 2, 3") or names ("Stadium, Bubble").
          Skip courts that aren't available (e.g., "1, 2, 3, 5" if court 4 is reserved). Leave
          blank to use courts 1–{event.num_courts ?? 4}.
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1 text-gray-700">
          Round duration (minutes)
        </label>
        <input
          type="number"
          min={5}
          max={240}
          step={5}
          value={form.round_duration_minutes}
          onChange={(e) =>
            setForm({
              ...form,
              round_duration_minutes: parseInt(e.target.value || '45', 10),
            })
          }
          className="w-full px-3 py-2 border rounded-lg text-gray-900 text-sm"
        />
        <p className="text-xs text-gray-500 mt-1">
          Used by Auto-schedule to space out R1, R2, R3, R4 (e.g. 45 min × 4 rounds = 3-hour event).
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1 text-gray-700">Entry fee (USD)</label>
        <input
          type="number"
          min={0}
          max={500}
          step={1}
          value={form.entry_fee_dollars}
          onChange={(e) =>
            setForm({ ...form, entry_fee_dollars: parseFloat(e.target.value || '0') })
          }
          className="w-full px-3 py-2 border rounded-lg text-gray-900 text-sm"
        />
      </div>

      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-2">
          {error}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-lg text-sm font-medium hover:bg-orange-600 disabled:opacity-50"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          {saving ? 'Saving…' : 'Save changes'}
        </button>
        {savedAt && <span className="text-sm text-emerald-600">Saved.</span>}
      </div>
    </div>
  );
}
