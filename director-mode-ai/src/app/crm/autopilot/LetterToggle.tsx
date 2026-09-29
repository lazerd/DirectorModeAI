'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/** One letter in or out of the split test. Letters already queued keep theirs. */
export default function LetterToggle({ variant, on }: { variant: string; on: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function flip() {
    setBusy(true);
    try {
      await fetch('/api/crm/autopilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ variant, on: !on }),
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => void flip()}
      className={
        on
          ? 'rounded-lg bg-[#D3FB52]/15 px-2.5 py-1 text-xs font-semibold text-[#D3FB52] hover:bg-[#D3FB52]/25 disabled:opacity-40'
          : 'rounded-lg border border-white/15 px-2.5 py-1 text-xs font-semibold text-white/45 hover:text-white/70 disabled:opacity-40'
      }
    >
      {on ? 'On' : 'Paused'}
    </button>
  );
}
