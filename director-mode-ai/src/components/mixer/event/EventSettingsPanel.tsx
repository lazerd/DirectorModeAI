'use client';

import { useState } from 'react';
import { Save, Loader2, Check } from 'lucide-react';

// Real Settings panel for the tournament desk — replaces the old "edit in
// Supabase" stub. The headline control is COURT COUNT (the fix for draws being
// stuck at 2 courts): set 8 for the round-robin, bump to 10 for the playoffs.
// Saves via PATCH /api/tournaments/events/[id]; parent re-fetches on success.

type Props = {
  event: {
    id: string;
    name: string;
    num_courts: number | null;
    default_match_length_minutes: number | null;
    daily_start_time: string | null;
  };
  onSaved: () => void;
};

export default function EventSettingsPanel({ event, onSaved }: Props) {
  const [name, setName] = useState(event.name ?? '');
  const [courts, setCourts] = useState(String(event.num_courts ?? 8));
  const [matchLen, setMatchLen] = useState(String(event.default_match_length_minutes ?? 20));
  const [startTime, setStartTime] = useState((event.daily_start_time ?? '13:00').slice(0, 5));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(`/api/tournaments/events/${event.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          num_courts: Number(courts),
          default_match_length_minutes: Number(matchLen),
          daily_start_time: startTime,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data?.error || 'Could not save.'); return; }
      setSaved(true);
      onSaved();
      setTimeout(() => setSaved(false), 2500);
    } catch {
      setError('Could not save — check your connection.');
    } finally {
      setSaving(false);
    }
  }

  const setCourtsQuick = (n: number) => setCourts(String(n));

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 max-w-xl">
      <p className="font-semibold text-gray-900 mb-4">Event settings</p>

      <div className="space-y-5">
        {/* Court count — the star control */}
        <div>
          <label className="block text-sm font-medium text-gray-900 mb-1">Number of courts</label>
          <p className="text-xs text-gray-500 mb-2">
            How many courts show on the desk and take matches. Use <strong>8</strong> for the
            round-robin, <strong>10</strong> for the playoff round.
          </p>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={40}
              value={courts}
              onChange={(e) => setCourts(e.target.value)}
              className="w-24 rounded-lg border border-gray-300 px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button type="button" onClick={() => setCourtsQuick(8)}
              className={`px-3 py-2 rounded-lg text-sm font-medium border ${courts === '8' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}>
              8 · round-robin
            </button>
            <button type="button" onClick={() => setCourtsQuick(10)}
              className={`px-3 py-2 rounded-lg text-sm font-medium border ${courts === '10' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}>
              10 · playoffs
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-900 mb-1">Match length (min)</label>
            <input
              type="number" min={5} max={240} value={matchLen}
              onChange={(e) => setMatchLen(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-900 mb-1">Daily start time</label>
            <input
              type="time" value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-900 mb-1">Event name</label>
          <input
            type="text" value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex items-center gap-3">
          <button
            type="button" onClick={save} disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 text-white font-semibold px-4 py-2 disabled:opacity-50 hover:bg-blue-700"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            Save settings
          </button>
          {saved && (
            <span className="inline-flex items-center gap-1 text-sm text-emerald-600 font-medium">
              <Check size={16} /> Saved
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
