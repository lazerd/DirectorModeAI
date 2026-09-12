'use client';

/**
 * "You changed the dates. Tell the families."
 *
 * Appears only after a change, and only when somebody is actually enrolled.
 * The sentence is written FOR the director from what changed — they read it,
 * optionally send a test to themselves, then send. That is the gesture that
 * replaces the phone call, and it is the reason the editor is worth paying for
 * rather than just being nicer than a developer.
 */

import { useState } from 'react';

export type PendingChange = {
  dates_removed: string[];
  dates_restored: string[];
  price_changed: boolean;
  old_price_cents: number | null;
  price_cents: number | null;
};

export default function NotifyPanel({
  programId,
  families,
  change,
  summary,
  onDone,
}: {
  programId: string;
  families: number;
  change: PendingChange;
  /** The plain-English diff, rendered by the caller so both agree. */
  summary: string;
  onDone: () => void;
}) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<null | 'test' | 'live'>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function send(mode: 'test' | 'live') {
    setBusy(mode);
    setError(null);
    setMsg(null);
    try {
      const res = await fetch(`/api/club-site/programs/${programId}/notify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode,
          dates_removed: change.dates_removed,
          dates_restored: change.dates_restored,
          price_cents: change.price_changed ? change.price_cents : null,
          note: note.trim() || undefined,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(j.error || 'Could not send.');
        setBusy(null);
        return;
      }
      if (mode === 'test') {
        setMsg('Test sent to you — check your inbox, then send it for real.');
        setBusy(null);
        return;
      }
      setMsg(`Sent to ${families} ${families === 1 ? 'family' : 'families'}.`);
      setBusy(null);
      // Leave the confirmation on screen for a beat before the panel closes,
      // so a director sees that it actually went.
      setTimeout(onDone, 1800);
    } catch {
      setError('Network problem — try again.');
      setBusy(null);
    }
  }

  return (
    <div className="mt-4 rounded-xl border border-[#D3FB52]/30 bg-[#D3FB52]/[0.06] p-4">
      <div className="text-sm font-semibold text-white">
        {families} {families === 1 ? 'family is' : 'families are'} signed up. Tell them?
      </div>
      <p className="mt-1 text-sm text-white/60">
        They&apos;ll get: &ldquo;{summary}&rdquo; — with the full list of dates as it stands now.
      </p>

      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        maxLength={600}
        placeholder="Anything to add? (optional)"
        style={{ color: '#ffffff' }}
        className="mt-3 w-full rounded-lg border border-white/10 bg-[#001820] px-3 py-2 text-sm focus:border-[#D3FB52]/50 focus:outline-none"
      />

      {error && <p className="mt-2 text-sm text-red-300">{error}</p>}
      {msg && <p className="mt-2 text-sm text-[#D3FB52]">{msg}</p>}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => send('live')}
          disabled={busy !== null}
          className="rounded-lg bg-[#D3FB52] px-4 py-2 text-sm font-semibold text-[#001820] disabled:opacity-50"
        >
          {busy === 'live' ? 'Sending…' : `Send to ${families}`}
        </button>
        <button
          type="button"
          onClick={() => send('test')}
          disabled={busy !== null}
          className="rounded-lg border border-white/15 px-4 py-2 text-sm font-medium text-white/70 hover:text-white disabled:opacity-50"
        >
          {busy === 'test' ? 'Sending…' : 'Send me a test first'}
        </button>
        <button
          type="button"
          onClick={onDone}
          disabled={busy !== null}
          className="px-3 py-2 text-sm text-white/45 hover:text-white/70"
        >
          Don&apos;t tell them
        </button>
      </div>
    </div>
  );
}
