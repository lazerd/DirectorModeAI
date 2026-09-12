'use client';

/**
 * What is happening right now, at the top of every director screen.
 *
 * Built because a director could not find his own event. It was open for
 * signups, dated three weeks out, and reaching it meant knowing which of
 * seventeen tools owned it and then finding it in a list. The thing people are
 * signing up to today should be one click from wherever you are.
 *
 * It covers every format a club actually runs — mixers, socials, tournaments,
 * quads, team battles, leagues, JTT and classes taking sign-ups — because a bar
 * that only knew about one table would send a director back to guessing which
 * tool owns the thing they are looking for, which is the problem.
 *
 * Renders NOTHING when nothing is live, which is most of the time — a bar that
 * is always there stops being read. And it deliberately shows at most a few:
 * the server has already thrown out the events and leagues still flagged
 * running months after they finished, because a list of fifteen where two
 * matter is a list nobody checks twice.
 */

import { useCallback, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

type LiveItem = {
  id: string;
  name: string;
  kind: 'event' | 'league' | 'class';
  phase: 'live' | 'signup';
  daysAway: number | null;
  /** "Tournament" / "Mixer" / "League" / "Class" — the director's own word. */
  label: string;
  manage_href: string;
  public_href: string | null;
};

/**
 * Surfaces this must stay off.
 *
 * A club's own public site and the marketing pages are not places for the
 * operator's own to-do list — and `/c/*` in particular must carry no ClubMode
 * chrome at all.
 */
const HIDDEN = [
  '/c',
  '/pricing',
  '/login',
  '/register',
  '/verify-email',
  '/forgot-password',
  '/reset-password',
  '/terms',
  '/privacy',
  '/captainmode',
  '/invite',
  '/join',
  '/event',
  '/quads',
  '/tournaments',
  '/leagues',
  '/nps',
  '/book',
  '/open',
  '/find-coach',
  '/client',
  '/member',
  '/swim-family',
  '/pathway/p',
];

/** "in 3 weeks" / "tomorrow" / "today" — how a person says it. */
function when(e: LiveItem): string {
  if (e.phase === 'live') return e.kind === 'league' ? 'in progress' : 'underway';
  const d = e.daysAway;
  if (d === null) return 'open for signups';
  if (d === 0) return 'starts today';
  if (d === 1) return 'starts tomorrow';
  if (d < 14) return `in ${d} days`;
  const weeks = Math.round(d / 7);
  return `in ${weeks} ${weeks === 1 ? 'week' : 'weeks'}`;
}

export default function LiveEventsBar() {
  const pathname = usePathname() || '/';
  const [items, setItems] = useState<LiveItem[]>([]);
  const [dismissed, setDismissed] = useState<string[]>([]);

  const hidden =
    pathname === '/' ||
    HIDDEN.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/me/live-events');
      const j = (await res.json()) as { items?: LiveItem[] };
      setItems(j.items ?? []);
    } catch {
      /* no bar on any error — every tool still works */
    }
  }, []);

  useEffect(() => {
    if (hidden) return;
    load();
  }, [hidden, load]);

  useEffect(() => {
    // Per-session, per-item. Dismissing is for "yes, I know about that one
    // today" — it must not hide a live event forever.
    try {
      const raw = sessionStorage.getItem('cm-live-dismissed');
      if (raw) setDismissed(JSON.parse(raw) as string[]);
    } catch {
      /* private window, or storage blocked */
    }
  }, []);

  function dismiss(id: string) {
    const next = [...dismissed, id];
    setDismissed(next);
    try {
      sessionStorage.setItem('cm-live-dismissed', JSON.stringify(next));
    } catch {
      /* nothing to do — it just comes back next page */
    }
  }

  const shown = items.filter((e) => !dismissed.includes(e.id));
  if (hidden || shown.length === 0) return null;

  return (
    <div className="sticky top-0 z-40 border-b border-[#D3FB52]/20 bg-[#0a2a1a]/95 backdrop-blur">
      <div className="flex items-center gap-2 overflow-x-auto px-3 py-2 sm:px-4">
        <span className="shrink-0 text-[10px] font-bold uppercase tracking-[0.14em] text-[#D3FB52]">
          {shown.some((e) => e.phase === 'live') ? 'Happening now' : 'Open for signups'}
        </span>

        {shown.map((e) => (
          <span key={e.id} className="flex shrink-0 items-center gap-1.5">
            <a
              href={e.manage_href}
              className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1 text-sm text-white hover:border-[#D3FB52]/40"
            >
              {e.phase === 'live' && (
                <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-[#D3FB52]" />
              )}
              {/* Which of the seventeen tools this belongs to, said in a word —
                  so a row reads as a league and not as a mystery. */}
              <span className="shrink-0 rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/55">
                {e.label}
              </span>
              <span className="max-w-[14rem] truncate font-medium">{e.name}</span>
              <span className="shrink-0 text-xs text-white/45">{when(e)}</span>
            </a>
            {/* The link a director actually wants to hand out. */}
            {e.public_href && (
              <a
                href={e.public_href}
                target="_blank"
                rel="noreferrer"
                title="The page players see"
                className="shrink-0 rounded-lg px-1.5 py-1 text-xs text-white/35 hover:text-white"
              >
                ↗
              </a>
            )}
            <button
              type="button"
              onClick={() => dismiss(e.id)}
              title="Hide until next visit"
              className="shrink-0 px-1 text-white/25 hover:text-white/60"
            >
              ×
            </button>
          </span>
        ))}
      </div>
    </div>
  );
}
