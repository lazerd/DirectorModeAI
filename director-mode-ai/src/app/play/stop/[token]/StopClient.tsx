'use client';

import { useEffect, useRef, useState } from 'react';
import { Notice, postJson, primaryBtn, secondaryBtn } from '@/components/partnerFinder/ui';

export default function StopClient({ token, clubName }: { token: string; clubName: string }) {
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ran = useRef(false);

  async function set(next: boolean) {
    setBusy(true);
    setError(null);
    const r = await postJson<{ notify_games?: boolean }>(`/api/play/stop/${token}`, { on: next });
    setBusy(false);
    if (r.error) return setError(r.error);
    setOn(!!r.notify_games);
  }

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    set(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-12 text-slate-900">
      <div className="mx-auto max-w-xl space-y-6">
        <p className="text-lg text-slate-600">{clubName}</p>
        {error ? (
          <>
            <Notice tone="bad">{error}</Notice>
            <button onClick={() => set(false)} disabled={busy} className={`${primaryBtn} w-full`}>
              Try again
            </button>
          </>
        ) : on === null ? (
          <h1 className="text-3xl font-bold">One moment…</h1>
        ) : on === false ? (
          <>
            <h1 className="text-3xl font-bold leading-tight">You won&rsquo;t get emails about games that need players.</h1>
            <p className="text-lg text-slate-700">
              You&rsquo;ll still hear about games you&rsquo;ve joined or posted, and you can still find games on the club&rsquo;s board.
            </p>
            <button onClick={() => set(true)} disabled={busy} className={`${secondaryBtn} w-full`}>
              Turn these emails back on
            </button>
          </>
        ) : (
          <>
            <h1 className="text-3xl font-bold leading-tight">Game emails are back on.</h1>
            <p className="text-lg text-slate-700">We&rsquo;ll email you when a game at {clubName} needs a player at your level.</p>
            <button onClick={() => set(false)} disabled={busy} className={`${secondaryBtn} w-full`}>
              Stop them again
            </button>
          </>
        )}
      </div>
    </main>
  );
}
