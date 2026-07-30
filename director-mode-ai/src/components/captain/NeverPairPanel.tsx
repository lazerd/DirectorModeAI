'use client';

/**
 * The never-pair list.
 *
 * A hard constraint, not a preference: these two are never put on a court
 * together no matter how well they'd score. Kept deliberately plain and
 * unlabelled beyond "never pair" — the reason is usually personal, and the
 * captain shouldn't have to write it down anywhere a player might see.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Player = { id: string; name: string; is_sub: boolean };
type Pair = { id: string; player_a_id: string; player_b_id: string };

const field =
  'px-3 py-2 rounded-lg bg-[#001820] border border-white/10 focus:border-[#D3FB52]/50 focus:outline-none text-sm';
// See TeamSettingsPanel: globals.css beats Tailwind on bare form elements.
const INPUT_COLOR = { color: '#ffffff' } as const;

export default function NeverPairPanel({
  teamId,
  players,
  neverPairs,
}: {
  teamId: string;
  players: Player[];
  neverPairs: Pair[];
}) {
  const router = useRouter();
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nameOf = (id: string) => players.find((p) => p.id === id)?.name ?? 'a former player';

  async function add() {
    if (!a || !b) {
      setError('Pick two players.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/captain/never-pair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ team_id: teamId, player_a_id: a, player_b_id: b }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) setError(j.error || 'Could not save.');
      else {
        setA('');
        setB('');
        router.refresh();
      }
    } catch {
      setError('Network problem — try again.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    setError(null);
    try {
      await fetch(`/api/captain/never-pair?team_id=${teamId}&id=${id}`, { method: 'DELETE' });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const options = [...players].sort((x, y) => x.name.localeCompare(y.name));

  return (
    <section className="mt-10">
      <h2 className="text-xl font-display text-white">Never pair</h2>
      <p className="text-sm text-white/50 mt-2">
        These two are never put on a court together. A hard rule — it beats ratings, preferences and
        chemistry.
      </p>

      {error && <p className="text-sm text-red-300 mt-3">{error}</p>}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <select
          value={a}
          onChange={(e) => setA(e.target.value)}
          aria-label="First player"
          style={INPUT_COLOR}
          className={field}
        >
          <option value="">Choose a player…</option>
          {options.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <span className="text-white/30 text-sm">and</span>
        <select
          value={b}
          onChange={(e) => setB(e.target.value)}
          aria-label="Second player"
          style={INPUT_COLOR}
          className={field}
        >
          <option value="">Choose a player…</option>
          {options
            .filter((p) => p.id !== a)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
        </select>
        <button
          onClick={add}
          disabled={busy || !a || !b}
          className="px-4 py-2 rounded-xl border border-white/10 text-white/70 hover:text-white hover:border-white/25 text-sm disabled:opacity-40"
        >
          Never pair these two
        </button>
      </div>

      {neverPairs.length > 0 && (
        <ul className="mt-4 space-y-2">
          {neverPairs.map((n) => (
            <li
              key={n.id}
              className="flex items-center justify-between gap-4 rounded-xl border border-white/[0.08] bg-[#002838] px-4 py-2.5"
            >
              <span className="text-sm text-white">
                {nameOf(n.player_a_id)} <span className="text-white/30">and</span>{' '}
                {nameOf(n.player_b_id)}
              </span>
              <button
                onClick={() => remove(n.id)}
                disabled={busy}
                className="text-white/30 hover:text-red-300 text-sm disabled:opacity-40"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
