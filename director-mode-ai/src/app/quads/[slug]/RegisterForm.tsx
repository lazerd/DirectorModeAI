'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';

type Props = {
  slug: string;
  feeCents: number;
  ageMax: number | null;
  genderRestriction: 'boys' | 'girls' | 'coed' | null;
};

export default function RegisterForm({ slug, feeCents, ageMax, genderRestriction }: Props) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    player_name: '',
    player_email: '',
    player_phone: '',
    parent_name: '',
    parent_email: '',
    parent_phone: '',
    date_of_birth: '',
    gender:
      genderRestriction === 'boys'
        ? 'male'
        : genderRestriction === 'girls'
          ? 'female'
          : '',
    ntrp: '',
  });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/quads/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug,
          ...form,
          ntrp: form.ntrp ? parseFloat(form.ntrp) : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Registration failed.');
        setSubmitting(false);
        return;
      }
      if (data.url) {
        window.location.href = data.url;
        return;
      }
      // Free tournament — redirect to a confirmation
      window.location.href = `/quads/${slug}/registered?entry=${data.entry_id}`;
    } catch (err: any) {
      setError(err?.message || 'Network error');
      setSubmitting(false);
    }
  };

  const isJunior = !!ageMax && ageMax <= 18;

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-gray-700 mb-1">Player Name *</label>
          <input
            type="text"
            required
            value={form.player_name}
            onChange={(e) => setForm({ ...form, player_name: e.target.value })}
            className="w-full px-3 py-2 border rounded-lg text-gray-900"
            placeholder="Full name"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Date of Birth</label>
          <input
            type="date"
            value={form.date_of_birth}
            onChange={(e) => setForm({ ...form, date_of_birth: e.target.value })}
            className="w-full px-3 py-2 border rounded-lg text-gray-900"
            required={!!ageMax}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Gender</label>
          <select
            value={form.gender}
            onChange={(e) => setForm({ ...form, gender: e.target.value })}
            className="w-full px-3 py-2 border rounded-lg text-gray-900"
            disabled={genderRestriction === 'boys' || genderRestriction === 'girls'}
            required={genderRestriction === 'boys' || genderRestriction === 'girls'}
          >
            <option value="">— select —</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
            <option value="nonbinary">Non-binary</option>
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Player Email</label>
          <input
            type="email"
            value={form.player_email}
            onChange={(e) => setForm({ ...form, player_email: e.target.value })}
            className="w-full px-3 py-2 border rounded-lg text-gray-900"
            required={!isJunior}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Player Phone</label>
          <input
            type="tel"
            value={form.player_phone}
            onChange={(e) => setForm({ ...form, player_phone: e.target.value })}
            className="w-full px-3 py-2 border rounded-lg text-gray-900"
          />
        </div>

        {isJunior && (
          <>
            <div className="sm:col-span-2 pt-2 border-t border-gray-200">
              <p className="text-xs text-gray-600 font-medium">Parent / Guardian (required for juniors)</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Parent Name *</label>
              <input
                type="text"
                required={isJunior}
                value={form.parent_name}
                onChange={(e) => setForm({ ...form, parent_name: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg text-gray-900"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Parent Email *</label>
              <input
                type="email"
                required={isJunior}
                value={form.parent_email}
                onChange={(e) => setForm({ ...form, parent_email: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg text-gray-900"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-gray-700 mb-1">Parent Phone</label>
              <input
                type="tel"
                value={form.parent_phone}
                onChange={(e) => setForm({ ...form, parent_phone: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg text-gray-900"
              />
            </div>
          </>
        )}

        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-gray-700 mb-1">
            NTRP (optional — UTR auto-looked up)
          </label>
          <input
            type="number"
            min="1"
            max="7"
            step="0.5"
            value={form.ntrp}
            onChange={(e) => setForm({ ...form, ntrp: e.target.value })}
            className="w-full px-3 py-2 border rounded-lg text-gray-900"
            placeholder="e.g. 3.5"
          />
          <p className="text-xs text-gray-500 mt-1">
            We'll look up the player's UTR by name automatically. NTRP is a backup if UTR isn't found.
          </p>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="w-full py-3 bg-orange-500 hover:bg-orange-600 text-white rounded-lg font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {submitting && <Loader2 size={16} className="animate-spin" />}
        {submitting
          ? 'Working…'
          : feeCents > 0
            ? `Register & Pay $${(feeCents / 100).toFixed(0)}`
            : 'Register (Free)'}
      </button>
    </form>
  );
}
