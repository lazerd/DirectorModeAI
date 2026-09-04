'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/** One button, one job: start the trial and go straight to the team list. */
export default function StartTrialButton({
  source,
  signedIn,
}: {
  source: string;
  /** A visitor from a cold email has no account yet. */
  signedIn: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    // Sign-in happens at the moment of intent, not before the pitch, and comes
    // straight back here with the referral tag intact.
    if (!signedIn) {
      const back = `/captain/start${source ? `?ref=${encodeURIComponent(source)}` : ''}`;
      router.push(`/login?redirect=${encodeURIComponent(back)}`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/captain/trial', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(j.error || 'Could not start the trial.');
        return;
      }
      // Straight into the product. The next thing this captain should see is
      // the "add your team" screen, not a confirmation they have to dismiss.
      router.push('/captain');
      router.refresh();
    } catch {
      setError('Network problem — try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        onClick={start}
        disabled={busy}
        className="w-full sm:w-auto px-6 py-3 rounded-xl bg-[#D3FB52] text-[#001820] font-semibold hover:brightness-95 transition disabled:opacity-50"
      >
        {busy ? 'Starting…' : 'Start my free trial'}
      </button>
      {error && <p className="mt-2 text-sm text-red-300">{error}</p>}
    </div>
  );
}
