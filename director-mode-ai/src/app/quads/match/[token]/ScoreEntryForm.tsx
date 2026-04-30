'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';

export default function ScoreEntryForm({
  token,
  sideA,
  sideB,
  initialScore,
  initialWinner,
  allowEdit,
}: {
  token: string;
  sideA: string;
  sideB: string;
  initialScore?: string;
  initialWinner?: 'a' | 'b' | null;
  allowEdit?: boolean;
}) {
  const [score, setScore] = useState(initialScore ?? '');
  const [winner, setWinner] = useState<'' | 'a' | 'b'>(initialWinner ?? '');
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [editing, setEditing] = useState(!allowEdit);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/quads/match/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ winner_side: winner, score, reported_by_name: name }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to submit.');
        setSubmitting(false);
        return;
      }
      setDone(true);
      setSubmitting(false);
      setTimeout(() => window.location.reload(), 800);
    } catch (err: any) {
      setError(err?.message || 'Network error');
      setSubmitting(false);
    }
  };

  if (allowEdit && !editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        className="text-sm text-orange-600 hover:underline"
      >
        Edit score →
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setWinner('a')}
          className={`px-3 py-3 rounded-lg text-sm font-semibold border-2 ${
            winner === 'a'
              ? 'bg-emerald-600 text-white border-emerald-600'
              : 'bg-white text-gray-700 border-gray-300 hover:border-emerald-400'
          }`}
        >
          {sideA} won
        </button>
        <button
          type="button"
          onClick={() => setWinner('b')}
          className={`px-3 py-3 rounded-lg text-sm font-semibold border-2 ${
            winner === 'b'
              ? 'bg-emerald-600 text-white border-emerald-600'
              : 'bg-white text-gray-700 border-gray-300 hover:border-emerald-400'
          }`}
        >
          {sideB} won
        </button>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Score</label>
        <input
          type="text"
          value={score}
          onChange={(e) => setScore(e.target.value)}
          placeholder='e.g. "6-3, 6-4" or "8-5"'
          required
          className="w-full px-3 py-2 border rounded-lg text-gray-900"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">
          Your name (for the record)
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Coach Smith"
          className="w-full px-3 py-2 border rounded-lg text-gray-900"
        />
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm">
          {error}
        </div>
      )}
      {done && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-lg p-3 text-sm">
          ✓ Saved. Reloading…
        </div>
      )}

      <button
        type="submit"
        disabled={submitting || !winner}
        className="w-full py-3 bg-orange-500 hover:bg-orange-600 text-white rounded-lg font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {submitting && <Loader2 size={16} className="animate-spin" />}
        {submitting ? 'Saving…' : 'Submit Score'}
      </button>
    </form>
  );
}
