'use client';

/**
 * Every player's name, email and mobile — one grid, one Save.
 *
 * This was three separate things stacked down the page: the roster, a "no email
 * on file" warning inside the season-availability panel, and a mobile-numbers
 * panel further down. A captain setting up a team had to find all three and
 * work out that they were the same job. Darrin, doing exactly that on his own
 * JTT team: "i feel like this could all be combined into the roster section
 * (make it just one section) at the very top."
 *
 * So: one section, at the top, with the gaps called out — because an empty
 * email column is the reason every email feature below it silently does
 * nothing.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatPhone } from '@/lib/captain/phone';

export type ContactRow = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  contact2_name: string | null;
  contact2_email: string | null;
  contact2_phone: string | null;
  is_sub: boolean;
};

type Draft = { email?: string; phone?: string };

const field =
  'w-full px-2.5 py-2 rounded-lg bg-[#001820] border border-white/10 placeholder-white/25 focus:border-[#D3FB52]/50 focus:outline-none text-sm';
// globals.css styles bare inputs outside Tailwind's layers and wins the
// cascade — the colour has to be inline. See RosterPanel.
const INPUT_COLOR = { color: '#ffffff' } as const;

export default function RosterContactsPanel({
  teamId,
  players,
  /** Juniors: the contact is a parent, and there are usually two. */
  juniors,
}: {
  teamId: string;
  players: ContactRow[];
  juniors: boolean;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Record<string, Draft>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const valueFor = (p: ContactRow, k: keyof Draft) =>
    draft[p.id]?.[k] ?? (k === 'phone' ? formatPhone(p.phone) || '' : p.email || '');

  const set = (id: string, k: keyof Draft, v: string) =>
    setDraft((d) => ({ ...d, [id]: { ...d[id], [k]: v } }));

  const pending = Object.keys(draft).length > 0;
  const noEmail = players.filter((p) => !p.email?.trim());
  const noPhone = players.filter((p) => !p.phone?.trim());

  async function save() {
    const updates = Object.entries(draft).map(([player_id, d]) => ({ player_id, ...d }));
    if (!updates.length) return;
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const res = await fetch('/api/captain/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ team_id: teamId, updates }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(j.error || 'Could not save.');
        return;
      }
      const bad = (j.rejected as { name: string; value: string }[]) || [];
      if (bad.length) {
        // Name what failed. A count leaves the captain hunting for it.
        setError(
          `Saved ${j.saved}. Could not read: ${bad
            .map((b) => `${b.name} (“${b.value}”)`)
            .join(', ')} — use 10 digits, or +1 and the number.`,
        );
      } else {
        setMsg(`Saved ${j.saved} ${j.saved === 1 ? 'player' : 'players'}.`);
      }
      setDraft({});
      router.refresh();
    } catch {
      setError('Network problem — try again.');
    } finally {
      setBusy(false);
    }
  }

  if (!players.length) return null;

  return (
    <div className="mt-4 rounded-2xl border border-white/[0.08] bg-[#002838] p-5">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h3 className="text-white font-medium">
          {juniors ? 'Parent contact details' : 'Contact details'}
        </h3>
        <span className="text-white/45 text-sm">
          {players.length - noEmail.length} of {players.length} emails ·{' '}
          {players.length - noPhone.length} of {players.length} mobiles
        </span>
      </div>

      <p className="text-white/40 text-xs mt-1">
        {juniors
          ? 'Availability, lineups and match reminders go to the parent. Without an email a player simply never hears from the team.'
          : 'Without an email a player never gets the availability poll or the lineup. The mobile is for a late change on match day.'}
      </p>

      {(noEmail.length > 0 || noPhone.length > 0) && (
        <p className="text-amber-200/80 text-xs mt-2">
          {noEmail.length > 0 && (
            <>
              No email yet for <strong>{noEmail.map((p) => p.name).join(', ')}</strong>.
            </>
          )}
          {noEmail.length > 0 && noPhone.length > 0 && ' '}
          {noPhone.length > 0 && <>No mobile for {noPhone.map((p) => p.name).join(', ')}.</>}
        </p>
      )}

      {msg && <p className="text-sm text-[#D3FB52] mt-3">{msg}</p>}
      {error && <p className="text-sm text-red-300 mt-3">{error}</p>}

      <div className="mt-4 space-y-2">
        {/* Column headers, so the two boxes are never a guess. */}
        <div className="hidden sm:grid sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1fr)] gap-2 text-[11px] uppercase tracking-wider text-white/30">
          <span>Player</span>
          <span>{juniors ? 'Parent email' : 'Email'}</span>
          <span>Mobile</span>
        </div>

        {players.map((p) => (
          <div
            key={p.id}
            className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1fr)] gap-2 items-center"
          >
            <span className="min-w-0 truncate text-white text-sm">
              {p.name}
              {p.is_sub && <span className="text-white/30 text-xs"> · sub</span>}
            </span>
            <input
              type="email"
              inputMode="email"
              autoComplete="off"
              placeholder={juniors ? 'parent@example.com' : 'player@example.com'}
              value={valueFor(p, 'email')}
              onChange={(e) => set(p.id, 'email', e.target.value)}
              style={INPUT_COLOR}
              className={field}
            />
            <input
              type="tel"
              inputMode="tel"
              autoComplete="off"
              placeholder="925-555-0148"
              value={valueFor(p, 'phone')}
              onChange={(e) => set(p.id, 'phone', e.target.value)}
              onKeyDown={(e) => {
                // Enter saves the lot — a captain working down the list with a
                // phone in the other hand shouldn't have to aim for a button.
                if (e.key === 'Enter' && pending) {
                  e.preventDefault();
                  void save();
                }
              }}
              style={INPUT_COLOR}
              className={field}
            />
          </div>
        ))}
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={save}
          disabled={busy || !pending}
          className="px-5 py-2.5 rounded-xl bg-[#D3FB52] text-[#001820] font-semibold text-sm disabled:opacity-50"
        >
          {busy ? 'Saving…' : pending ? 'Save contact details' : 'Nothing to save'}
        </button>
        {pending && (
          <button
            onClick={() => setDraft({})}
            disabled={busy}
            className="text-sm text-white/50 hover:text-white"
          >
            Undo changes
          </button>
        )}
      </div>
    </div>
  );
}
