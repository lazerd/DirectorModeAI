'use client';

/**
 * Captain's view of the pre-season intake: send it, see who's answered, chase
 * the stragglers. The chase button only emails people who never submitted, so
 * nobody who already did the work gets nagged, and a single player can be
 * caught up on their own when they join after the first blast.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import EmailPreviewModal, { type EmailPreview } from './EmailPreviewModal';

type Row = { id: string; name: string; email: string | null; intake_completed_at: string | null };

export default function PreseasonPanel({ teamId, players }: { teamId: string; players: Row[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const done = players.filter((p) => p.intake_completed_at);
  const waiting = players.filter((p) => !p.intake_completed_at);
  const noEmail = players.filter((p) => !p.email);

  const [preview, setPreview] = useState<EmailPreview | null>(null);
  const [pending, setPending] = useState<{ onlyMissing: boolean; playerIds?: string[] }>({
    onlyMissing: false,
  });

  async function post(
    opts: { onlyMissing: boolean; playerIds?: string[] },
    isPreview: boolean,
  ) {
    const res = await fetch('/api/captain/preseason', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        team_id: teamId,
        only_missing: opts.onlyMissing,
        player_ids: opts.playerIds,
        preview: isPreview,
      }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Could not send.');
    return json;
  }

  /** Build it, show it, and wait. The button never sends on its own. */
  async function requestPreview(opts: { onlyMissing: boolean; playerIds?: string[] }) {
    setBusy(true);
    setMsg(null);
    setError(null);
    try {
      const json = await post(opts, true);
      setPending(opts);
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
      const json = await post(pending, false);
      const failedNames: string[] = json.failedNames || [];
      setMsg(
        `Sent to ${json.sent} player${json.sent === 1 ? '' : 's'}.` +
          // Name them — a bare "9 failed" leaves the captain with no way to recover.
          (json.failed
            ? ` ${json.failed} did NOT go through${failedNames.length ? `: ${failedNames.join(', ')}` : ''}. Send again to retry just them.`
            : '') +
          (json.skippedNoEmail ? ` ${json.skippedNoEmail} skipped — no email on file.` : ''),
      );
      setPreview(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  if (!players.length) return null;

  return (
    <section className="mt-10">
      <EmailPreviewModal
        preview={preview}
        sending={busy}
        onSend={confirmSend}
        onCancel={() => setPreview(null)}
      />
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-display text-white">Pre-season questions</h2>
        <span className="text-sm text-white/50">
          {done.length} of {players.length} answered
        </span>
      </div>

      <p className="text-sm text-white/50 mt-2">
        Asks each player who they partner best with, which side they return on, and any days they
        can never play. Their answers feed straight into lineup generation.
      </p>

      {msg && <p className="text-sm text-[#D3FB52] mt-3">{msg}</p>}
      {error && <p className="text-sm text-red-300 mt-3">{error}</p>}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          onClick={() => requestPreview({ onlyMissing: false })}
          disabled={busy}
          className="px-5 py-2.5 rounded-xl bg-[#D3FB52] text-[#001820] font-semibold disabled:opacity-50"
        >
          {busy
            ? 'Building preview…'
            : done.length
              ? 'Preview & send to everyone again'
              : 'Preview & send to the team'}
        </button>
        {waiting.length > 0 && done.length > 0 && (
          <button
            onClick={() => requestPreview({ onlyMissing: true })}
            disabled={busy}
            className="text-sm px-4 py-2 rounded-xl border border-white/10 text-white/70 hover:text-white hover:border-white/25 disabled:opacity-50"
          >
            Chase the {waiting.length} who haven&apos;t
          </button>
        )}
      </div>

      {noEmail.length > 0 && (
        <p className="text-xs text-amber-300/90 mt-3">
          ⚠ No email on file, so they can&apos;t be sent this: {noEmail.map((p) => p.name).join(', ')}
        </p>
      )}

      <div className="mt-5 grid gap-2 sm:grid-cols-2">
        {[
          { title: 'Answered', list: done, tone: 'text-[#D3FB52]' },
          { title: 'Still waiting', list: waiting, tone: 'text-white/40' },
        ].map(
          (g) =>
            g.list.length > 0 && (
              <div key={g.title}>
                <h3 className="text-white/50 text-xs uppercase tracking-wide mb-1">
                  {g.title} ({g.list.length})
                </h3>
                <ul className="space-y-1">
                  {g.list.map((p) => (
                    <li key={p.id} className={`text-sm ${g.tone} flex items-center gap-2 group`}>
                      <span>{p.name}</span>
                      {p.email && (
                        <button
                          onClick={() => requestPreview({ onlyMissing: false, playerIds: [p.id] })}
                          disabled={busy}
                          title={`Send the intake to ${p.name} only`}
                          className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-[11px] px-2 py-0.5 rounded-lg border border-white/15 text-white/60 hover:text-white hover:border-white/35 disabled:opacity-50 transition"
                        >
                          send
                        </button>
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
