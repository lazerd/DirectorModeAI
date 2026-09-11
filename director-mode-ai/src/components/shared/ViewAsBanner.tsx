'use client';

/**
 * The bar that says whose screen you are on.
 *
 * While "view as" is on, the session IS the other person's and every write is
 * made in their name — so this cannot be subtle, cannot be dismissible, and
 * has to be on every page. It is fixed to the bottom rather than the top
 * because the top of these pages is where the club's own nav and headers live,
 * and a banner that pushes those down changes the very layout being inspected.
 */

import { useEffect, useState } from 'react';

export default function ViewAsBanner() {
  const [label, setLabel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
   * Asked for rather than rendered from the cookie in the root layout: reading
   * a cookie up there turns every static page dynamic to serve a bar that is
   * off almost all of the time.
   */
  useEffect(() => {
    let live = true;
    fetch('/api/admin/view-as')
      .then((r) => r.json())
      .then((j: { viewing?: boolean; label?: string }) => {
        if (live && j?.viewing) setLabel(j.label || 'another account');
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  async function exit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/view-as', { method: 'DELETE' });
      const j = (await res.json().catch(() => ({}))) as { error?: string; signed_out?: boolean };
      if (!res.ok) {
        setError(j.error || 'Could not switch back.');
        setBusy(false);
        return;
      }
      // A hard load, not router.refresh(): the auth cookies just changed under
      // the app, and every cached server component on this page was rendered
      // for the other user.
      window.location.href = j.signed_out ? '/login' : '/admin/view-as';
    } catch {
      setError('Network problem — try again.');
      setBusy(false);
    }
  }

  if (!label) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-[9999] border-t-2 border-amber-400 bg-amber-500 text-[#1a1200] print:hidden">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-2">
        <div className="text-sm font-semibold">
          Viewing as {label}
          <span className="ml-2 font-normal opacity-70">
            anything you change here is saved as them
          </span>
        </div>
        <div className="flex items-center gap-3">
          {error && <span className="text-xs font-medium text-red-900">{error}</span>}
          <button
            type="button"
            onClick={exit}
            disabled={busy}
            className="rounded-lg bg-[#1a1200] px-3 py-1.5 text-sm font-semibold text-amber-200 disabled:opacity-50"
          >
            {busy ? 'Switching back…' : 'Back to my account'}
          </button>
        </div>
      </div>
    </div>
  );
}
