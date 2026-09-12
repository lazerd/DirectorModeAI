'use client';

/**
 * What is happening right now, at the top of every director screen.
 *
 * Built because a director could not find his own event. It was open for
 * signups, dated three weeks out, and reaching it meant knowing which of
 * seventeen tools owned it and then finding it in a list. The thing people are
 * signing up to today should be one click from wherever you are.
 *
 * Renders NOTHING when nothing is live, which is most of the time — a bar that
 * is always there stops being read. And it deliberately shows at most a few:
 * the server has already thrown out events still flagged running months after
 * they happened, because a list of ten where one matters is a list nobody
 * checks twice.
 */

import { useCallback, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

type LiveEvent = {
  id: string;
  name: string;
  phase: 'live' | 'signup';
  days_away: number | null;
  date: string | null;
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
function when(e: LiveEvent): string {
  if (e.phase === 'live') return 'underway';
  const d = e.days_away;
  if (d === null) return 'open for signups';
  if (d === 0) return 'today';
  if (d === 1) return 'tomorrow';
  if (d < 14) return `in ${d} days`;
  const weeks = Math.round(d / 7);
  return `in ${weeks} ${weeks === 1 ? 'week' : 'weeks'}`;
}

export default function LiveEventsBar() {
  const pathname = usePathname() || '/';
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [dismissed, setDismissed] = useState<string[]>([]);

  const hidden =
    pathname === '/' ||
    HIDDEN.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/me/live-events');
      const j = (await res.json()) as { events?: LiveEvent[] };
      setEvents(j.events ?? []);
    } catch {
      /* no bar on any error — every tool still works */
    }
  }, []);

  useEffect(() => {
    if (hidden) return;
    load();
  }, [hidden, load]);

  useEffect(() => {
    // Per-session, per-event. Dismissing is for "yes, I know about that one
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

  const shown = events.filter((e) => !dismissed.includes(e.id));
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
              <span className="max-w-[15rem] truncate font-medium">{e.name}</span>
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
