'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function Switch({ on, queued }: { on: boolean; queued: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function flip() {
    const next = !on;
    const ask = next
      ? `Turn the autopilot on? ${queued} letter${queued === 1 ? '' : 's'} below will start going out inside each club's 8am-3pm window, and 6 more every weekday after that.`
      : 'Turn the autopilot off? Nothing more goes out, and letters not yet sent go back to waiting.';
    if (!window.confirm(ask)) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch('/api/crm/autopilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auto_send: next }),
      });
      if (!res.ok) setErr('That did not save.');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        disabled={busy}
        onClick={() => void flip()}
        className={
          on
            ? 'rounded-xl border border-red-400/50 px-4 py-2 text-sm font-semibold text-red-300 hover:bg-red-400/10 disabled:opacity-40'
            : 'rounded-xl bg-[#D3FB52] px-4 py-2 text-sm font-semibold text-[#001820] hover:bg-[#D3FB52]/90 disabled:opacity-40'
        }
      >
        {on ? 'Turn off' : 'Turn on'}
      </button>
      {err && <span className="text-sm text-red-300">{err}</span>}
    </div>
  );
}
