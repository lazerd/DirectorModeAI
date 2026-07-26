'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function AddMatchForm({ teamId }: { teamId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [when, setWhen] = useState('');
  const [opponent, setOpponent] = useState('');
  const [isHome, setIsHome] = useState(true);
  const [location, setLocation] = useState('');
  const [singles, setSingles] = useState(2);
  const [doubles, setDoubles] = useState(3);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/captain/matches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          team_id: teamId,
          matches: [
            {
              match_at: new Date(when).toISOString(),
              opponent,
              is_home: isHome,
              location,
              singles_courts: singles,
              doubles_courts: doubles,
            },
          ],
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(j.error || 'Could not add the match.');
        return;
      }
      setOpen(false);
      setWhen('');
      setOpponent('');
      setLocation('');
      router.refresh();
    } catch {
      setError('Network problem — try again.');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-3 px-4 py-2.5 rounded-xl border border-white/10 text-white/70 hover:text-white hover:border-white/25 text-sm"
      >
        + Add match
      </button>
    );
  }

  const field =
    'w-full px-3 py-2.5 rounded-xl bg-[#001820] border border-white/10 text-white placeholder-white/25 focus:border-[#D3FB52]/50 focus:outline-none';

  return (
    <form
      onSubmit={submit}
      className="mt-3 rounded-2xl border border-white/[0.08] bg-[#002838] p-5 space-y-4"
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="m-when" className="block text-sm text-white/60 mb-1">
            Date &amp; time
          </label>
          <input
            id="m-when"
            type="datetime-local"
            required
            value={when}
            onChange={(e) => setWhen(e.target.value)}
            className={field}
          />
        </div>
        <div>
          <label htmlFor="m-opp" className="block text-sm text-white/60 mb-1">
            Opponent
          </label>
          <input
            id="m-opp"
            value={opponent}
            onChange={(e) => setOpponent(e.target.value)}
            placeholder="Diablo Valley"
            className={field}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div>
          <label htmlFor="m-home" className="block text-sm text-white/60 mb-1">
            Home / away
          </label>
          <select
            id="m-home"
            value={isHome ? 'home' : 'away'}
            onChange={(e) => setIsHome(e.target.value === 'home')}
            className={field}
          >
            <option value="home">Home</option>
            <option value="away">Away</option>
          </select>
        </div>
        <div className="col-span-1 sm:col-span-2">
          <label htmlFor="m-loc" className="block text-sm text-white/60 mb-1">
            Location
          </label>
          <input
            id="m-loc"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            className={field}
          />
        </div>
        <div className="flex gap-2">
          <div>
            <label htmlFor="m-s" className="block text-sm text-white/60 mb-1">
              S
            </label>
            <input
              id="m-s"
              type="number"
              min={0}
              max={6}
              value={singles}
              onChange={(e) => setSingles(Number(e.target.value))}
              className={field}
            />
          </div>
          <div>
            <label htmlFor="m-d" className="block text-sm text-white/60 mb-1">
              D
            </label>
            <input
              id="m-d"
              type="number"
              min={0}
              max={6}
              value={doubles}
              onChange={(e) => setDoubles(Number(e.target.value))}
              className={field}
            />
          </div>
        </div>
      </div>

      {error && <p className="text-sm text-red-300">{error}</p>}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={busy}
          className="px-5 py-2.5 rounded-xl bg-[#D3FB52] text-[#001820] font-semibold disabled:opacity-50"
        >
          {busy ? 'Adding…' : 'Add match'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="px-5 py-2.5 rounded-xl text-white/60 hover:text-white"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
