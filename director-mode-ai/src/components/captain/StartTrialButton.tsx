'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/** One button, one job: start the trial and go straight to the team list. */
export default function StartTrialButton({ source }: { source: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
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
