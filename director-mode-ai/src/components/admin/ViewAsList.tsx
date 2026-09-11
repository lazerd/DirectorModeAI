'use client';

/**
 * Pick an account and step into it.
 *
 * A search box rather than a long scroll: the reason to be on this page is
 * always a named person who just said something is broken.
 */

import { useMemo, useState } from 'react';

export type ViewAsPerson = {
  id: string;
  email: string;
  name: string | null;
  /** "captain of Fall B2/B3", "director at Sleepy Hollow" — what makes a row recognisable. */
  roles: string[];
  lastSignInAt: string | null;
};

export default function ViewAsList({ people }: { people: ViewAsPerson[] }) {
  const [q, setQ] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return people.slice(0, 40);
    return people
      .filter((p) =>
        [p.name ?? '', p.email, ...p.roles].join(' ').toLowerCase().includes(needle),
      )
      .slice(0, 40);
  }, [people, q]);

  async function start(p: ViewAsPerson) {
    setBusyId(p.id);
    setError(null);
    try {
      const res = await fetch('/api/admin/view-as', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: p.id }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(j.error || 'Could not switch.');
        setBusyId(null);
        return;
      }
      // A hard load: the auth cookies just changed, so every server component
      // already rendered on this page belongs to the wrong user.
      window.location.href = '/';
    } catch {
      setError('Network problem — try again.');
      setBusyId(null);
    }
  }

  return (
    <div className="mt-6">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search a name, email, club or team…"
        aria-label="Search accounts"
        style={{ color: '#ffffff' }}
        className="w-full rounded-xl border border-white/10 bg-[#001820] px-4 py-2.5 text-sm focus:border-[#D3FB52]/50 focus:outline-none"
      />

      {error && <p className="mt-3 text-sm text-red-300">{error}</p>}

      <div className="mt-4 space-y-2">
        {shown.length === 0 && (
          <p className="text-sm text-white/40">
            Nobody matches that. Someone who has never signed in has no account to open — check
            whether they were ever invited.
          </p>
        )}

        {shown.map((p) => (
          <div
            key={p.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/[0.08] bg-[#002838] p-4"
          >
            <div className="min-w-0">
              <div className="font-medium text-white">{p.name || p.email}</div>
              <div className="truncate text-sm text-white/40">
                {p.name ? `${p.email} · ` : ''}
                {p.roles.length ? p.roles.join(' · ') : 'no club role'}
              </div>
              {!p.lastSignInAt && (
                <div className="mt-1 text-xs text-amber-300/80">
                  never signed in — nothing to open yet
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => start(p)}
              disabled={busyId !== null || !p.lastSignInAt}
              className="shrink-0 rounded-lg bg-[#D3FB52] px-4 py-2 text-sm font-semibold text-[#001820] disabled:opacity-40"
            >
              {busyId === p.id ? 'Opening…' : 'View as'}
            </button>
          </div>
        ))}
      </div>

      {!q.trim() && people.length > shown.length && (
        <p className="mt-3 text-xs text-white/35">
          Showing {shown.length} of {people.length} accounts — search to narrow it.
        </p>
      )}
    </div>
  );
}
