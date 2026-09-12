'use client';

/**
 * Which club you are running, and how to change it.
 *
 * Renders nothing for the overwhelming majority of users, who run exactly one
 * club and should never be asked about it. It appears the moment somebody can
 * reach two — and that case exists for real: a platform operator who also runs
 * their own club, or a director helping at a second one.
 *
 * It exists because the alternative failed silently. Standing up a prospect's
 * club under a working director's account repointed all of that director's own
 * tools at somebody else's club, and there was no line of text anywhere on the
 * screen that would have told them. A thing this consequential has to be
 * visible even when it is right.
 */

import { useCallback, useEffect, useState } from 'react';

type Club = {
  id: string;
  name: string;
  slug: string;
  via: 'owner' | 'staff' | 'platform';
  role: string;
};

export default function ClubSwitcher({ collapsed }: { collapsed?: boolean }) {
  const [clubs, setClubs] = useState<Club[]>([]);
  const [active, setActive] = useState<Club | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/me/active-club');
      const j = (await res.json()) as { clubs?: Club[]; active?: Club | null };
      setClubs(j.clubs ?? []);
      setActive(j.active ?? null);
    } catch {
      /* no switcher on any error — the tools still work */
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function choose(clubId: string) {
    if (clubId === active?.id) {
      setOpen(false);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/me/active-club', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ club_id: clubId }),
      });
      if (!res.ok) {
        setBusy(false);
        return;
      }
      // A hard reload, not a router refresh: every server component on the
      // page was rendered for the club they are leaving.
      window.location.reload();
    } catch {
      setBusy(false);
    }
  }

  // One club is the normal case, and asking about it would be noise.
  if (clubs.length < 2 || !active) return null;

  const mine = clubs.filter((c) => c.via !== 'platform');
  const others = clubs.filter((c) => c.via === 'platform');

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={`Running ${active.name} — click to switch`}
        className="mx-auto flex h-9 w-9 items-center justify-center rounded-xl bg-[#D3FB52]/15 text-sm font-bold text-[#D3FB52]"
      >
        {active.name.charAt(0)}
      </button>
    );
  }

  return (
    <div className="relative px-2.5 py-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full rounded-xl border border-white/10 bg-[#001820] px-3 py-2 text-left hover:border-white/25"
      >
        <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/35">
          Running
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <span className="truncate text-sm font-semibold text-white">{active.name}</span>
          <span className="shrink-0 text-white/40">{open ? '▴' : '▾'}</span>
        </div>
        {active.via === 'platform' && (
          // Says so plainly: they are in somebody else's club as the platform,
          // not as its director.
          <div className="mt-0.5 text-[11px] text-amber-300">as ClubMode platform</div>
        )}
      </button>

      {open && (
        <div className="absolute left-2.5 right-2.5 z-50 mt-1 overflow-hidden rounded-xl border border-white/10 bg-[#002838] shadow-xl">
          {mine.length > 0 && (
            <>
              <div className="px-3 pt-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/30">
                Your clubs
              </div>
              {mine.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  disabled={busy}
                  onClick={() => choose(c.id)}
                  className={`block w-full px-3 py-2 text-left text-sm hover:bg-white/5 disabled:opacity-50 ${
                    c.id === active.id ? 'text-[#D3FB52]' : 'text-white/80'
                  }`}
                >
                  <span className="truncate">{c.name}</span>
                  <span className="ml-1.5 text-[11px] text-white/35">{c.role}</span>
                </button>
              ))}
            </>
          )}

          {others.length > 0 && (
            <>
              <div className="mt-1 border-t border-white/[0.06] px-3 pt-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/30">
                Every club on ClubMode
              </div>
              <div className="max-h-56 overflow-y-auto">
                {others.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    disabled={busy}
                    onClick={() => choose(c.id)}
                    className={`block w-full px-3 py-2 text-left text-sm hover:bg-white/5 disabled:opacity-50 ${
                      c.id === active.id ? 'text-[#D3FB52]' : 'text-white/60'
                    }`}
                  >
                    <span className="truncate">{c.name}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
