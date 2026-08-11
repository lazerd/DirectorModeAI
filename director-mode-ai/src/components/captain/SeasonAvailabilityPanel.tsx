'use client';

/**
 * One blast for the whole season. Nine per-match polls is nine chances for a
 * player to ignore you; this asks once, lists every date, and then chases only
 * the people with gaps left.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import EmailPreviewModal, { type EmailPreview } from './EmailPreviewModal';

type Row = { id: string; name: string; email: string | null; answered: number };

export default function SeasonAvailabilityPanel({
  teamId,
  totalMatches,
  players,
}: {
  teamId: string;
  totalMatches: number;
  players: Row[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const complete = players.filter((p) => p.email && p.answered >= totalMatches);
  const partial = players.filter((p) => p.email && p.answered > 0 && p.answered < totalMatches);
  const none = players.filter((p) => p.email && p.answered === 0);
  const noEmail = players.filter((p) => !p.email);

  const [preview, setPreview] = useState<EmailPreview | null>(null);
  const [pendingOnlyMissing, setPendingOnlyMissing] = useState(false);

  async function post(onlyMissing: boolean, isPreview: boolean) {
    const res = await fetch('/api/captain/season-poll', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ team_id: teamId, only_missing: onlyMissing, preview: isPreview }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Could not send.');
    return json;
  }

  /** Build it, show it, and wait. The button never sends on its own. */
  async function requestPreview(onlyMissing: boolean) {
    setBusy(true);
    setMsg(null);
    setError(null);
    try {
      const json = await post(onlyMissing, true);
      if (json.skipped || json.count === 0) {
        setMsg('Nobody needed it — everyone has answered every date.');
        return;
      }
      setPendingOnlyMissing(onlyMissing);
      setPreview(json as EmailPreview);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  async function confirmSend() {
    setBusy(true);
    setError(null);
    try {
      const json = await post(pendingOnlyMissing, false);
      setMsg(
        json.sent === 0
          ? 'Nobody needed it — everyone has answered every date.'
          : `Sent to ${json.sent} player${json.sent === 1 ? '' : 's'}, covering all ${json.matches} match dates.`,
      );
      setPreview(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  if (!players.length || totalMatches === 0) return null;

  const outstanding = partial.length + none.length;

  return (
    <section className="mt-10">
      <EmailPreviewModal
        preview={preview}
        sending={busy}
        onSend={confirmSend}
        onCancel={() => setPreview(null)}
      />
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-display text-white">Season availability</h2>
        <span className="text-sm text-white/50">
          {complete.length} of {players.length} fully answered
        </span>
      </div>

      <p className="text-sm text-white/50 mt-2">
        Emails each player one message listing all {totalMatches} match dates, times and locations,
        with a personal link to mark Yes / No / Maybe for every one. No login, works all season.
      </p>

      {msg && <p className="text-sm text-[#D3FB52] mt-3">{msg}</p>}
      {error && <p className="text-sm text-red-300 mt-3">{error}</p>}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          onClick={() => requestPreview(false)}
          disabled={busy}
          className="px-5 py-2.5 rounded-xl bg-[#D3FB52] text-[#001820] font-semibold disabled:opacity-50"
        >
          {busy
            ? 'Building preview…'
            : complete.length
              ? 'Preview & send to everyone again'
              : 'Preview & send to the team'}
        </button>
        {outstanding > 0 && complete.length > 0 && (
          <button
            onClick={() => requestPreview(true)}
            disabled={busy}
            className="text-sm px-4 py-2 rounded-xl border border-white/10 text-white/70 hover:text-white hover:border-white/25 disabled:opacity-50"
          >
            Chase the {outstanding} with gaps
          </button>
        )}
      </div>

      {noEmail.length > 0 && (
        <p className="text-xs text-amber-300/90 mt-3">
          ⚠ No email on file, so they can&apos;t be sent this: {noEmail.map((p) => p.name).join(', ')}
        </p>
      )}

      <div className="mt-5 grid gap-4 sm:grid-cols-3">
        {[
          { title: 'All dates in', list: complete, tone: 'text-[#D3FB52]' },
          { title: 'Partly done', list: partial, tone: 'text-amber-200/90' },
          { title: 'Nothing yet', list: none, tone: 'text-white/40' },
        ].map(
          (g) =>
            g.list.length > 0 && (
              <div key={g.title}>
                <h3 className="text-white/50 text-xs uppercase tracking-wide mb-1">
                  {g.title} ({g.list.length})
                </h3>
                <ul className="space-y-1">
                  {g.list.map((p) => (
                    <li key={p.id} className={`text-sm ${g.tone}`}>
                      {p.name}
                      {p.answered > 0 && p.answered < totalMatches && (
                        <span className="text-white/30"> · {p.answered}/{totalMatches}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ),
        )}
      </div>
    </section>
  );
}
