'use client';

/**
 * "Email members" on an open game — preview first, then send.
 *
 * Preview is not decoration. This spends the club's email allowance and puts a
 * message in front of real members, so the director sees exactly who is about
 * to be written to, by name, before anything leaves. The second tap is the
 * send. Anyone this game has already emailed is left out by the API, so the
 * button cannot mail the same person about the same game twice.
 */

import { useState } from 'react';
import { Loader2, Mail } from 'lucide-react';

type Recipient = { name: string | null; email: string; level: number | null };

export default function NotifyAgain({ gameId, levelWord }: { gameId: string; levelWord: string }) {
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Recipient[] | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function call(isPreview: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/play/games/${gameId}/notify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preview: isPreview }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'That did not work.');
      if (isPreview) {
        setPreview(json.recipients as Recipient[]);
        if (!json.recipients?.length) setDone('Everyone who fits this game has already had the email.');
      } else {
        setPreview(null);
        setDone(json.message);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  }

  if (done) return <span className="mt-2 block text-xs text-emerald-300">{done}</span>;

  return (
    <div className="mt-2">
      {preview == null ? (
        <button
          onClick={() => call(true)}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg bg-white/[0.06] px-2.5 py-1.5 text-xs font-medium text-white/80 hover:bg-white/10 disabled:opacity-50"
        >
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Mail size={12} />} Email members
        </button>
      ) : (
        <div className="rounded-xl border border-[#D3FB52]/30 bg-[#D3FB52]/[0.06] p-3">
          <p className="text-xs font-semibold text-white">
            {preview.length} {preview.length === 1 ? 'member' : 'members'} would get this game
          </p>
          <ul className="mt-1.5 max-h-40 space-y-0.5 overflow-y-auto text-[11.5px] text-white/60">
            {preview.map((r) => (
              <li key={r.email}>
                {r.name || r.email}
                <span className="text-white/35">
                  {' '}
                  · {r.level == null ? `no ${levelWord}` : r.level} · {r.email}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex gap-2">
            <button
              onClick={() => call(false)}
              disabled={busy}
              className="rounded-lg bg-[#D3FB52] px-2.5 py-1.5 text-xs font-semibold text-[#002838] disabled:opacity-50"
            >
              {busy ? 'Sending…' : `Send to ${preview.length}`}
            </button>
            <button
              onClick={() => setPreview(null)}
              className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-white/50 hover:text-white/80"
            >
              Not now
            </button>
          </div>
        </div>
      )}
      {error && <span className="mt-1 block text-xs text-rose-300">{error}</span>}
    </div>
  );
}
