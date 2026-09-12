'use client';

/**
 * Giving a court back.
 *
 * A single button behind a link in the confirmation email. It asks once,
 * because a court released by accident is a court somebody else has taken by
 * the time you notice.
 */

import { useState } from 'react';

export default function CancelBooking({
  clubSlug,
  token,
  theme,
}: {
  clubSlug: string;
  token: string;
  theme: { primary: string; onPrimary: string; ink: string; muted: string; border: string; surface: string };
}) {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'already'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [refundOwed, setRefundOwed] = useState(false);

  async function cancel() {
    setState('busy');
    setError(null);
    try {
      const res = await fetch(
        `/api/clubs/${encodeURIComponent(clubSlug)}/courts/cancel/${encodeURIComponent(token)}`,
        { method: 'POST' },
      );
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        already?: boolean;
        refund_owed?: boolean;
        error?: string;
      };
      if (!res.ok) {
        setError(j.error || 'Could not cancel that booking.');
        setState('idle');
        return;
      }
      setRefundOwed(!!j.refund_owed);
      setState(j.already ? 'already' : 'done');
    } catch {
      setError('Network problem — try again.');
      setState('idle');
    }
  }

  if (state === 'done' || state === 'already') {
    return (
      <div
        className="rounded-2xl border p-6"
        style={{ borderColor: theme.border, background: theme.surface }}
      >
        <div className="text-3xl">{state === 'already' ? '👍' : '✅'}</div>
        <h2 className="mt-3 text-xl font-bold">
          {state === 'already' ? 'Already cancelled' : 'Cancelled'}
        </h2>
        <p className="mt-2 text-sm" style={{ color: theme.muted }}>
          {state === 'already'
            ? 'This booking was already released — nothing more to do.'
            : 'The court is back in the pool. Thanks for letting us know.'}
        </p>
        {refundOwed && (
          <p className="mt-3 text-sm font-medium" style={{ color: theme.ink }}>
            You had already paid for this one — the club will be in touch about a refund.
          </p>
        )}
      </div>
    );
  }

  return (
    <div
      className="rounded-2xl border p-6"
      style={{ borderColor: theme.border, background: theme.surface }}
    >
      <p className="text-base">Release this court so somebody else can take it?</p>
      {error && <p className="mt-3 text-sm font-medium text-red-600">{error}</p>}
      <button
        type="button"
        onClick={cancel}
        disabled={state === 'busy'}
        className="mt-4 rounded-xl px-5 py-3 text-sm font-bold disabled:opacity-50"
        style={{ background: theme.primary, color: theme.onPrimary }}
      >
        {state === 'busy' ? 'Cancelling…' : 'Yes, cancel my booking'}
      </button>
    </div>
  );
}
